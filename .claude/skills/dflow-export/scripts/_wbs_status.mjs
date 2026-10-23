// _wbs_status.mjs — WBS 상태 어휘 공유 정의. python `_wbs_status.py` 의 node 이식.
// 내보내는 이름은 python 판과 같다: V5_STATES, V6_STATES, V6_ONLY, STAGE_CODE, is_v6_states, is_v6_sm,
// known_states, stage_code, satisfied_states, state_machine_candidates, resolve_state_machine.
//
// 로컬 사이클은 5상태(`references/state-machine.json`)로 계속 돈다. 이 모듈은
// ① 로컬 표기를 D'Flow `stage` 코드로 번역하는 매핑표(export 계약 §7.2-2)와
// ② 프로젝트 상태머신 해석(dep 충족 임계)을 제공한다. 로컬 상태머신 자체는 바꾸지 않는다.
//
// python 판과 주고받는 형태
//  - python set  → JS `Set`  (known_states, satisfied_states 의 반환값. is_v6_states 는 Set·배열·객체를 받는다)
//  - python dict → JS 일반 객체. 단 STAGE_CODE 는 키 조회 안전을 위해 `Map`("[ ]" → null 등).
//  - python tuple (sm, path, err) → JS 배열 `[sm, path, err]` (resolve_state_machine 의 반환값. 구조 분해로 쓴다)
//  - python None → JS null. 상태머신 json 은 `_pyjson_loads.mjs` 로 읽어 python 과 같은 오류 문구를 낸다.
//  - 상태머신 json 은 python `open(path, "r", encoding="utf-8")` 처럼 줄끝만 정규화하고 BOM 은 지우지 않는다
//    (BOM 이 있으면 python 과 같게 `Unexpected UTF-8 BOM` 오류로 보고한다).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyJsonLoads, PyJSONDecodeError } from './_pyjson_loads.mjs';
import { pyReprStr } from '../../_shared/node/pyrepr.mjs';
import { pyStrip } from './_pystr.mjs';

// --- 어휘 ---------------------------------------------------------------

// 로컬 사이클 어휘 (플러그인 references/state-machine.json)
export const V5_STATES = Object.freeze(['[ ]', '[dd]', '[im]', '[ts]', '[xx]']);

// D'Flow stage 축 (dev-workflow docs/state-machine.json — 서버가 소유)
export const V6_STATES = Object.freeze(['[ ]', '[as]', '[fp]', '[ip]', '[im]', '[xx]']);

// 6상태에만 존재하는 코드. 어휘 판별의 유일한 지표.
export const V6_ONLY = Object.freeze(['[as]', '[fp]', '[ip]']);

// 파일 표기 → D'Flow stage 코드.
// [dd]/[ts] 는 사이클 내부 단계라 D'Flow 에 대응 상태가 없다 — 둘 다 진행 중(ip).
// v2.1: "[ ]"(진행 없음)는 문자열 "todo" 대신 null(JSON null) 로 표현한다 —
// stage 어휘가 as|fp|ip|im|xx|null 로 좁혀졌다 (서버 import 계약 — 원본 리포 7cd3b5e 확정).
export const STAGE_CODE = new Map([
  ['[ ]', null], ['[as]', 'as'], ['[fp]', 'fp'],
  ['[ip]', 'ip'], ['[im]', 'im'], ['[xx]', 'xx'],
  ['[dd]', 'ip'], ['[ts]', 'ip'], ['[dd!]', 'todo'], ['[im!]', 'ip'],
]);

// --- 판별 ---------------------------------------------------------------

// python `x in states` (set·list·tuple·dict 모두) 와 `not states` 대응
function toKeySet(states) {
  if (states instanceof Set) return states;
  if (Array.isArray(states)) return new Set(states);
  if (states && typeof states === 'object') return new Set(Object.keys(states));
  return new Set();
}

