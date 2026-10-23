#!/usr/bin/env node
// wbs-parse.mjs — WBS 파일에서 Task/WP 정보를 구조화해 꺼낸다 (python `wbs-parse.py` 의 node 이식)
//
// 위치 인자 `<wbs> <ID|-> [모드]` 와 모드 12종(--block --field --tasks --tasks-pending --tasks-all --export
// --feat-tasks --resumable-wps --phase-start --dev-config --complexity --json), 그리고 `--feat <dir> …` 를
// python 판과 같은 동작으로 옮겼다. 실패는 stderr `ERROR: …` + 종료 코드 1 이다.
// `--export` 출력은 D'Flow `POST /wbs/import` 서버 계약 v2.1(`schema_version`, `nodes` 17키 고정 shape)이라
// python 판과 바이트까지 같고 재실행해도 byte 동일하다(골든 시험 tests/wbs-parse.test.mjs 가 지킨다).
//
// 인자 해석은 python 판의 수동 파싱을 줄 단위로 그대로 따른다(`_shared/node/args.mjs` 의 parseCli 는 쓰지 않는다 —
// python 판은 알 수 없는 인자·남는 인자를 조용히 무시하고, 모드를 argv[2] 또는 argv[3] 에서 찾고, 사용 오류도 종료 코드 1 이다).
//
// 이식 메모 (python 판과의 차이는 아래가 전부다)
//  - USAGE 문구의 프로그램 이름만 `wbs-parse.py` → `wbs-parse.mjs` 로 바꿨다(윈도우에는 python 이 없다). 그 밖의 줄은 같다.
//  - `--dev-config` 의 템플릿 경로(`$CLAUDE_PLUGIN_ROOT/skills/wbs/references/dev-config-template.md`)는 이 리포에 없는
//    옛 플러그인 경로라 실제로는 항상 내장 폴백 문자열이 쓰인다. python 판의 탐색 코드는 그대로 옮겨 두었다.
//  - 파일은 python `open(..., encoding="utf-8")` 처럼 줄끝만 `\n` 으로 정규화하고 BOM 은 지우지 않는다(BOM 바로 뒤가
//    `## WP-` 인 첫 줄은 python 판처럼 헤딩으로 인식되지 않는다). 잘못된 UTF-8 은 python 이 UnicodeDecodeError traceback(종료 코드 1)
//    이고 node 는 같은 종료 코드 1 에 `ERROR: unexpected failure: …` 한 줄이다.
//  - state.json·state-machine.json·feat state 는 `Map`(삽입순)·`PyFloat`(1.0)·`BigInt` 로 읽어 python dict 의 순서·표기를
//    그대로 되돌려 쓴다. python 이 traceback 으로 끝나는 비정상 입력(state.json 이 객체가 아닌 값 등)은 종료 코드 1 + 한 줄 오류.
//  - 경로 문자열(`docs_dir`, `source_path`, `feat_dir`)은 python `os.path.dirname/join/basename` 의 의미를 따로 구현해 쓴다
//    (node `path.dirname("wbs.md")` 는 "." 이지만 python 은 "").
//  - `f"{target_id}"` 에 들어가던 `None`(플래그만 준 모드)은 문자열 "None" 으로 그대로 재현한다.
//  - 정규식은 python 의 유니코드 의미(`\s`·`\d`)를 `_pystr.mjs` 의 공백 집합과 `\p{Nd}` 로 옮겼다. `re.match` 는 시작 앵커를 지킨다.
//  - 오프셋(`_wbs_md.mjs`)은 UTF-16 단위지만 같은 문서 안에서만 쓰므로 결과는 같다.
//  - 알려진 차이(영향이 작아 맞추지 않음): ① 대소문자 무시 정규식에서 python 은 `i`·`İ`(U+0130)·`ı`(U+0131)를 같은 글자로 보지만
//    JS 의 `iu` 플래그는 그렇지 않다(`--complexity` 키워드·`--dev-config` 제목·표 제목 인식에 영향, `--export` 는 i 플래그를 쓰지 않아 무관).
//    ② state.json 에 짝 없는 서로게이트(`"\ud800"`)가 있으면 python 은 UnicodeEncodeError(종료 코드 1), node 는 U+FFFD 를 찍고 종료 코드 0.
//    ③ 상태머신 파일이 기형(`{"states":null}` 등)이면 python 은 AttributeError, node 는 빈 집합으로 진행한다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyJsonDumps, PyFloat, pyFloat } from '../../_shared/node/pyjson.mjs';
import { splitlinesPy } from '../../_shared/node/pytext.mjs';
import { pyReprStr } from '../../_shared/node/pyrepr.mjs';
import { finish } from '../../_shared/node/args.mjs';
import * as _wbs_status from './_wbs_status.mjs';
import { _fenced_ranges, _in_ranges, line_start_offsets } from './_wbs_md.mjs';
import { PY_SPACE_CLASS, pyStrip, pyRstrip } from './_pystr.mjs';
import { pyJsonLoads, PyJSONDecodeError } from './_pyjson_loads.mjs';

const SCRIPT_FILE = fileURLToPath(import.meta.url);

export const USAGE = `\
Usage: wbs-parse.mjs <wbs-path> <ID> [mode]

Modes:
  (default)              Task/WP full fields as JSON
  --block                Task block raw text
  --field <name>         Single field value
  --tasks                WP child Task list (JSON array)
  --tasks-pending        WP child incomplete Tasks only (status != [xx], category != feat)
  --tasks-all            All Tasks across every WP (flat array, no target_id, includes category field)
  --export               전 계층(Phase/WP/ACT/Task)·전 필드 JSON — D'Flow 업로드 계약 v2
  --feat-tasks           WP child Tasks with category=feat only → [{"tsk_id","feat_name","title"}]
  --resumable-wps        Executable WP list (WPs with incomplete Tasks)
  --phase-start          Start phase based on Task's current status
  --dev-config           Extract ## Dev Config section as JSON
  --complexity           Compute complexity score and recommended design model

Feature mode:
  wbs-parse.mjs --feat <feat-dir> --phase-start
  wbs-parse.mjs --feat <feat-dir> --status
  wbs-parse.mjs --feat <feat-dir> --dev-config [docs-dir]
      Fallback chain: <feat-dir>/dev-config.md → <docs-dir>/wbs.md → default-dev-config.md

Examples:
  wbs-parse.mjs docs/wbs.md TSK-01-02
  wbs-parse.mjs docs/wbs.md TSK-01-02 --block
  wbs-parse.mjs docs/wbs.md TSK-01-02 --field domain
  wbs-parse.mjs docs/wbs.md WP-01 --tasks
  wbs-parse.mjs docs/wbs.md --tasks-all
  wbs-parse.mjs docs/wbs.md --export
  wbs-parse.mjs docs/wbs.md - --resumable-wps
  wbs-parse.mjs docs/wbs.md TSK-01-02 --phase-start
  wbs-parse.mjs docs/wbs.md - --dev-config
  wbs-parse.mjs --feat docs/features/login-2fa --phase-start
  wbs-parse.mjs --feat docs/features/login-2fa --status
  wbs-parse.mjs --feat docs/features/login-2fa --dev-config docs
`;

