// wbs-parse.mjs 시험.
//  1) 원본 test_wbs_parse_export.py 의 모든 케이스(18건)를 같은 의미로 옮긴 단위 시험.
//  2) 이식 도우미(python os.path 대응, truthiness, 충실한 JSON 읽기) 단위 시험.
//  3) 골든 비교: 같은 인자·같은 cwd 로 python legacy 와 node 판을 돌려 stdout·stderr·종료 코드를 비교한다
//     (python 이 없거나 DMES_NO_PYTHON=1 이면 skip).
//     - 합성 경계 입력(wbs-parse-cases.mjs): 문서 28종 × 모드, state.json 변종, 상태머신 변종, feat 모드, 인자 해석.
//     - 리포의 실제 WBS 문서(docs/**/wbs*.md 전수) × 모드 12종 — `--export` 는 상대·절대 경로 모두, 두 번 돌려 byte 동일(결정성).
//  4) python 이 없어도 도는 보조 시험: 미리 python 으로 계산한 tests/golden/expected/parse.json 과 node 판 결과 비교
//     (기대값은 `node dflow-export/tests/make-expected-parse.mjs` 로 다시 만든다. 실제 문서·live state.json 은 포함하지 않는다).
// 임시 폴더는 모두 makeTempDir 로 만들고 끝나면 지운다.

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir, runNode } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import { walkSorted } from '../../_shared/node/paths.mjs';
import { PyFloat, pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import {
  parse_nodes, USAGE, pyDirname, pyJoin, pyBasename, pyTruthy, dget, parseFaithful, readPyText,
  get_field, parse_list_field, extract_task_block, extract_wp_block, parse_tasks_from_wp, _slugify,
  _split_table_row, _cell_value, compute_complexity, _resolve_phase_from_status, parse_dev_config,
} from '../scripts/wbs-parse.mjs';
import { legacyEnv } from './legacy-env.mjs';
import { FOURLEVEL, THREELEVEL, NODE_KEYS, SPEC_KEYS, buildSynthetic } from './wbs-parse-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, '..');
const SCRIPT = path.join(SKILL, 'scripts', 'wbs-parse.mjs');
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const EXPECTED = path.join(HERE, 'golden', 'expected', 'parse.json');

const env = legacyEnv();
const base = makeTempDir('wbs-parse-test-');
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
  env.cleanup();
});

const keysOf = (o) => Object.keys(o).sort();
const sortedKeys = [...NODE_KEYS].sort();
const sortedSpec = [...SPEC_KEYS].sort();
const run = (args, opts = {}) => runNode(SCRIPT, args, { env: { CLAUDE_PLUGIN_ROOT: '' }, ...opts });