/** 상태 코드 집합이 6상태 어휘인지. */
export function is_v6_states(states) {
  const keys = toKeySet(states);
  if (keys.size === 0) return false;
  return V6_ONLY.some((code) => keys.has(code));
}

// python `(sm or {}).get("states", {})` — sm 이 비었거나 states 가 없으면 빈 객체
function statesOf(sm) {
  const s = sm ? sm.states : undefined;
  return s === undefined ? {} : s;
}

export function is_v6_sm(sm) {
  return is_v6_states(known_states(sm));
}

export function known_states(sm) {
  return new Set(Object.keys(statesOf(sm) ?? {}));
}

/** 파일 표기 → D'Flow stage 코드. 모르는 표기는 null (지어내지 않는다). */
export function stage_code(status) {
  const key = pyStrip(status || '');
  return STAGE_CODE.has(key) ? STAGE_CODE.get(key) : null;
}

// --- 의존 충족 -----------------------------------------------------------

/**
 * 의존 충족으로 인정하는 상태 집합.
 *
 * 6상태 정의에서는 사람 검수([xx]) 대기가 병렬 진행을 막지 않도록 [im] 부터 충족.
 * 5상태 정의(플러그인 기본)에서는 현행대로 [xx] 만.
 */
export function satisfied_states(sm) {
  const explicit = ((sm || {}).dependency || {}).satisfied_states;
  if (Array.isArray(explicit) && explicit.length > 0) return new Set(explicit);
  return is_v6_sm(sm) ? new Set(['[im]', '[xx]']) : new Set(['[xx]']);
}

// --- 상태머신 해석 -------------------------------------------------------

/** 해석 후보 경로를 우선순위 순으로 반환. */
export function state_machine_candidates(docs_dir = null) {
  const out = [];
  const env = process.env.WBS_STATE_MACHINE;
  if (env) out.push(env);
  if (docs_dir !== null && docs_dir !== undefined) {
    const base = path.resolve(docs_dir || '.');
    out.push(path.join(base, 'state-machine.json'));
    // docs/<모듈>/wbs.md 레이아웃 — 한 단계 위까지만 본다
    out.push(path.join(path.dirname(base), 'state-machine.json'));
  }
  const plugin_root = process.env.CLAUDE_PLUGIN_ROOT
    || path.dirname(fileURLToPath(import.meta.url));
  out.push(path.join(plugin_root, 'references', 'state-machine.json'));
  return out;
}

const ERRNO = {
  EACCES: [13, 'Permission denied'],
  ENOENT: [2, 'No such file or directory'],
  EISDIR: [21, 'Is a directory'],
  EIO: [5, 'Input/output error'],
  EPERM: [1, 'Operation not permitted'],
  EMFILE: [24, 'Too many open files'],
  ENOTDIR: [20, 'Not a directory'],
};

// python OSError 의 str(e): "[Errno 13] Permission denied: '/path'"
function oserrorText(e, file) {
  const known = ERRNO[e.code];
  if (!known) return String(e.message ?? e);
  return `[Errno ${known[0]}] ${known[1]}: ${pyReprStr(file)}`;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** [sm, path, err] 반환. 첫 번째로 존재하는 후보를 쓴다. */
export function resolve_state_machine(docs_dir = null) {
  const tried = [];
  for (const p of state_machine_candidates(docs_dir)) {
    tried.push(p);
    if (!isFile(p)) continue;
    try {
      const text = fs.readFileSync(p, 'utf8').replace(/\r\n?/g, '\n');
      return [pyJsonLoads(text), p, null];
    } catch (e) {
      if (e instanceof PyJSONDecodeError) return [null, p, `failed to load ${p}: ${e.message}`];
      if (e && typeof e.code === 'string') return [null, p, `failed to load ${p}: ${oserrorText(e, p)}`];
      throw e;
    }
  }
  return [null, null, `state-machine.json not found (tried: ${tried.join(', ')})`];
}
