// dep-analysis.mjs 시험.
//  1) 단위 시험: 원본 python 에는 단위 시험(test_*.py)이 없었다. 대신 함수별로 python 판의 동작을 직접 확인해 둔 계약을 시험한다
//     (parse_depends, _chain_depth, _compute_fan_out, _compute_critical_path, compute_graph_stats, compute_levels, run).
//  2) 골든 비교: 같은 입력·인자로 python legacy 와 node 판을 돌려 stdout·stderr·종료 코드를 비교한다
//     (python 이 없거나 DMES_NO_PYTHON=1 이면 skip). 입력은 dep-cases.mjs 의 경계 입력과 실제 리포 WBS 를 python wbs-parse 로
//     변환한 출력이다. 같은 가지 쌍이 합류점을 둘 이상 공유하는 케이스는 python 의 diamond_patterns 순서가 실행마다 달라서
//     (set 교집합의 해시 순서) python 쪽 출력의 그 배열만 node 판의 순서(merge 코드포인트 순)로 바꾼 뒤 바이트 비교한다.
//  3) python 이 없어도 도는 보조 시험: tests/golden/expected/dep.json (make-expected-dep.mjs 가 python 으로 만든 기대값)과 비교.
//  4) 실제 WBS 문서 → wbs-parse → dep-analysis 파이프(legacy 와 node, wbs-parse.mjs 가 있으면 그 출력으로도).
// 임시 폴더는 모두 makeTempDir 로 만들고 끝나면 지운다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareGolden, formatDiffs } from '../../_shared/node/golden.mjs';
import { makeTempDir, runNode } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { compareCodePoint } from '../../_shared/node/pytext.mjs';
import { MinHeap } from '../../_shared/node/heap.mjs';
import {
  parse_depends, _chain_depth, _compute_fan_out, _compute_critical_path, compute_graph_stats, compute_levels, run,
  PyValueError, USAGE,
} from '../scripts/dep-analysis.mjs';
import { legacyEnv } from './legacy-env.mjs';
import { FILES, CLI_CASES, caseInput, toNodeDiamondOrder, HAS_SNAPSHOT, SNAPSHOT } from './dep-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'dep-analysis.mjs');
const REPO = path.resolve(HERE, '..', '..', '..', '..');

const base = fs.realpathSync(makeTempDir('dep-analysis-test-'));
const env = legacyEnv();
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
  env.cleanup();
});

const BASE_ENV = { WBS_STATE_MACHINE: '', CLAUDE_PLUGIN_ROOT: '' };
const PY_ENV = { PYTHONHASHSEED: '0', ...BASE_ENV };
const runDep = (args, opts = {}) => runNode(SCRIPT, args, { normalizeEol: true, ...opts, env: { ...BASE_ENV, ...(opts.env ?? {}) } });

const t = (tsk_id, depends = '-', status = '[ ]', extra = {}) => ({ tsk_id, depends, status, ...extra });
const mapOf = (o) => new Map(Object.entries(o));

// ---- 1) 단위 시험 -------------------------------------------------------------

test('parse_depends: 쉼표·공백 구분, "-" 와 빈 조각 제거', () => {
  assert.deepEqual(parse_depends('TSK-01-01'), ['TSK-01-01']);
  assert.deepEqual(parse_depends('TSK-01-01, TSK-01-02'), ['TSK-01-01', 'TSK-01-02']);
  assert.deepEqual(parse_depends('A B,C  ,, D'), ['A', 'B', 'C', 'D']);
  assert.deepEqual(parse_depends('A, -, B'), ['A', 'B']);
  assert.deepEqual(parse_depends('(none) A'), ['(none)', 'A']); // 정확히 "(none)" 일 때만 의존 없음
});

test('parse_depends: 의존 없음 표기', () => {
  for (const v of ['-', '(none)', '', null, undefined, 0, false, []]) assert.deepEqual(parse_depends(v), [], String(v));
  assert.deepEqual(parse_depends('  '), []); // 공백뿐이면 조각이 모두 비어 사라진다
});