function docsTree(text) {
  const mod = path.join(base, 'docs', `MOD-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(mod, { recursive: true });
  const wbs = path.join(mod, 'wbs.md');
  fs.writeFileSync(wbs, text, 'utf8');
  return wbs;
}

// ---- 1) 원본 python 단위 시험 이식 (test_wbs_parse_export.py, 18건) -----------

test('ParseNodesHierarchy: test_four_level_hierarchy', () => {
  const nodes = parse_nodes(FOURLEVEL, '');
  const by_id = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assert.deepEqual(nodes.filter((n) => n.kind === 'phase').map((n) => n.id), ['PH-1', 'PH-2']);
  assert.equal(by_id['PH-1'].parent_id, null);
  assert.equal(by_id['PH-1'].title, 'PH-1');
  assert.equal(by_id['WP-00'].parent_id, 'PH-1');
  assert.equal(by_id['WP-00'].schedule, '2026-08-05 ~ 2026-08-18');
  assert.equal(by_id['WP-00'].spec_sections.description, '스캐폴드·CI, 전사 공유 계약');
  assert.equal(by_id['ACT-00-01'].parent_id, 'WP-00');
  assert.equal(by_id['TSK-00-01-01'].parent_id, 'ACT-00-01');
  assert.equal(by_id['TSK-01-01-01'].parent_id, 'ACT-01-01');
});

test('ParseNodesHierarchy: test_node_counts', () => {
  const kinds = {};
  for (const n of parse_nodes(FOURLEVEL, '')) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
  assert.deepEqual(kinds, { phase: 2, wp: 2, act: 2, task: 3 });
});

test('ParseNodesHierarchy: test_three_level_task_parents_are_wps', () => {
  const nodes = parse_nodes(THREELEVEL, '');
  const by_id = Object.fromEntries(nodes.map((n) => [n.id, n]));
  assert.equal(by_id['TSK-00-01'].parent_id, 'WP-00');
  assert.deepEqual(nodes.filter((n) => n.kind === 'act'), []);
  assert.deepEqual(by_id['TSK-00-01'].acceptance, ['dev 서버 기동']);
});

test('ParseNodesContractV2: test_uniform_key_set', () => {
  for (const n of parse_nodes(FOURLEVEL, '')) {
    assert.deepEqual(keysOf(n), sortedKeys, n.id);
    assert.deepEqual(keysOf(n.spec_sections), sortedSpec, n.id);
  }
});

test('ParseNodesContractV2: test_task_top_level_fields', () => {
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, '').map((n) => [n.id, n]));
  const t = by_id['TSK-00-01-01'];
  assert.equal(t.kind, 'task');
  assert.equal(t.title, '스캐폴드');
  assert.equal(t.stage, null);
  assert.equal(t.category, 'infra');
  assert.equal(t.domain, 'infra');
  assert.equal(t.model, 'sonnet');
  assert.equal(t.assignee, null); // '-' 는 null
  assert.equal(t.schedule, '2026-08-05 ~ 2026-08-06');
  assert.equal(t.priority, 'critical'); // 문자열 라벨 그대로
  assert.deepEqual(t.tags, ['setup', 'init']);
  assert.deepEqual(t.depends, []);
  assert.equal(t.prd_ref, '공통 (BPA 외)');
  assert.equal(t.entry_point, null);
  assert.deepEqual(t.acceptance, ['dev 서버 기동', '헬스체크 통과']);
});

test('ParseNodesContractV2: test_task_spec_sections', () => {
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, '').map((n) => [n.id, n]));
  const s1 = by_id['TSK-00-01-01'].spec_sections;
  assert.deepEqual(s1.requirements, ['프로젝트 생성, env 배선', 'CI 파이프라인']);
  assert.deepEqual(s1.test_criteria, []);
  assert.deepEqual(s1.constraints, []);
  assert.equal(s1.api_spec, null);
  assert.equal(s1.data_model, null);
  assert.equal(s1.description, null);

  const s2 = by_id['TSK-00-01-02'].spec_sections;
  assert.deepEqual(s2.constraints, ['모듈 전용 엔티티 금지']);
  assert.deepEqual(s2.test_criteria, ['단위: 전이 / E2E: 수신 3유형']);
  assert.equal(s2.api_spec, '`confirmReceiving(lotId)` — 단일 트랜잭션 RPC');
  assert.equal(s2.data_model, 'common_code(그룹, 코드, 명칭)');
});

test('ParseNodesContractV2: test_second_task_fields', () => {
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, '').map((n) => [n.id, n]));
  const t = by_id['TSK-00-01-02'];
  assert.equal(t.assignee, 'lee@example.com');
  assert.deepEqual(t.depends, ['TSK-00-01-01']);
  assert.equal(t.model, 'opus');
  assert.equal(t.stage, 'im');
  assert.equal(t.entry_point, 'layout (전 화면 공통 셸)');
});

test('ParseNodesContractV2: test_empty_tags_sentinel', () => {
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, '').map((n) => [n.id, n]));
  assert.deepEqual(by_id['TSK-01-01-01'].tags, []);
});

test('ParseNodesContractV2: test_non_task_nodes_are_blank_but_present', () => {
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, '').map((n) => [n.id, n]));
  const act = by_id['ACT-00-01'];
  assert.equal(act.stage, null);
  assert.deepEqual(act.tags, []);
  assert.deepEqual(act.acceptance, []);
  assert.equal(act.spec_sections.api_spec, null);
  const wp = by_id['WP-01'];
  assert.equal(wp.stage, null);
  assert.equal(wp.spec_sections.description, null);
});

test('ParseNodesStage: test_local_cycle_states_map_to_dflow_stage', () => {
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, '').map((n) => [n.id, n]));
  assert.equal(by_id['TSK-01-01-01'].stage, 'ip'); // [ts] → ip
  const by3 = Object.fromEntries(parse_nodes(THREELEVEL, '').map((n) => [n.id, n]));
  assert.equal(by3['TSK-00-01'].stage, 'ip'); // [dd] → ip
});

test('ParseNodesStage: test_state_json_overrides_wbs_status', () => {
  const wbs = docsTree(FOURLEVEL);
  const taskDir = path.join(path.dirname(wbs), 'tasks', 'TSK-00-01-01');
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, 'state.json'), JSON.stringify({ status: '[xx]' }), 'utf8');
  const by_id = Object.fromEntries(parse_nodes(FOURLEVEL, path.dirname(wbs)).map((n) => [n.id, n]));
  assert.equal(by_id['TSK-00-01-01'].stage, 'xx');
});

test('ExportCLI: test_export_envelope', () => {
  const wbs = docsTree(FOURLEVEL);
  const r = run([wbs, '--export']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.schema_version, '2.1');
  assert.equal(out.source, wbs);
  assert.ok(!('generated_at' in out));
  assert.equal(out.nodes.length, 9); // 2 phase + 2 wp + 2 act + 3 task
});

test('ExportCLI: test_export_node_keys_match_contract', () => {
  const wbs = docsTree(FOURLEVEL);
  const out = JSON.parse(run([wbs, '--export']).stdout);
  for (const n of out.nodes) {
    assert.deepEqual(keysOf(n), sortedKeys, n.id);
    assert.deepEqual(keysOf(n.spec_sections), sortedSpec, n.id);
  }
});

test('ExportCLI: test_export_is_deterministic', () => {
  const wbs = docsTree(FOURLEVEL);
  const a = run([wbs, '--export']).stdout;
  const b = run([wbs, '--export']).stdout;
  assert.equal(a, b);
});

test('ExportCLI: test_export_uses_stage_codes_not_brackets', () => {
  const wbs = docsTree(FOURLEVEL);
  const raw = run([wbs, '--export']).stdout;
  const stages = new Set(JSON.parse(raw).nodes.filter((n) => n.kind === 'task').map((n) => n.stage));
  assert.deepEqual(stages, new Set([null, 'im', 'ip']));
  // 대괄호 표기는 wbs.md 표면 한정 — 계약에는 stage 코드만 나간다
  for (const bracket of ['[ ]', '[as]', '[fp]', '[ip]', '[im]', '[ts]', '[dd]', '[xx]']) {
    assert.ok(!raw.includes(bracket), bracket);
  }
});

test('ExportCLI: test_export_parent_graph_is_closed', () => {
  // 모든 parent_id 가 노드 집합 안에 있고, 고아는 phase 뿐이다.
  const wbs = docsTree(FOURLEVEL);
  const nodes = JSON.parse(run([wbs, '--export']).stdout).nodes;
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    if (n.parent_id === null) assert.equal(n.kind, 'phase', n.id);
    else assert.ok(ids.has(n.parent_id), n.id);
  }
});

test('ExportCLI: test_export_three_level', () => {
  const wbs = docsTree(THREELEVEL);
  const out = JSON.parse(run([wbs, '--export']).stdout);
  assert.equal(out.nodes.length, 3); // 1 phase + 1 wp + 1 task
});

test('ExportCLI: test_export_missing_file', () => {
  const r = run([path.join(base, 'nonexistent', 'wbs.md'), '--export']);
  assert.equal(r.status, 1);
});

// ---- 2) 이식 도우미 단위 시험 ------------------------------------------------

test('pyDirname/pyBasename/pyJoin: python os.path 의미(정규화 없음)', { skip: process.platform === 'win32' }, () => {
  assert.equal(pyDirname('wbs.md'), '');
  assert.equal(pyDirname('a/b/wbs.md'), 'a/b');
  assert.equal(pyDirname('a/b/'), 'a/b');
  assert.equal(pyDirname('/wbs.md'), '/');
  assert.equal(pyDirname('//a//b'), '//a');
  assert.equal(pyDirname(''), '');
  assert.equal(pyBasename('a/b/c'), 'c');
  assert.equal(pyBasename('a/b/'), '');
  assert.equal(pyBasename('c'), 'c');
  assert.equal(pyJoin('', 'tasks', 'T', 'state.json'), 'tasks/T/state.json');
  assert.equal(pyJoin('./x/', 'dev-config.md'), './x/dev-config.md');
  assert.equal(pyJoin('a//b', 'c'), 'a//b/c');
  assert.equal(pyJoin('a', '/abs'), '/abs');
  assert.throws(() => pyJoin('a', null), TypeError);
});

test('pyTruthy: python 진리값', () => {
  for (const v of [null, undefined, '', 0, false, [], new Map(), {}, 0n, new PyFloat(0)]) assert.equal(pyTruthy(v), false, String(v));
  for (const v of ['x', 1, true, [0], new Map([['a', 1]]), 1n, new PyFloat(0.5), new PyFloat(NaN)]) assert.equal(pyTruthy(v), true, String(v));
});

test('dget: dict(Map)만 허용', () => {
  assert.equal(dget(new Map([['a', 1]]), 'a'), 1);
  assert.equal(dget(new Map(), 'a', 'd'), 'd');
  assert.throws(() => dget([], 'a'), TypeError);
  assert.throws(() => dget(null, 'a'), TypeError);
});

test('parseFaithful: 삽입순·float·큰 정수·오류 문구를 python 처럼', () => {
  const v = parseFaithful('{"b": 1, "10": 2.0, "2": [1.5, 1e5, -0.0, 12345678901234567890], "a": null}');
  assert.deepEqual([...v.keys()], ['b', '10', '2', 'a']);
  assert.equal(pyJsonDumps(v), '{"b": 1, "10": 2.0, "2": [1.5, 100000.0, -0.0, 12345678901234567890], "a": null}');
  assert.equal(pyJsonDumps(parseFaithful('{"a": 1, "a": 2, "b": 0}')), '{"a": 2, "b": 0}');
  assert.throws(() => parseFaithful('{'), /Expecting property name enclosed in double quotes: line 1 column 2 \(char 1\)/);
  assert.throws(() => parseFaithful('﻿{}'), /Unexpected UTF-8 BOM/);
});

test('readPyText: 줄끝 정규화, BOM 유지, 잘못된 UTF-8 은 예외', () => {
  const p = path.join(base, 'rp.txt');
  fs.writeFileSync(p, '﻿a\r\nb\rc\n', 'utf8');
  assert.equal(readPyText(p), '﻿a\nb\nc\n');
  fs.writeFileSync(p, Buffer.from([0x61, 0xff, 0x62]));
  assert.throws(() => readPyText(p));
});

test('텍스트 도우미: get_field / parse_list_field / 블록 / slug', () => {
  const block = '### TSK-01-01: t\n- domain: backend\n- tags: a,, b\n- depends: -\n- acceptance:\n  - x\n    - y\n    z\n  - w\n\n- model: opus';
  assert.equal(get_field(block, 'domain'), 'backend');
  assert.equal(get_field(block, 'nope'), '');
  assert.deepEqual(parse_list_field(block, 'tags'), ['a', 'b']);
  assert.deepEqual(parse_list_field(block, 'depends'), []);
  assert.deepEqual(parse_list_field(block, 'acceptance'), ['x\n    - y\n    z', 'w']);
  assert.equal(extract_task_block('## WP-1: a\n### TSK-01-01: t\n- s\n### TSK-01-02: u\n', 'TSK-01-01'), '### TSK-01-01: t\n- s');
  assert.equal(extract_task_block('x', 'TSK-01-01'), '');
  assert.equal(extract_wp_block('## WP-01: a\nx\n## WP-02: b\n', 'WP-01'), '## WP-01: a\nx');
  assert.deepEqual(parse_tasks_from_wp('### TSK-01-01: t\n- status: [xx]\n- category: feat\n', true), []);
  assert.equal(_slugify('Login 2FA setup!'), 'login-2fa-setup');
  assert.equal(_slugify('한글'), '');
  assert.equal(_slugify(`${'a'.repeat(39)}-b`), 'a'.repeat(39));
  assert.deepEqual(_split_table_row('| a | `b|c` | d |'), ['a', '`b|c`', 'd']);
  assert.equal(_cell_value('`x`'), 'x');
  assert.equal(_cell_value('-'), null);
  assert.equal(_cell_value('`'), '');
});

