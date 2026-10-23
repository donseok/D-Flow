// squash-branch.mjs — 레인·작업 브랜치를 통합 브랜치 위 commit 하나로 합친다 (2026-10-10 결정: 통합 브랜치 모양 = 레인·작업당 commit 1, merge commit 없음, `git merge --ff-only`).
//
//   사용: node squash-branch.mjs --onto <통합브랜치|ref> [--subject "<제목>"] [--body-file <파일>] [--trailer "<키: 값>"]… [--drop-trailer <키>]… [--rebase] [--git-bin <git>] [--dry-run]
//
// 동작
//   1. 추적 파일이 깨끗해야 함(untracked 는 무시, 개수만 stderr 경고). merge·rebase 진행 중이어도 dirty.
//   2. base = merge-base(HEAD, onto). 통합 브랜치를 브랜치에 먼저 합쳤으면 base 가 그 합친 commit 으로 옮겨 가서 레인 변경만 남는다.
//   3. base..HEAD 의 commit 수 n(merge commit 포함) 을 센다.
//        n = 0                              → SQUASH_NOTHING
//        n = 1, merge 아님, --subject 없음/같음 → SQUASH_ALREADY_ONE <sha>
//        그 밖 → soft reset base + commit 1개. 제목 = --subject(필수), 본문 = --body-file + 합친 commit 제목(오래된 것부터, 최신이 마지막)
//        + 합친 commit 메시지의 trailer(중복 제거, 처음 나온 순서; --drop-trailer 키는 뺌) + --trailer.
//   4. commit 뒤 트리(HEAD^{tree}) 가 합치기 전과 같은지 검증. 다르면 원래 HEAD 로 되돌리고 SQUASH_TREE_MISMATCH.
//   5. --rebase: 합친 뒤(또는 이미 하나인 경우) base 가 onto tip 이 아니면 `git rebase <onto tip>` 로 그 commit 을 tip 위로 옮긴다.
//      충돌이면 rebase --abort + 원래 HEAD 로 복원하고 `SQUASH_REBASE_CONFLICT <파일…>` 종료 3. (풀려면: 통합 브랜치를 브랜치에 merge·충돌 해소 → 다시 실행. 그러면 base = tip 이라 rebase 불필요)
//   성공 출력: `SQUASH_OK <old-sha> → <new-sha> commits=<n>` (rebase 했으면 끝에 ` rebased=<tip-sha>`, new-sha = rebase 뒤 최종 SHA)
//   이미 하나 + rebase 함: `SQUASH_REBASED <old-sha> → <new-sha> onto=<tip-sha>`
//   --dry-run: 아무것도 바꾸지 않고 `SQUASH_DRYRUN commits=<n> base=<sha>` 와 만들 메시지를 출력.
//   commit 은 --no-verify 로 만든다(내용 변화 없는 재포장이라 hook 재실행 불필요).
//
// 종료 코드
//   0  SQUASH_OK · SQUASH_NOTHING · SQUASH_ALREADY_ONE · SQUASH_DRYRUN
//   1  SQUASH_TREE_MISMATCH(원래 HEAD 로 복원함) · git 실패(SQUASH_GIT_FAILED)
//   2  사용 오류 · SQUASH_DIRTY · SQUASH_NO_ONTO · SQUASH_NEED_SUBJECT(n≥2 인데 --subject 없음)
//   3  SQUASH_REBASE_CONFLICT(원래 HEAD 로 복원함)
//
// node 18.17 이상, 외부 패키지 없음, bash/sed/jq 안 씀.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCli, finish, OK, VIOLATION, USAGE } from './args.mjs';
import { runCommand } from './proc.mjs';

const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*\s*:\s*\S/;