test('parse_depends: 유니코드 공백도 구분자(python \\s)', () => {
  assert.deepEqual(parse_depends('A　B C\u0085D\u001cE F'), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(parse_depends('A﻿B'), ['A﻿B']); // BOM(U+FEFF)은 python 공백이 아니다
  assert.deepEqual(parse_depends('A​B'), ['A​B']); // 영폭 공백도 아니다
});

test('parse_depends: 문자열이 아니면 TypeError(python re.split)', () => {
  assert.throws(() => parse_depends(['A']), /expected string/);
  assert.throws(() => parse_depends(5), /expected string/);
});

test('_chain_depth: 사슬 길이(자기 포함)와 순환 방지', () => {
  const dep = mapOf({ A: [], B: ['A'], C: ['B'], D: ['B', 'A'], E: ['GHOST'] });
  const memo = new Map();
  assert.equal(_chain_depth('C', dep, memo, new Set()), 3);
  assert.equal(_chain_depth('D', dep, memo, new Set()), 3);
  assert.equal(_chain_depth('E', dep, memo, new Set()), 1); // 그래프에 없는 의존은 센다기보다 무시
  assert.equal(memo.get('B'), 2);
  const cyc = mapOf({ A: ['B'], B: ['A'] });
  assert.equal(_chain_depth('A', cyc, new Map(), new Set()), 2); // 순환 노드는 0 으로 막아 A→B(→A=0)
});

test('_compute_fan_out: 직접 후속 수', () => {
  const dep = mapOf({ A: [], B: ['A'], C: ['A', 'B'], D: ['GHOST'] });
  const fo = _compute_fan_out(dep, ['A', 'B', 'C', 'D']);
  assert.deepEqual([...fo], [['A', 2], ['B', 1], ['C', 0], ['D', 0]]);
});

test('_compute_critical_path: 빈 입력·단일·사슬', () => {
  assert.deepEqual(_compute_critical_path(new Map(), []), { nodes: [], edges: [] });
  assert.deepEqual(_compute_critical_path(mapOf({ A: [] }), ['A']), { nodes: ['A'], edges: [] });
  const cp = _compute_critical_path(mapOf({ A: [], B: ['A'], C: ['B'] }), ['A', 'B', 'C']);
  assert.deepEqual(cp.nodes, ['A', 'B', 'C']);
  assert.deepEqual(cp.edges, [{ source: 'A', target: 'B' }, { source: 'B', target: 'C' }]);
});

test('_compute_critical_path: 동률은 사전순으로 작은 부모·끝점', () => {
  // D 는 C 와 B 둘 다 길이 2 — 사전순으로 작은 B 가 부모
  const cp = _compute_critical_path(mapOf({ A: [], C: ['A'], B: ['A'], D: ['C', 'B'] }), ['A', 'C', 'B', 'D']);
  assert.deepEqual(cp.nodes, ['A', 'B', 'D']);
  // 끝점 동률: 길이 2 인 사슬이 셋 → 사전순 첫 끝점 A2
  const ids = ['X1', 'X2', 'Y1', 'Y2', 'A1', 'A2'];
  const cp2 = _compute_critical_path(mapOf({ X1: [], X2: ['X1'], Y1: [], Y2: ['Y1'], A1: [], A2: ['A1'] }), ids);
  assert.deepEqual(cp2.nodes, ['A1', 'A2']);
});

test('_compute_critical_path: 순환이면 ValueError', () => {
  assert.throws(() => _compute_critical_path(mapOf({ A: ['B'], B: ['A'] }), ['A', 'B']), (e) => e instanceof PyValueError
    && e.message === 'cycle detected in dependency graph');
  assert.throws(() => _compute_critical_path(mapOf({ A: ['A'] }), ['A']), PyValueError);
});

test('_compute_critical_path: 중복 id 는 python 처럼 순환으로 보고하거나 두 번 처리한다', () => {
  // task_ids 에 A 가 둘 — in_degree 가 두 번 증가해 영영 0 이 되지 않는 쪽은 순환 오류
  assert.throws(() => _compute_critical_path(mapOf({ A: ['B'], B: [] }), ['A', 'A', 'B']), PyValueError);
  // 뿌리가 중복이면 힙에 두 번 들어가 두 번 처리되어 개수가 맞는다
  const cp = _compute_critical_path(mapOf({ A: [], B: ['A'] }), ['A', 'A', 'B']);
  assert.deepEqual(cp.nodes, ['A', 'B']);
});

test('MinHeap 으로 옮긴 힙: 코드포인트 순(UTF-16 순서와 다른 경우)', () => {
  // UTF-16 코드 단위로 비교하면 U+1F600(D83D…)이 U+FF5E 보다 앞이지만, python 은 코드포인트(1F600 > FF5E)로 비교한다
  const ids = ['TSK-\u{1F600}', 'TSK-\uff5e'];
  const cp = _compute_critical_path(mapOf({ [ids[0]]: [], [ids[1]]: [] }), ids);
  assert.deepEqual(cp.nodes, ['TSK-\uff5e']); // 둘 다 dist 1 → 코드포인트 순으로 가장 작은 id
  const heap = new MinHeap(compareCodePoint, ['b', 'a', 'c']);
  assert.equal(heap.pop(), 'a');
});

test('compute_graph_stats: 빈 입력', () => {
  const r = compute_graph_stats([]);
  assert.equal(r.max_chain_depth, 0);
  assert.equal(r.total, 0);
  assert.deepEqual(r.fan_in_top, []);
  assert.deepEqual(r.critical_path, { nodes: [], edges: [] });
  assert.deepEqual([...r.fan_out], []);
  assert.deepEqual(r.bottleneck_ids, []);
});

test('compute_graph_stats: 출력 키 순서와 fan_out_map 별칭', () => {
  const r = compute_graph_stats([t('A'), t('B', 'A')]);
  assert.deepEqual(Object.keys(r), [
    'max_chain_depth', 'total', 'fan_in_top', 'fan_in_ge_3_count', 'diamond_patterns', 'diamond_count',
    'review_candidates', 'fan_out', 'fan_out_map', 'critical_path', 'bottleneck_ids',
  ]);
  assert.equal(r.fan_out, r.fan_out_map);
});

test('compute_graph_stats: 지표 값(다이아몬드·fan-in·후보·병목)', () => {
  const items = [t('A'), t('B', 'A'), t('C', 'A'), t('D', 'B, C'), t('E', 'A'), t('F', 'A, B, C, D')];
  const r = compute_graph_stats(items);
  assert.equal(r.max_chain_depth, 4); // A → B → D → F
  assert.deepEqual(r.fan_in_top.slice(0, 2), [{ tsk_id: 'A', count: 4 }, { tsk_id: 'B', count: 2 }]);
  assert.equal(r.fan_in_ge_3_count, 1);
  assert.deepEqual(r.diamond_patterns.find((d) => d.merge === 'D'), { apex: 'A', branches: ['B', 'C'], merge: 'D' });
  assert.equal(r.diamond_count, r.diamond_patterns.length);
  assert.deepEqual(r.review_candidates, [
    { tsk_id: 'A', reason: 'fan_in>=3', signal: { fan_in: 4 } },
    { tsk_id: 'F', reason: 'depends>=4', signal: { depends_count: 4 } },
  ]);
  assert.deepEqual(r.bottleneck_ids, ['A']);
  assert.deepEqual(r.critical_path.nodes, ['A', 'B', 'D', 'F']);
});

test('compute_graph_stats: 한 Task 가 depends 와 fan_in 둘 다 임계 이상이면 이유가 합쳐진다', () => {
  const items = [t('W'), t('X'), t('Y'), t('Z'), t('T', 'W X Y Z'), t('U1', 'T'), t('U2', 'T'), t('U3', 'T')];
  const cand = compute_graph_stats(items).review_candidates.find((c) => c.tsk_id === 'T');
  assert.deepEqual(cand, { tsk_id: 'T', reason: 'depends>=4,fan_in>=3', signal: { depends_count: 4, fan_in: 3 } });
  assert.deepEqual(Object.keys(cand.signal), ['depends_count', 'fan_in']);
});

test('compute_graph_stats: 같은 가지 쌍의 합류점이 둘 이상이면 코드포인트 순(python 은 실행마다 다름)', () => {
  const items = [t('A'), t('B', 'A'), t('C', 'A'), t('F', 'B, C'), t('D', 'B, C'), t('E', 'B, C')];
  const merges = compute_graph_stats(items).diamond_patterns.map((d) => d.merge);
  assert.deepEqual(merges, ['D', 'E', 'F']);
});

test('compute_graph_stats: tsk_id 가 비었으면 건너뛰고 id 별칭을 쓴다', () => {
  const r = compute_graph_stats([{ depends: '-' }, t(''), { id: 'X' }, { tsk_id: null, id: 'Y', depends: 'X' }]);
  assert.equal(r.total, 2);
  assert.deepEqual(r.critical_path.nodes, ['X', 'Y']);
});

test('compute_graph_stats: 순환이면 ValueError, 중복 id 는 total 에 그대로 센다', () => {
  assert.throws(() => compute_graph_stats([t('A', 'B'), t('B', 'A')]), PyValueError);
  assert.equal(compute_graph_stats([t('A'), t('A')]).total, 2);
});

test('compute_graph_stats: 정수형 문자열 id 도 입력 순서(Map)로 fan_out 을 낸다', () => {
  const r = compute_graph_stats([t('10'), t('2', '10'), t('1', '2')]);
  assert.deepEqual([...r.fan_out.keys()], ['10', '2', '1']);
});

test('compute_graph_stats: 입력 형태 오류는 python 예외와 같은 종류', () => {
  assert.throws(() => compute_graph_stats(['A']), /'str' object has no attribute 'get'/);
  assert.throws(() => compute_graph_stats(5), /'int' object is not iterable/);
  assert.throws(() => compute_graph_stats([t('A', ['x'])]), /expected string/);
});

test('compute_levels: 레벨·완료·순환·외부 의존', () => {
  const items = [
    t('A', '-', '[xx]'), t('B', 'A'), t('C', 'A, B'), t('D', 'GHOST'), t('E', 'F'), t('F', 'E'),
    t('G', '-', '[ ]', { bypassed: true }), t('H', 'G', '[ ]', { category: 'feat' }), t('I', 'H G'),
  ];
  const r = compute_levels(items, new Set(['[xx]']));
  assert.deepEqual([...r.levels], [['0', ['B', 'D', 'I']], ['1', ['C']]]);
  assert.deepEqual(r.completed, ['A', 'G', 'H']);
  assert.deepEqual(r.circular, ['E', 'F']);
  assert.equal(r.total, 9);
  assert.equal(r.pending, 6);
  assert.deepEqual(r.satisfied_states, ['[xx]']);
});

test('compute_levels: 충족 상태는 부분 문자열로 판정, [im] 은 6상태 임계에서만 완료', () => {
  const items = [t('A', '-', '[xx] 검수'), t('B', '-', '[im]'), t('C', 'B', '[ ]')];
  const five = compute_levels(items, new Set(['[xx]']));
  assert.deepEqual(five.completed, ['A']);
  const six = compute_levels(items, new Set(['[im]', '[xx]']));
  assert.deepEqual(six.completed, ['A', 'B']);
  assert.deepEqual([...six.levels], [['0', ['C']]]);
  assert.deepEqual(six.satisfied_states, ['[im]', '[xx]']);
});

test('compute_levels: 중복 id 는 같은 레벨에 두 번 들어가고 pending 은 입력 개수', () => {
  const r = compute_levels([t('A'), t('A'), t('B', 'A')], new Set(['[xx]']));
  assert.deepEqual([...r.levels], [['0', ['A', 'A']], ['1', ['B']]]);
  assert.equal(r.pending, 3);
});

test('compute_levels: 값이 비었으면 python 의 진리값 규칙', () => {
  const r = compute_levels([{ tsk_id: 'A', depends: null }, { tsk_id: 'B', depends: [] }, { tsk_id: 'C', depends: 0, bypassed: [] }], new Set(['[xx]']));
  assert.deepEqual([...r.levels], [['0', ['A', 'B', 'C']]]);
});

test('compute_levels: 항목이 객체가 아니면 AttributeError, status 가 null 이면 TypeError', () => {
  assert.throws(() => compute_levels(['A'], new Set(['[xx]'])), /has no attribute 'get'/);
  assert.throws(() => compute_levels([t('A', '-', null)], new Set(['[xx]'])), /argument of type 'NoneType' is not iterable/);
  assert.throws(() => compute_levels([t(['a'])], new Set(['[xx]'])), /unhashable type: 'list'/);
});

test('run: 빈 입력 출력(기본 모드는 들여쓰기 없음·ensure_ascii, 그래프 모드는 indent 2)', () => {
  const out = [];
  const io = { out: (s) => out.push(s), err: () => {}, readStdin: () => Buffer.from('  \n') };
  assert.equal(run([], io), 0);
  assert.equal(out[0], '{"levels": {}, "completed": [], "circular": [], "total": 0, "pending": 0, "satisfied_states": ["[xx]"]}\n');
  out.length = 0;
  assert.equal(run(['--graph-stats'], io), 0);
  const j = JSON.parse(out[0]);
  assert.equal(j.total, 0);
  assert.ok(out[0].startsWith('{\n  "max_chain_depth": 0,\n'));
  assert.ok(out[0].includes('"critical_path": {\n    "nodes": [],\n    "edges": []\n  }'));
});

test('run: 인자 오류와 입력 오류는 종료 코드 1', () => {
  const errs = [];
  const io = { out: () => {}, err: (s) => errs.push(s), readStdin: () => Buffer.from('[') };
  assert.equal(run(['--docs-dir'], io), 1);
  assert.equal(errs.pop(), 'ERROR: --docs-dir requires a directory argument\n');
  assert.equal(run(['/nonexistent/dep-analysis-input.json'], io), 1);
  assert.equal(errs.pop(), 'ERROR: file not found: /nonexistent/dep-analysis-input.json\n');
  assert.equal(run([], io), 1);
  assert.match(errs.pop(), /^ERROR: invalid JSON: /);
  assert.equal(run(['--help'], io), 1); // 도움말 옵션이 없다 — 파일 경로로 취급
  assert.equal(errs.pop(), 'ERROR: file not found: --help\n');
});

test('USAGE: python 판과 같은 안내문(사용되지는 않는다)', () => {
  assert.match(USAGE, /^Usage: dep-analysis\.py \[input-file\] \[--graph-stats\] \[--docs-dir DIR\]/);
});

// ---- CLI(node 단독) ---------------------------------------------------------

const work = path.join(base, 'cases');
for (const [name, text] of Object.entries(FILES)) {
  const p = path.join(work, ...name.split('/'));
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf8');
}

test('CLI: 기본 출력 모양(들여쓰기 2, 키 순서, 끝 개행)', () => {
  const r = runDep(['tasks-simple.json'], { cwd: work });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(j), ['levels', 'completed', 'circular', 'total', 'pending', 'satisfied_states']);
  assert.deepEqual(j.levels, { 0: ['TSK-01-01'], 1: ['TSK-01-02', 'TSK-01-03'], 2: ['TSK-01-04'] });
  assert.ok(r.stdout.startsWith('{\n  "levels": {\n    "0": [\n      "TSK-01-01"\n    ],'));
  assert.ok(r.stdout.endsWith('}\n'));
});

