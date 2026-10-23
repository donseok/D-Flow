// status-cases.mjs — _wbs_status 골든·기대값 시험이 함께 쓰는 케이스와 python 쪽 드라이버.
//  - CALLS: 파일·환경과 무관한 순수 함수 호출. JSON 으로 python 과 node 양쪽에 같은 목록을 준다.
//  - RESOLVE_CASES: resolve_state_machine / state_machine_candidates 를 환경 변수·파일 배치를 바꿔 호출.
//    각 케이스는 임시 폴더 아래 자기 폴더 `{R}`(= <TMP>/<root>)에 files 를 만들고, docs_dir·env 안의 `{R}` 을 그 경로로 바꾼다.
// 드라이버(node: status-driver.mjs, python: PY_DRIVER)가 같은 JSON 을 읽어 같은 모양의 JSON 을 낸다.
// 집합(set)은 정렬한 배열, 튜플은 배열, None 은 null 로 직렬화한다.

export const V5_SM = {
  states: { '[ ]': {}, '[dd]': {}, '[im]': {}, '[ts]': {}, '[xx]': {} },
  events: { 'design.ok': '…', 'build.ok': '…' },
};
export const V6_SM = {
  states: { '[ ]': {}, '[as]': {}, '[fp]': {}, '[ip]': {}, '[im]': {}, '[xx]': {} },
  events: { assign: '…', 'cycle.start': '…', 'refactor.ok': '…', accept: '…' },
};

const j = (v) => JSON.stringify(v);

export const CALLS = [
  // stage_code
  ...['[ ]', '[dd]', '[im]', '[ts]', '[xx]', '[dd!]', '[im!]', '[as]', '[fp]', '[ip]', '  [xx]  ', '\t[im]\n', '[xx] ', '　[ip]　',
    '\u001c[ip]\u001d', '\u0085[as]\u0085', '﻿[xx]', '[zz]', '', '   ', '[XX]', '[ ] ', ' [ ]', '[x x]', 'xx', '[]', null, 0, false, '[dd!] ', '[im!]\n']
    .map((s) => ({ fn: 'stage_code', args: [s] })),
  // is_v6_states (배열 입력: python 은 list, node 는 배열)
  ...[[], ['[ ]', '[ip]'], ['[ ]', '[dd]', '[xx]'], ['[as]'], ['[fp]'], ['[ip]'], ['[im]', '[xx]'], ['[AS]'], null, ['x']]
    .map((s) => ({ fn: 'is_v6_states', args: [s] })),
  // is_v6_sm · known_states · satisfied_states
  ...[V5_SM, V6_SM, null, {}, { states: {} }, { states: { '[as]': 1 } }, { states: { '[ip]': null } }, { events: {} },
    { states: { '[ ]': {}, '[xx]': {} } },
    { states: {}, dependency: { satisfied_states: ['[ts]', '[xx]'] } },
    { states: { '[as]': {} }, dependency: { satisfied_states: ['[ts]', '[xx]'] } },
    { states: { '[as]': {} }, dependency: { satisfied_states: [] } },
    { states: { '[as]': {} }, dependency: { satisfied_states: '[xx]' } },
    { states: { '[as]': {} }, dependency: { satisfied_states: null } },
    { states: { '[as]': {} }, dependency: null },
    { states: { '[as]': {} }, dependency: {} },
    { states: { '[dd]': {} }, dependency: { satisfied_states: ['[a]', '[a]', '[b]'] } },
    { states: { '[ip]': {}, '[xx]': {} }, dependency: { satisfied_states: ['[dd]'], other: 1 } },
  ].flatMap((sm) => [
    { fn: 'is_v6_sm', args: [sm] },
    { fn: 'known_states', args: [sm] },
    { fn: 'satisfied_states', args: [sm] },
  ]),
];

const DOC_PLUGIN_ENV = { CLAUDE_PLUGIN_ROOT: '{R}/plugin' };
const PLUGIN_FILE = { 'plugin/references/state-machine.json': j(V5_SM) };

