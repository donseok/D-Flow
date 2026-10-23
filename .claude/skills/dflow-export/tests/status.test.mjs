// _wbs_status.mjs 시험.
//  1) 원본 test_wbs_status.py 의 13개 케이스를 같은 의미로 옮긴 단위 시험.
//  2) 골든 비교: 같은 입력(status-cases.mjs)을 python legacy 와 node 판이 각각 처리한 결과(JSON)를 비교(python 없으면 skip).
//  3) python 없이 도는 보조 시험: tests/golden/expected/status.json 과 node 판 결과를 비교
//     (기대값은 `node dflow-export/tests/make-expected.mjs` 로 다시 만든다).
// 임시 폴더는 모두 makeTempDir 로 만들고 끝나면 지운다.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir, runNode } from '../../_shared/node/proc.mjs';
import { readJson } from '../../_shared/node/io.mjs';
import * as S from '../scripts/_wbs_status.mjs';
import { legacyEnv, SCRIPTS_DIR } from './legacy-env.mjs';
import { V5_SM, V6_SM, PY_DRIVER as PY_DRIVER_CODE, RESOLVE_CASES, buildRequest, normalizeOut } from './status-cases.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = path.join(HERE, 'status-driver.mjs');

const base = makeTempDir('wbs-status-test-');
const env = legacyEnv();
after(() => {
  fs.rmSync(base, { recursive: true, force: true });
  env.cleanup();
});

const setEq = (actual, expected) => assert.deepEqual([...actual].sort(), [...expected].sort());

// ---- 1) 원본 python 단위 시험 이식 -------------------------------------------

test('VocabularyDetection: test_is_v6_sm', () => {
  assert.equal(S.is_v6_sm(V6_SM), true);
  assert.equal(S.is_v6_sm(V5_SM), false);
  assert.equal(S.is_v6_sm(null), false);
});

test('VocabularyDetection: test_is_v6_states', () => {
  assert.equal(S.is_v6_states(new Set(['[ ]', '[ip]'])), true);
  assert.equal(S.is_v6_states(new Set(['[ ]', '[dd]', '[xx]'])), false);
  assert.equal(S.is_v6_states(new Set()), false);
});

test('VocabularyDetection: test_known_states', () => {
  setEq(S.known_states(V5_SM), ['[ ]', '[dd]', '[im]', '[ts]', '[xx]']);
  assert.ok(S.known_states(V5_SM) instanceof Set);
  setEq(S.known_states(null), []);
});

test('StageMapping: test_local_five_state_maps_to_dflow_stage', () => {
  assert.equal(S.stage_code('[ ]'), null);
  assert.equal(S.stage_code('[dd]'), 'ip');
  assert.equal(S.stage_code('[im]'), 'im');
  assert.equal(S.stage_code('[ts]'), 'ip');
  assert.equal(S.stage_code('[xx]'), 'xx');
});

test('StageMapping: test_legacy_markers', () => {
  assert.equal(S.stage_code('[dd!]'), 'todo');
  assert.equal(S.stage_code('[im!]'), 'ip');
});

test('StageMapping: test_six_state_codes_round_trip', () => {
  assert.equal(S.stage_code('[as]'), 'as');
  assert.equal(S.stage_code('[fp]'), 'fp');
  assert.equal(S.stage_code('[ip]'), 'ip');
});

test('StageMapping: test_whitespace_and_unknown', () => {
  assert.equal(S.stage_code('  [xx]  '), 'xx');
  assert.equal(S.stage_code('[zz]'), null);
  assert.equal(S.stage_code(''), null);
  assert.equal(S.stage_code(null), null);
});

test('Dependencies: test_satisfied_states', () => {
  setEq(S.satisfied_states(V6_SM), ['[im]', '[xx]']);
  setEq(S.satisfied_states(V5_SM), ['[xx]']);
  setEq(S.satisfied_states(null), ['[xx]']);
});

test('Dependencies: test_explicit_override_wins', () => {
  const sm = { states: { '[ ]': {} }, dependency: { satisfied_states: ['[ts]', '[xx]'] } };
  setEq(S.satisfied_states(sm), ['[ts]', '[xx]']);
});