test('CLI: 표준입력(파이프)·"-" 인자', () => {
  const body = fs.readFileSync(path.join(work, 'tasks-simple.json'), 'utf8');
  const a = runDep([], { cwd: work, input: body });
  const b = runDep(['-'], { cwd: work, input: body });
  const c = runDep(['tasks-simple.json'], { cwd: work });
  assert.equal(a.stdout, c.stdout);
  assert.equal(b.stdout, c.stdout);
});

test('CLI: 큰 표준입력(수천 Task)도 끊기지 않는다', () => {
  const items = Array.from({ length: 4000 }, (_, i) => t(`TSK-${String(i).padStart(5, '0')}`, i ? `TSK-${String(i - 1).padStart(5, '0')}` : '-'));
  const r = runDep(['--graph-stats'], { cwd: work, input: JSON.stringify(items) });
  assert.equal(r.status, 0, r.stderr.slice(0, 300));
  const j = JSON.parse(r.stdout);
  assert.equal(j.max_chain_depth, 4000);
  assert.equal(j.critical_path.nodes.length, 4000);
});

test('CLI: BOM 은 지우지 않는다(python 처럼 invalid JSON)', () => {
  const r = runDep(['tasks-bom.json'], { cwd: work });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'ERROR: invalid JSON: Unexpected UTF-8 BOM (decode using utf-8-sig): line 1 column 1 (char 0)\n');
});

