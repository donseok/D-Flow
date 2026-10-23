#!/usr/bin/env node
// dep-analysis.mjs — Task 의존 레벨 계산(위상 정렬). python `dep-analysis.py` 의 node 이식.
//
// 입력(JSON 배열)·출력(JSON)·CLI 인자·종료 코드·stderr 문구는 python 판과 같다. 입력은 `wbs-parse --tasks-all`
// (또는 `--tasks-pending`)의 출력을 표준입력이나 파일로 받는다.
//
// 모드
//   기본            위상 정렬 → 실행 레벨(하위 호환)
//   --graph-stats   의존 그래프 건강 지표(최대 사슬 깊이, fan-in, 다이아몬드, 검토 후보, fan_out, critical_path, bottleneck_ids)
//   --docs-dir DIR  상태머신을 해석해 의존 충족 임계를 정한다. 6상태 정의면 [im] 이상, 5상태(또는 미지정)면 [xx] 만 충족.
//
// 내보내는 이름은 python 판과 같다: USAGE, parse_depends, _chain_depth, _compute_fan_out, _compute_critical_path,
// compute_graph_stats, main. 추가: compute_levels(기본 모드의 레벨 계산 본체), run(args, io).
//
// python 판과 다른 점(의도한 차이)
//  - 다이아몬드 패턴: python 은 같은 가지 쌍이 합류점을 둘 이상 공유할 때 `set` 교집합 순회 순서로 내보낸다. 문자열 해시가
//    프로세스마다 무작위라 python 출력 자체가 실행마다 달라지므로, node 판은 합류점을 코드포인트 순으로 고정한다.
//    합류점이 하나뿐이면 python 과 바이트까지 같다.
//  - 최상위가 배열이 아니거나 원소가 객체가 아니면 python 은 traceback(종료 코드 1)을 내고, node 는 같은 종료 코드 1 에
//    `Traceback (most recent call last):` 없이 python 예외 이름과 문구만 stderr 에 쓴다(stderr 문구가 다르다).
//    잘못된 UTF-8 입력도 종료 코드 1(python: UnicodeDecodeError traceback)이다.
//  - 2^53 을 넘는 정수 id, `1.0` 같은 정수형 float, True 와 1 이 같은 키가 되는 python 의 동치 규칙은 흉내 내지 않는다
//    (id 는 보통 문자열이다).
//  - 의존 사슬이 수백 단계를 넘으면 python 은 RecursionError(재귀 한도 1000)로 끝나고 node 는 계속 계산한다.
//  - 표준입력은 UTF-8 로 해석한다(윈도우 python 은 로캘 코드 페이지). 줄끝은 바꾸지 않는다(POSIX python 과 같음; 윈도우 python 은
//    CRLF 를 LF 로 바꾸므로 CRLF 표준입력의 `invalid JSON` 오류 위치(줄·열·char)만 달라질 수 있다. 파일 입력은 둘 다 LF 로 정규화).
// BOM 은 python 처럼 지우지 않는다(BOM 이 붙은 입력은 `invalid JSON: Unexpected UTF-8 BOM …` 으로 끝난다).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { compareCodePoint } from '../../_shared/node/pytext.mjs';
import { MinHeap } from '../../_shared/node/heap.mjs';
import { finish, OK, VIOLATION } from '../../_shared/node/args.mjs';
import { PY_SPACE_CLASS, pyStrip } from './_pystr.mjs';
import { pyJsonLoads, PyJSONDecodeError } from './_pyjson_loads.mjs';
import { resolve_state_machine, satisfied_states } from './_wbs_status.mjs';

export const USAGE = `\
Usage: dep-analysis.py [input-file] [--graph-stats] [--docs-dir DIR]

  --docs-dir DIR  상태머신을 해석해 의존 충족 임계를 정한다.
                  6상태 정의면 [im] 이상, 5상태(또는 미지정)면 [xx] 만 충족.

Input: JSON array (stdin or file), each element:
  {"tsk_id":"TSK-01-01", "depends":"-", "status":"[ ]"}
  Also accepts "id" as alias for "tsk_id" (e.g. agent-pool format)

  - depends: "-", "(none)", "" -> no dependency
  - depends: "TSK-01-01" or "TSK-01-01, TSK-01-02" -> comma separated
  - status "[xx]" tasks are treated as completed
  - "bypassed": true tasks are treated as completed (dependency satisfied)
`;