// ---------------------------------------------------------------------------
// python 의미를 옮기는 작은 도구들
// ---------------------------------------------------------------------------

const S = `[${PY_SPACE_CLASS}]`; // 정규식의 \s
const D = '\\p{Nd}'; // 정규식의 \d

/** f-string 의 `{x}`: python None 은 "None". */
const pyStr = (v) => (v === null || v === undefined ? 'None' : String(v));

/** python 진리값. Map(dict)·배열·문자열·숫자·PyFloat·BigInt·null 을 python 처럼 판정한다. */
export function pyTruthy(v) {
  if (v === null || v === undefined) return false;
  if (v instanceof PyFloat) return v.value !== 0;
  switch (typeof v) {
    case 'string': return v.length > 0;
    case 'number': return v !== 0;
    case 'bigint': return v !== 0n;
    case 'boolean': return v;
    default:
  }
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Map) return v.size > 0;
  return Object.keys(v).length > 0;
}

/** python `dict.get(key, default)`. dict 가 아니면 AttributeError 에 해당하는 TypeError. */
export function dget(d, key, def = null) {
  if (!(d instanceof Map)) throw new TypeError(`'${typeName(d)}' object has no attribute 'get'`);
  return d.has(key) ? d.get(key) : def;
}

function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  if (v instanceof PyFloat) return 'float';
  return { string: 'str', number: 'int', bigint: 'int', boolean: 'bool' }[typeof v] ?? 'object';
}

function stripChars(s, ch) {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === ch) a++;
  while (b > a && s[b - 1] === ch) b--;
  return s.slice(a, b);
}

const IS_WIN = process.platform === 'win32';
const SEPS = IS_WIN ? '/\\' : '/';

/** python `os.path.dirname` ("wbs.md" → "", "a/b/" → "a/b"). */
export function pyDirname(p) {
  let drive = '';
  let rest = p;
  if (IS_WIN && /^[A-Za-z]:/.test(p)) {
    drive = p.slice(0, 2);
    rest = p.slice(2);
  }
  let i = -1;
  for (let k = rest.length - 1; k >= 0; k--) {
    if (SEPS.includes(rest[k])) { i = k; break; }
  }
  let head = rest.slice(0, i + 1);
  if (head && ![...head].every((c) => SEPS.includes(c))) {
    let e = head.length;
    while (e > 0 && SEPS.includes(head[e - 1])) e--;
    head = head.slice(0, e);
  }
  return drive + head;
}

/** python `os.path.basename`. */
export function pyBasename(p) {
  let rest = p;
  if (IS_WIN && /^[A-Za-z]:/.test(p)) rest = p.slice(2);
  let i = -1;
  for (let k = rest.length - 1; k >= 0; k--) {
    if (SEPS.includes(rest[k])) { i = k; break; }
  }
  return rest.slice(i + 1);
}

/** python `os.path.join` (정규화 없음). 문자열이 아닌 인자는 TypeError. */
export function pyJoin(a, ...parts) {
  let p = a;
  for (const b of parts) {
    if (typeof p !== 'string' || typeof b !== 'string') {
      throw new TypeError('expected str, bytes or os.PathLike object, not NoneType');
    }
    if (IS_WIN) {
      if (/^([A-Za-z]:|[\\/])/.test(b)) p = b;
      else if (p === '' || /[\\/:]$/.test(p)) p += b;
      else p += `\\${b}`;
    } else if (b.startsWith('/')) p = b;
    else if (p === '' || p.endsWith('/')) p += b;
    else p += `/${b}`;
  }
  return p;
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
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

// errno 계열(EACCES 등)이면 python OSError. ERR_… 로 시작하는 node 내부 오류(잘못된 UTF-8 등)는 아니다.
const isOSError = (e) => !!e && typeof e.code === 'string' && /^E[A-Z0-9]+$/.test(e.code);

/** python `open(path, "r", encoding="utf-8").read()`: 줄끝만 정규화하고 BOM 은 남긴다. 잘못된 UTF-8 은 예외. */
export function readPyText(file) {
  const buf = fs.readFileSync(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  return text.replace(/\r\n?/g, '\n');
}

/**
 * python `json.loads` 와 같은 구문 검사(오류 문구 동일) 뒤, 값을 python 모양으로 만든다:
 * 객체 → Map(삽입순), 소수·지수 표기 → PyFloat, 2^53 넘는 정수 → BigInt.
 */
export function parseFaithful(text) {
  pyJsonLoads(text); // 검증 — 실패하면 PyJSONDecodeError
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const str = () => {
    let j = i + 1;
    while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    const lit = text.slice(i, j + 1);
    i = j + 1;
    return JSON.parse(lit);
  };
  const NUM = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
  const val = () => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const m = new Map();
      ws();
      if (text[i] === '}') { i++; return m; }
      for (;;) {
        ws();
        const k = str();
        ws();
        i++; // ':'
        m.set(k, val());
        ws();
        if (text[i] === ',') { i++; continue; }
        i++; // '}'
        return m;
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      ws();
      if (text[i] === ']') { i++; return a; }
      for (;;) {
        a.push(val());
        ws();
        if (text[i] === ',') { i++; continue; }
        i++; // ']'
        return a;
      }
    }
    if (c === '"') return str();
    if (text.startsWith('null', i)) { i += 4; return null; }
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('NaN', i)) { i += 3; return pyFloat(NaN); }
    if (text.startsWith('Infinity', i)) { i += 8; return pyFloat(Infinity); }
    if (text.startsWith('-Infinity', i)) { i += 9; return pyFloat(-Infinity); }
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    i += m[0].length;
    if (m[1] !== undefined || m[2] !== undefined) return pyFloat(Number(m[0]));
    const n = Number(m[0]);
    return Number.isSafeInteger(n) ? n : BigInt(m[0]);
  };
  return val();
}

// ---------------------------------------------------------------------------
// 본문 추출
// ---------------------------------------------------------------------------

