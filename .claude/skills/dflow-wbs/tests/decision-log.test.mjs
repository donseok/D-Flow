// decision-log.mjs 시험. python 원본(tests/golden/legacy/decision-log.legacy.py)에는 단위 시험이 없어(실제 호출로만 덮임) 새로 쓴다.
//  1) 단위 시험: 함수를 직접 불러(시각은 `timestamp` 인자로 고정) 형식·번호·검증 규칙을 확인한다.
//  2) 골든 비교: decision-cases.mjs 의 사례를 python legacy 와 node 판이 각자 새 임시 저장소에서 같은 인자로 돌려
//     stdout·stderr·종료 코드와 저장소 파일 전체를 비교한다(시각은 `<TS>` 로 정규화. python 이 없으면 skip).
//  3) 교차 시험: python 이 쓴 decisions.md 를 node 판이 읽고(list·validate), node 판이 쓴 파일을 python 판이 읽고 이어 쓴다.
//     단계마다 판을 번갈아 돌린 결과가 한 판만으로 돌린 결과와 같아야 한다(python 이 없으면 skip).
//  4) 기대값 비교: tests/golden/expected/decision-log.json(python 으로 미리 계산) 과 node 판 결과 비교, 그리고
//     "python 이 쓴 파일(기대값에 박힘)을 node 판이 읽은 결과" 비교 — python 이 없는 PC 에서도 돈다.
//  5) 실제 리포 docs/mdm/decisions.md(수백 KB) 읽기 비교와, 그 사본에 양쪽이 append 한 결과 비교.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { runNode, makeTempDir } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import {
  ALLOWED_PHASES, ENTRY_RE, FIELD_RE, REQUIRED_FIELDS, ValueError, _format_entry, _next_id, _parse_entries, _scope_label_from_dir,
  _utc_iso, append_decision, decisions_path_of, list_decisions, validate_decisions,
} from '../scripts/decision-log.mjs';
import { argparse_compat_argv, cp_index, cp_slice, py_read_text } from '../scripts/_pyio.mjs';
import { legacyEnv } from './legacy-env-decision-prd.mjs';
import { CASES, CROSS_CASES, fromNode } from './decision-cases.mjs';
import { diffResults, normText, runCase, winPaths } from './case-runner.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'decision-log.mjs');
const EXPECTED = path.join(HERE, 'golden', 'expected', 'decision-log.json');
const REPO = path.join(HERE, '..', '..', '..', '..');

const env = legacyEnv();
const tmps = [];
const tmp = (p) => {
  const d = fs.realpathSync(makeTempDir(p));
  tmps.push(d);
  return d;
};
after(() => {
  env.cleanup();
  for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
});

const nodeRunner = (args, cwd) => runNode(SCRIPT, args, { cwd, normalizeEol: true });
const pyRunner = (args, cwd) => env.python([env.script('decision-log.py'), ...args], { cwd });
const mixedRunner = (args, cwd, step) => (step.impl === 'py' ? pyRunner(args, cwd) : nodeRunner(args, cwd));
const nodeOpts = { fix: (t) => fromNode(t) };

// ---- 1) 단위 시험 ------------------------------------------------------------

const TS = '2026-10-07T01:02:03Z';
const OK4 = ['design', 'n', 'm', 'r'];

test('ALLOWED_PHASES 는 9개 화이트리스트', () => {
  assert.deepEqual([...ALLOWED_PHASES].sort(), ['build', 'design', 'dev-team-merge', 'feat-intake', 'prd-resolve', 'refactor', 'test', 'wbs', 'wbs-resolve']);
  assert.deepEqual([...REQUIRED_FIELDS].sort(), ['Decision made', 'Decision needed', 'Phase', 'Rationale']);
});