test('compute_complexity / _resolve_phase_from_status / parse_dev_config', () => {
  assert.equal(compute_complexity('### T: x\n- model: OPUS').recommended_model, 'opus');
  const c = compute_complexity('### T: x\n- domain: fullstack\n- depends: A, B, C, D\n');
  assert.equal(c.complexity_score, 4);
  assert.equal(c.recommended_model, 'opus');
  assert.equal(_resolve_phase_from_status('[dd!]', new Map()), 'design');
  assert.equal(_resolve_phase_from_status('[im!]', new Map()), 'test');
  assert.equal(_resolve_phase_from_status('[xx]', null), 'done');
  assert.equal(_resolve_phase_from_status('  ', new Map()), 'design');
  const cfg = parse_dev_config('## Dev Config\n### Domains\n| d | e | u | t |\n|--|--|--|--|\n| 10 | x | `a` | - |\n| 2 | y | - | `b` |\n');
  assert.deepEqual([...cfg.domains.keys()], ['10', '2']);
  assert.equal(parse_dev_config('# none').error, 'DEV_CONFIG_MISSING');
});

test('USAGE: python 판과 프로그램 이름만 다르다', () => {
  assert.ok(USAGE.startsWith('Usage: wbs-parse.mjs <wbs-path> <ID> [mode]\n'));
  assert.ok(USAGE.endsWith('--dev-config docs\n'));
  const r = run([]);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, `${USAGE}\n`);
});

