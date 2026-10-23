import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand, runNode, makeTempDir } from '../proc.mjs';
import { parseTrailers, buildMessage } from '../squash-branch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'squash-branch.mjs');
const ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  GIT_CONFIG_GLOBAL: path.join(HERE, 'nonexistent-gitconfig'), GIT_CONFIG_SYSTEM: path.join(HERE, 'nonexistent-gitconfig'),
};
const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function git(cwd, ...args) {
  const r = runCommand('git', args, { cwd, env: ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function repo() {
  const dir = makeTempDir('dmes-squash-');
  roots.push(dir);
  git(dir, 'init', '-q', '-b', 'dev');
  git(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, 'base.txt', 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: init');
  git(dir, 'checkout', '-q', '-b', 'lane');
  return dir;
}
function write(dir, name, text) { fs.writeFileSync(path.join(dir, name), text); }
function commit(dir, name, text, msg) {
  write(dir, name, text);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
}
const run = (dir, ...args) => runNode(SCRIPT, args, { cwd: dir, env: ENV });
const count = (dir, range) => Number(git(dir, 'rev-list', '--count', range));

test('커밋 여러 개 → 하나로, 트리 동일, 본문에 체크포인트 제목(오래된 것부터)', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  commit(d, 'a.txt', '3\n', 'fix: a again');
  const tree = git(d, 'rev-parse', 'HEAD^{tree}');
  const old = git(d, 'rev-parse', 'HEAD');
  const r = run(d, '--onto', 'dev', '--subject', 'feat(x): 한 번에 합친다');
  assert.equal(r.status, 0, r.stderr);
  const newSha = git(d, 'rev-parse', 'HEAD');
  assert.equal(r.stdout.trim(), `SQUASH_OK ${old} → ${newSha} commits=3`);
  assert.equal(count(d, 'dev..HEAD'), 1);
  assert.equal(git(d, 'rev-parse', 'HEAD^{tree}'), tree);
  assert.equal(git(d, 'rev-parse', 'HEAD^'), git(d, 'rev-parse', 'dev'));
  const msg = git(d, 'log', '-1', '--format=%B');
  assert.match(msg, /^feat\(x\): 한 번에 합친다\n\nSquashed commits \(3\):\n- wip: a\n- wip: b\n- fix: a again$/);
});

test('dev 를 합친 브랜치: merge-base 가 옮겨 가서 레인 변경만 담긴 비-merge commit 하나', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  git(d, 'checkout', '-q', 'dev');
  commit(d, 'dev1.txt', 'd1\n', 'feat: dev work 1');
  commit(d, 'dev2.txt', 'd2\n', 'feat: dev work 2');
  git(d, 'checkout', '-q', 'lane');
  git(d, 'merge', '-q', '--no-ff', '-m', 'merge: dev into lane', 'dev');
  commit(d, 'b.txt', '2\n', 'wip: b');
  git(d, 'checkout', '-q', 'dev');
  commit(d, 'dev3.txt', 'd3\n', 'feat: dev work 3');   // dev 가 더 앞서 감
  git(d, 'checkout', '-q', 'lane');
  const tree = git(d, 'rev-parse', 'HEAD^{tree}');
  const r = run(d, '--onto', 'dev', '--subject', 'feat(y): 합침');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SQUASH_OK [0-9a-f]{40} → [0-9a-f]{40} commits=3$/m);   // wip a, merge, wip b
  assert.equal(git(d, 'rev-parse', 'HEAD^{tree}'), tree);
  assert.equal(git(d, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 2);   // 부모 하나
  // 레인 변경(a.txt, b.txt)만 담김: 부모(= merge 한 dev 지점) 대비 diff
  assert.equal(git(d, 'diff', '--name-only', 'HEAD^', 'HEAD').split('\n').sort().join(','), 'a.txt,b.txt');
  assert.equal(git(d, 'rev-parse', 'HEAD^'), git(d, 'rev-parse', 'dev~1'));
  const msg = git(d, 'log', '-1', '--format=%B');
  assert.ok(!msg.includes('merge: dev into lane'), '합친 dev 의 merge commit 제목은 본문에 안 넣음');
  assert.ok(msg.includes('- wip: a') && msg.includes('- wip: b'));
  // 합친 결과가 dev 위로 깨끗하게 merge 됨
  git(d, 'checkout', '-q', 'dev');
  git(d, 'merge', '-q', '--no-ff', '-m', 'merge lane', 'lane');
  assert.equal(count(d, 'dev~1..dev'), 2);
});

test('더러운 트리 → SQUASH_DIRTY, 종료 2, HEAD 그대로', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  const old = git(d, 'rev-parse', 'HEAD');
  write(d, 'a.txt', 'dirty\n');
  const r = run(d, '--onto', 'dev', '--subject', 's');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^SQUASH_DIRTY /);
  assert.equal(git(d, 'rev-parse', 'HEAD'), old);
});