// resolve_state_machine() 이 읽는 WBS_STATE_MACHINE/CLAUDE_PLUGIN_ROOT 는 시험을 돌리는 환경에 이미 있을 수 있다.
// 매 시험 전에 두 값을 지우고 시험 뒤 원래 값으로 되돌린다.
function withCleanEnv(fn) {
  const saved = { WBS_STATE_MACHINE: process.env.WBS_STATE_MACHINE, CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT };
  delete process.env.WBS_STATE_MACHINE;
  delete process.env.CLAUDE_PLUGIN_ROOT;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const tmpDir = () => fs.mkdtempSync(path.join(base, 'res-'));

test('Resolution: test_docs_dir_override_beats_plugin_default', () => withCleanEnv(() => {
  const tmp = tmpDir();
  const docs = path.join(tmp, 'docs');
  fs.mkdirSync(path.join(docs, 'MES'), { recursive: true });
  fs.writeFileSync(path.join(docs, 'state-machine.json'), JSON.stringify(V6_SM), 'utf8');
  const [sm, p, err] = S.resolve_state_machine(path.join(docs, 'MES'));
  assert.equal(err, null);
  assert.equal(p, path.join(docs, 'state-machine.json'));
  assert.equal(S.is_v6_sm(sm), true);
}));

test('Resolution: test_same_dir_override', () => withCleanEnv(() => {
  const tmp = tmpDir();
  const docs = path.join(tmp, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'state-machine.json'), JSON.stringify(V6_SM), 'utf8');
  const [, p, err] = S.resolve_state_machine(docs);
  assert.equal(err, null);
  assert.equal(p, path.join(docs, 'state-machine.json'));
}));

test('Resolution: test_falls_back_to_plugin_5state', () => withCleanEnv(() => {
  const tmp = tmpDir();
  const sub = path.join(tmp, 'a', 'b');
  fs.mkdirSync(sub, { recursive: true });
  const [sm, p, err] = S.resolve_state_machine(sub);
  assert.equal(err, null, err);
  assert.ok(p.endsWith(path.join('references', 'state-machine.json')));
  assert.equal(S.is_v6_sm(sm), false);
}));

test('Resolution: test_env_override_wins', () => withCleanEnv(() => {
  const tmp = tmpDir();
  const p = path.join(tmp, 'custom.json');
  fs.writeFileSync(p, JSON.stringify(V6_SM), 'utf8');
  process.env.WBS_STATE_MACHINE = p;
  const [, path_, err] = S.resolve_state_machine(null);
  assert.equal(err, null);
  assert.equal(path_, p);
}));

// ---- 추가: node 판 계약 ------------------------------------------------------

test('내보내는 이름이 python 판과 같다', () => {
  for (const n of ['V5_STATES', 'V6_STATES', 'V6_ONLY', 'STAGE_CODE', 'is_v6_states', 'is_v6_sm', 'known_states',
    'stage_code', 'satisfied_states', 'state_machine_candidates', 'resolve_state_machine']) {
    assert.ok(n in S, n);
  }
  assert.deepEqual([...S.V5_STATES], ['[ ]', '[dd]', '[im]', '[ts]', '[xx]']);
  assert.deepEqual([...S.V6_STATES], ['[ ]', '[as]', '[fp]', '[ip]', '[im]', '[xx]']);
  assert.deepEqual([...S.V6_ONLY], ['[as]', '[fp]', '[ip]']);
  assert.equal(S.STAGE_CODE.get('[ ]'), null);
  assert.equal(S.STAGE_CODE.size, 10);
});

test('stage_code: 프로토타입 이름은 모르는 표기(null)', () => {
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(S.stage_code(k), null);
});

test('resolve_state_machine: 반환은 [sm, path, err] 배열, 없으면 tried 목록을 쓴다', () => withCleanEnv(() => {
  const tmp = tmpDir();
  process.env.CLAUDE_PLUGIN_ROOT = path.join(tmp, 'none');
  const r = S.resolve_state_machine(path.join(tmp, 'x'));
  assert.ok(Array.isArray(r) && r.length === 3);
  assert.equal(r[0], null);
  assert.equal(r[1], null);
  assert.match(r[2], /^state-machine\.json not found \(tried: .+, .+, .+\)$/);
  assert.equal(r[2].split(', ').length, 3);
}));

test('resolve_state_machine: 깨진 JSON 은 python 과 같은 문구', () => withCleanEnv(() => {
  const tmp = tmpDir();
  const docs = path.join(tmp, 'docs');
  fs.mkdirSync(docs);
  const f = path.join(docs, 'state-machine.json');
  fs.writeFileSync(f, '{"a": }', 'utf8');
  const [sm, p, err] = S.resolve_state_machine(docs);
  assert.equal(sm, null);
  assert.equal(p, f);
  assert.equal(err, `failed to load ${f}: Expecting value: line 1 column 7 (char 6)`);
}));