test('makeNorm(win32 모양): JSON 이스케이프(\\n \\" \\uXXXX)는 건드리지 않고 경로의 역슬래시만 슬래시로', () => {
  const baseDir = 'C:\\t\\base';
  const jsRoot = 'C:\\skills\\dflow-export';
  const n = makeNorm(baseDir, { win: true, jsRoot, pyRoot: 'C:\\tmp' });
  const stdout = JSON.stringify({
    block: 'a\nb "q" \u00e9',
    source_path: 'C:\\t\\base/feats/x\\dev-config.md',
    message: 'Default dev-config not found at C:\\skills\\dflow-export\\references\\default-dev-config.md. x',
  });
  const want = JSON.stringify({
    block: 'a\nb "q" \u00e9',
    source_path: '<BASE>/feats/x/dev-config.md',
    message: 'Default dev-config not found at <ROOT>/references/default-dev-config.md. x',
  });
  assert.equal(n.js(stdout, { stdout: true }), want);
  assert.equal(n.js('ERROR: file not found: C:\\t\\base\\x\\wbs.md'), 'ERROR: file not found: <BASE>/x/wbs.md');
  assert.equal(n.js('ERROR: unexpected failure: boom'), '<TRACEBACK>');
  const posix = makeNorm('/t/base', { win: false, jsRoot: '/s/dflow-export', pyRoot: '/tmp' });
  assert.equal(posix.js('{"source": "/t/base/a", "m": "/s/dflow-export/references/default-dev-config.md"}', { stdout: true }),
    '{"source": "<BASE>/a", "m": "<ROOT>/references/default-dev-config.md"}');
  assert.equal(posix.py('Usage: wbs-parse.py <x>', { stdout: true }), 'Usage: wbs-parse.mjs <x>');
  assert.equal(posix.py('Traceback (most recent call last):\n  x'), '<TRACEBACK>');
});