test('CLI: CRLF 파일은 LF 와 같은 결과', () => {
  const a = runDep(['tasks-crlf.json'], { cwd: work });
  const b = runDep(['tasks-simple.json'], { cwd: work });
  assert.equal(a.stdout, b.stdout);
});

test('CLI: 잘못된 UTF-8 파일은 종료 코드 1', () => {
  fs.writeFileSync(path.join(work, 'bad-utf8.json'), Buffer.from([0x5b, 0xff, 0xfe, 0x5d]));
  const r = runDep(['bad-utf8.json'], { cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /UnicodeDecodeError/);
  assert.equal(r.stdout, '');
});

test('CLI: 한글 id 는 ensure_ascii=False 로 그대로 출력(빈 입력의 기본 모드만 \\u 이스케이프)', () => {
  const r = runDep(['한글/tasks-한글.json'], { cwd: work });
  assert.ok(r.stdout.includes('"TSK-가"'));
  const e = runDep(['--docs-dir', 'smkr'], { cwd: work, input: '' });
  assert.ok(e.stdout.includes('\\uc644\\ub8cc'), e.stdout);
});

test('CLI: 상태머신 오류는 종료 코드 1 과 ERROR 문구', () => {
  const r = runDep(['--docs-dir', 'smbad', 'tasks-done.json'], { cwd: work });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^ERROR: failed to load .*state-machine\.json: Expecting value: line 1 column 12 \(char 11\)\n$/);
});