export function json_escape(s) {
  s = s.replace(/\\/g, '\\\\');
  s = s.replace(/"/g, '\\"');
  s = s.replace(/\n/g, '\\n');
  s = s.replace(/\t/g, '\\t');
  return s;
}

// --- 전 계층 export (D'Flow /wbs/import 계약 v2) ---
export const _WP_HEADING_RE = new RegExp(`^##${S}+(WP-${D}+):${S}*([^\\n]*)$`, 'u');
export const _ACT_HEADING_RE = new RegExp(`^###${S}+(ACT-${D}+(?:-${D}+)+):${S}*([^\\n]*)$`, 'u');
export const _TSK_HEADING_RE = new RegExp(`^#{3,5}${S}+(TSK-${D}+(?:-${D}+)+):${S}*([^\\n]*)$`, 'u');
// parse_tasks_from_wp / --resumable-wps 가 쓰는 3~4단계 헤딩(끝 앵커 없음)
const _TASK_LIST_RE = new RegExp(`^#{3,4}${S}+(TSK-${D}+(?:-${D}+)+):${S}*([^\\n]*)`, 'u');
const _TASK_COUNT_RE = new RegExp(`^#{3,4}${S}+(TSK-${D}+(?:-${D}+)+):`, 'u');
const _WP_LINE_RE = new RegExp(`^## (WP-${D}+):`, 'u');

/**
 * Task 블록(### 또는 #### 단계)을 WBS 텍스트에서 꺼낸다.
 *
 * 끝 경계 탐색은 펜스 코드 블록 안의 WP/ACT 단계 헤딩을 무시한다 — Task 본문에 든 ```markdown 예시의
 * `## WP-99:`/`### ACT-99-01:` 가 블록을 일찍 끊어 뒤의 진짜 acceptance/spec_sections 를 조용히 잃게 하지 않기 위함이다.
 * Task 헤딩(`TSK-...`)은 펜스 상태와 무관하게 항상 블록을 닫는다.
 */
export function extract_task_block(wbs_text, tsk_id) {
  const fences = _fenced_ranges(wbs_text);
  const lines = splitlinesPy(wbs_text);
  const offsets = line_start_offsets(wbs_text);
  const result = [];
  let found = false;
  let level = 0;
  const needle = `${pyStr(tsk_id)}:`;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    let hl = 0;
    for (const ch of line) {
      if (ch === '#') hl++;
      else break;
    }

    if (!found && hl >= 2 && line.includes(needle)) {
      found = true;
      level = hl;
      result.push(line);
      continue;
    }

    const is_task_heading = _TSK_HEADING_RE.test(line);
    if (found && hl >= 2 && hl <= level && !line.includes(needle)
        && (is_task_heading || !_in_ranges(offsets[idx], fences))) {
      break;
    }

    if (found) result.push(line);
  }

  return result.join('\n');
}

/** WP 블록(## 단계)을 WBS 텍스트에서 꺼낸다. */
export function extract_wp_block(wbs_text, wp_id) {
  const lines = splitlinesPy(wbs_text);
  const result = [];
  let found = false;
  const needle = `${pyStr(wp_id)}:`;

  for (const line of lines) {
    if (line.startsWith('## ') && line.includes(needle)) {
      found = true;
      result.push(line);
      continue;
    }
    if (found && line.startsWith('## ')) break;
    if (found) result.push(line);
  }

  return result.join('\n');
}

/**
 * 블록에서 한 줄짜리 필드 값을 꺼낸다. `- field: value` 한 줄만 인식하며 없거나 여러 줄 불릿 형태면 "".
 */
export function get_field(block, field_name) {
  const pattern = `- ${field_name}:`;
  for (const line of splitlinesPy(block)) {
    if (line.startsWith(pattern)) return pyStrip(line.slice(pattern.length));
  }
  return '';
}

/**
 * 리스트 필드(한 줄 CSV 또는 여러 줄 불릿)를 꺼낸다.
 *   1. `- field: -` → []   2. `- field: v1, v2` → ["v1","v2"]   3. `- field:` + `  - item` 줄들 → ["item", …]
 * 4칸 이상 들여쓴 불릿·이어쓰기 줄은 직전 항목 뒤에 붙인다.
 */
export function parse_list_field(block, field_name) {
  const lines = splitlinesPy(block);
  const pattern = `- ${field_name}:`;
  const items = [];
  let capturing = false;

  for (const line of lines) {
    if (!capturing) {
      if (line.startsWith(pattern)) {
        const inline = pyStrip(line.slice(pattern.length));
        if (inline && inline !== '-') {
          return inline.split(',').map((s) => pyStrip(s)).filter((s) => s);
        }
        if (inline === '-') return [];
        capturing = true;
      }
      continue;
    }

    const stripped = pyStrip(line);
    if (/^- [a-zA-Z][a-zA-Z0-9_-]*:/.test(line)) break;
    if (!stripped || stripped.startsWith('#')) break;

    if (line.startsWith('  - ')) {
      items.push(pyRstrip(line.slice(4)));
      continue;
    }
    if (line.startsWith('    -') && items.length) {
      items[items.length - 1] = `${items[items.length - 1]}\n${pyRstrip(line)}`;
      continue;
    }
    if (line.startsWith('    ') && items.length) {
      items[items.length - 1] = `${items[items.length - 1]}\n${pyRstrip(line)}`;
      continue;
    }
  }

  return items;
}

/** Task 제목을 kebab-case 슬러그로(최대 40자). 만들 수 없으면 "". */
export function _slugify(title) {
  let slug = title.toLowerCase();
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = stripChars(slug, '-');
  if (slug.length > 40) slug = rstripChar(slug.slice(0, 40), '-');
  return slug;
}

function rstripChar(s, ch) {
  let b = s.length;
  while (b > 0 && s[b - 1] === ch) b--;
  return s.slice(0, b);
}

/** WP 블록에서 Task 항목을 파싱한다. */
export function parse_tasks_from_wp(wp_block, pending_only = false) {
  const tasks = [];
  let current = null;

  const keep = (cur) => {
    const status = cur.status ?? '';
    const category = cur.category ?? '';
    if (!pending_only || (!status.includes('[xx]') && category !== 'feat')) tasks.push(cur);
  };

  for (const line of splitlinesPy(wp_block)) {
    const m = _TASK_LIST_RE.exec(line);
    if (m) {
      if (current !== null) keep(current);
      current = {
        tsk_id: m[1],
        title: pyStrip(m[2]),
        status: '',
        depends: '',
        domain: '',
        category: '',
      };
      continue;
    }
    if (current !== null) {
      if (line.startsWith('- status:')) current.status = pyStrip(line.slice('- status:'.length));
      else if (line.startsWith('- depends:')) current.depends = pyStrip(line.slice('- depends:'.length));
      else if (line.startsWith('- domain:')) current.domain = pyStrip(line.slice('- domain:'.length));
      else if (line.startsWith('- category:')) current.category = pyStrip(line.slice('- category:'.length));
    }
  }

  if (current !== null) keep(current);

  return tasks;
}

/** '-' 와 빈 문자열을 null 로 접는다 (wbs.md 의 '값 없음' 센티널). */
export function _nullify(value) {
  const v = pyStrip(value || '');
  if (!v || v === '-') return null;
  return v;
}

/** 쉼표 구분 스칼라 필드를 배열로 편다 (tags). '-' 는 []. */
export function _csv_field(block, field_name) {
  const raw = _nullify(get_field(block, field_name));
  if (raw === null) return [];
  return raw.split(',').map((s) => pyStrip(s)).filter((s) => s);
}

/** 불릿 리스트를 개행으로 이은 문자열. 비면 null (계약 v2 의 string|null). */
export function _join_or_none(items) {
  if (!items.length) return null;
  return items.join('\n');
}

export function _blank_spec_sections() {
  return {
    requirements: [],
    test_criteria: [],
    constraints: [],
    api_spec: null,
    data_model: null,
    description: null,
  };
}