// ---- 3) 골든 비교 ------------------------------------------------------------

function spawnCapture(cmd, args, { cwd, env: extraEnv, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', (e) => resolve({ status: -1, stdout: '', stderr: String(e) }));
    child.on('close', (status) => resolve({
      status, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'),
    }));
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}

const PY_ENV = { PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', CLAUDE_PLUGIN_ROOT: '' };

const runPy = (args, { cwd, env: e } = {}) =>
  spawnCapture(env.pythonCmd, ['-B', env.script('wbs-parse.py'), ...args], { cwd, env: { ...PY_ENV, ...e } });
const runJs = (args, { cwd, env: e } = {}) =>
  spawnCapture(process.execPath, [SCRIPT, ...args], { cwd, env: { CLAUDE_PLUGIN_ROOT: '', ...e } });

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
};

const TRACEBACK = '<TRACEBACK>';

/**
 * 출력 속의 임시 경로·플러그인 경로·프로그램 이름처럼 환경마다 다른 부분만 같은 토큰으로 바꾼다.
 * win32 에서는 node 판 출력의 경로 구분자(`\`)를 `/` 로 맞춘다 — stdout 은 JSON 이므로 경로의 `\` 가 `\\` 로
 * 이스케이프돼 있고, `\n`·`\"`·`\uXXXX` 같은 다른 이스케이프는 건드리면 안 된다(합성 문서에는 역슬래시 문자가 없다).
 * stderr 는 평문(`ERROR: …`)이라 단일 `\` 를 바꾼다.
 */
export function makeNorm(baseDir, { win = process.platform === 'win32', jsRoot = SKILL, pyRoot = path.dirname(env.dir) } = {}) {
  const bases = [...new Set([baseDir, real(baseDir)])];
  const DEFAULT_CFG = '/references/default-dev-config.md';
  // 경로를 토큰으로 바꾼다. win32 의 stdout(JSON)에서는 경로의 `\` 가 `\\` 로 이스케이프돼 있다.
  const paths = (s, root, stdout) => {
    let r = s;
    if (win) {
      const esc = (p) => (stdout ? p.replace(/\\/g, '\\\\') : p);
      const sep = esc('\\');
      r = r.split(`${esc(root)}${sep}references${sep}default-dev-config.md`).join(`<ROOT>${DEFAULT_CFG}`);
      for (const b of bases) r = r.split(esc(b)).join('<BASE>');
      r = r.split(sep).join('/');
    } else {
      r = r.split(`${root}${DEFAULT_CFG}`).join(`<ROOT>${DEFAULT_CFG}`);
      for (const b of bases) r = r.split(b).join('<BASE>');
    }
    return r;
  };
  return {
    py(s, { stdout = false } = {}) {
      let r = paths(s, pyRoot, stdout);
      if (stdout) r = r.split('wbs-parse.py').join('wbs-parse.mjs');
      // python traceback(비정상 입력)은 node 의 한 줄 오류와 같은 표식으로 맞춘다
      if (!stdout && r.startsWith('Traceback (most recent call last):')) r = TRACEBACK;
      return r;
    },
    js(s, { stdout = false } = {}) {
      let r = paths(s, jsRoot, stdout);
      if (!stdout && r.startsWith('ERROR: unexpected failure: ')) r = TRACEBACK;
      return r;
    },
  };
}

const norm = makeNorm(base);
const synth = buildSynthetic(base);
before(() => {
  for (const [rel, text] of Object.entries(synth.files)) {
    const p = path.join(base, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text, 'utf8');
  }
});

function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ctx = (t) => JSON.stringify(t.slice(Math.max(0, i - 30), i + 60));
  return `위치 ${i}\n    python: ${ctx(a)}\n    node:   ${ctx(b)}`;
}

