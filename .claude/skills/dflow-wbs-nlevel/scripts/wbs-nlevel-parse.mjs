#!/usr/bin/env node
// N단 wbs.md 파서 — 검증(validate) + import v2.2 payload(export).
// (python 판 wbs-nlevel-parse.py 의 node 이식. 원본은 tests/golden/legacy/wbs-nlevel-parse.legacy.py 에 동결.)
//
// 계약 정본: references/wbs-nlevel-md-contract.md §import 계약 v2.2
// - 단계 판정은 접두어(frontmatter levels 의 prefix)가 정본, 헤딩/들여쓰기는 부모 판정용.
// - fold 층(STK)은 노드로 내보내지 않고 부모 acceptance 로 접는다: "[ ] 제목" / "[x] 제목".
// - rollup 층 leaf 는 파일 단위 경고(분리 업로드 과도기 정상 — 합본 검증은 서버·후속 도구 몫).
//
// 사용:
//   node wbs-nlevel-parse.mjs validate --wbs docs/mes/조업/wbs.md --role pl
//   node wbs-nlevel-parse.mjs export --wbs docs/mes/조업/wbs.md --attach-ref mes-skel/SYS-OP
//   node wbs-nlevel-parse.mjs export --wbs docs/mes/조업/wbs.md --skeleton docs/mes/skel/wbs.md
//
// python 판과 같게 둔 것(바이트 단위): validate·export 의 stdout(JSON, indent=1, ensure_ascii=False)·종료 코드·
//   검증 실패 시 stderr 의 JSON. export 는 서버 계약이라 재실행 결과도 byte 동일이다.
// 의도한 차이
//  - python 이 traceback 으로 죽는 입력(파일 없음, UTF-8 아님, w:1.2.3, 2026-02-30 같은 날짜 등)은 종료 코드 1 과
//    stdout 비어 있음이 같고, stderr 는 `Traceback…` 머리 + 예외 이름·메시지 한 줄(스택 생략)이다.
//  - 인자 해석은 argparse 가 아니라 _shared/node/args.mjs 다: 사용 오류는 종료 코드 2 로 같으나 문구가 다르고,
//    긴 옵션 접두 축약(`--att`)·`-h` 도움말 본문은 지원하지 않는다.
// 내부 표현: 사전(dict) 중 키 순서·정수형 키가 출력에 나오는 것(frontmatter 의 levels 항목·credits)은 Map 으로 둔다.
//   frontmatter(front)·levels 항목·counts 는 Map, 노드·payload·validate 결과는 일반 객체다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyJsonDumps, pyFloat } from '../../_shared/node/pyjson.mjs';
import { splitlinesPy, compareCodePoint } from '../../_shared/node/pytext.mjs';
import { pyReprStr } from '../../_shared/node/pyrepr.mjs';
import { parseCli, finish, USAGE } from '../../_shared/node/args.mjs';
import { PY_SPACE_CLASS, pyStrip, pyLstrip, pyRstrip } from '../../dflow-export/scripts/_pystr.mjs';

// ── python 동작 보조 ─────────────────────────────────────────────────────

const S = `[${PY_SPACE_CLASS}]`; // python 3 `\s`(유니코드)
const NS = `[^${PY_SPACE_CLASS}]`; // python `\S`
const W = '[\\p{L}\\p{N}_]'; // python `\w`
const D = '\\p{Nd}'; // python `\d`

/** python 예외로 죽는 자리(traceback). main 이 잡아 종료 코드 1 로 바꾼다. */
export class PyCrash extends Error {
  constructor(pyName, message) {
    super(message);
    this.pyName = pyName;
  }
}

function pyTruthy(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'bigint') return v !== 0n;
  if (typeof v === 'string' || Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  return true;
}

/** python `str(x)` — None/True/False 표기 포함(문자열·정수만 들어온다). */
function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/** python `a in b` (b 는 dict 또는 str). */
function pyIn(a, b) {
  if (typeof b === 'string') return b.includes(a);
  if (b instanceof Map) return b.has(a);
  if (Array.isArray(b)) return b.includes(a);
  return false;
}

