// decision-log.mjs 와 dflow-merge/scripts/decisions.mjs 가 공유하는 두 규칙의 시험.
//  1) 머리 줄 규칙: 줄 꼴별 표를 mjs(ENTRY_RE)와 decisions.mjs(HRE 리터럴)에 같이 넣어 같은 판정이 나오는지 본다.
//     (유니코드 숫자 머리 `## D-٣ (ts)` 는 일부러 뺀다: python 판과 바이트까지 맞춘 mjs 는 받고, decisions.mjs 는 ASCII 숫자만 받는다. 실제 기록에 없다.)
//  2) 번호 매김 일치: `## D-002 (ts) 비고` 가 낀 파일에서 decisions.mjs renumber 가 매긴 번호를 validate 가 받아들이는지 본다.
//  3) 동시 append: 프로세스 여럿이 한꺼번에 쓰면 항목이 모두 남고 번호가 겹치지 않아야 한다. 잠금의 시간 상한·오래된 잠금 정리도 본다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { makeTempDir } from '../../_shared/node/proc.mjs';
import { LockError, _parse_entries, acquire_lock, validate_decisions } from '../scripts/decision-log.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'decision-log.mjs');
const DECISIONS_MJS = path.join(HERE, '..', '..', 'dflow-merge', 'scripts', 'decisions.mjs');

const tmps = [];
const tmp = (p) => {
  const d = fs.realpathSync(makeTempDir(p));
  tmps.push(d);
  return d;
};
after(() => {
  for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
});

/** decisions.mjs 의 HRE 리터럴 값을 파일 글에서 꺼낸다(스크립트를 실행하지 않고). */
function headRe() {
  const m = fs.readFileSync(DECISIONS_MJS, 'utf8').match(/^const HRE = (\/.*\/);$/m);
  assert.ok(m, 'decisions.mjs 에서 HRE 를 찾지 못했다');
  return new RegExp(m[1].slice(1, -1));
}
// dflow-merge 의 decisions.mjs 가 없는 리포(D-Flow 정본 — dflow-merge 는 아직 이 판이 아니다)에서는 그 스크립트와 맞대는 시험을 건너뛴다.
const NO_MERGE = !fs.existsSync(DECISIONS_MJS) && 'dflow-merge/scripts/decisions.mjs 가 없다(이 리포의 dflow-merge 는 그 스크립트를 동봉하지 않는다)';
const HRE_RE = NO_MERGE ? null : headRe();

const TS = '2026-10-07T00:00:00Z';
// [줄, 머리인가]
const HEAD_TABLE = [
  [`## D-001 (${TS})`, true],
  [`## D-1 (${TS})`, true],
  [`## D-12345 (${TS})`, true],
  [`## D-001 (${TS})   `, true],
  [`## D-001 (${TS})\t`, true],
  [`## D-001 (${TS})\r`, true],
  [`## D-002 (${TS}) 비고`, false],
  [`## D-002 (${TS}) (재기록)`, false],
  [`## D-002(${TS})`, false],
  [`## D-002  (${TS})`, false],
  ['## D-002 ()', false],
  ['## D-002 (a (b))', false],
  [`## D-TSK-01-02-1 (${TS})`, false],
  [`### D-001 (${TS})`, false],
  [`# D-001 (${TS})`, false],
  [` ## D-001 (${TS})`, false],
  [`## D- (${TS})`, false],
  [`## d-001 (${TS})`, false],
  ['## Decisions Log', false],
  [`- **Rationale**: ## D-001 (${TS})`, false],
];

for (const [line, expected] of HEAD_TABLE) {
  const label = JSON.stringify(line);
  test(`머리 줄 규칙 mjs: ${label} → ${expected}`, () => {
    assert.equal(_parse_entries(`${line}\n`).length === 1, expected);
  });
  test(`머리 줄 규칙 decisions.mjs: ${label} → ${expected}`, { skip: NO_MERGE }, () => {
    assert.equal(HRE_RE.test(line), expected);
  });
}

// ---------------------------------------------------------------------------
// 번호 매김 일치
// ---------------------------------------------------------------------------