function compareResults(c, py, js) {
  const diffs = [];
  const p = { status: py.status, stdout: norm.py(py.stdout, { stdout: true }), stderr: norm.py(py.stderr) };
  const n = { status: js.status, stdout: norm.js(js.stdout, { stdout: true }), stderr: norm.js(js.stderr) };
  for (const f of ['status', 'stdout', 'stderr']) {
    if (p[f] !== n[f]) diffs.push(`[${c.id}] ${f} (${JSON.stringify(c.args)}) ${f === 'status' ? `python ${p[f]} node ${n[f]}` : firstDiff(p[f], n[f])}`);
  }
  return diffs;
}

async function goldenBatch(cases, { cwd, limit = 8 }) {
  const diffs = [];
  await mapLimit(cases, limit, async (c) => {
    const [py, js] = await Promise.all([runPy(c.args, { cwd, env: c.env }), runJs(c.args, { cwd, env: c.env })]);
    diffs.push(...compareResults(c, py, js));
  });
  return diffs;
}

const group = (prefix) => synth.cases.filter((c) => c.id.startsWith(prefix));

for (const [title, filter] of [
  ['문서 × 모드 행렬 (경계 입력 28종)', (c) => c.id.startsWith('doc ')],
  ['state.json 변종 × 모드', (c) => c.id.startsWith('state-')],
  ['상태머신 변종(CLAUDE_PLUGIN_ROOT) × 상태', (c) => c.id.startsWith('pr-')],
  ['feat 모드', (c) => c.id.startsWith('feat ')],
  ['인자 해석(python 수동 파싱)', (c) => c.id.startsWith('argv ')],
]) {
  test(`골든(python 대비): ${title}`, async (t) => {
    if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
    const cases = synth.cases.filter(filter);
    assert.ok(cases.length > 0);
    const diffs = await goldenBatch(cases, { cwd: base });
    assert.equal(diffs.length, 0, `${cases.length}건 중 차이 ${diffs.length}건\n${diffs.slice(0, 8).join('\n')}`);
  });
}