/** 계약 v2 의 17키를 전부 가진 빈 노드. 모든 kind 가 같은 shape 을 쓴다. */
export function _blank_node(node_id, kind, title, parent_id) {
  return {
    id: node_id,
    parent_id,
    kind,
    title: pyStrip(title),
    stage: null,
    category: null,
    domain: null,
    model: null,
    assignee: null,
    schedule: null,
    priority: null,
    tags: [],
    depends: [],
    prd_ref: null,
    entry_point: null,
    acceptance: [],
    spec_sections: _blank_spec_sections(),
  };
}

/**
 * WBS 전 계층(Phase/WP/ACT/Task)을 계약 v2 노드 배열로 파싱한다.
 *
 * Phase 노드는 WP 의 `- phase:` 값에서 최초 등장 순서로 합성한다(title = id). Task 의 상태는 state.json 이 있으면
 * 그 값이 진실 원천이며 출력에는 D'Flow stage 코드만 싣는다. WP/ACT 헤딩은 펜스 안의 줄을 무시하지만 TASK 헤딩에는
 * 펜스 필터를 적용하지 않는다(과다 탐지가 과소 탐지보다 안전하다는 wbs-validate 의 정책).
 */
export function parse_nodes(wbs_text, docs_dir) {
  const lines = splitlinesPy(wbs_text);
  const fences = _fenced_ranges(wbs_text);
  const offsets = line_start_offsets(wbs_text);
  const phases = [];
  const wps = [];
  const acts = [];
  const tasks = [];

  let current_wp = null;
  let current_act = null;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const in_fence = _in_ranges(offsets[idx], fences);

    if (!in_fence) {
      let m = _WP_HEADING_RE.exec(line);
      if (m) {
        const wp_id = m[1];
        const title = m[2];
        const meta_lines = [];
        for (let k = idx + 1; k < lines.length; k++) {
          if (lines[k].startsWith('#')) break;
          meta_lines.push(lines[k]);
        }
        const meta = meta_lines.join('\n');
        const phase_id = _nullify(get_field(meta, 'phase'));
        if (phase_id && !phases.includes(phase_id)) phases.push(phase_id);
        const node = _blank_node(wp_id, 'wp', title, phase_id);
        node.schedule = _nullify(get_field(meta, 'schedule'));
        node.spec_sections.description = _nullify(get_field(meta, 'description'));
        wps.push(node);
        current_wp = wp_id;
        current_act = null;
        continue;
      }

      m = _ACT_HEADING_RE.exec(line);
      if (m) {
        const act_id = m[1];
        const title = m[2];
        acts.push(_blank_node(act_id, 'act', title, current_wp));
        current_act = act_id;
        continue;
      }
    }

    const m = _TSK_HEADING_RE.exec(line);
    if (m) {
      const tsk_id = m[1];
      const title = m[2];
      const block = extract_task_block(wbs_text, tsk_id);
      let status = get_field(block, 'status') || '[ ]';
      if (docs_dir) {
        const state_data = _load_task_state_json(docs_dir, tsk_id);
        if (pyTruthy(state_data) && pyTruthy(dget(state_data, 'status'))) {
          status = dget(state_data, 'status');
        }
      }
      const node = _blank_node(tsk_id, 'task', title, current_act || current_wp);
      node.stage = _wbs_status.stage_code(status);
      node.category = _nullify(get_field(block, 'category'));
      node.domain = _nullify(get_field(block, 'domain'));
      node.model = _nullify(get_field(block, 'model'));
      node.assignee = _nullify(get_field(block, 'assignee'));
      node.schedule = _nullify(get_field(block, 'schedule'));
      node.priority = _nullify(get_field(block, 'priority'));
      node.tags = _csv_field(block, 'tags');
      node.depends = parse_list_field(block, 'depends');
      node.prd_ref = _nullify(get_field(block, 'prd-ref'));
      node.entry_point = _nullify(get_field(block, 'entry-point'));
      node.acceptance = parse_list_field(block, 'acceptance');
      node.spec_sections = {
        requirements: parse_list_field(block, 'requirements'),
        test_criteria: parse_list_field(block, 'test-criteria'),
        constraints: parse_list_field(block, 'constraints'),
        api_spec: _join_or_none(parse_list_field(block, 'api-spec')),
        data_model: _join_or_none(parse_list_field(block, 'data-model')),
        description: _nullify(get_field(block, 'description')),
      };
      tasks.push(node);
      continue;
    }
  }

  const phase_nodes = phases.map((p) => _blank_node(p, 'phase', p, null));
  return [...phase_nodes, ...wps, ...acts, ...tasks];
}

// ---------------------------------------------------------------------------
// Dev Config
// ---------------------------------------------------------------------------

export const _DEV_CONFIG_TEMPLATE_FALLBACK = `\
## Dev Config

### Domains
| domain | description | unit-test | e2e-test | e2e-server | e2e-url |
|--------|-------------|-----------|----------|------------|---------|
| backend | Server API | \`your-unit-test-cmd\` | \`your-e2e-test-cmd\` | - | - |
| frontend | Client UI | \`your-unit-test-cmd\` | \`your-e2e-test-cmd\` | \`your-dev-server-cmd\` | \`http://localhost:3000\` |
| database | Data layer | - | - | - | - |
| fullstack | Full stack | - | - | - | - |

### Design Guidance
| domain | architecture |
|--------|-------------|
| backend | Your backend architecture description |
| frontend | Your frontend architecture description |

### Quality Commands
| name | command |
|------|---------|
| lint | \`your-lint-cmd\` |
| typecheck | \`your-typecheck-cmd\` |
| coverage | \`your-coverage-cmd\` |

### Cleanup Processes
node, vitest
`;

/** python `os.environ.get("CLAUDE_PLUGIN_ROOT") or dirname(dirname(abspath(__file__)))` (스킬 폴더). */
function pluginRootParent() {
  return process.env.CLAUDE_PLUGIN_ROOT || pyDirname(pyDirname(path.resolve(SCRIPT_FILE)));
}

/**
 * dev-config-template.md 의 ```markdown 펜스 블록을 꺼낸다. 파일이 없거나 펜스가 없으면 내장 폴백.
 * (이 경로는 이 리포에 없는 옛 플러그인 경로라 실제로는 항상 폴백이 쓰인다.)
 */
export function _dev_config_template_body() {
  const plugin_root = pluginRootParent();
  const p = pyJoin(plugin_root, 'skills', 'wbs', 'references', 'dev-config-template.md');
  let text;
  try {
    text = readPyText(p);
  } catch (e) {
    if (isOSError(e)) return _DEV_CONFIG_TEMPLATE_FALLBACK;
    throw e;
  }
  const m = /```markdown\n([\s\S]*?)\n```/.exec(text);
  if (m) return m[1];
  return _DEV_CONFIG_TEMPLATE_FALLBACK;
}