// ---- 2) 골든 비교 (python legacy 대 node) -------------------------------------

const nodeOrder = (text) => toNodeDiamondOrder(text, { pyJsonDumps, compareCodePoint });

function goldenCase(c) {
  return test(`golden: ${c.id}`, (tt) => {
    const input = caseInput(c);
    const r = compareGolden({
      python: { cmd: [env.script('dep-analysis.py'), ...c.args], env: { ...PY_ENV, ...c.env } },
      node: { script: SCRIPT, args: c.args, env: { ...BASE_ENV, ...c.env } },
      cwd: work,
      input,
      compare: c.compare ?? ['stdout', 'status', 'stderr'],
    });
    if (r.skipped) return tt.skip(r.reason);
    if (r.ok) return undefined;
    if (c.diamonds && r.diffs.every((d) => d.field === 'stdout')) {
      const d = r.diffs[0];
      assert.equal(d.node, nodeOrder(d.python), formatDiffs(r)); // node 출력은 원문 그대로, python 쪽만 순서를 맞춘다
      return undefined;
    }
    return assert.fail(formatDiffs(r));
  });
}
for (const c of CLI_CASES) goldenCase(c);

// ---- 3) python 없이 도는 보조 시험: 기대값 파일 비교 --------------------------

const expectedFile = path.join(HERE, 'golden', 'expected', 'dep.json');
const expected = fs.existsSync(expectedFile) ? readJson(expectedFile) : {};
const rootFix = (s) => s.split(work).join('<ROOT>');