// ---- python 값 모델 도우미 ---------------------------------------------------
// JSON 으로 읽은 값(null·boolean·number·string·배열·일반 객체)에 python 의 진리값·`in`·정렬·해시 규칙을 적용한다.

/** python TypeError·AttributeError 대응 — 잡히지 않은 python 예외처럼 종료 코드 1 로 끝난다. */
class PyException extends Error {
  constructor(kind, msg) {
    super(msg);
    this.name = kind;
    this.kind = kind;
  }
}

/** python ValueError 대응 — 호출 쪽에서 `except ValueError` 로 잡는다. */
export class PyValueError extends PyException {
  constructor(msg) {
    super('ValueError', msg);
  }
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  if (typeof v === 'string') return 'str';
  if (Array.isArray(v)) return 'list';
  return 'dict';
}

/** python `bool(v)` */
function pyTruthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

/** python `item.get(key, default)` — 키가 없을 때만 기본값(값이 null 이면 null). item 이 dict 가 아니면 AttributeError. */
function pyGet(item, key, dflt) {
  if (!isDict(item)) throw new PyException('AttributeError', `'${typeName(item)}' object has no attribute 'get'`);
  return hasOwn(item, key) ? item[key] : dflt;
}

/** dict 키·set 원소로 쓸 수 있는 값인지(list·dict 는 unhashable). */
function pyHashable(v) {
  if (Array.isArray(v) || isDict(v)) throw new PyException('TypeError', `unhashable type: '${typeName(v)}'`);
  return v;
}

/** python `for x in obj` 의 원소 목록. 배열은 그대로, 문자열은 코드포인트, dict 는 키, 그 밖은 TypeError. */
function pyIter(obj) {
  if (Array.isArray(obj)) return obj;
  if (typeof obj === 'string') return [...obj];
  if (isDict(obj)) return Object.keys(obj);
  throw new PyException('TypeError', `'${typeName(obj)}' object is not iterable`);
}

/** python `needle in hay` (hay 가 str·list·dict 일 때). */
function pyIn(needle, hay) {
  if (typeof hay === 'string') {
    if (typeof needle !== 'string') {
      throw new PyException('TypeError', `'in <string>' requires string as left operand, not ${typeName(needle)}`);
    }
    return hay.includes(needle);
  }
  if (Array.isArray(hay)) return hay.some((x) => x === needle);
  if (isDict(hay)) return typeof needle === 'string' && hasOwn(hay, needle);
  throw new PyException('TypeError', `argument of type '${typeName(hay)}' is not iterable`);
}