test('untracked 파일은 막지 않고 경고만', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  write(d, 'scratch.tmp', 'x\n');
  const r = run(d, '--onto', 'dev', '--subject', 'feat: s');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /SQUASH_WARN_UNTRACKED 1/);
  assert.equal(count(d, 'dev..HEAD'), 1);
});

test('이미 하나: SQUASH_ALREADY_ONE <sha>, 제목 바꾸면 다시 씀', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'feat: only');
  const sha = git(d, 'rev-parse', 'HEAD');
  let r = run(d, '--onto', 'dev', '--subject', 'feat: only');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), `SQUASH_ALREADY_ONE ${sha}`);
  r = run(d, '--onto', 'dev');
  assert.equal(r.stdout.trim(), `SQUASH_ALREADY_ONE ${sha}`);
  assert.equal(git(d, 'rev-parse', 'HEAD'), sha);
  r = run(d, '--onto', 'dev', '--subject', 'feat: renamed');
  assert.match(r.stdout, /^SQUASH_OK /);
  assert.equal(git(d, 'log', '-1', '--format=%s'), 'feat: renamed');
  assert.equal(count(d, 'dev..HEAD'), 1);
});

test('commit 없음: SQUASH_NOTHING 종료 0', () => {
  const d = repo();
  const r = run(d, '--onto', 'dev', '--subject', 's');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'SQUASH_NOTHING');
});

test('trailer 보존: 중복 제거, 처음 나온 순서, Co-Authored-By · DFlow-*', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a\n\nbody a\n\nDFlow-Task: TSK-1\nCo-Authored-By: Claude <noreply@anthropic.com>');
  commit(d, 'b.txt', '2\n', 'wip: b\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nDFlow-Order: 7');
  commit(d, 'c.txt', '3\n', 'wip: c');
  const r = run(d, '--onto', 'dev', '--subject', 'feat: t', '--trailer', 'Extra-Key: v1');
  assert.equal(r.status, 0, r.stderr);
  const msg = git(d, 'log', '-1', '--format=%B');
  const tail = msg.split('\n\n').pop();
  assert.equal(tail, 'DFlow-Task: TSK-1\nCo-Authored-By: Claude <noreply@anthropic.com>\nDFlow-Order: 7\nExtra-Key: v1');
});

test('--rebase: dev 가 앞서 갔으면 합친 commit 을 tip 위로 옮김 → ff-only 로 선형 병합 가능', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  git(d, 'checkout', '-q', 'dev');
  commit(d, 'dev1.txt', 'd1\n', 'feat: dev work');
  git(d, 'checkout', '-q', 'lane');
  const tip = git(d, 'rev-parse', 'dev');
  const r = run(d, '--onto', 'dev', '--subject', 'feat: lane', '--rebase');
  assert.equal(r.status, 0, r.stderr);
  const fin = git(d, 'rev-parse', 'HEAD');
  assert.match(r.stdout.trim(), new RegExp(`^SQUASH_OK [0-9a-f]{40} → ${fin} commits=2 rebased=${tip}$`));
  assert.equal(git(d, 'rev-parse', 'HEAD^'), tip);
  assert.equal(count(d, 'dev..HEAD'), 1);
  assert.equal(git(d, 'diff', '--name-only', 'HEAD^', 'HEAD').split('\n').sort().join(','), 'a.txt,b.txt');
  git(d, 'checkout', '-q', 'dev');
  git(d, 'merge', '-q', '--ff-only', 'lane');
  assert.equal(git(d, 'rev-parse', 'dev'), fin);
  assert.equal(git(d, 'rev-list', '--merges', '--count', 'HEAD'), '0');
});