for (const c of CLI_CASES) {
  // 상태머신 경로가 오류 문구에 들어가는 케이스는 경로 구분자가 윈도우에서 다르다
  const posixOnly = /docs-dir (smbad|smbom)/.test(c.id);
  test(`expected: ${c.id}`, { skip: posixOnly && process.platform === 'win32' }, () => {
    const exp = expected[c.id];
    assert.ok(exp, `expected/dep.json 에 케이스가 없음: ${c.id} (make-expected-dep.mjs 로 다시 생성)`);
    const r = runDep(c.args, { cwd: work, input: caseInput(c), env: c.env, normalizeEol: false });
    for (const f of c.compare ?? ['stdout', 'status', 'stderr']) {
      const got = f === 'status' ? r.status : rootFix(r[f]);
      const want = f === 'status' ? exp.status : exp[f];
      assert.equal(got, want, `${f} 불일치`); // diamonds 케이스의 기대값은 이미 node 순서로 저장돼 있다
    }
  });
}

// 실제 WBS 스냅숏(dep-mdm-tasks-all.json)은 고객 자료라 공개 리포(D-Flow)에는 두지 않는다 — 없으면 real/ 기대값은 세지 않는다.
test('expected: 케이스 수가 기대값 파일과 같다(오래된 파일 방지)', () => {
  const keys = Object.keys(expected).filter((k) => HAS_SNAPSHOT || !k.startsWith('real/'));
  assert.equal(keys.length, CLI_CASES.length, `make-expected-dep.mjs 를 다시 실행(스냅숏 ${HAS_SNAPSHOT ? '있음' : `없음: ${SNAPSHOT}`})`);
});