test('골든(python 대비): 케이스 총수와 모드 12종 · --feat 모드가 모두 들어 있다', () => {
  const modes = ['--block', '--field', '--tasks', '--tasks-pending', '--tasks-all', '--export', '--feat-tasks',
    '--resumable-wps', '--phase-start', '--dev-config', '--complexity', '--json'];
  for (const m of modes) assert.ok(synth.cases.some((c) => c.args.includes(m)) || m === '--json', m);
  assert.ok(synth.cases.some((c) => c.args[0] === '--feat'));
  assert.ok(synth.cases.length > 1000, `케이스 ${synth.cases.length}`);
});

test('골든(python 대비): 잘못된 UTF-8 은 둘 다 종료 코드 1 · stdout 비어 있음(stderr 문구는 다름)', async (t) => {
  const bad = path.join(base, 'invalid-utf8.md');
  fs.writeFileSync(bad, Buffer.concat([Buffer.from('## WP-01: a\n### TSK-01-01: t\n'), Buffer.from([0xff, 0xfe]), Buffer.from('\n')]));
  const js = await runJs([bad, '--export']);
  assert.equal(js.status, 1);
  assert.equal(js.stdout, '');
  assert.match(js.stderr, /^ERROR: unexpected failure: /);
  if (!env.available) return t.skip('python3 없음 — node 쪽만 확인');
  const py = await runPy([bad, '--export']);
  assert.equal(py.status, 1);
  assert.equal(py.stdout, '');
  assert.match(py.stderr, /UnicodeDecodeError/);
});

// 실제 WBS 문서 전수 ---------------------------------------------------------

function realWbsDocs() {
  const docs = path.join(REPO, 'docs');
  if (!fs.existsSync(docs)) return [];
  return walkSorted(docs, { extensions: ['.md'], skipDirs: ['node_modules', '.git'] })
    .filter((f) => /^wbs.*\.md$/i.test(path.basename(f)));
}

const REAL = realWbsDocs();

test('실제 WBS 문서가 최소 1개 있다', { skip: REAL.length === 0 && '이 리포에 실제 문서가 없다(D-Flow 정본 리포 — 실제 문서 비교는 스킬을 설치한 리포에서 돈다)' }, () => {
  assert.ok(REAL.length >= 1, 'docs/**/wbs*.md 가 없음');
});