test('--rebase: 이미 하나인 commit 도 tip 이 앞서 있으면 옮김(SQUASH_REBASED), tip 위면 그대로', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'feat: only');
  let r = run(d, '--onto', 'dev', '--rebase');
  assert.match(r.stdout, /^SQUASH_ALREADY_ONE [0-9a-f]{40}$/m);
  git(d, 'checkout', '-q', 'dev');
  commit(d, 'dev1.txt', 'd1\n', 'feat: dev work');
  git(d, 'checkout', '-q', 'lane');
  const before = git(d, 'rev-parse', 'HEAD');
  r = run(d, '--onto', 'dev', '--rebase');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), `SQUASH_REBASED ${before} → ${git(d, 'rev-parse', 'HEAD')} onto=${git(d, 'rev-parse', 'dev')}`);
  assert.equal(git(d, 'rev-parse', 'HEAD^'), git(d, 'rev-parse', 'dev'));
});

test('--rebase 충돌: SQUASH_REBASE_CONFLICT 파일 목록, 종료 3, 원래 HEAD 로 복원', () => {
  const d = repo();
  commit(d, 'base.txt', 'lane edit\n', 'wip: lane a');
  commit(d, 'x.txt', 'x\n', 'wip: lane b');
  git(d, 'checkout', '-q', 'dev');
  commit(d, 'base.txt', 'dev edit\n', 'feat: dev edit');
  git(d, 'checkout', '-q', 'lane');
  const old = git(d, 'rev-parse', 'HEAD');
  const r = run(d, '--onto', 'dev', '--subject', 'feat: lane', '--rebase');
  assert.equal(r.status, 3);
  assert.match(r.stdout, /^SQUASH_REBASE_CONFLICT base\.txt$/m);
  assert.equal(git(d, 'rev-parse', 'HEAD'), old);
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(git(d, 'rev-parse', '--abbrev-ref', 'HEAD'), 'lane');
});

test('--drop-trailer: 지정한 키(대소문자 무시)만 빠지고 나머지는 남음', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a\n\nDFlow-Order: 7\nDFlow-Unit: A done');
  commit(d, 'b.txt', '2\n', 'wip: b\n\nDFlow-Order: 7\nDFlow-Unit: B handoff\nDFlow-Escalate: B x');
  const r = run(d, '--onto', 'dev', '--subject', 'feat: d', '--drop-trailer', 'dflow-unit', '--drop-trailer', 'DFlow-Escalate');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(d, 'log', '-1', '--format=%B').split('\n\n').pop(), 'DFlow-Order: 7');
});

test('--body-file 은 제목 다음, 체크포인트 목록 앞', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  const f = path.join(d, '..', `body-${path.basename(d)}.txt`);
  fs.writeFileSync(f, '레인 요약 한 줄\n');
  roots.push(f);
  const r = run(d, '--onto', 'dev', '--subject', 'feat: b', '--body-file', f);
  assert.equal(r.status, 0, r.stderr);
  assert.match(git(d, 'log', '-1', '--format=%B'), /^feat: b\n\n레인 요약 한 줄\n\nSquashed commits \(2\):/);
});

test('--dry-run: 아무것도 안 바꾸고 메시지 출력', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  const old = git(d, 'rev-parse', 'HEAD');
  const r = run(d, '--onto', 'dev', '--subject', 'feat: dry', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^SQUASH_DRYRUN commits=2 base=[0-9a-f]{40}\n---\nfeat: dry\n\nSquashed commits \(2\):/);
  assert.equal(git(d, 'rev-parse', 'HEAD'), old);
});

test('사용 오류: --subject 없이 2개 이상, 없는 --onto', () => {
  const d = repo();
  commit(d, 'a.txt', '1\n', 'wip: a');
  commit(d, 'b.txt', '2\n', 'wip: b');
  let r = run(d, '--onto', 'dev');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^SQUASH_NEED_SUBJECT/);
  r = run(d, '--onto', 'nope', '--subject', 's');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /^SQUASH_NO_ONTO/);
  r = run(d);
  assert.equal(r.status, 2);
  r = run(d, '--help');
  assert.equal(r.status, 0);
});

test('parseTrailers · buildMessage 단위', () => {
  assert.deepEqual(parseTrailers('subject only'), []);
  assert.deepEqual(parseTrailers('s\n\nbody text here: not trailer\nmore'), []);
  assert.deepEqual(parseTrailers('s\n\nbody\n\nA-B: 1\nC: 2\n'), ['A-B: 1', 'C: 2']);
  const m = buildMessage({ subject: 'feat: x', commits: [{ subject: 'm', merge: true, message: 'm' }, { subject: 'w', merge: false, message: 'w\n\nK: v' }] });
  assert.equal(m, 'feat: x\n\nSquashed commits (1):\n- w\n\nK: v\n');
});