/** root: <TMP> 아래 폴더 이름. pyMsg313: python 3.13+ 에서 json 오류 문구가 달라 골든 비교에서 err 를 뺀다. docs_dir 가 undefined 면 인자를 생략하는 호출(기본값 None). */
export const RESOLVE_CASES = [
  { id: '기본값 인자 없음(플러그인 기본)', root: 'r01', files: {}, env: {}, docs_dir: null },
  { id: 'docs/<모듈> 에서 한 단계 위 docs/state-machine.json', root: 'r02', files: { 'docs/state-machine.json': j(V6_SM), 'docs/MES/.keep': '' }, env: {}, docs_dir: '{R}/docs/MES' },
  { id: '같은 폴더 state-machine.json', root: 'r03', files: { 'docs/state-machine.json': j(V6_SM) }, env: {}, docs_dir: '{R}/docs' },
  { id: '같은 폴더가 한 단계 위보다 우선', root: 'r04', files: { 'docs/state-machine.json': j(V6_SM), 'docs/MES/state-machine.json': j(V5_SM) }, env: {}, docs_dir: '{R}/docs/MES' },
  { id: '아무것도 없으면 플러그인 기본(5상태)', root: 'r05', files: { 'a/b/.keep': '' }, env: {}, docs_dir: '{R}/a/b' },
  { id: 'WBS_STATE_MACHINE 우선', root: 'r06', files: { 'custom.json': j(V6_SM), 'docs/state-machine.json': j(V5_SM) }, env: { WBS_STATE_MACHINE: '{R}/custom.json' }, docs_dir: '{R}/docs' },
  { id: 'WBS_STATE_MACHINE 이 docs_dir=None 에서도 우선', root: 'r07', files: { 'custom.json': j(V6_SM) }, env: { WBS_STATE_MACHINE: '{R}/custom.json' }, docs_dir: null },
  { id: 'WBS_STATE_MACHINE 이 없는 파일이면 다음 후보', root: 'r08', files: { 'docs/state-machine.json': j(V6_SM) }, env: { WBS_STATE_MACHINE: '{R}/nope.json' }, docs_dir: '{R}/docs' },
  { id: 'WBS_STATE_MACHINE 빈 문자열은 없는 것', root: 'r09', files: { 'docs/state-machine.json': j(V6_SM) }, env: { WBS_STATE_MACHINE: '' }, docs_dir: '{R}/docs' },
  { id: 'CLAUDE_PLUGIN_ROOT 지정', root: 'r10', files: PLUGIN_FILE, env: DOC_PLUGIN_ENV, docs_dir: '{R}/x' },
  { id: 'CLAUDE_PLUGIN_ROOT 빈 문자열은 기본 위치', root: 'r11', files: {}, env: { CLAUDE_PLUGIN_ROOT: '' }, docs_dir: '{R}/x' },
  { id: 'CLAUDE_PLUGIN_ROOT 에 상태머신이 없음', root: 'r12', files: {}, env: DOC_PLUGIN_ENV, docs_dir: '{R}/x' },
  { id: '깨진 JSON: 값 없음', root: 'r13', files: { 'docs/state-machine.json': '{"states": }' }, env: {}, docs_dir: '{R}/docs' },
  { id: '깨진 JSON: 쉼표 뒤 닫는 괄호', pyMsg313: true, root: 'r14', files: { 'docs/state-machine.json': '{"states": {"[ ]": {},}}' }, env: {}, docs_dir: '{R}/docs' },
  { id: '깨진 JSON: 여러 줄 위치', root: 'r15', files: { 'docs/state-machine.json': '{\n  "states": {\n    "[ ]": {}\n    "[xx]": {}\n  }\n}\n' }, env: {}, docs_dir: '{R}/docs' },
  { id: '깨진 JSON: CRLF 줄 위치', root: 'r16', files: { 'docs/state-machine.json': '{\r\n  "states": {\r\n    "[ ]": {}\r\n    "[xx]": {}\r\n  }\r\n}\r\n' }, env: {}, docs_dir: '{R}/docs' },
  { id: '빈 파일', root: 'r17', files: { 'docs/state-machine.json': '' }, env: {}, docs_dir: '{R}/docs' },
  { id: '뒤에 남은 글자', root: 'r18', files: { 'docs/state-machine.json': '{} x' }, env: {}, docs_dir: '{R}/docs' },
  { id: 'BOM 은 python 처럼 오류', root: 'r19', files: { 'docs/state-machine.json': `﻿${j(V6_SM)}` }, env: {}, docs_dir: '{R}/docs' },
  { id: '한글 폴더·한글 오류 위치', root: 'r한글', files: { '문서/상태.json': '{"한글": }', '문서/state-machine.json': '{"가": "나", "다": }' }, env: {}, docs_dir: '{R}/문서' },
  { id: '이모지 뒤 오류 위치(코드포인트)', root: 'r20', files: { 'docs/state-machine.json': '{"😀😀": 1, "a" }' }, env: {}, docs_dir: '{R}/docs' },
  { id: '폴더 이름이 state-machine.json 이면 건너뜀', root: 'r21', files: { 'docs/state-machine.json/.keep': '', 'state-machine.json': j(V6_SM) }, env: {}, docs_dir: '{R}/docs' },
  { id: 'JSON 이 배열', root: 'r22', files: { 'docs/state-machine.json': '[1, 2]' }, env: {}, docs_dir: '{R}/docs' },
  { id: 'JSON 숫자·중첩 값', root: 'r23', files: { 'docs/state-machine.json': '{"states": {"[as]": 1.5, "x": [1, 2.0e2, true, null, "s"]}}' }, env: {}, docs_dir: '{R}/docs' },
  { id: '후행 슬래시', root: 'r24', files: { 'docs/state-machine.json': j(V6_SM) }, env: {}, docs_dir: '{R}/docs/' },
  { id: '.. 가 낀 경로', root: 'r25', files: { 'docs/state-machine.json': j(V6_SM), 'x/.keep': '' }, env: {}, docs_dir: '{R}/x/../docs' },
  { id: '상대 경로(cwd = 임시 폴더)', root: 'r26', files: { 'docs/state-machine.json': j(V6_SM), 'docs/MES/.keep': '' }, env: {}, docs_dir: 'r26/docs/MES', cwdIsTmp: true },
  { id: '빈 문자열 docs_dir 은 cwd', root: 'r27', files: { 'state-machine.json': j(V6_SM) }, env: {}, docs_dir: '', cwdIsTmp: true, cwdRoot: true },
  { id: '명시적 satisfied_states 파일', root: 'r28', files: { 'docs/state-machine.json': j({ states: { '[ ]': {} }, dependency: { satisfied_states: ['[ts]', '[xx]'] } }) }, env: {}, docs_dir: '{R}/docs' },
];