export function _dev_config_missing_message() {
  return "wbs.md에 '## Dev Config' 섹션이 없습니다. 아래 내용을 wbs.md 헤더와 첫 번째 WP 사이에 추가하세요:\n\n"
    + _dev_config_template_body();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ### 제목 아래의 마크다운 표를 파싱한다. 백틱 안의 | 는 구분자가 아니다. */
export function _parse_md_table(lines, header_name, expected_cols) { // eslint-disable-line no-unused-vars
  let in_section = false;
  let header_found = false;
  const rows = [];
  const head = escapeRe(header_name);
  const headRe = new RegExp(`^###${S}+${head}${S}*$`, 'iu');
  const headPrefixRe = new RegExp(`^###${S}+${head}`, 'iu');
  const anyHeadRe = new RegExp(`^#{2,3}${S}+`, 'u');

  for (const line of lines) {
    const stripped = pyStrip(line);
    if (headRe.test(stripped)) {
      in_section = true;
      header_found = false;
      continue;
    }
    if (in_section && anyHeadRe.test(stripped) && !headPrefixRe.test(stripped)) break;
    if (!in_section) continue;

    if (!stripped || !stripped.startsWith('|')) continue;

    const cells = _split_table_row(stripped);
    if (!cells.length) continue;

    if (!header_found) {
      header_found = true;
      continue;
    }
    if (cells.every((c) => pyStrip(c).replace(/-/g, '').replace(/:/g, '') === '')) continue;

    rows.push(cells);
  }

  return rows;
}

/** 마크다운 표 한 줄을 셀로 나눈다(백틱으로 감싼 내용 존중). */
export function _split_table_row(row) {
  row = pyStrip(row);
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);

  const cells = [];
  let current = [];
  let in_backtick = false;
  for (const ch of row) {
    if (ch === '`') {
      in_backtick = !in_backtick;
      current.push(ch);
    } else if (ch === '|' && !in_backtick) {
      cells.push(pyStrip(current.join('')));
      current = [];
    } else {
      current.push(ch);
    }
  }
  cells.push(pyStrip(current.join('')));
  return cells;
}

/** 셀 값 변환: 백틱 벗기기, '-' → null. */
export function _cell_value(cell) {
  cell = pyStrip(cell);
  if (cell === '-' || cell === '') return null;
  if (cell.startsWith('`') && cell.endsWith('`')) cell = cell.slice(1, -1);
  return cell;
}

const DEVCFG_HEAD_RE = new RegExp(`^##${S}+Dev${S}+Config${S}*$`, 'iu');
const DEVCFG_PREFIX_RE = new RegExp(`^##${S}+Dev${S}+Config`, 'iu');
const H2_RE = new RegExp(`^##${S}+`, 'u');
const CLEANUP_HEAD_RE = new RegExp(`^###${S}+Cleanup${S}+Processes${S}*$`, 'iu');
const H23_RE = new RegExp(`^#{2,3}${S}+`, 'u');

/** WBS 텍스트의 `## Dev Config` 섹션을 파싱한다. 도메인 표들은 Map(삽입순)으로 돌려준다. */
export function parse_dev_config(wbs_text) {
  const lines = splitlinesPy(wbs_text);
  let start = null;
  let end = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (DEVCFG_HEAD_RE.test(line)) {
      start = i;
      continue;
    }
    if (start !== null && H2_RE.test(line) && !pyStrip(line).startsWith('###')) {
      if (!DEVCFG_PREFIX_RE.test(line)) {
        end = i;
        break;
      }
    }
  }

  if (start === null) {
    return { error: 'DEV_CONFIG_MISSING', message: _dev_config_missing_message() };
  }

  const section = lines.slice(start, end === null ? undefined : end);

  const domain_rows = _parse_md_table(section, 'Domains', ['domain', 'description', 'unit-test', 'e2e-test']);
  const domains = new Map();
  const fullstack_domains = [];
  for (const row of domain_rows) {
    if (row.length < 4) continue;
    const d = stripChars(pyStrip(row[0]), '`');
    const unit = _cell_value(row[2]);
    const e2e = _cell_value(row[3]);
    const e2e_server = row.length > 4 ? _cell_value(row[4]) : null;
    const e2e_url = row.length > 5 ? _cell_value(row[5]) : null;
    domains.set(d, {
      description: _cell_value(row[1]) || d,
      unit_test: unit,
      e2e_test: e2e,
      e2e_server,
      e2e_url,
    });
    if (d !== 'fullstack' && (unit || e2e)) fullstack_domains.push(d);
  }

  const guidance_rows = _parse_md_table(section, 'Design Guidance', ['domain', 'architecture']);
  const design_guidance = new Map();
  for (const row of guidance_rows) {
    if (row.length < 2) continue;
    const d = stripChars(pyStrip(row[0]), '`');
    const val = _cell_value(row[1]);
    if (val) design_guidance.set(d, val);
  }

  const quality_rows = _parse_md_table(section, 'Quality Commands', ['name', 'command']);
  const quality_commands = new Map();
  for (const row of quality_rows) {
    if (row.length < 2) continue;
    const name = stripChars(pyStrip(row[0]), '`');
    const val = _cell_value(row[1]);
    if (val) quality_commands.set(name, val);
  }

  let cleanup_processes = [];
  let in_cleanup = false;
  for (const line of section) {
    const stripped = pyStrip(line);
    if (CLEANUP_HEAD_RE.test(stripped)) {
      in_cleanup = true;
      continue;
    }
    if (in_cleanup && H23_RE.test(stripped)) break;
    if (in_cleanup && stripped && !stripped.startsWith('|') && !stripped.startsWith('---')) {
      cleanup_processes = stripped.split(',').map((p) => pyStrip(p)).filter((p) => p);
      break;
    }
  }

  return {
    domains,
    design_guidance,
    quality_commands,
    cleanup_processes,
    fullstack_domains,
  };
}

function _read_file(p) {
  return readPyText(p);
}