function git(cwd, ...args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

test('renumber 가 매긴 번호를 validate 가 받아들인다(머리 뒤에 글이 붙은 줄이 낀 파일)', { skip: NO_MERGE }, () => {
  const repo = tmp('declog-renumber-');
  git(repo, 'init', '-q');
  const block = (head, n) => `${head}\n- **Phase**: wbs\n- **Decision needed**: q${n}\n- **Decision made**: a${n}\n- **Rationale**: r${n}\n`;
  const body =
    '# Decisions Log — project\n\n' +
    `${block(`## D-001 (${TS})`, 1)}\n` +
    `${block(`## D-002 (${TS}) 비고`, 2)}\n` + // 머리가 아니므로 D-001 본문의 일부다
    `${block(`## D-TSK-01-1 (${TS})`, 3)}`;
  fs.writeFileSync(path.join(repo, 'decisions.md'), body);
  git(repo, 'add', 'decisions.md');
  git(repo, 'commit', '-q', '-m', 'seed');

  const r = spawnSync(process.execPath, [DECISIONS_MJS, 'renumber', '-C', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RENUMBERED D-TSK-01-1=D-002 decisions\.md/);
  assert.equal(fs.existsSync(path.join(repo, 'decisions.md.lock')), false, '잠금이 남았다');
  const v = validate_decisions(repo);
  assert.deepEqual(v.errors, []);
  assert.equal(v.entry_count, 2);
});

// ---------------------------------------------------------------------------
// 잠금
// ---------------------------------------------------------------------------

function runAppend(target, n) {
  return new Promise((resolve) => {
    const c = spawn(
      process.execPath,
      [SCRIPT, 'append', '--target', target, '--phase', 'wbs', '--decision-needed', `q${n}`, '--decision-made', `a${n}`, '--rationale', `r${n}`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    c.on('close', (code) => resolve({ code, out, err }));
  });
}

// 잠금이 없으면 겹침이 확률적으로만 나타나므로(12개 한 번은 통과하기도 했다) 16개씩 5회 돌려 놓치지 않게 한다.
test('동시 append: 16개 프로세스를 5회 한꺼번에 돌려도 항목이 모두 남고 번호가 겹치지 않는다', async () => {
  const N = 16;
  for (let round = 0; round < 5; round++) {
    const dir = tmp('declog-concurrent-');
    const results = await Promise.all(Array.from({ length: N }, (_, i) => runAppend(dir, i + 1)));
    for (const r of results) assert.equal(r.code, 0, r.err);
    const ids = results.map((r) => JSON.parse(r.out).id).sort((a, b) => a - b);
    assert.deepEqual(ids, Array.from({ length: N }, (_, i) => i + 1), `${round + 1}회차`);
    const v = validate_decisions(dir);
    assert.deepEqual(v.errors, []);
    assert.equal(v.entry_count, N);
    const made = _parse_entries(fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8')).map((e) => e.fields.get('Decision made')).sort();
    assert.deepEqual(made, Array.from({ length: N }, (_, i) => `a${i + 1}`).sort());
    assert.equal(fs.existsSync(path.join(dir, 'decisions.md.lock')), false, '잠금이 남았다');
  }
});

test('잠금: 다른 프로세스가 잡고 있으면 시간 상한 뒤 LockError', () => {
  const dir = tmp('declog-lock-busy-');
  const lock = path.join(dir, 'decisions.md.lock');
  const release = acquire_lock(lock);
  try {
    const t0 = Date.now();
    assert.throws(() => acquire_lock(lock, { timeout_ms: 300 }), LockError);
    assert.ok(Date.now() - t0 >= 250);
  } finally {
    release();
  }
  assert.equal(fs.existsSync(lock), false);
  acquire_lock(lock, { timeout_ms: 300 })(); // 풀린 뒤에는 다시 잡힌다
});

test('잠금: 오래된(죽은 프로세스의) 잠금은 치우고 진행한다', async () => {
  const dir = tmp('declog-lock-stale-');
  const lock = path.join(dir, 'decisions.md.lock');
  fs.mkdirSync(lock);
  const old = new Date(Date.now() - 20 * 60_000);
  fs.utimesSync(lock, old, old);
  const r = await runAppend(dir, 1);
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(validate_decisions(dir).entry_count, 1);
});

test('잠금: decisions.mjs 도 오래된 잠금을 치우고 같은 이름의 잠금을 남기지 않는다', { skip: NO_MERGE }, () => {
  const repo = tmp('declog-sh-stale-');
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'decisions.md'), '# Decisions Log — project\n');
  git(repo, 'add', 'decisions.md');
  git(repo, 'commit', '-q', '-m', 'seed');
  const lock = path.join(repo, 'decisions.md.lock');
  fs.mkdirSync(lock);
  const old = new Date(Date.now() - 20 * 60_000);
  fs.utimesSync(lock, old, old);
  const r = spawnSync(process.execPath, [DECISIONS_MJS, 'renumber', '-C', repo], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /NO_TEMP_IDS/);
  assert.equal(fs.existsSync(lock), false);
});

test('잠금: decisions.mjs 는 남이 쥔 잠금이 풀리기를 기다렸다가 진행한다', { skip: NO_MERGE }, async () => {
  const repo = tmp('declog-sh-wait-');
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'decisions.md'), '# Decisions Log — project\n');
  git(repo, 'add', 'decisions.md');
  git(repo, 'commit', '-q', '-m', 'seed');
  const lock = path.join(repo, 'decisions.md.lock');
  fs.mkdirSync(lock); // 방금 만든 잠금 = 살아 있는 잠금
  const t0 = Date.now();
  const child = spawn(process.execPath, [DECISIONS_MJS, 'renumber', '-C', repo], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const done = new Promise((resolve) => child.on('close', resolve));
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(child.exitCode, null, '잠금이 풀리기 전에 끝났다');
  fs.rmdirSync(lock);
  assert.equal(await done, 0, out);
  assert.ok(Date.now() - t0 >= 700);
  assert.match(out, /NO_TEMP_IDS/);
  assert.equal(fs.existsSync(lock), false);
});

test('잠금: decisions.mjs 는 시그널로 끝나도 잠금을 남기지 않는다', { skip: NO_MERGE }, async () => {
  const repo = tmp('declog-sh-term-');
  git(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'decisions.md'), '# Decisions Log — project\n');
  git(repo, 'add', 'decisions.md');
  git(repo, 'commit', '-q', '-m', 'seed');
  const lock = path.join(repo, 'decisions.md.lock');
  fs.mkdirSync(lock); // 남의 잠금 때문에 sh 가 대기 중일 때 TERM 을 받는 경우
  const child = spawn(process.execPath, [DECISIONS_MJS, 'renumber', '-C', repo], { stdio: 'ignore' });
  const done = new Promise((resolve) => child.on('close', (code, sig) => resolve({ code, sig })));
  await new Promise((r) => setTimeout(r, 500));
  child.kill('SIGTERM');
  const r = await done;
  assert.ok(r.code === 130 || r.sig === 'SIGTERM', JSON.stringify(r));
  assert.equal(fs.existsSync(lock), true, '남의 잠금을 지웠다'); // 못 잡은 잠금은 건드리지 않는다
});