test('_utc_iso: UTC 초 단위 + Z', () => {
  assert.match(_utc_iso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

// python 이 없는 PC 에서도 시각이 UTC 로 기록되는지 본다(시각을 고정한 래퍼로 append 해 파일 내용을 그대로 비교).
test('append: 고정 시각 래퍼로 쓴 기록은 UTC 시각 그대로(python 없이)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-utc-'));
  try {
    const wrapper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'decision-log-fixed-time.mjs');
    const r = spawnSync(process.execPath, [wrapper, 'append', '--target', dir, '--phase', 'build', '--decision-needed', 'a', '--decision-made', 'b', '--rationale', 'c'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const text = fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');
    assert.match(text, /^## D-001 \(2026-10-07T00:00:00Z\)$/m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ENTRY_RE·FIELD_RE: 줄 시작·끝은 \\n 기준(python re.MULTILINE), \\s 는 python 공백', () => {
  const e = (s) => [...s.matchAll(ENTRY_RE)].map((m) => [m[1], m[2]]);
  assert.deepEqual(e('## D-001 (t)\n'), [['001', 't']]);
  assert.deepEqual(e('x\n## D-2 (a b)  \n## D-3 (c)'), [['2', 'a b'], ['3', 'c']]);
  assert.deepEqual(e(' ## D-1 (t)'), []);
  assert.deepEqual(e('a\r## D-1 (t)'), []); // \r 뒤는 줄 시작이 아니다
  assert.deepEqual(e('a ## D-1 (t)'), []); // U+2028 뒤도 아니다
  assert.deepEqual(e('## D-1 (t) \n'), [['1', 't']]); // python \s 가 U+2028 을 먹는다
  assert.deepEqual(e('## D-1 (t) x\n'), []);
  assert.deepEqual(e('## D-１ (t)\n'), [['１', 't']]);
  const f = (s) => [...s.matchAll(FIELD_RE)].map((m) => [m[1], m[2]]);
  assert.deepEqual(f('- **Phase**: design  \n'), [['Phase', 'design']]);
  assert.deepEqual(f('- **Phase**:\n- **X**: y'), [['Phase', '- **X**: y']]);
  assert.deepEqual(f('- **K**:'), [['K', '']]);
  assert.deepEqual(f('x - **K**: v'), []);
});

test('_parse_entries: 번호·시각·필드·raw', () => {
  const content = '# h\n\n## D-001 (t1)\n- **Phase**: design\n- **Rationale**: r\n\n## D-002 (t2)\n- **Phase**: build\n';
  const es = _parse_entries(content);
  assert.equal(es.length, 2);
  assert.equal(es[0].id, 1);
  assert.equal(es[0].timestamp, 't1');
  assert.deepEqual([...es[0].fields], [['Phase', 'design'], ['Rationale', 'r']]);
  assert.equal(es[0].raw, '## D-001 (t1)\n- **Phase**: design\n- **Rationale**: r');
  assert.equal(es[1].raw, '## D-002 (t2)\n- **Phase**: build');
  assert.deepEqual(_parse_entries(''), []);
  assert.deepEqual(_parse_entries('# only header'), []);
});

test('_parse_entries: 전각·아랍 숫자와 앞의 0', () => {
  const es = _parse_entries('## D-００２ (a)\n## D-٣ (b)\n## D-0007 (c)\n## D-\u{1d7d1} (d)\n## D-\u{1d7d9}\u{1d7d8} (e)\n');
  assert.deepEqual(es.map((e) => e.id), [2, 3, 7, 3, 10]);
});

test('_next_id: 비면 1, 아니면 최댓값+1(순서·중복 무관)', () => {
  assert.equal(_next_id([]), 1);
  assert.equal(_next_id([{ id: 1 }, { id: 3 }]), 4);
  assert.equal(_next_id([{ id: 7 }, { id: 2 }, { id: 7 }]), 8);
});

test('_format_entry: 4필드 + 선택 필드, 번호는 3자리 이상', () => {
  assert.equal(_format_entry(1, TS, 'design', 'N', 'M', 'R', null, null), `## D-001 (${TS})\n- **Phase**: design\n- **Decision needed**: N\n- **Decision made**: M\n- **Rationale**: R\n`);
  assert.equal(_format_entry(12, TS, 'build', 'N', 'M', 'R', 'yes', 'a.ts:1'), `## D-012 (${TS})\n- **Phase**: build\n- **Decision needed**: N\n- **Decision made**: M\n- **Rationale**: R\n- **Reversible**: yes\n- **Source**: a.ts:1\n`);
  assert.ok(_format_entry(1000, TS, 'build', 'N', 'M', 'R', null, null).startsWith('## D-1000 ('));
  assert.ok(_format_entry(5, TS, 'build', 'N', 'M', 'R', null, '').endsWith('- **Source**: \n')); // 빈 문자열 source 도 줄을 남긴다(None 만 생략)
});

test('append_decision: 새 파일은 머리글 + D-001, 이어 붙이면 빈 줄 하나 + 다음 번호', () => {
  const root = tmp('dlog-unit-');
  const t = path.join(root, 'docs', 'tasks', 'TSK-04-02');
  const r1 = append_decision(t, 'design', 'N1', 'M1', 'R1', null, null, null, TS);
  assert.deepEqual(r1, { id: 1, timestamp: TS, path: path.join(t, 'decisions.md') });
  const r2 = append_decision(t, 'build', 'N2', 'M2', 'R2', 'no', 'x:1', '무시되는 라벨', '2026-10-08T00:00:00Z');
  assert.equal(r2.id, 2);
  assert.equal(
    fs.readFileSync(path.join(t, 'decisions.md'), 'utf8'),
    '# Decisions Log — TSK-04-02\n\n' +
      '> Append-only audit trail of autonomous decisions made during DDTR/feat/wbs cycles.\n' +
      '> Edit prior entries forbidden — record reversals as new entries instead.\n\n' +
      `## D-001 (${TS})\n- **Phase**: design\n- **Decision needed**: N1\n- **Decision made**: M1\n- **Rationale**: R1\n\n` +
      '## D-002 (2026-10-08T00:00:00Z)\n- **Phase**: build\n- **Decision needed**: N2\n- **Decision made**: M2\n- **Rationale**: R2\n- **Reversible**: no\n- **Source**: x:1\n',
  );
});

test('append_decision: scope_label 지정은 새 파일 머리글에만 반영', () => {
  const root = tmp('dlog-unit-');
  append_decision(path.join(root, 'a'), ...OK4, null, null, '내 라벨', TS);
  assert.ok(fs.readFileSync(path.join(root, 'a', 'decisions.md'), 'utf8').startsWith('# Decisions Log — 내 라벨\n'));
});

test('append_decision: 끝 개행 없는 파일에는 개행을 보태고, CRLF 는 LF 로 다시 쓴다', () => {
  const root = tmp('dlog-unit-');
  const f = path.join(root, 'decisions.md');
  fs.writeFileSync(f, `## D-001 (t)\r\n- **Phase**: design`);
  const r = append_decision(root, ...OK4, null, null, null, TS);
  assert.equal(r.id, 2);
  assert.equal(fs.readFileSync(f, 'utf8'), `## D-001 (t)\n- **Phase**: design\n\n## D-002 (${TS})\n- **Phase**: design\n- **Decision needed**: n\n- **Decision made**: m\n- **Rationale**: r\n`);
});

test('append_decision: 검증 오류 문구', () => {
  const root = tmp('dlog-unit-');
  assert.throws(() => append_decision(root, 'deploy', 'n', 'm', 'r'), (e) => e instanceof ValueError && e.message === "phase 'deploy' not in allowed set: ['build', 'design', 'dev-team-merge', 'feat-intake', 'prd-resolve', 'refactor', 'test', 'wbs', 'wbs-resolve']");
  assert.throws(() => append_decision(root, 'design', 'n', 'm', 'r', 'maybe'), { message: "reversible must be 'yes' or 'no', got 'maybe'" });
  assert.throws(() => append_decision(root, 'design', '', 'm', 'r'), { message: 'decision_needed must be non-empty' });
  assert.throws(() => append_decision(root, 'design', 'n', ' \t', 'r'), { message: 'decision_made must be non-empty' });
  assert.throws(() => append_decision(root, 'design', 'n', 'm', '\x1c　'), { message: 'rationale must be non-empty' });
  assert.ok(!fs.existsSync(path.join(root, 'decisions.md')));
});

test('_scope_label_from_dir: tasks → 다음 성분, features → "feature: …", 그 밖에는 project', () => {
  const root = tmp('dlog-unit-');
  const mk = (...p) => {
    const d = path.join(root, ...p);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  assert.equal(_scope_label_from_dir(mk('docs', 'tasks', 'TSK-04-02')), 'TSK-04-02');
  assert.equal(_scope_label_from_dir(mk('docs', 'features', 'auth')), 'feature: auth');
  assert.equal(_scope_label_from_dir(mk('docs')), 'project');
  assert.equal(_scope_label_from_dir(mk('p', 'tasks')), 'project');
  assert.equal(_scope_label_from_dir(mk('f', 'features', 'x', 'tasks', 'T')), 'T');
});

test('decisions_path_of: python Path 처럼 "." 와 빈 성분만 정리하고 ".." 는 그대로', () => {
  const sep = path.sep;
  assert.equal(decisions_path_of('.'), 'decisions.md');
  assert.equal(decisions_path_of(''), 'decisions.md');
  assert.equal(decisions_path_of('a/b/'), `a${sep}b${sep}decisions.md`);
  assert.equal(decisions_path_of('./a//b'), `a${sep}b${sep}decisions.md`);
  assert.equal(decisions_path_of('a/../b'), `a${sep}..${sep}b${sep}decisions.md`);
});

test('list_decisions: 파일 없으면 [], 있으면 id·timestamp 뒤에 소문자_밑줄 키', () => {
  const root = tmp('dlog-unit-');
  assert.deepEqual(list_decisions(root), []);
  append_decision(root, 'design', 'n', 'm', 'r', 'yes', 's', null, TS);
  const rows = list_decisions(root);
  assert.equal(rows.length, 1);
  assert.deepEqual([...rows[0]], [
    ['id', 1], ['timestamp', TS], ['phase', 'design'], ['decision_needed', 'n'], ['decision_made', 'm'], ['rationale', 'r'], ['reversible', 'yes'], ['source', 's'],
  ]);
});

test('list_decisions: 필드 키 ID 는 id 를 덮어쓰되 자리는 앞 그대로(python dict 와 같다)', () => {
  const root = tmp('dlog-unit-');
  fs.writeFileSync(path.join(root, 'decisions.md'), '## D-001 (t)\n- **ID**: zzz\n- **Phase**: design\n');
  assert.deepEqual([...list_decisions(root)[0]], [['id', 'zzz'], ['timestamp', 't'], ['phase', 'design']]);
});

test('validate_decisions: 파일 없음·정상·위반 문구', () => {
  const root = tmp('dlog-unit-');
  assert.deepEqual(validate_decisions(root), { ok: true, errors: [], entry_count: 0 });
  append_decision(root, 'design', 'n', 'm', 'r', null, null, null, TS);
  assert.deepEqual(validate_decisions(root), { ok: true, errors: [], entry_count: 1 });
  fs.appendFileSync(path.join(root, 'decisions.md'), '\n## D-003 (t)\n- **Phase**: deploy\n- **Reversible**: Yes\n');
  assert.deepEqual(validate_decisions(root), {
    ok: false,
    entry_count: 2,
    errors: [
      'D-003: expected id 2 (id sequence broken)',
      "D-003: missing fields ['Decision made', 'Decision needed', 'Rationale']",
      "D-003: phase 'deploy' not in allowed set",
      "D-003: reversible 'Yes' not in {yes,no}",
    ],
  });
});

test('py_read_text: CRLF·CR 을 LF 로, BOM 은 남기고, 잘못된 UTF-8 은 예외', () => {
  const root = tmp('dlog-unit-');
  const f = path.join(root, 'x.txt');
  fs.writeFileSync(f, '﻿a\r\nb\rc\n');
  assert.equal(py_read_text(f), '﻿a\nb\nc\n');
  fs.writeFileSync(f, Buffer.from([0x61, 0xff, 0x62]));
  assert.throws(() => py_read_text(f));
});

test('cp_slice·cp_index: 코드포인트 단위', () => {
  assert.equal(cp_slice('a😀b', 1, 2), '😀');
  assert.equal(cp_slice('😀😀😀', 0, 2), '😀😀');
  assert.equal(cp_index('a😀b', 3), 2);
  assert.equal(cp_index('abc', 2), 2);
});

test('argparse_compat_argv: - 로 시작하는 값 합치기와 접두 축약', () => {
  const cmds = { append: { target: 'string', rationale: 'string', 'decision-needed': 'string', 'decision-made': 'string', reversible: 'string', phase: 'string' }, list: { target: 'string' } };
  const f = (a) => argparse_compat_argv(a, cmds);
  assert.deepEqual(f(['append', '--rationale', '- a b']), ['append', '--rationale=- a b']);
  assert.deepEqual(f(['append', '--rationale', '-1']), ['append', '--rationale=-1']);
  assert.deepEqual(f(['append', '--rationale', '-foo']), ['append', '--rationale', '-foo']); // argparse 도 오류
  assert.deepEqual(f(['append', '--rationale', '--phase']), ['append', '--rationale', '--phase']);
  assert.deepEqual(f(['append', '--rationale', '--x y']), ['append', '--rationale=--x y']);
  assert.deepEqual(f(['append', '--rationale', '-']), ['append', '--rationale', '-']);
  assert.deepEqual(f(['append', '--rat', 'x', '--decision-n', 'y']), ['append', '--rationale', 'x', '--decision-needed', 'y']);
  assert.deepEqual(f(['append', '--decision', 'x']), ['append', '--decision', 'x']); // 모호
  assert.deepEqual(f(['append', '--rat=v']), ['append', '--rationale=v']);
  assert.deepEqual(f(['append', '--', '--rationale', '- a b']), ['append', '--', '--rationale', '- a b']);
  assert.deepEqual(f(['list', '--rationale', '- a b']), ['list', '--rationale', '- a b']); // 알 수 없는 옵션은 그대로(사용 오류가 되게)
  assert.deepEqual(f(['bogus', '--rationale', '- a b']), ['bogus', '--rationale', '- a b']);
});

test('normText(윈도우 모양): JSON 이스케이프된 루트와 경로 필드의 역슬래시만 정리한다', () => {
  const root = 'C:\\Users\\x\\Temp\\case1';
  const jsonEscaped = JSON.stringify(root).slice(1, -1);
  const out = normText(`{"ok": true, "id": 1, "timestamp": "2026-10-07T01:02:03Z", "path": "${jsonEscaped}\\\\docs\\\\tasks\\\\T1\\\\decisions.md"}`, root, { win: true });
  assert.equal(out, '{"ok": true, "id": 1, "timestamp": "<TS>", "path": "<ROOT>/docs/tasks/T1/decisions.md"}');
  // 상대 경로·target·file not found 도 같다. 다른 필드의 역슬래시는 그대로 둔다.
  assert.equal(winPaths('"target": "docs\\\\a\\\\p.md", "error": "file not found: x\\\\y.md"'), '"target": "docs/a/p.md", "error": "file not found: x/y.md"');
  assert.equal(winPaths('"section": "back\\\\slash", "term": "a\\\\b"'), '"section": "back\\\\slash", "term": "a\\\\b"');
  // 비 윈도우에서는 경로 필드를 건드리지 않는다(루트 치환만)
  assert.equal(normText('{"path": "/r/docs\\\\x"}', '/r', { win: false }), '{"path": "<ROOT>/docs\\\\x"}');
});

// ---- 2) 골든 비교 ------------------------------------------------------------

for (const c of CASES) {
  test(`골든: ${c.id}`, (t) => {
    if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
    const py = runCase(c, pyRunner);
    const nd = runCase(c, nodeRunner, nodeOpts);
    const diffs = diffResults(py, nd, ['python', 'node']);
    assert.deepEqual(diffs, [], diffs.join('\n'));
  });
}

// ---- 3) 교차 시험: 단계마다 판을 번갈아 돌린다 ---------------------------------

for (const c of CROSS_CASES) {
  test(`교차: ${c.id}`, (t) => {
    if (!env.available) return t.skip('python3 를 찾지 못해 교차 시험을 건너뜀');
    const mixed = runCase(c, mixedRunner, nodeOpts);
    const py = runCase(c, pyRunner);
    const nd = runCase(c, nodeRunner, nodeOpts);
    const d1 = diffResults(py, mixed, ['python 만', '번갈아']);
    assert.deepEqual(d1, [], d1.join('\n'));
    const d2 = diffResults(nd, mixed, ['node 만', '번갈아']);
    assert.deepEqual(d2, [], d2.join('\n'));
  });
}

// ---- 4) 기대값 비교(python 없이도 돈다) ----------------------------------------

const expected = fs.existsSync(EXPECTED) ? readJson(EXPECTED) : null;

test('기대값 파일이 사례 목록과 일치(사례를 바꿨으면 make-expected-decision-prd.mjs 를 다시 돌린다)', () => {
  assert.ok(expected, `${EXPECTED} 가 없다`);
  assert.deepEqual(Object.keys(expected), CASES.map((c) => c.id));
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, '사례 id 중복');
});

for (const c of CASES) {
  test(`기대값: ${c.id}`, () => {
    const nd = runCase(c, nodeRunner, nodeOpts);
    const diffs = diffResults(expected[c.id], nd, ['python 기대값', 'node']);
    assert.deepEqual(diffs, [], diffs.join('\n'));
  });
}

// python 이 쓴 파일(기대값에 박힌 최종 파일)을 node 판이 읽어 list·validate 한 결과가 python 의 기록과 같다.
for (const c of CASES) {
  const lastWrite = c.steps.map((s) => s.args[0]).lastIndexOf('append');
  if (lastWrite < 0) continue;
  const reads = c.steps.slice(lastWrite + 1).filter((s) => s.args[0] === 'list' || s.args[0] === 'validate');
  if (!reads.length) continue;
  test(`python 이 쓴 파일을 node 가 읽기: ${c.id}`, () => {
    const exp = expected[c.id];
    const readSteps = c.steps.slice(lastWrite + 1);
    const root = tmp('dlog-readback-');
    for (const [rel, body] of Object.entries(exp.files)) {
      const p = path.join(root, ...rel.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
    const sub = { id: c.id, steps: readSteps };
    const got = runCase(sub, nodeRunner, { ...nodeOpts, root });
    const want = { steps: exp.steps.slice(lastWrite + 1), files: exp.files };
    const diffs = diffResults(want, got, ['python 기록', 'node 읽기']);
    assert.deepEqual(diffs, [], diffs.join('\n'));
  });
}

// ---- 5) 실제 리포 decisions.md -------------------------------------------------

const REAL = path.join(REPO, 'docs', 'mdm');
const NO_REAL = !fs.existsSync(path.join(REAL, 'decisions.md')) && '이 리포에 실제 문서가 없다(D-Flow 정본 리포 — 실제 문서 비교는 스킬을 설치한 리포에서 돈다)';

test('실제 docs/mdm/decisions.md: list·validate 가 python 판과 같다', { skip: NO_REAL }, (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  assert.ok(fs.existsSync(path.join(REAL, 'decisions.md')));
  for (const cmd of ['list', 'validate']) {
    const a = pyRunner([cmd, '--target', REAL], REPO);
    const b = nodeRunner([cmd, '--target', REAL], REPO);
    assert.equal(b.status, a.status, cmd);
    assert.equal(b.stdout, a.stdout, cmd);
    assert.equal(b.stderr, a.stderr, cmd);
  }
});

test('실제 docs/mdm/decisions.md 사본에 양쪽이 append: 파일이 같고, 서로의 결과를 읽는다', { skip: NO_REAL }, (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  const real = fs.readFileSync(path.join(REAL, 'decisions.md'));
  const run = (impl) => {
    const root = tmp(`dlog-real-${impl}-`);
    fs.mkdirSync(path.join(root, 'docs', 'mdm'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'mdm', 'decisions.md'), real);
    const target = path.join(root, 'docs', 'mdm');
    const runner = impl === 'py' ? pyRunner : nodeRunner;
    const r = runner(['append', '--target', target, '--phase', 'build', '--decision-needed', '실제 파일 사본 N', '--decision-made', 'M', '--rationale', 'R'], root);
    assert.equal(r.status, 0, r.stderr);
    return { root, target };
  };
  const a = run('py');
  const b = run('node');
  const fa = fs.readFileSync(path.join(a.target, 'decisions.md'), 'utf8');
  const fb = fs.readFileSync(path.join(b.target, 'decisions.md'), 'utf8');
  const norm = (s) => s.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, '<TS>');
  assert.equal(norm(fb), norm(fa));
  // 서로가 쓴 파일을 상대 판이 읽는다
  for (const [dir, other] of [[a.target, nodeRunner], [b.target, pyRunner]]) {
    const v = other(['validate', '--target', dir], REPO);
    const w = (dir === a.target ? pyRunner : nodeRunner)(['validate', '--target', dir], REPO);
    assert.equal(v.stdout, w.stdout);
    assert.equal(v.status, w.status);
    const l1 = other(['list', '--target', dir], REPO).stdout;
    const l2 = (dir === a.target ? pyRunner : nodeRunner)(['list', '--target', dir], REPO).stdout;
    assert.equal(l1, l2);
  }
});

test('실제 docs/mdm/decisions.md 사본: 기록된 마지막 번호 다음으로 이어 붙는다(node)', { skip: NO_REAL }, () => {
  const real = fs.readFileSync(path.join(REAL, 'decisions.md'), 'utf8');
  const root = tmp('dlog-real-n-');
  fs.writeFileSync(path.join(root, 'decisions.md'), real);
  const before = _parse_entries(py_read_text(path.join(root, 'decisions.md')));
  const r = append_decision(root, 'design', 'n', 'm', 'r', null, null, null, TS);
  assert.equal(r.id, Math.max(...before.map((e) => e.id)) + 1);
});