/** 메시지 마지막 문단이 trailer 문단이면 그 줄들(이어지는 줄은 앞 줄에 붙임). 제목 문단 하나뿐이면 없음. */
export function parseTrailers(message) {
  const text = message.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  const paras = text.split(/\n\s*\n/);
  if (paras.length < 2) return [];
  const lines = paras[paras.length - 1].split('\n');
  const out = [];
  for (const l of lines) {
    if (TRAILER_LINE.test(l)) out.push(l.trimEnd());
    else if (/^\s+\S/.test(l) && out.length > 0) out[out.length - 1] += `\n${l.trimEnd()}`;
    else if (l.startsWith('(cherry picked from')) continue;
    else return [];   // trailer 문단이 아님
  }
  return out;
}

/** 합친 commit 메시지를 만든다. commits = 오래된 것부터 [{sha, subject, merge, message}] */
export function buildMessage({ subject, body = '', commits, extraTrailers = [], dropTrailers = [] }) {
  const drop = new Set(dropTrailers.map((k) => k.toLowerCase()));
  const parts = [subject.trim()];
  if (body.trim() !== '') parts.push(body.trim());
  const list = commits.filter((c) => !c.merge).map((c) => `- ${c.subject}`);
  if (list.length > 0) parts.push(`Squashed commits (${list.length}):\n${list.join('\n')}`);
  const seen = new Set();
  const trailers = [];
  for (const line of [...commits.flatMap((c) => parseTrailers(c.message)), ...extraTrailers]) {
    if (drop.has(line.split(':')[0].trim().toLowerCase())) continue;
    if (!seen.has(line)) { seen.add(line); trailers.push(line); }
  }
  if (trailers.length > 0) parts.push(trailers.join('\n'));
  return `${parts.join('\n\n')}\n`;
}

class Fail extends Error {
  constructor(code, line) { super(line); this.code = code; }
}

/**
 * 합치기 본체. 출력 줄은 돌려주고(out), 종료 코드는 code 로 돌려준다. 호출 쪽(CLI·시험)이 출력한다.
 * opts: {cwd, onto, subject, body, extraTrailers, gitBin, dryRun}
 */