test('resolve_state_machine: 읽을 수 없는 파일은 OSError 문구', { skip: process.platform === 'win32' || (typeof process.getuid === 'function' && process.getuid() === 0) }, () => withCleanEnv(() => {
  const tmp = tmpDir();
  const docs = path.join(tmp, 'docs');
  fs.mkdirSync(docs);
  const f = path.join(docs, 'state-machine.json');
  fs.writeFileSync(f, '{}', 'utf8');
  fs.chmodSync(f, 0o000);
  try {
    const [, , err] = S.resolve_state_machine(docs);
    assert.equal(err, `failed to load ${f}: [Errno 13] Permission denied: '${f}'`);
  } finally {
    fs.chmodSync(f, 0o644);
  }
}));

test('실제 references/state-machine.json 은 5상태 정의로 읽힌다', () => withCleanEnv(() => {
  const [sm, p, err] = S.resolve_state_machine(null);
  assert.equal(err, null);
  assert.equal(p, path.join(SCRIPTS_DIR, 'references', 'state-machine.json'));
  assert.equal(S.is_v6_sm(sm), false);
  setEq(S.satisfied_states(sm), ['[xx]']);
}));

// ---- 2)·3) 골든 비교 / 기대값 비교 ---------------------------------------------

function runDriver(who, tmp, req) {
  const input = JSON.stringify(req);
  const r = who === 'python'
    ? env.python(['-c', PY_DRIVER_CODE, env.dir], { input, cwd: tmp })
    : runNode(DRIVER, [], { input, cwd: tmp });
  assert.equal(r.status, 0, `${who} 드라이버 실패: ${r.stderr}`);
  return normalizeOut(JSON.parse(r.stdout), { tmp, plugins: [env.dir, SCRIPTS_DIR] });
}

test('golden 상태 어휘·해석: python legacy 대 node (전 케이스)', (t) => {
  if (!env.available) return t.skip('python3 를 찾지 못해 골든 비교를 건너뜀');
  const tmp = fs.mkdtempSync(path.join(base, 'gold-'));
  const req = buildRequest(tmp);
  const py = runDriver('python', tmp, req);
  const nd = runDriver('node', tmp, req);
  assert.equal(nd.calls.length, req.calls.length);
  for (let i = 0; i < req.calls.length; i++) {
    assert.deepEqual(nd.calls[i], py.calls[i], `calls[${i}] ${JSON.stringify(req.calls[i])}`);
  }
  assert.equal(nd.resolves.length, req.resolves.length);
  const py313 = !!env.pyVersion && (env.pyVersion[0] > 3 || env.pyVersion[1] >= 13);
  for (let i = 0; i < req.resolves.length; i++) {
    const a = { ...nd.resolves[i] };
    const b = { ...py.resolves[i] };
    if (RESOLVE_CASES[i].pyMsg313 && py313) { delete a.err; delete b.err; } // python 3.13+ json 오류 문구가 다르다
    assert.deepEqual(a, b, `resolves[${i}] ${JSON.stringify(req.resolves[i])}`);
  }
});

const expectedFile = path.join(HERE, 'golden', 'expected', 'status.json');

test('expected 상태 어휘·해석: node 판 결과가 python 으로 미리 계산한 기대값과 같다', () => {
  assert.ok(fs.existsSync(expectedFile), 'golden/expected/status.json 이 없음 (make-expected.mjs 로 생성)');
  const exp = readJson(expectedFile);
  const tmp = fs.mkdtempSync(path.join(base, 'exp-'));
  const req = buildRequest(tmp);
  const nd = runDriver('node', tmp, req);
  assert.equal(nd.calls.length, exp.calls.length);
  for (let i = 0; i < exp.calls.length; i++) {
    assert.deepEqual(nd.calls[i], exp.calls[i], `calls[${i}] ${JSON.stringify(req.calls[i])}`);
  }
  assert.equal(nd.resolves.length, exp.resolves.length);
  for (let i = 0; i < exp.resolves.length; i++) {
    assert.deepEqual(nd.resolves[i], exp.resolves[i], `resolves[${i}]`);
  }
});