// ---- 4) 실제 WBS 문서 → wbs-parse → dep-analysis -------------------------------

function realWbsDocs() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compareCodePoint(a.name, b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^wbs.*\.md$/.test(e.name)) out.push(p);
    }
  };
  const docs = path.join(REPO, 'docs');
  if (fs.existsSync(docs)) walk(docs);
  return out;
}

const PARSE_MJS = path.join(HERE, '..', 'scripts', 'wbs-parse.mjs');
for (const doc of realWbsDocs()) {
  const rel = path.relative(REPO, doc).split(path.sep).join('/');
  const text = fs.readFileSync(doc, 'utf8');
  const wps = [...text.matchAll(/^##\s+(WP-\d+):/gm)].map((m) => m[1]);
  const modes = [['--tasks-all'], ...wps.slice(0, 3).map((wp) => [wp, '--tasks-pending'])];
  for (const mode of modes) {
    for (const docsDir of [null, path.dirname(doc)]) {
      for (const gs of [false, true]) {
        const label = `${rel} ${mode.join(' ')}${docsDir ? ' --docs-dir' : ''}${gs ? ' --graph-stats' : ''}`;
        const depArgs = [...(gs ? ['--graph-stats'] : []), ...(docsDir ? ['--docs-dir', docsDir] : [])];
        const parseArgs = mode.length === 1 ? [doc, mode[0]] : [doc, mode[0], mode[1]];
        test(`pipe(legacy wbs-parse): ${label}`, (tt) => {
          if (!env.available) return tt.skip('python3 를 찾지 못함');
          const parsed = env.python([env.script('wbs-parse.py'), ...parseArgs], { env: PY_ENV, cwd: base });
          assert.equal(parsed.status, 0, parsed.stderr);
          const r = compareGolden({
            python: { cmd: [env.script('dep-analysis.py'), ...depArgs], env: PY_ENV },
            node: { script: SCRIPT, args: depArgs, env: BASE_ENV },
            input: parsed.stdout,
            cwd: base,
          });
          if (r.ok) return undefined;
          const same = r.diffs.every((d) => d.field === 'stdout') && r.diffs[0].node === nodeOrder(r.diffs[0].python);
          return assert.ok(same, formatDiffs(r));
        });
        test(`pipe(wbs-parse.mjs): ${label}`, (tt) => {
          if (!env.available) return tt.skip('python3 를 찾지 못함');
          if (!fs.existsSync(PARSE_MJS)) return tt.skip('wbs-parse.mjs 가 아직 없음');
          const parsed = env.python([env.script('wbs-parse.py'), ...parseArgs], { env: PY_ENV, cwd: base });
          const parsedNode = runNode(PARSE_MJS, parseArgs, { cwd: base, env: BASE_ENV });
          assert.equal(parsedNode.status, 0, parsedNode.stderr); // wbs-parse 출력 자체의 동일성은 wbs-parse.test.mjs 가 맡는다
          const a = runNode(SCRIPT, depArgs, { cwd: base, input: parsedNode.stdout, env: BASE_ENV });
          const b = env.python([env.script('dep-analysis.py'), ...depArgs], { cwd: base, input: parsed.stdout, env: PY_ENV });
          assert.equal(a.status, b.status);
          assert.equal(a.stdout, nodeOrder(b.stdout));
          return undefined;
        });
      }
    }
  }
}