export function squash(opts) {
  const { cwd, onto, subject, body = '', extraTrailers = [], dropTrailers = [], gitBin = 'git', dryRun = false, rebase = false } = opts;
  const out = [];
  const warn = [];
  const git = (args, { input, allowFail = false } = {}) => {
    const r = runCommand(gitBin, args, { cwd, input });
    if (r.status !== 0 && !allowFail) throw new Fail(VIOLATION, `SQUASH_GIT_FAILED git ${args.join(' ')}: ${(r.stderr || r.error || '').trim()}`);
    return r;
  };
  /** squash 뒤(또는 이미 하나) 단계: base 가 onto tip 이 아니면 그 한 commit 을 tip 위로 rebase */
  const rebasePhase = ({ kind, base, oldSha, n }) => {
    const tip = git(['rev-parse', `${onto}^{commit}`]).stdout.trim();
    const cur = git(['rev-parse', 'HEAD']).stdout.trim();
    if (base === tip) {
      out.push(kind === 'ok' ? `SQUASH_OK ${oldSha} → ${cur} commits=${n}` : `SQUASH_ALREADY_ONE ${cur}`);
      return { code: OK, out, warn };
    }
    const rb = git(['rebase', tip], { allowFail: true });
    if (rb.status !== 0) {
      const files = git(['diff', '--name-only', '--diff-filter=U'], { allowFail: true }).stdout.split('\n').filter(Boolean);
      git(['rebase', '--abort'], { allowFail: true });
      git(['reset', '--hard', oldSha], { allowFail: true });
      throw new Fail(3, `SQUASH_REBASE_CONFLICT ${files.join(' ')}\n원래 HEAD ${oldSha} 로 복원함. ${onto} 를 브랜치에 merge·충돌 해소 뒤 다시 실행`);
    }
    const fin = git(['rev-parse', 'HEAD']).stdout.trim();
    const par = git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(/\s+/);
    if (par.length !== 2 || par[1] !== tip) {
      git(['reset', '--hard', oldSha], { allowFail: true });
      throw new Fail(VIOLATION, `SQUASH_TREE_MISMATCH rebase 뒤 부모가 ${onto} tip 이 아니다. 원래 HEAD ${oldSha} 로 복원함`);
    }
    out.push(kind === 'ok' ? `SQUASH_OK ${oldSha} → ${fin} commits=${n} rebased=${tip}` : `SQUASH_REBASED ${cur} → ${fin} onto=${tip}`);
    return { code: OK, out, warn };
  };
  try {
    const head = git(['rev-parse', 'HEAD'], { allowFail: true });
    if (head.status !== 0) throw new Fail(USAGE, 'SQUASH_NO_HEAD HEAD 가 없다(commit 이 없는 저장소)');
    const oldSha = head.stdout.trim();

    // 1. 깨끗한지
    const st = git(['status', '--porcelain', '--untracked-files=all']);
    const rows = st.stdout.split('\n').filter((l) => l !== '');
    const tracked = rows.filter((l) => !l.startsWith('??'));
    const untracked = rows.length - tracked.length;
    const inProgress = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].some((r) => git(['rev-parse', '-q', '--verify', r], { allowFail: true }).status === 0);
    if (tracked.length > 0 || inProgress) {
      throw new Fail(USAGE, `SQUASH_DIRTY ${inProgress ? 'merge·cherry-pick 진행 중' : `추적 파일 변경 ${tracked.length}건`} — commit 하거나 되돌린 뒤 다시`);
    }
    if (untracked > 0) warn.push(`SQUASH_WARN_UNTRACKED ${untracked}건은 합치기에 안 들어간다`);

    // 2. base
    const ontoOk = git(['rev-parse', '--verify', '-q', `${onto}^{commit}`], { allowFail: true });
    if (ontoOk.status !== 0) throw new Fail(USAGE, `SQUASH_NO_ONTO 통합 브랜치(ref)를 못 찾음: ${onto}`);
    const mb = git(['merge-base', 'HEAD', onto], { allowFail: true });
    if (mb.status !== 0 || mb.stdout.trim() === '') throw new Fail(USAGE, `SQUASH_NO_BASE HEAD 와 ${onto} 의 공통 조상이 없다`);
    const base = mb.stdout.trim();

    // 3. commit 목록(오래된 것부터). 필드 구분 = NUL, commit 구분 = SOH
    const lg = git(['log', '--reverse', '--format=%H%x00%P%x00%s%x00%B%x01', `${base}..HEAD`]);
    const commits = lg.stdout.split('\x01').map((s) => s.replace(/^\n/, '')).filter((s) => s.trim() !== '').map((s) => {
      const [sha, parents, subj, ...rest] = s.split('\x00');
      return { sha, subject: subj, merge: parents.trim().split(/\s+/).filter(Boolean).length > 1, message: rest.join('\x00') };
    });
    const n = commits.length;
    if (n === 0) { out.push('SQUASH_NOTHING'); return { code: OK, out, warn }; }

    const curSubject = commits[0].subject;
    const sameSubject = subject === undefined || subject.trim() === curSubject.trim();
    if (n === 1 && !commits[0].merge && sameSubject && body.trim() === '' && extraTrailers.length === 0) {
      if (!rebase) { out.push(`SQUASH_ALREADY_ONE ${commits[0].sha}`); return { code: OK, out, warn }; }
      return rebasePhase({ kind: 'already', base, oldSha, n });
    }
    if (subject === undefined || subject.trim() === '') throw new Fail(USAGE, `SQUASH_NEED_SUBJECT commit ${n}개를 합치려면 --subject 가 필요하다`);

    const message = buildMessage({ subject, body, commits, extraTrailers, dropTrailers });
    if (dryRun) {
      out.push(`SQUASH_DRYRUN commits=${n} base=${base}`, '---', message.replace(/\n+$/, ''));
      return { code: OK, out, warn };
    }

    // 4. soft reset → commit 1개 → 트리 검증
    const treeBefore = git(['rev-parse', 'HEAD^{tree}']).stdout.trim();
    git(['reset', '--soft', base]);
    const c = git(['commit', '--no-verify', '-q', '-F', '-'], { input: message, allowFail: true });
    if (c.status !== 0) {
      git(['reset', '--soft', oldSha], { allowFail: true });
      throw new Fail(VIOLATION, `SQUASH_GIT_FAILED git commit: ${(c.stderr || c.stdout || '').trim()} (원래 HEAD ${oldSha} 로 복원)`);
    }
    const newSha = git(['rev-parse', 'HEAD']).stdout.trim();
    const treeAfter = git(['rev-parse', 'HEAD^{tree}']).stdout.trim();
    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).stdout.trim().split(/\s+/).length - 1;
    if (treeAfter !== treeBefore || parents !== 1) {
      git(['reset', '--hard', oldSha], { allowFail: true });
      throw new Fail(VIOLATION, `SQUASH_TREE_MISMATCH 트리 ${treeBefore} ≠ ${treeAfter} (parents=${parents}). 원래 HEAD ${oldSha} 로 복원함`);
    }
    if (!rebase) { out.push(`SQUASH_OK ${oldSha} → ${newSha} commits=${n}`); return { code: OK, out, warn }; }
    return rebasePhase({ kind: 'ok', base, oldSha, n });
  } catch (e) {
    if (e instanceof Fail) { out.push(e.message); return { code: e.code, out, warn }; }
    throw e;
  }
}