/** feat 모드 폴백 체인: feat 로컬 → wbs → 기본값. 출처를 `source` 필드로 단다. */
export function _resolve_dev_config_feat(feat_dir, docs_dir) {
  // 1) Feature-local override
  const local_path = pyJoin(feat_dir, 'dev-config.md');
  if (isFile(local_path)) {
    try {
      const result = parse_dev_config(_read_file(local_path));
      if (!('error' in result)) {
        result.source = 'feat-local';
        result.source_path = local_path;
        return result;
      }
    } catch (e) {
      if (!isOSError(e)) throw e;
    }
  }

  // 2) Project wbs.md Dev Config section
  if (docs_dir) {
    const wbs_path = pyJoin(docs_dir, 'wbs.md');
    if (isFile(wbs_path)) {
      try {
        const result = parse_dev_config(_read_file(wbs_path));
        if (!('error' in result)) {
          result.source = 'wbs';
          result.source_path = wbs_path;
          return result;
        }
      } catch (e) {
        if (!isOSError(e)) throw e;
      }
    }
  }

  // 3) Global default
  const plugin_root = pluginRootParent();
  const default_path = pyJoin(plugin_root, 'references', 'default-dev-config.md');
  if (!isFile(default_path)) {
    return {
      error: 'DEFAULT_DEV_CONFIG_MISSING',
      message: `Default dev-config not found at ${default_path}. Plugin installation may be corrupted.`,
    };
  }
  try {
    const result = parse_dev_config(_read_file(default_path));
    if ('error' in result) return result;
    result.source = 'default';
    result.source_path = default_path;
    return result;
  } catch (e) {
    if (!isOSError(e)) throw e;
    return {
      error: 'DEFAULT_DEV_CONFIG_READ_ERROR',
      message: `Failed to read ${default_path}: ${oserrorText(e, default_path)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// 상태 (state.json · state-machine.json)
// ---------------------------------------------------------------------------

/**
 * 상태 문자열에서 시작 Phase 를 정한다(상태머신, 없으면 폴백).
 * 레거시 `[dd!]` → `[ ]`, `[im!]` → `[im]` 로 먼저 정규화한다.
 */
export function _resolve_phase_from_status(status, sm) {
  let key = pyTruthy(status) && pyStrip(status) ? pyStrip(status) : '[ ]';
  const legacy_map = { '[dd!]': '[ ]', '[im!]': '[im]' };
  key = Object.prototype.hasOwnProperty.call(legacy_map, key) ? legacy_map[key] : key;

  const state_def = pyTruthy(sm) ? dget(dget(sm, 'states', new Map()), key) : null;
  if (pyTruthy(state_def)) {
    const ps = dget(state_def, 'phase_start');
    return pyTruthy(ps) ? ps : 'design';
  }
  if (key.includes('[xx]')) return 'done';
  if (key.includes('[ts]')) return 'refactor';
  if (key.includes('[im]')) return 'test';
  if (key.includes('[dd]')) return 'build';
  return 'design';
}

/** WBS Task 의 state.json 을 읽는다. 없거나 읽을 수 없으면 null. */
export function _load_task_state_json(docs_dir, tsk_id) {
  const p = pyJoin(docs_dir, 'tasks', tsk_id, 'state.json');
  if (!isFile(p)) return null;
  let text;
  try {
    text = readPyText(p);
  } catch (e) {
    if (isOSError(e)) return null;
    throw e;
  }
  try {
    return parseFaithful(text);
  } catch (e) {
    if (e instanceof PyJSONDecodeError) return null;
    throw e;
  }
}

/** Task 딕셔너리에 state.json 값(bypassed, 정확한 status)을 덧입힌다(제자리 변경). */
export function _enrich_tasks_with_state(tasks, docs_dir) {
  for (const task of tasks) {
    const tsk_id = task.tsk_id ?? '';
    if (!tsk_id) continue;
    const state_data = _load_task_state_json(docs_dir, tsk_id);
    if (state_data === null) continue;
    // python: `"status" in state_data` 뒤 `.get` — dict 가 아니면 어느 쪽이든 예외(종료 코드 1)
    if (!(state_data instanceof Map)) throw new TypeError(`'${typeName(state_data)}' object has no attribute 'get'`);
    if (state_data.has('status')) task.status = state_data.get('status');
    if (pyTruthy(dget(state_data, 'bypassed'))) {
      task.bypassed = true;
      task.bypassed_reason = dget(state_data, 'bypassed_reason', '');
    }
  }
  return tasks;
}

/** feat 상태를 읽는다(state.json 우선, 레거시 status.json 폴백). `state` 필드는 `status` 로 바꾼다. [data, err]. */
export function _load_feat_state(feat_dir) {
  const state_path = pyJoin(feat_dir, 'state.json');
  const legacy_path = pyJoin(feat_dir, 'status.json');
  const target = isFile(state_path) ? state_path : legacy_path;
  if (!isFile(target)) return [null, `neither state.json nor status.json found in ${feat_dir}`];
  let data;
  try {
    data = parseFaithful(readPyText(target));
  } catch (e) {
    if (e instanceof PyJSONDecodeError) return [null, `failed to read ${target}: ${e.message}`];
    if (isOSError(e)) return [null, `failed to read ${target}: ${oserrorText(e, target)}`];
    throw e;
  }
  if (!(data instanceof Map)) throw new TypeError(`'${typeName(data)}' object is not a feature state dict`);
  if (data.has('state') && !data.has('status')) {
    const v = data.get('state');
    data.delete('state');
    data.set('status', v);
  }
  return [data, null];
}

/** state-machine.json 을 읽는다. [sm, err]. */
export function _load_state_machine() {
  const plugin_root = process.env.CLAUDE_PLUGIN_ROOT || path.dirname(path.resolve(SCRIPT_FILE));
  const sm_path = pyJoin(plugin_root, 'references', 'state-machine.json');
  if (!isFile(sm_path)) return [null, `state-machine.json not found at ${sm_path}`];
  try {
    return [parseFaithful(readPyText(sm_path)), null];
  } catch (e) {
    if (e instanceof PyJSONDecodeError) return [null, `load error: ${e.message}`];
    if (isOSError(e)) return [null, `load error: ${oserrorText(e, sm_path)}`];
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Complexity scoring
// ---------------------------------------------------------------------------

const _COMPLEXITY_KEYWORDS = new RegExp(
  '아키텍처|마이그레이션|인프라|통합|리팩토링|미들웨어|트랜잭션|동시성|상태머신|인증체계'
  + '|architecture|migration|infrastructure|integration|refactor|middleware|transaction|concurrency'
  + '|websocket|fsm|state[^\\n]machine|oauth|rbac',
  'iu',
);
const _METADATA_LINE = /^- (?:category|domain|status|priority|assignee|schedule|tags|depends|model):/;
const _SIMPLE_CATEGORIES = new Set(['config', 'docs', 'documentation']);
const _SIMPLE_DOMAINS = new Set(['docs', 'test']);

export const COMPLEXITY_THRESHOLD = 3; // >= threshold → opus

const _VALID_MODELS = new Set(['opus', 'sonnet']);

/** 키워드 검색이 본문만 보도록 메타데이터 줄을 지운다. */
export function _strip_metadata(block) {
  return splitlinesPy(block).filter((line) => !_METADATA_LINE.test(pyStrip(line))).join('\n');
}

/**
 * WBS 블록 메타데이터로 Task 복잡도를 점수화한다. 우선순위: 명시 `- model:` > 자동 점수.
 * 자동 점수: depends 0-1→0, 2-3→+1, 4+→+2 / domain frontend +1, fullstack +2, docs·test -1 /
 * 본문 키워드 +2 / category config·docs -1.
 */
export function compute_complexity(block) {
  const explicit_model = pyStrip(get_field(block, 'model')).toLowerCase();
  if (explicit_model && _VALID_MODELS.has(explicit_model)) {
    return {
      complexity_score: null,
      recommended_model: explicit_model,
      source: 'wbs',
      factors: ['explicit'],
      threshold: COMPLEXITY_THRESHOLD,
    };
  }

  let score = 0;
  const factors = [];

  const depends_raw = pyStrip(get_field(block, 'depends'));
  let dep_count = 0;
  if (depends_raw && depends_raw !== '-') {
    dep_count = depends_raw.split(',').map((d) => pyStrip(d)).filter((d) => d && d !== '-').length;
  }

  if (dep_count >= 4) {
    score += 2;
    factors.push(`depends:${dep_count}`);
  } else if (dep_count >= 2) {
    score += 1;
    factors.push(`depends:${dep_count}`);
  }

  const domain = pyStrip(get_field(block, 'domain')).toLowerCase();
  if (domain === 'frontend') {
    score += 1;
    factors.push(`domain:${domain}`);
  } else if (domain === 'fullstack') {
    score += 2;
    factors.push(`domain:${domain}`);
  } else if (_SIMPLE_DOMAINS.has(domain)) {
    score -= 1;
    factors.push(`domain:${domain}(-1)`);
  }

  const content = _strip_metadata(block);
  if (_COMPLEXITY_KEYWORDS.test(content)) {
    score += 2;
    factors.push('keyword_match');
  }

  const category = pyStrip(get_field(block, 'category')).toLowerCase();
  if (_SIMPLE_CATEGORIES.has(category)) {
    score -= 1;
    factors.push(`category:${category}(-1)`);
  }

  score = Math.max(score, 0);
  const model = score >= COMPLEXITY_THRESHOLD ? 'opus' : 'sonnet';

  return {
    complexity_score: score,
    recommended_model: model,
    source: 'auto',
    factors,
    threshold: COMPLEXITY_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const out = (s) => process.stdout.write(`${s}\n`);
const err = (s) => process.stderr.write(`${s}\n`);
const dump2 = (v) => pyJsonDumps(v, { indent: 2, ensureAscii: false });
const dump0 = (v) => pyJsonDumps(v, { ensureAscii: false });

/** feat 모드 디스패처: `wbs-parse --feat <feat-dir> <mode> [extra]`. argv[0] 은 프로그램 이름 자리. */
export function _handle_feat_mode(argv) {
  if (argv.length < 4) {
    err('ERROR: --feat requires <feat-dir> <mode>');
    return 1;
  }

  const feat_dir = argv[2];
  const mode = argv[3];

  if (!isDir(feat_dir)) {
    err(`ERROR: feature dir not found: ${feat_dir}`);
    return 1;
  }

  // --dev-config 는 자체 폴백 체인을 쓴다(status.json 불필요)
  if (mode === '--dev-config') {
    const docs_dir = argv.length > 4 ? argv[4] : '';
    out(dump2(_resolve_dev_config_feat(feat_dir, docs_dir)));
    return 0;
  }

  const [data, e] = _load_feat_state(feat_dir);
  if (e) {
    err(`ERROR: ${e}`);
    return 1;
  }

  const nm = dget(data, 'name');
  const name = pyTruthy(nm) ? nm : pyBasename(feat_dir.replace(/\/+$/, ''));
  const status = dget(data, 'status', '[ ]');

  if (mode === '--phase-start') {
    const [sm, sm_err] = _load_state_machine();
    const phase = _resolve_phase_from_status(status, pyTruthy(sm) ? sm : new Map());
    const result = {
      source: 'feat',
      feat_name: name,
      feat_dir,
      status,
      start_phase: phase,
    };
    if (sm_err) result.state_machine_warning = sm_err;
    out(dump0(result));
    return 0;
  }

  if (mode === '--status') {
    out(dump2(data));
    return 0;
  }

  err(`ERROR: unknown feat mode: ${mode}`);
  return 1;
}

function printUsage() {
  out(USAGE);
  return 1;
}

function run(argv) {
  if (argv.length >= 2 && argv[1] === '--feat') return _handle_feat_mode(argv);

  if (argv.length < 3) return printUsage();

  const wbs_path = argv[1];
  // argv[2] 는 TSK/WP id, 자리표시 "-", 또는 (--tasks-all 처럼 id 가 필요 없는 모드의) 플래그 자체다.
  let target_id;
  let mode;
  let field_name;
  if (argv[2].startsWith('--')) {
    target_id = null;
    mode = argv[2];
    field_name = mode === '--field' && argv.length > 3 ? argv[3] : null;
  } else {
    target_id = argv[2];
    mode = argv.length > 3 ? argv[3] : '--json';
    field_name = mode === '--field' && argv.length > 4 ? argv[4] : null;
  }

  if (mode === '--field' && !field_name) {
    err('ERROR: --field requires a field name');
    return 1;
  }

  if (!isFile(wbs_path)) {
    err(`ERROR: file not found: ${wbs_path}`);
    return 1;
  }

  const wbs_text = readPyText(wbs_path);

  // -- Raw block --
  if (mode === '--block') {
    const block = extract_task_block(wbs_text, target_id);
    if (!block) {
      err(`ERROR: ${pyStr(target_id)} not found in ${wbs_path}`);
      return 1;
    }
    out(block);
    return 0;
  }

  // -- Single field --
  if (mode === '--field') {
    const block = extract_task_block(wbs_text, target_id);
    if (!block) {
      err(`ERROR: ${pyStr(target_id)} not found`);
      return 1;
    }
    out(get_field(block, field_name));
    return 0;
  }

  // -- Task JSON (default) --
  if (mode === '--json') {
    const block = extract_task_block(wbs_text, target_id);
    if (!block) {
      err(`ERROR: ${pyStr(target_id)} not found in ${wbs_path}`);
      return 1;
    }

    const first_line = block ? splitlinesPy(block)[0] : '';
    // 헤딩 접두어와 Task ID 를 지운다
    const title = first_line.replace(new RegExp(`^#{2,4}${S}+[^:]*:${S}*`, 'u'), '');

    const scalar_fields = [
      'category', 'domain', 'model', 'status', 'priority',
      'assignee', 'schedule', 'tags', 'depends', 'blocked-by',
      'note', 'entry-point', 'prd-ref',
    ];
    // 여러 줄 리스트 필드(CSV·불릿 모두 지원)
    const list_fields = [
      'requirements', 'acceptance', 'constraints', 'test-criteria',
      'tech-spec', 'api-spec', 'data-model', 'ui-spec',
    ];

    const result = { tsk_id: target_id, title };
    for (const f of scalar_fields) result[f.replace(/-/g, '_')] = get_field(block, f);
    for (const f of list_fields) result[f.replace(/-/g, '_')] = parse_list_field(block, f);
    result.block = block;
    out(dump2(result));
    return 0;
  }

  // -- WP child tasks (all) --
  if (mode === '--tasks') {
    const wp_block = extract_wp_block(wbs_text, target_id);
    if (!wp_block) {
      err(`ERROR: ${pyStr(target_id)} not found in ${wbs_path}`);
      return 1;
    }
    const tasks = parse_tasks_from_wp(wp_block, false);
    _enrich_tasks_with_state(tasks, pyDirname(wbs_path));
    out(dump2(tasks));
    return 0;
  }

  // -- All tasks in the whole WBS (flat list, all WPs) --
  if (mode === '--tasks-all') {
    const all_tasks = [];
    const docs_dir = pyDirname(wbs_path);
    const wp_headers = [...wbs_text.matchAll(new RegExp(`(?<![^\\n])##${S}+(WP-${D}+):`, 'gu'))];
    for (let idx = 0; idx < wp_headers.length; idx++) {
      const start = wp_headers[idx].index;
      const end = idx + 1 < wp_headers.length ? wp_headers[idx + 1].index : wbs_text.length;
      all_tasks.push(...parse_tasks_from_wp(wbs_text.slice(start, end), false));
    }
    _enrich_tasks_with_state(all_tasks, docs_dir);
    out(dump2(all_tasks));
    return 0;
  }

  // -- 전 계층 export (D'Flow /wbs/import 계약 v2) --
  if (mode === '--export') {
    const docs_dir = pyDirname(path.resolve(wbs_path));
    const nodes = parse_nodes(wbs_text, docs_dir);
    out(dump2({
      schema_version: '2.1',
      source: wbs_path,
      nodes,
    }));
    return 0;
  }

  // -- WP child tasks (pending only) --
  if (mode === '--tasks-pending') {
    const wp_block = extract_wp_block(wbs_text, target_id);
    if (!wp_block) {
      err(`ERROR: ${pyStr(target_id)} not found in ${wbs_path}`);
      return 1;
    }
    let tasks = parse_tasks_from_wp(wp_block, true);
    _enrich_tasks_with_state(tasks, pyDirname(wbs_path));
    // bypassed Task 는 스케줄링에서 사실상 완료로 본다
    tasks = tasks.filter((t) => !pyTruthy(t.bypassed));
    out(dump2(tasks));
    return 0;
  }

  // -- feat tasks in a WP (category: feat only) --
  if (mode === '--feat-tasks') {
    const wp_block = extract_wp_block(wbs_text, target_id);
    if (!wp_block) {
      err(`ERROR: ${pyStr(target_id)} not found in ${wbs_path}`);
      return 1;
    }
    const all_tasks = parse_tasks_from_wp(wp_block, false);
    const feat_tasks = [];
    for (const t of all_tasks) {
      if (t.category !== 'feat') continue;
      const tsk_id = t.tsk_id;
      const title = t.title ?? '';
      const slug = _slugify(title);
      // 슬러그를 못 만들면 소문자 TSK-ID (TSK-01-02 → tsk-01-02)
      const feat_name = slug || tsk_id.toLowerCase();
      feat_tasks.push({ tsk_id, feat_name, title });
    }
    out(dump2(feat_tasks));
    return 0;
  }

  // -- Resumable WPs --
  if (mode === '--resumable-wps') {
    const docs_dir = pyDirname(wbs_path);
    const wps = [];
    let current_wp = null;
    let in_task = false;
    let current_tsk_id = null;

    for (const line of splitlinesPy(wbs_text)) {
      const m = _WP_LINE_RE.exec(line);
      if (m) {
        if (current_wp && current_wp.pending > 0) wps.push(current_wp);
        current_wp = { wp_id: m[1], pending: 0, total: 0 };
        in_task = false;
        current_tsk_id = null;
        continue;
      }
      if (current_wp !== null) {
        const tsk_m = _TASK_COUNT_RE.exec(line);
        if (tsk_m) {
          in_task = true;
          current_tsk_id = tsk_m[1];
          current_wp.total += 1;
        }
        if (in_task && line.startsWith('- status:')) {
          if (!line.includes('[xx]')) {
            let is_bypassed = false;
            if (current_tsk_id) {
              const state_data = _load_task_state_json(docs_dir, current_tsk_id);
              if (pyTruthy(state_data) && pyTruthy(dget(state_data, 'bypassed'))) is_bypassed = true;
            }
            if (!is_bypassed) current_wp.pending += 1;
          }
          in_task = false;
          current_tsk_id = null;
        }
      }
    }

    if (current_wp && current_wp.pending > 0) wps.push(current_wp);

    out(dump2(wps));
    return 0;
  }

  // -- Complexity --
  if (mode === '--complexity') {
    const block = extract_task_block(wbs_text, target_id);
    if (!block) {
      err(`ERROR: ${pyStr(target_id)} not found in ${wbs_path}`);
      return 1;
    }
    const result = compute_complexity(block);
    result.tsk_id = target_id;
    out(dump2(result));
    return 0;
  }

  // -- Dev Config --
  if (mode === '--dev-config') {
    out(dump2(parse_dev_config(wbs_text)));
    return 0;
  }

  // -- Phase start --
  if (mode === '--phase-start') {
    const block = extract_task_block(wbs_text, target_id);
    if (!block) {
      err(`ERROR: ${pyStr(target_id)} not found`);
      return 1;
    }

    const domain = get_field(block, 'domain');
    const docs_dir = pyDirname(wbs_path);

    // state.json 이 있으면 그 값이 진실 원천, 없으면 wbs.md 의 status 줄
    const state_data = _load_task_state_json(docs_dir, target_id);
    let status;
    let status_source;
    if (state_data !== null) {
      const s = dget(state_data, 'status', '[ ]');
      status = pyTruthy(s) ? s : '[ ]';
      status_source = 'state.json';
    } else {
      status = get_field(block, 'status') || '[ ]';
      status_source = 'wbs.md';
    }

    const [sm, sm_error] = _load_state_machine();
    const phase = _resolve_phase_from_status(status, pyTruthy(sm) ? sm : new Map());

    const result = {
      tsk_id: target_id,
      status,
      status_source,
      domain,
      start_phase: phase,
      docs_dir,
    };
    if (pyTruthy(state_data) && pyTruthy(dget(state_data, 'last'))) result.last = dget(state_data, 'last');
    if (pyTruthy(state_data) && pyTruthy(dget(state_data, 'bypassed'))) {
      result.bypassed = true;
      result.bypassed_reason = dget(state_data, 'bypassed_reason', '');
    }
    // 드리프트 감지: state.json 과 wbs.md 의 status 가 다르면 경고
    if (state_data !== null) {
      const wbs_status = get_field(block, 'status') || '[ ]';
      const legacy_map = { '[dd!]': '[ ]', '[im!]': '[im]' };
      const wbs_norm = Object.prototype.hasOwnProperty.call(legacy_map, wbs_status) ? legacy_map[wbs_status] : wbs_status;
      if (wbs_norm !== status) {
        result.drift_warning = `wbs.md status ${wbs_status} != state.json status ${status}`;
      }
    }
    if (sm_error) result.state_machine_warning = sm_error;
    out(dump0(result));
    return 0;
  }

  return printUsage();
}

/**
 * 종료 코드를 돌려준다(process.exit 는 부르지 않는다). python 이 traceback 으로 끝나던 비정상 입력은
 * 같은 종료 코드 1 에 한 줄 오류로 낸다.
 * @param {string[]} [args] 프로그램 이름을 뺀 인자
 * @returns {number}
 */
export function main(args = process.argv.slice(2)) {
  try {
    return run(['wbs-parse', ...args]);
  } catch (e) {
    err(`ERROR: unexpected failure: ${e && e.message ? e.message : e}`);
    return 1;
  }
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(SCRIPT_FILE) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMain()) finish(main());