/** python `a < b` 의 순서(문자열은 코드포인트, 수는 수). 다른 형식은 TypeError. */
function pyCmp(a, b) {
  const ka = typeof a === 'boolean' ? 'number' : typeof a;
  const kb = typeof b === 'boolean' ? 'number' : typeof b;
  if (ka === 'string' && kb === 'string') return compareCodePoint(a, b);
  if (ka === 'number' && kb === 'number') {
    const x = Number(a);
    const y = Number(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  throw new PyException('TypeError', `'<' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
}

/** python `sorted(iterable)` (제자리 정렬이 아니라 새 배열). */
const pySorted = (iterable) => [...iterable].sort(pyCmp);

/** python `item.get("tsk_id", "") or item.get("id", "")` */
function taskIdOf(item) {
  const a = pyGet(item, 'tsk_id', '');
  return pyTruthy(a) ? a : pyGet(item, 'id', '');
}

// ---- 의존 문자열 -------------------------------------------------------------

const DEPENDS_SPLIT_RE = new RegExp(`[,${PY_SPACE_CLASS}]+`); // python r'[,\s]+'

/** python `re.split(r'[,\s]+', s)` 후 strip 하고 빈 조각·"-" 를 버린다. */
function splitDepends(dep_str) {
  if (typeof dep_str !== 'string') throw new PyException('TypeError', 'expected string or bytes-like object');
  const out = [];
  for (const raw of dep_str.split(DEPENDS_SPLIT_RE)) {
    const part = pyStrip(raw);
    if (part && part !== '-') out.push(part);
  }
  return out;
}

/** depends 문자열을 Task ID 목록으로 해석한다. */
export function parse_depends(dep_str) {
  if (!pyTruthy(dep_str) || dep_str === '-' || dep_str === '(none)') return [];
  return splitDepends(dep_str);
}

// ---- 그래프 지표 -------------------------------------------------------------

/**
 * t 에서 끝나는 가장 긴 의존 사슬 길이(자기 포함)를 재귀로 계산한다.
 * @param dep_map Map(tsk_id → 의존 id 배열), memo Map(tsk_id → 정수), stack Set(순환 방지)
 */
export function _chain_depth(t, dep_map, memo, stack) {
  if (memo.has(t)) return memo.get(t);
  if (stack.has(t)) return 0; // circular guard
  stack.add(t);
  const deps = dep_map.has(t) ? dep_map.get(t) : [];
  let d;
  if (deps.length === 0) {
    d = 1;
  } else {
    let best = 0; // max(..., default=0)
    for (const x of deps) {
      if (!dep_map.has(x)) continue;
      const v = _chain_depth(x, dep_map, memo, stack);
      if (v > best) best = v;
    }
    d = 1 + best;
  }
  stack.delete(t);
  memo.set(t, d);
  return d;
}

/** fan_out[t] = t 를 의존으로 꼽는 Task 수. Map(tsk_id → 정수). */
export function _compute_fan_out(dep_map, task_ids) {
  const fan_out = new Map(task_ids.map((t) => [t, 0]));
  for (const deps of dep_map.values()) {
    for (const d of deps) {
      if (fan_out.has(d)) fan_out.set(d, fan_out.get(d) + 1);
    }
  }
  return fan_out;
}

/**
 * 뿌리에서 잎까지 가장 긴 경로(critical path). Kahn 위상 정렬 + 최장 경로 DP.
 * 동률은 사전순으로 작은 task_id 가 이긴다(부모 선택·끝점 선택 모두). 순환이면 PyValueError.
 * 반환 {nodes, edges}: edges[i] = {source: nodes[i], target: nodes[i+1]} (source 가 먼저 실행).
 */
export function _compute_critical_path(dep_map, task_ids) {
  if (task_ids.length === 0) return { nodes: [], edges: [] };

  const task_set = new Set(task_ids);

  // in_degree: 의존 개수, successors[t]: t 가 끝나야 시작할 수 있는 Task 들
  const in_degree = new Map(task_ids.map((t) => [t, 0]));
  const successors = new Map(task_ids.map((t) => [t, []]));
  for (const t of task_ids) {
    for (const d of (dep_map.has(t) ? dep_map.get(t) : [])) {
      if (task_set.has(d)) {
        in_degree.set(t, in_degree.get(t) + 1);
        successors.get(d).push(t);
      }
    }
  }

  // 최소 힙(python heapq 와 같은 알고리즘)으로 결정적 순서
  const roots = pySorted(task_ids.filter((t) => in_degree.get(t) === 0));
  const heap = new MinHeap(pyCmp, roots);

  // dist[t]: t 에서 끝나는 최장 사슬 길이, parent[t]: 그 경로의 직전 노드
  const dist = new Map(task_ids.map((t) => [t, 1]));
  const parent = new Map(task_ids.map((t) => [t, null]));

  const processed = [];
  while (heap.size > 0) {
    const node = heap.pop();
    processed.push(node);

    for (const succ of successors.get(node)) {
      const new_dist = dist.get(node) + 1;
      // 더 길거나, 같은 길이에서 사전순으로 더 작은 부모
      if (new_dist > dist.get(succ)
          || (new_dist === dist.get(succ) && (parent.get(succ) === null || pyCmp(node, parent.get(succ)) < 0))) {
        dist.set(succ, new_dist);
        parent.set(succ, node);
      }

      in_degree.set(succ, in_degree.get(succ) - 1);
      if (in_degree.get(succ) === 0) heap.push(succ);
    }
  }

  if (processed.length !== task_ids.length) throw new PyValueError('cycle detected in dependency graph');

  // 끝점: dist 최대, 동률은 사전순 첫째
  let max_dist = -Infinity;
  for (const v of dist.values()) if (v > max_dist) max_dist = v;
  const candidates = pySorted(task_ids.filter((t) => dist.get(t) === max_dist));
  const endpoint = candidates[0];

  const trace = [];
  let cur = endpoint;
  while (cur !== null) {
    trace.push(cur);
    cur = parent.get(cur);
  }
  trace.reverse();

  const edges = [];
  for (let i = 0; i < trace.length - 1; i++) edges.push({ source: trace[i], target: trace[i + 1] });
  return { nodes: trace, edges };
}

/**
 * 의존 그래프 건강 지표.
 * 반환: max_chain_depth, total, fan_in_top, fan_in_ge_3_count, diamond_patterns, diamond_count,
 * review_candidates, fan_out(Map), fan_out_map(같은 Map), critical_path, bottleneck_ids.
 */
export function compute_graph_stats(items, fan_in_threshold = 3, depends_threshold = 4, top_n = 5) {
  const dep_map = new Map();
  const task_ids = [];
  for (const item of pyIter(items)) {
    const tsk_id = taskIdOf(item);
    if (!pyTruthy(tsk_id)) continue;
    const deps = parse_depends(pyGet(item, 'depends', ''));
    dep_map.set(pyHashable(tsk_id), deps);
    task_ids.push(tsk_id);
  }

  // Fan-in: 각 Task 를 의존으로 꼽는 Task 수
  const fan_in = new Map(task_ids.map((t) => [t, 0]));
  for (const deps of dep_map.values()) {
    for (const d of deps) {
      if (fan_in.has(d)) fan_in.set(d, fan_in.get(d) + 1);
    }
  }
  const fan_in_sorted = [...fan_in.entries()].sort((x, y) => (y[1] - x[1]) || pyCmp(x[0], y[0]));
  const fan_in_top = fan_in_sorted.slice(0, top_n).filter(([, c]) => c > 0).map(([t, c]) => ({ tsk_id: t, count: c }));
  let fan_in_ge_3_count = 0;
  for (const c of fan_in.values()) if (c >= fan_in_threshold) fan_in_ge_3_count += 1;

  // 최대 사슬 깊이(메모 DFS, 자기 포함)
  const memo = new Map();
  let max_chain_depth = 0;
  for (const t of task_ids) {
    const v = _chain_depth(t, dep_map, memo, new Set());
    if (v > max_chain_depth) max_chain_depth = v;
  }

  // 다이아몬드: 꼭짓점 X 의 직접 자식 A, B 가 같은 합류점 M 을 공유
  const children = new Map(task_ids.map((t) => [t, []]));
  for (const [t, deps] of dep_map) {
    for (const d of deps) {
      if (children.has(d)) children.get(d).push(t);
    }
  }

  const diamond_patterns = [];
  const seen = new Set();
  for (const [apex, kids] of children) {
    if (kids.length < 2) continue;
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i];
        const b = kids[j];
        const setB = new Set(children.has(b) ? children.get(b) : []);
        // python 은 set 교집합 순서(해시 순)라 실행마다 다르다 — node 판은 코드포인트 순으로 고정한다.
        const merges = pySorted(new Set((children.has(a) ? children.get(a) : []).filter((x) => setB.has(x))));
        for (const m of merges) {
          const branches = pySorted([a, b]);
          const key = JSON.stringify([apex, branches, m]);
          if (seen.has(key)) continue;
          seen.add(key);
          diamond_patterns.push({ apex, branches, merge: m });
        }
      }
    }
  }

  // 검토 후보: depends 개수 또는 fan_in 이 임계 이상
  const candidates = new Map();
  for (const [t, deps] of dep_map) {
    if (deps.length >= depends_threshold) {
      candidates.set(t, { tsk_id: t, reason: `depends>=${depends_threshold}`, signal: { depends_count: deps.length } });
    }
  }
  for (const [t, c] of fan_in) {
    if (c >= fan_in_threshold) {
      if (candidates.has(t)) {
        const cand = candidates.get(t);
        cand.signal.fan_in = c;
        cand.reason += `,fan_in>=${fan_in_threshold}`;
      } else {
        candidates.set(t, { tsk_id: t, reason: `fan_in>=${fan_in_threshold}`, signal: { fan_in: c } });
      }
    }
  }
  const review_candidates = [...candidates.values()].sort((x, y) => pyCmp(x.tsk_id, y.tsk_id));

  const fan_out = _compute_fan_out(dep_map, task_ids);
  const critical_path = _compute_critical_path(dep_map, task_ids);

  // 병목: fan_in 또는 fan_out 이 임계(둘 다 fan_in_threshold) 이상
  const bottleneck_ids = pySorted(task_ids.filter((t) => (fan_in.has(t) ? fan_in.get(t) : 0) >= fan_in_threshold
    || (fan_out.has(t) ? fan_out.get(t) : 0) >= fan_in_threshold));

  return {
    max_chain_depth,
    total: task_ids.length,
    fan_in_top,
    fan_in_ge_3_count,
    diamond_patterns,
    diamond_count: diamond_patterns.length,
    review_candidates,
    fan_out,
    fan_out_map: fan_out, // alias: monitor-server.py _build_graph_payload 호환
    critical_path,
    bottleneck_ids,
  };
}

// ---- 기본 모드: 위상 정렬 레벨 ------------------------------------------------

/**
 * 실행 레벨 계산(python main() 의 기본 모드 본체).
 * @param items 입력 JSON 값, satisfied 의존 충족 상태 집합(Set)
 * @returns {levels: Map("0" → id 배열), completed, circular, total, pending, satisfied_states}
 */
export function compute_levels(items, satisfied) {
  const completed = [];
  const is_completed = new Set();
  const tasks = []; // 미완료 Task ID (입력 순서)
  const task_exists = new Set();
  const dep_map = new Map(); // tsk_id -> 의존 ID 배열

  for (const item of pyIter(items)) {
    const tsk_id = taskIdOf(item);
    const status = pyGet(item, 'status', '');
    const dep_str = pyGet(item, 'depends', '');

    const category = pyGet(item, 'category', '');
    let done = false;
    for (const s of satisfied) {
      if (pyIn(s, status)) {
        done = true;
        break;
      }
    }
    if (done || pyTruthy(pyGet(item, 'bypassed', null)) || category === 'feat') {
      completed.push(tsk_id);
      is_completed.add(pyHashable(tsk_id));
      continue;
    }

    tasks.push(tsk_id);
    task_exists.add(pyHashable(tsk_id));

    // depends 해석(parse_depends 와 같은 규칙)
    if (!pyTruthy(dep_str) || dep_str === '-' || dep_str === '(none)') {
      dep_map.set(tsk_id, []);
    } else {
      dep_map.set(tsk_id, splitDepends(dep_str));
    }
  }

  // 위상 정렬 — 레벨 배정
  const levels = new Map();
  const level_assigned = new Set();
  let assigned = 0;
  const max_iter = tasks.length + 1;
  let current_level = 0;
  const circular = [];

  while (assigned < tasks.length && current_level < max_iter) {
    const level_tasks = [];

    for (const t of tasks) {
      if (level_assigned.has(t)) continue;

      // 모든 의존이 충족됐는가
      let all_met = true;
      for (const dep of (dep_map.has(t) ? dep_map.get(t) : [])) {
        if (is_completed.has(dep)) continue;
        if (level_assigned.has(dep)) continue;
        if (!task_exists.has(dep)) continue; // 외부 의존 — 충족으로 간주
        all_met = false;
        break;
      }

      if (all_met) level_tasks.push(t);
    }

    if (level_tasks.length === 0 && assigned < tasks.length) {
      // 순환 의존 감지
      for (const t of tasks) {
        if (!level_assigned.has(t)) {
          circular.push(t);
          level_assigned.add(t);
          assigned += 1;
        }
      }
      break;
    }

    levels.set(String(current_level), level_tasks);
    for (const t of level_tasks) {
      level_assigned.add(t);
      assigned += 1;
    }

    current_level += 1;
  }

  return {
    levels,
    completed,
    circular,
    total: tasks.length + completed.length,
    pending: tasks.length,
    satisfied_states: pySorted(satisfied),
  };
}

// ---- 입출력 ------------------------------------------------------------------

function readStdinBytes() {
  const chunks = [];
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = fs.readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e.code === 'EAGAIN') { // 비차단 입력: 잠깐 쉬고 재시도
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        continue;
      }
      if (e.code === 'EOF') break; // 윈도우에서 닫힌 파이프
      throw e;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  return Buffer.concat(chunks);
}

// BOM 을 지우지 않는 엄격한 UTF-8 해석(python 의 utf-8 읽기와 같다)
function decodeUtf8(buf) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * CLI 본체. @param {string[]} argv 인자(python 의 sys.argv[1:]), @param io {readStdin, out, err} 주입(시험용).
 * @returns {number} 종료 코드
 */
export function run(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));
  const readStdin = io.readStdin ?? readStdinBytes;

  let args = [...argv];
  let graph_stats_mode = false;
  if (args.includes('--graph-stats')) {
    graph_stats_mode = true;
    args = args.filter((a) => a !== '--graph-stats');
  }

  let docs_dir = null;
  if (args.includes('--docs-dir')) {
    const idx = args.indexOf('--docs-dir');
    if (idx + 1 >= args.length) {
      err('ERROR: --docs-dir requires a directory argument\n');
      return VIOLATION;
    }
    docs_dir = args[idx + 1];
    args.splice(idx, 2);
  }

  // 충족 임계는 상태머신이 정한다. --docs-dir 미지정 시 현행([xx] 단독) 유지.
  let satisfied;
  if (docs_dir === null) {
    satisfied = new Set(['[xx]']);
  } else {
    const [sm, , sm_err] = resolve_state_machine(docs_dir);
    if (sm_err) {
      err(`ERROR: ${sm_err}\n`);
      return VIOLATION;
    }
    satisfied = satisfied_states(sm);
  }

  try {
    // 입력 읽기
    let raw;
    if (args.length > 0 && args[0] !== '-') {
      const input_path = args[0];
      if (!isFile(input_path)) {
        err(`ERROR: file not found: ${input_path}\n`);
        return VIOLATION;
      }
      raw = decodeUtf8(fs.readFileSync(input_path)).replace(/\r\n?/g, '\n'); // universal newlines
    } else {
      raw = decodeUtf8(readStdin());
    }

    raw = pyStrip(raw);
    if (!raw) {
      if (graph_stats_mode) {
        out(`${pyJsonDumps({
          max_chain_depth: 0,
          total: 0,
          fan_in_top: [],
          fan_in_ge_3_count: 0,
          diamond_patterns: [],
          diamond_count: 0,
          review_candidates: [],
          fan_out: {},
          fan_out_map: {}, // alias for monitor-server.py compatibility
          critical_path: { nodes: [], edges: [] },
          bottleneck_ids: [],
        }, { indent: 2, ensureAscii: false })}\n`);
      } else {
        out(`${pyJsonDumps({
          levels: {}, completed: [], circular: [], total: 0, pending: 0,
          satisfied_states: pySorted(satisfied),
        })}\n`);
      }
      return OK;
    }

    let items;
    try {
      items = pyJsonLoads(raw);
    } catch (e) {
      if (e instanceof PyJSONDecodeError) {
        err(`ERROR: invalid JSON: ${e.message}\n`);
        return VIOLATION;
      }
      throw e;
    }

    if (graph_stats_mode) {
      let result;
      try {
        result = compute_graph_stats(items);
      } catch (e) {
        if (e instanceof PyValueError) {
          err(`ERROR: ${e.message}\n`);
          return VIOLATION;
        }
        throw e;
      }
      out(`${pyJsonDumps(result, { indent: 2, ensureAscii: false })}\n`);
      return OK;
    }

    const result = compute_levels(items, satisfied);
    out(`${pyJsonDumps(result, { indent: 2, ensureAscii: false })}\n`);
    return OK;
  } catch (e) {
    // python 이면 traceback 으로 끝나는 경우(잘못된 UTF-8, 입력 형태 오류 등): 종료 코드 1
    if (e instanceof PyException) {
      err(`${e.kind}: ${e.message}\n`);
      return VIOLATION;
    }
    if (e && e.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
      err("UnicodeDecodeError: 'utf-8' codec can't decode input: invalid UTF-8\n");
      return VIOLATION;
    }
    if (e && typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) { // 읽기 실패(권한 등)
      err(`OSError: ${e.message}\n`);
      return VIOLATION;
    }
    throw e;
  }
}

export function main() {
  return run(process.argv.slice(2));
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMain()) finish(main());