function realCases(file) {
  const rel = path.relative(REPO, file).split(path.sep).join('/');
  const text = readPyText(file);
  const tsk = [...new Set([...text.matchAll(/^#{2,6}[ \t]*(TSK-[0-9]+(?:-[0-9]+)+):/gm)].map((m) => m[1]))];
  const wp = [...new Set([...text.matchAll(/^##[ \t]*(WP-[0-9]+):/gm)].map((m) => m[1]))];
  const cases = [];
  const add = (id, args) => cases.push({ id: `${rel} ${id}`, args: [rel, ...args] });
  for (const mode of ['--export', '--tasks-all', '--resumable-wps', '--dev-config']) add(mode, ['-', mode]);
  add('flag --export', ['--export']);
  add('flag --tasks-all', ['--tasks-all']);
  for (const id of [...tsk, 'TSK-99-99']) {
    add(id, [id]);
    for (const mode of ['--block', '--complexity', '--phase-start']) add(`${id} ${mode}`, [id, mode]);
    add(`${id} --field domain`, [id, '--field', 'domain']);
    add(`${id} --field status`, [id, '--field', 'status']);
  }
  for (const id of [...wp, 'WP-99']) {
    for (const mode of ['--tasks', '--tasks-pending', '--feat-tasks']) add(`${id} ${mode}`, [id, mode]);
  }
  return { rel, cases, tskCount: tsk.length, wpCount: wp.length };
}

test('골든(python 대비): 실제 WBS 문서 전수 × 모드 12종 (상대 경로, cwd = 리포 루트)', async (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  if (REAL.length === 0) return t.skip('이 리포에 실제 문서가 없다(D-Flow 정본 리포 — 실제 문서 비교는 스킬을 설치한 리포에서 돈다)');
  let total = 0;
  const diffs = [];
  for (const f of REAL) {
    const { cases } = realCases(f);
    total += cases.length;
    diffs.push(...await goldenBatch(cases, { cwd: REPO }));
  }
  assert.ok(total > 0);
  assert.equal(diffs.length, 0, `${total}건 중 차이 ${diffs.length}건\n${diffs.slice(0, 8).join('\n')}`);
});

test('골든(python 대비): 실제 WBS 문서 --export 는 절대 경로로도 바이트 동일, 재실행도 동일', async (t) => {
  for (const f of REAL) {
    const a = await runJs([f, '--export'], { cwd: HERE });
    const b = await runJs([f, '--export'], { cwd: HERE });
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stdout, b.stdout, `${f}: 재실행 결과가 다름`);
    const parsed = JSON.parse(a.stdout);
    assert.equal(parsed.schema_version, '2.1');
    assert.equal(parsed.source, f);
    for (const n of parsed.nodes) {
      assert.deepEqual(keysOf(n), sortedKeys, n.id);
      assert.deepEqual(keysOf(n.spec_sections), sortedSpec, n.id);
    }
    if (!env.available) continue;
    const py = await runPy([f, '--export'], { cwd: HERE });
    assert.equal(py.status, 0, py.stderr);
    assert.equal(a.stdout, py.stdout, `${f}: python 판과 export 가 다름 ${firstDiff(py.stdout, a.stdout)}`);
    assert.equal(Buffer.from(a.stdout).equals(Buffer.from(py.stdout)), true);
  }
  if (!env.available) t.diagnostic('python 없음 — 결정성만 확인');
});

test('python 원본 단위 시험(legacy)이 아직 통과한다 (골든 기준의 건강 확인)', async (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못함');
  const legacyTest = path.join(env.dir, 'test_wbs_parse_export.py');
  if (!fs.existsSync(legacyTest)) return t.skip('legacy 시험 파일이 없음');
  const r = await spawnCapture(env.pythonCmd, ['-B', legacyTest], { cwd: env.dir, env: PY_ENV });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /Ran 18 tests/);
});

// ---- 4) python 없이 도는 기대값 비교 ------------------------------------------

test('기대값(python 으로 미리 계산): 합성 케이스 전체를 node 판 결과와 비교', async (t) => {
  assert.ok(fs.existsSync(EXPECTED), 'tests/golden/expected/parse.json 이 없음 — make-expected-parse.mjs 로 만든다');
  const expected = readJson(EXPECTED);
  const ids = Object.keys(expected);
  assert.equal(ids.length, synth.cases.length, `기대값 ${ids.length}건 ≠ 케이스 ${synth.cases.length}건 — make-expected-parse.mjs 를 다시 돌린다`);
  const diffs = [];
  await mapLimit(synth.cases, 8, async (c) => {
    const exp = expected[c.id];
    if (!exp) { diffs.push(`[${c.id}] 기대값 없음`); return; }
    const js = await runJs(c.args, { cwd: base, env: c.env });
    const n = { status: js.status, stdout: norm.js(js.stdout, { stdout: true }), stderr: norm.js(js.stderr) };
    for (const f of ['status', 'stdout', 'stderr']) {
      if (exp[f] !== n[f]) diffs.push(`[${c.id}] ${f} ${f === 'status' ? `기대 ${exp[f]} node ${n[f]}` : firstDiff(exp[f], n[f])}`);
    }
  });
  assert.equal(diffs.length, 0, `${synth.cases.length}건 중 차이 ${diffs.length}건\n${diffs.slice(0, 8).join('\n')}`);
});