export function main(argv, { cwd = process.cwd() } = {}) {
  const cli = parseCli(argv, {
    prog: 'squash-branch.mjs',
    description: '브랜치를 통합 브랜치 위 commit 하나로 합친다(soft reset + commit, 트리 동일 검증)',
    options: {
      onto: { type: 'string', required: true, help: '통합 브랜치 또는 ref' },
      subject: { type: 'string', help: '합친 commit 제목(Conventional Commits). commit 이 2개 이상이면 필수' },
      'body-file': { type: 'string', help: '본문 앞부분에 넣을 글 파일' },
      trailer: { type: 'string', multiple: true, help: '추가 trailer "Key: value"' },
      'drop-trailer': { type: 'string', multiple: true, help: '합친 commit 에 안 넣을 trailer 키(예: DFlow-Unit). 여러 번 가능' },
      'git-bin': { type: 'string', help: 'git 실행 파일(기본 git)' },
      rebase: { type: 'boolean', help: '합친 뒤 그 commit 을 --onto tip 위로 rebase(충돌이면 복원 후 종료 3)' },
      'dry-run': { type: 'boolean', help: '바꾸지 않고 만들 메시지만 출력' },
    },
  });
  if (!cli) return process.exitCode ?? USAGE;
  const v = cli.values;
  let body = '';
  if (v['body-file']) {
    try { body = fs.readFileSync(path.resolve(cwd, v['body-file']), 'utf8').replace(/\r\n?/g, '\n'); }
    catch (e) { process.stderr.write(`squash-branch.mjs: 오류: --body-file 읽기 실패: ${e.message}\n`); return finish(USAGE); }
  }
  const r = squash({
    cwd, onto: v.onto, subject: v.subject, body, extraTrailers: v.trailer ?? [], dropTrailers: v['drop-trailer'] ?? [],
    gitBin: v['git-bin'] || process.env.GIT_BIN || 'git', dryRun: Boolean(v['dry-run']), rebase: Boolean(v.rebase),
  });
  for (const w of r.warn) process.stderr.write(`${w}\n`);
  const text = `${r.out.join('\n')}\n`;
  process.stdout.write(text);
  if (r.code !== OK) process.stderr.write(text);
  return finish(r.code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) main(process.argv.slice(2));