import fs from 'node:fs';
import path from 'node:path';

/** 케이스의 임시 파일을 tmp 아래에 만들고 드라이버에 줄 요청(JSON 객체)을 돌려준다. */
export function buildRequest(tmp) {
  const resolves = RESOLVE_CASES.map((c) => {
    const R = path.join(tmp, c.root);
    fs.mkdirSync(R, { recursive: true });
    for (const [rel, text] of Object.entries(c.files)) {
      const p = path.join(R, ...rel.split('/'));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text, 'utf8');
    }
    const fill = (v) => v.split('{R}').join(R);
    const env = Object.fromEntries(Object.entries(c.env).map(([k, v]) => [k, fill(v)]));
    return {
      env,
      docs_dir: c.docs_dir === null ? null : fill(c.docs_dir),
      cwd: c.cwdIsTmp ? (c.cwdRoot ? R : tmp) : undefined,
    };
  });
  return { calls: CALLS, resolves };
}

/**
 * 드라이버 출력의 경로를 자리표시자로 바꿔 python·node 결과를 같은 모양으로 만든다.
 * plugins: 플러그인 기본 위치로 쓰인 폴더들(legacy 복사본 폴더, scripts 폴더). 역슬래시는 슬래시로 통일.
 */
export function normalizeOut(value, { tmp, plugins }) {
  const reps = [];
  // realpath 를 먼저 바꾼다(macOS 의 /var → /private/var 처럼 realpath 가 더 길 때 부분 일치를 막는다)
  for (const d of plugins) {
    try { reps.push([fs.realpathSync(d), '<PLUGIN>']); } catch { /* 없으면 건너뜀 */ }
    reps.push([d, '<PLUGIN>']);
  }
  try { reps.push([fs.realpathSync(tmp), '<TMP>']); } catch { /* 없으면 건너뜀 */ }
  reps.push([tmp, '<TMP>']);
  const walk = (v) => {
    if (typeof v === 'string') {
      let t = v;
      for (const [a, b] of reps) t = t.split(a).join(b);
      return t.replace(/\\/g, '/');
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}

// python 쪽 드라이버: argv[1] = legacy 폴더. stdin 으로 {calls, resolves} JSON 을 받아 같은 모양의 JSON 을 stdout 에 낸다.
export const PY_DRIVER = `
import json, os, sys
sys.path.insert(0, sys.argv[1])
import _wbs_status as S

def ser(v):
    if isinstance(v, (set, frozenset)):
        return sorted(v)
    if isinstance(v, (tuple, list)):
        return [ser(x) for x in v]
    if isinstance(v, dict):
        return {k: ser(x) for k, x in v.items()}
    return v

req = json.load(sys.stdin)
res = {"calls": [], "resolves": []}
for c in req["calls"]:
    res["calls"].append(ser(getattr(S, c["fn"])(*c["args"])))
for r in req["resolves"]:
    saved = dict(os.environ)
    for k in ("WBS_STATE_MACHINE", "CLAUDE_PLUGIN_ROOT"):
        os.environ.pop(k, None)
    os.environ.update(r["env"])
    if r.get("cwd"):
        os.chdir(r["cwd"])
    try:
        if r["docs_dir"] is None:
            cand = S.state_machine_candidates()
            sm, p, err = S.resolve_state_machine()
        else:
            cand = S.state_machine_candidates(r["docs_dir"])
            sm, p, err = S.resolve_state_machine(r["docs_dir"])
        res["resolves"].append({"candidates": cand, "sm": ser(sm), "path": p, "err": err})
    finally:
        os.environ.clear()
        os.environ.update(saved)
print(json.dumps(res, ensure_ascii=False))
`;