/** python 정수(`\p{Nd}` 숫자 포함)를 ASCII 숫자로 바꾼다. 같은 자리수 묶음의 첫 글자가 0 이다. */
const ND = /^\p{Nd}$/u;
function ndValue(cp) {
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start -= 1;
  return (cp - start) % 10;
}
function digitsToAscii(s) {
  return s.replace(/\p{Nd}/gu, (ch) => String(ndValue(ch.codePointAt(0))));
}

/** python `int(str)` — 안전 범위를 넘으면 BigInt. */
function pyInt(s) {
  const b = BigInt(digitsToAscii(s));
  return b >= -9007199254740991n && b <= 9007199254740991n ? Number(b) : b;
}

/** python `float(str)` — `[\d.]+` 로 걸러진 문자열만 온다. */
function pyFloatParse(s) {
  const a = digitsToAscii(s);
  if (!/^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/.test(a)) {
    throw new PyCrash('ValueError', `could not convert string to float: ${pyReprStr(s)}`);
  }
  return Number(a);
}

const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
function daysInMonth(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}
const pad = (n, w) => String(n).padStart(w, '0');

/** 다음 영업일(토·일 건너뜀). 공휴일은 모른다. */
export function next_business_day(ymd) {
  const m = ISO_DATE.exec(ymd);
  if (!m) throw new PyCrash('ValueError', `Invalid isoformat string: ${pyReprStr(ymd)}`);
  let y = Number(m[1]);
  let mo = Number(m[2]);
  let d = Number(m[3]);
  if (y < 1) throw new PyCrash('ValueError', `year ${y} is out of range`);
  if (mo < 1 || mo > 12) throw new PyCrash('ValueError', 'month must be in 1..12');
  if (d < 1 || d > daysInMonth(y, mo)) throw new PyCrash('ValueError', 'day is out of range for month');
  for (;;) {
    // d += 1일
    if (d < daysInMonth(y, mo)) d += 1;
    else if (mo < 12) { mo += 1; d = 1; }
    else {
      if (y >= 9999) throw new PyCrash('OverflowError', 'date value out of range');
      y += 1; mo = 1; d = 1;
    }
    const dt = new Date(0);
    dt.setUTCFullYear(y, mo - 1, d);
    const weekday = (dt.getUTCDay() + 6) % 7; // python date.weekday(): 월=0
    if (weekday < 5) return `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
  }
}

// ── frontmatter ──────────────────────────────────────────────────────────

const _FLOW_MAP_RE = new RegExp(`^${S}*-${S}*\\{(.+)\\}${S}*$`, 'u');
const _CREDIT_RE = new RegExp(`^${S}{2}(${NS}+):${S}*\\{(.+)\\}${S}*$`, 'u');
const _KV_RE = new RegExp(`^([A-Za-z_][${'\\p{L}\\p{N}_'}-]*):${S}*(.*?)${S}*(?:#.*)?$`, 'u');
const _FULL_INT_RE = new RegExp(`^-?${D}+$`, 'u');

export function _parse_flow_map(inner) {
  const out = new Map();
  for (const part of inner.split(',')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i);
    let v = pyStrip(part.slice(i + 1));
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else if (_FULL_INT_RE.test(v)) v = pyInt(v);
    out.set(pyStrip(k), v);
  }
  return out;
}

export function _parse_frontmatter(lines) {
  const front = new Map([['levels', []], ['credits', new Map()]]);
  let section = null;
  for (const raw of lines) {
    const hash = raw.indexOf('#');
    const line = !pyLstrip(raw).startsWith('#') ? pyRstrip(hash < 0 ? raw : raw.slice(0, hash)) : '';
    if (!pyStrip(line)) continue;
    const fm = _FLOW_MAP_RE.exec(line);
    if (fm && section === 'levels') {
      const lv = front.get('levels');
      if (!Array.isArray(lv)) throw new PyCrash('AttributeError', "'str' object has no attribute 'append'");
      lv.push(_parse_flow_map(fm[1]));
      continue;
    }
    const cm = _CREDIT_RE.exec(raw);
    if (cm && section === 'credits') {
      const cr = front.get('credits');
      if (!(cr instanceof Map)) throw new PyCrash('TypeError', "'str' object does not support item assignment");
      cr.set(cm[1], _parse_flow_map(cm[2]));
      continue;
    }
    const kv = _KV_RE.exec(line);
    if (kv) {
      const key = kv[1];
      const val = kv[2];
      if ((key === 'levels' || key === 'credits') && val === '') {
        section = key;
      } else {
        section = null;
        front.set(key, val);
      }
    }
  }
  return front;
}

// ── 본문 ─────────────────────────────────────────────────────────────────

const _HEADING_RE = new RegExp(`^(#{1,6})${S}+(.+?)${S}*$`, 'u');
const _ITEM_RE = new RegExp(`^(${S}*)-${S}+(.+?)${S}*$`, 'u');
const _ID_TITLE_RE = new RegExp(`^([A-Z][A-Z0-9]*(?:-[^${PY_SPACE_CLASS}:]+)*):${S}*(.+)$`, 'u');
const _CHECKBOX_RE = new RegExp(`^\\[( |x|M)\\]${S}+(.+)$`, 'u');
const _FIELD_KEYS = new Set([
  'category', 'domain', 'model', 'priority', 'tags', 'depends',
  'prd-ref', 'entry-point', 'requirements', 'acceptance',
]);
const _TOKEN_RES = [
  ['assignee', new RegExp(`${S}+@(${NS}+)`, 'u')],
  ['weight', new RegExp(`${S}+w:([${D}.]+)`, 'u')],
  ['end', new RegExp(`${S}+~(${D}{4}-${D}{2}-${D}{2})`, 'u')],
  ['credit', new RegExp(`${S}+credit:(${NS}+)`, 'u')],
  ['if_id', new RegExp(`${S}+if-id:(${NS}+)`, 'u')],
];

// `시작~종료` 범위 토큰 — 종료 단독(`~종료`)보다 먼저 떼어낸다(2026-08-24: 시작일 없는 WBS 는 간트가 비어 있었다)
const _RANGE_RE = new RegExp(`${S}+(${D}{4}-${D}{2}-${D}{2})${S}*~${S}*(${D}{4}-${D}{2}-${D}{2})`, 'u');
const _WS_RUN = new RegExp(`${S}+`, 'gu');

export function _extract_tokens(text) {
  const tokens = {};
  const rm = _RANGE_RE.exec(text);
  if (rm) {
    tokens.start = rm[1];
    tokens.end = rm[2];
    text = text.replace(_RANGE_RE, '');
  }
  for (const [name, rx] of _TOKEN_RES) {
    const mm = rx.exec(text);
    if (mm) {
      tokens[name] = mm[1];
      text = text.replace(rx, '');
    }
  }
  return [pyStrip(text.replace(_WS_RUN, ' ')), tokens];
}

export function parse_wbs(md) {
  const lines = splitlinesPy(md);
  // frontmatter 분리
  let front_lines = [];
  let body_start = 0;
  if (lines.length && pyStrip(lines[0]) === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (pyStrip(lines[i]) === '---') {
        front_lines = lines.slice(1, i);
        body_start = i + 1;
        break;
      }
    }
  }
  const front = _parse_frontmatter(front_lines);
  const levels = front.get('levels');
  const prefix_to_idx = new Map();
  if (Array.isArray(levels)) {
    levels.forEach((l, i) => {
      if (l.has('prefix')) prefix_to_idx.set(l.get('prefix'), i);
    });
  } // levels 가 문자열이면(`levels: x`) python 은 글자마다 "prefix" in 글자 → 거짓이라 빈 사전이다

  const nodes = [];
  const problems = [];
  const heading_stack = []; // [heading depth, node]
  const item_stack = []; // [indent, node]
  let in_comment = false;

  const _mk_node = (nid, title, level, parent, { checked = null, milestone = false, tokens = null } = {}) => {
    const node = {
      id: nid, title, level,
      parent: parent ? parent.id : null,
      checked, milestone,
      tokens: tokens || {}, fields: {}, stks: [],
    };
    nodes.push(node);
    return node;
  };

  for (const line of lines.slice(body_start)) {
    // 주석 스킵(여러 줄 지원)
    if (in_comment) {
      if (line.includes('-->')) in_comment = false;
      continue;
    }
    if (pyLstrip(line).startsWith('<!--')) {
      if (!line.includes('-->')) in_comment = true;
      continue;
    }

    const hm = _HEADING_RE.exec(line);
    if (hm) {
      const depth = hm[1].length;
      const idm = _ID_TITLE_RE.exec(hm[2]);
      if (!idm) continue; // 문서 제목 등 ID 없는 헤딩
      const nid = idm[1];
      const [title, tokens] = _extract_tokens(idm[2]);
      const prefix = nid.split('-', 1)[0];
      while (heading_stack.length && heading_stack[heading_stack.length - 1][0] >= depth) heading_stack.pop();
      const parent = heading_stack.length ? heading_stack[heading_stack.length - 1][1] : null;
      const level = prefix_to_idx.get(prefix);
      if (level === undefined) {
        problems.push(`미선언 접두어: ${nid} (levels 의 prefix 에 없음)`);
        continue;
      }
      const node = _mk_node(nid, title, level, parent, { tokens });
      heading_stack.push([depth, node]);
      item_stack.length = 0;
      continue;
    }

    const im = _ITEM_RE.exec(line);
    if (!im) continue;
    const indent = im[1].length;
    const content = im[2];
    while (item_stack.length && item_stack[item_stack.length - 1][0] >= indent) item_stack.pop();
    const owner = item_stack.length ? item_stack[item_stack.length - 1][1] : null;

    const cb = _CHECKBOX_RE.exec(content);
    if (cb) {
      const mark = cb[1];
      const rest = cb[2];
      const idm = _ID_TITLE_RE.exec(rest);
      if (!idm) {
        if (mark === 'M') problems.push(`마일스톤에 ID 필요: ${pyReprStr(rest)} — '- [M] {접두어 ID}: 제목' 형식`);
        else problems.push(`체크 항목에 ID 필요: ${pyReprStr(rest)}`);
        continue;
      }
      const nid = idm[1];
      const [title, tokens] = _extract_tokens(idm[2]);
      const prefix = nid.split('-', 1)[0];
      const level = prefix_to_idx.get(prefix);
      if (level === undefined) {
        problems.push(`미선언 접두어: ${nid} (levels 의 prefix 에 없음)`);
        continue;
      }
      const parent = owner || (heading_stack.length ? heading_stack[heading_stack.length - 1][1] : null);
      const node = _mk_node(nid, title, level, parent, {
        checked: mark === 'x', milestone: mark === 'M', tokens,
      });
      item_stack.push([indent, node]);
      continue;
    }

    // 상세 블록 필드: "- key: value" (체크박스 없음)
    const ci = content.indexOf(':');
    if (ci >= 0 && _FIELD_KEYS.has(pyStrip(content.slice(0, ci))) && owner !== null) {
      owner.fields[pyStrip(content.slice(0, ci))] = pyStrip(content.slice(ci + 1));
      continue;
    }
    // 그 외 리스트 줄은 무시(자유 메모)
  }

  return { front, levels, nodes, problems };
}

// ── 검증 ─────────────────────────────────────────────────────────────────

const _PCT_RE = new RegExp(`${D}+${S}*%`, 'u');

// import 사전 검사 기준 (2026-10) — D'Flow POST /wbs/import 와 같다.
//  module: route.ts `^[A-Za-z0-9_-]{1,32}$` / priority: wbsImport.ts toRpcNode 의 PRIORITY_LABELS / weight: 양수만
const _MODULE_RE = /^[A-Za-z0-9_-]{1,32}$/;
const _PRIORITIES = ['critical', 'high', 'medium', 'low'];
const _WEIGHT_RE = /^(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/;

const fget = (fields, key) => (Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined);
/** python `fields.get("depends", "").split(",")` → 공백 제거·빈 칸 제외 */
function splitList(text, sep) {
  return text.split(sep).map(pyStrip).filter((s) => s);
}

/**
 * import 사전 검사 — D'Flow POST /wbs/import 와 웹 적용이 거부하는 값을 미리 찾는다 (2026-10).
 * module 존재·형식(PL 의 "없음" 은 validate 의 기존 문구가 맡는다), priority 허용값, w: 양수.
 * 올라가지 않는 층(upload false·fold)의 노드는 보지 않는다. levels 가 없으면 빈 목록(validate 가 따로 거부한다).
 * 테스트가 "새 검사가 거부하는 입력"을 고르는 판정 함수로도 쓴다.
 */
export function import_compat_errors(doc, role = 'pl') {
  const errors = [];
  const levels = doc.levels;
  if (!pyTruthy(levels)) return errors;
  const mod = doc.front.get('module');
  if (!pyTruthy(mod)) {
    if (role !== 'pl') errors.push('골격 파일에 module 이 없습니다 — import 가 module 없이는 받지 않습니다 (frontmatter module: {영문 코드}).');
  } else if (!_MODULE_RE.test(String(mod))) {
    errors.push(`module 형식 오류: ${pyReprStr(String(mod))} — 영문·숫자·_·- 만, 1~32자 (import 가 거부함).`);
  }
  for (const n of doc.nodes) {
    const lv = levels[n.level];
    if (lv.get('upload') === false || lv.get('upload') === 'fold') continue;
    const pri = fget(n.fields, 'priority');
    if (pri !== undefined && !_PRIORITIES.includes(pri)) {
      errors.push(`${n.id}: priority ${pyReprStr(pri)} 는 허용 밖 — critical|high|medium|low 중 하나 (import 가 거부함).`);
    }
    const wt = n.tokens.weight;
    if (wt !== undefined) {
      const w = digitsToAscii(wt);
      if (!_WEIGHT_RE.test(w)) errors.push(`${n.id}: w:${wt} 는 숫자가 아님 — 양수 하나 (예 w:5, w:2.5).`);
      else if (!(Number(w) > 0)) errors.push(`${n.id}: w:${wt} 는 양수가 아님 — 가중치는 0 보다 커야 함 (import 가 거부함).`);
    }
  }
  return errors;
}

export function validate(doc, role = 'pl') {
  const errors = [...doc.problems];
  const warnings = [];
  const levels = doc.levels;
  const front = doc.front;
  const nodes = doc.nodes;
  const by_id = new Map();

  if (!pyTruthy(levels)) {
    errors.push('frontmatter levels 가 없습니다 — 단계 선언은 frontmatter 에서만 한다.');
    return { ok: false, errors, warnings, counts: new Map() };
  }

  if (role === 'pl') {
    if (!pyTruthy(front.get('attach'))) errors.push('PL 파일에 attach 가 없습니다 (frontmatter attach: {골격 경로}).');
    if (!pyTruthy(front.get('module'))) errors.push('PL 파일에 module 이 없습니다.');
  }

  for (const n of nodes) {
    if (by_id.has(n.id)) errors.push(`ID 중복: ${n.id}`);
    by_id.set(n.id, n);
  }

  const children = new Map();
  for (const n of nodes) {
    if (n.parent) {
      if (!children.has(n.parent)) children.set(n.parent, []);
      children.get(n.parent).push(n);
    }
  }

  // attach 지점 밑에서 시작해야 하는 최소 레벨(role=pl)
  let attach_min_level = -1;
  if (role === 'pl' && pyTruthy(front.get('attach'))) {
    if (!Array.isArray(levels)) throw new PyCrash('AttributeError', "'str' object has no attribute 'get'");
    const parts = String(front.get('attach')).split('/');
    const last = parts[parts.length - 1];
    const m = new Map();
    levels.forEach((l, i) => m.set(l.has('prefix') ? l.get('prefix') : null, i));
    const idx = m.get(last.split('-', 1)[0]);
    attach_min_level = idx === undefined ? -1 : idx;
  }

  for (const n of nodes) {
    const lv = levels[n.level];
    // PL 파일에 골격 층(upload:false / owner:pmo) 본문 금지
    if (role === 'pl' && (lv.get('upload') === false || lv.get('owner') === 'pmo')) {
      errors.push(`${n.id}: 골격 층(${pyStr(lv.get('name'))})은 PL 파일 본문에 쓸 수 없다 — 골격 소유.`);
    }
    // 자식 순번 > 부모 순번
    if (n.parent) {
      const p = by_id.get(n.parent);
      if (p !== undefined && n.level <= p.level) {
        errors.push(`${n.id}: 단계 순번 역행/동급 — 부모 ${p.id}(${p.level}) 이하가 아님(${n.level}).`);
      } else if (p !== undefined) {
        for (let i = p.level + 1; i < n.level; i++) {
          if (!pyTruthy(levels[i].get('optional'))) {
            warnings.push(`${n.id}: 필수층 ${pyStr(levels[i].get('name'))} 건너뜀 (부모 ${p.id}).`);
          }
        }
      }
    } else if (attach_min_level >= 0 && n.level <= attach_min_level) {
      errors.push(`${n.id}: attach 지점(${attach_min_level}층) 이하 층은 최상위에 올 수 없다.`);
    }
    // 상태·실적
    if (n.checked && lv.get('progress') !== 'checklist') {
      errors.push(`${n.id}: 상태는 항상 [ ] — [x] 는 checklist 층 전용(전이 정본은 D'Flow).`);
    }
    if (_PCT_RE.test(n.title)) errors.push(`${n.id}: 제목에 실적 % 금지 — 진도는 D'Flow 가 정본.`);
    // checklist 층 leaf 전용 + 부모는 input 층
    if (lv.get('progress') === 'checklist') {
      if (pyTruthy(children.get(n.id))) errors.push(`${n.id}: checklist 층은 leaf 전용 — 자식 금지.`);
      const p = n.parent ? by_id.get(n.parent) : undefined;
      if (p === undefined || levels[p.level].get('progress') !== 'input') {
        errors.push(`${n.id}: checklist 의 부모는 input 층이어야 한다.`);
      }
    }
    // rollup 층 leaf — 파일 단위 경고(합본 검증 아님)
    if (lv.get('progress') === 'rollup' && !pyTruthy(children.get(n.id)) && !n.milestone) {
      warnings.push(`${n.id}: rollup 층 leaf (파일 단위 — 분리 업로드 과도기면 정상).`);
    }
    // depends 대상(파일 내) — 크로스 모듈은 여기서 못 본다 → 경고만
    for (const d of splitList(fget(n.fields, 'depends') ?? '', ',')) {
      if (!by_id.has(d)) warnings.push(`${n.id}: depends 대상 없음(파일 내): ${d}`);
    }
    // credit 키
    const credit = n.tokens.credit;
    if (credit && !pyIn(credit, front.get('credits'))) {
      warnings.push(`${n.id}: credit 키 미정의: ${credit}`);
    }
  }

  errors.push(...import_compat_errors(doc, role));

  const counts = new Map();
  for (const n of nodes) {
    const name = pyStr(levels[n.level].get('name'));
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return { ok: errors.length === 0, errors, warnings, counts };
}

// ── export (import v2.2 payload) ─────────────────────────────────────────

export function export_payload(doc, attach_ref = null) {
  const levels = doc.levels;
  const nodes_out = [];
  const by_id = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const n of doc.nodes) {
    const lv = levels[n.level];
    if (lv.get('upload') === false) continue;
    if (lv.get('upload') === 'fold') {
      // 부모 acceptance 로 접힘 — 노드로 내보내지 않는다
      const p = n.parent ? by_id.get(n.parent) : undefined;
      if (p !== undefined) p.stks.push({ checked: Boolean(n.checked), title: n.title });
      continue;
    }
    nodes_out.push(n);
  }

  // 시작일 파생 — 종료만 적힌 노드(마일스톤 제외)는 선행(depends) 종료 다음 영업일,
  // 선행이 없거나 선행에 종료가 없으면 frontmatter start_date. 둘 다 없으면 None.
  const end_of = new Map(doc.nodes.map((n) => [n.id, n.tokens.end]));
  const sd = doc.front.get('start_date');
  const start_date = pyTruthy(sd) ? sd : doc.front.get('start-date');

  const _derived_start = (n) => {
    const t = n.tokens;
    if (t.start) return t.start;
    if (!t.end || n.milestone) return null;
    const deps = splitList(fget(n.fields, 'depends') ?? '', ',');
    const ends = deps.map((d) => end_of.get(d));
    let start = null;
    if (deps.length && ends.every((e) => e)) {
      start = next_business_day(ends.reduce((a, b) => (compareCodePoint(b, a) > 0 ? b : a)));
    } else if (pyTruthy(start_date)) {
      start = String(start_date);
    }
    if (start && compareCodePoint(start, t.end) > 0) {
      start = t.end; // 선행이 더 늦게 끝나는 계획 오류 — 막대는 그리되 0일로
    }
    return start;
  };

  const orNull = (v) => (v === undefined ? null : v);

  const _node_json = (n) => {
    const f = n.fields;
    const t = n.tokens;
    const start = _derived_start(n);
    const acceptance = splitList(fget(f, 'acceptance') ?? '', ' / ');
    for (const s of n.stks) acceptance.push((s.checked ? '[x] ' : '[ ] ') + s.title);
    const req = pyStrip(fget(f, 'requirements') ?? '');
    let spec_sections = null;
    if (req) {
      spec_sections = {
        requirements: [req], test_criteria: [], constraints: [],
        api_spec: null, data_model: null, description: null,
      };
    }
    let weight = t.weight;
    if (weight !== undefined) {
      const w = pyFloatParse(weight);
      if (!Number.isFinite(w)) weight = pyFloat(w);
      else if (Number.isInteger(w)) weight = Math.abs(w) <= Number.MAX_SAFE_INTEGER ? w + 0 : BigInt(w);
      else weight = pyFloat(w);
    } else {
      weight = null;
    }
    const progress = levels[n.level].get('progress');
    const kind = progress === 'input' ? 'task' : (n.level === 0 ? 'phase' : 'wp');
    return {
      id: n.id, parent_id: n.parent, kind,
      title: n.title, stage: null,
      level: n.level, weight,
      milestone: n.milestone,
      credit: orNull(t.credit), if_id: orNull(t.if_id),
      assignee: orNull(t.assignee),
      schedule: t.end ? (start ? `${start} ~ ${t.end}` : `~ ${t.end}`) : null,
      depends: splitList(fget(f, 'depends') ?? '', ','),
      acceptance,
      tags: splitList(fget(f, 'tags') ?? '', ','),
      category: orNull(fget(f, 'category')), domain: orNull(fget(f, 'domain')),
      priority: orNull(fget(f, 'priority')), model: orNull(fget(f, 'model')),
      prd_ref: orNull(fget(f, 'prd-ref')), entry_point: orNull(fget(f, 'entry-point')),
      spec_sections,
    };
  };

  const mod = doc.front.get('module');
  const payload = {
    schema_version: '2.2',
    module: mod === undefined ? null : mod,
    levels,
    nodes: nodes_out.map(_node_json),
  };
  if (attach_ref) payload.attach_ref = attach_ref;
  return payload;
}

// ── CLI ──────────────────────────────────────────────────────────────────

const SPEC = {
  prog: 'wbs-nlevel-parse.mjs',
  description: 'N단 wbs.md 파서 — 검증(validate) + import v2.2 payload(export).',
  commands: {
    validate: {
      options: {
        wbs: { type: 'string', required: true },
        role: { type: 'string', choices: ['pl', 'skeleton'], default: 'pl' },
      },
    },
    export: {
      options: {
        wbs: { type: 'string', required: true },
        'attach-ref': { type: 'string' },
        skeleton: { type: 'string' },
      },
    },
  },
};

/** python `open(path, encoding="utf-8").read()` — BOM 은 남기고(U+FEFF), 줄끝만 `\n` 으로 통일, UTF-8 이 아니면 UnicodeDecodeError. */
export function readPyText(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    if (e.code === 'ENOENT') throw new PyCrash('FileNotFoundError', `[Errno 2] No such file or directory: ${pyReprStr(file)}`);
    if (e.code === 'EISDIR') throw new PyCrash('IsADirectoryError', `[Errno 21] Is a directory: ${pyReprStr(file)}`);
    if (e.code === 'EACCES') throw new PyCrash('PermissionError', `[Errno 13] Permission denied: ${pyReprStr(file)}`);
    throw new PyCrash('OSError', String(e.message));
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new PyCrash('UnicodeDecodeError', "'utf-8' codec can't decode the file (UTF-8 이 아님)");
  }
  return text.replace(/\r\n?/g, '\n');
}

const dump = (obj) => `${pyJsonDumps(obj, { indent: 1, ensureAscii: false })}\n`;

function run(args) {
  const doc = parse_wbs(readPyText(args.values.wbs));
  if (args.command === 'validate') {
    const out = validate(doc, args.values.role);
    process.stdout.write(dump(out));
    return out.ok ? 0 : 1;
  }

  let attach_ref = args.values['attach-ref'];
  const attach = doc.front.get('attach');
  const skeleton = args.values.skeleton;
  if (!attach_ref && pyTruthy(attach) && skeleton) {
    const skel = parse_wbs(readPyText(skeleton));
    const skel_module = skel.front.get('module');
    if (!pyTruthy(skel_module)) {
      process.stderr.write('골격 파일에 module 이 없습니다.\n');
      return 1;
    }
    const parts = String(attach).split('/');
    attach_ref = `${skel_module}/${parts[parts.length - 1]}`;
  }
  if (pyTruthy(attach) && !attach_ref) {
    process.stderr.write('attach 파일인데 attach_ref 를 조립할 수 없습니다 — --attach-ref 또는 --skeleton 필요.\n');
    return 1;
  }
  // 검증 게이트 — 에러가 있으면 export 하지 않는다(fail-closed)
  const rep = validate(doc, pyTruthy(attach) ? 'pl' : 'skeleton');
  if (!rep.ok) {
    process.stderr.write(dump(rep));
    return 1;
  }
  process.stdout.write(dump(export_payload(doc, attach_ref || null)));
  return 0;
}

/**
 * 종료 코드를 돌려준다(process.exit 는 부르지 않는다). 사용 오류면 args.mjs 가 stderr 에 쓰고 2 를 돌려준다.
 * python 이 traceback 으로 죽는 자리는 stderr 에 한 줄 오류를 쓰고 1 을 돌려준다.
 * @param {string[]} [argv]
 * @returns {number}
 */
export function main(argv = process.argv.slice(2)) {
  const cli = parseCli(argv, SPEC);
  if (!cli) return Number(process.exitCode ?? USAGE);
  try {
    return run(cli);
  } catch (e) {
    if (!(e instanceof PyCrash)) throw e;
    process.stderr.write(`Traceback (most recent call last):\n  (node 이식판: 스택 생략)\n${e.pyName}: ${e.message}\n`);
    return 1;
  }
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
