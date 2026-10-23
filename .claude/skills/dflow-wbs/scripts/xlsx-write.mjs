#!/usr/bin/env node
// xlsx-write.mjs — 행 배열(JSON)을 의존성 0 으로 .xlsx 로 쓴다 (dflow-wbs SKILL.md 「쓰기 — 의존성 0」의 python `write_xlsx` 블록의 node 이식).
//
// 사용:
//   node xlsx-write.mjs --out wbs.xlsx rows.json
//   node xlsx-write.mjs --out wbs.xlsx < rows.json
//
// 입력: 행 배열 `[[헤더…], [셀…], …]` (rows[0] = 헤더). 셀은 문자열 또는 숫자다.
//   문자열 셀(그 밖의 값도 python `str(v)` 로 바꿔 문자열 셀)은 `t="s"`(sharedStrings), 숫자 셀은 `t` 속성 없이 `<v>` 에 쓴다.
//   숫자 표기는 python `str(v)` 와 같다: JSON `1` → `1`, `1.0` → `1.0`, `1e-5` → `1e-05`, 큰 정수는 자릿수 그대로.
// 출력: --out 경로에 xlsx 파일. 성공하면 stdout 은 비어 있다. 종료 코드 0 정상, 1 입력·쓰기 오류, 2 사용 오류.
//
// 열은 최대 26개(A~Z)다. 이 문서(dflow-wbs, 엑셀 export)의 표는 18열이라 충분하다. python 원본은 27열부터 `chr(ord('A')+c)` 가 `[` 같은 깨진 열 이름을 냈고,
//   이 판은 27열 이상이면 오류로 끝낸다(종료 코드 1).
// python 판과 같은 점: 모든 파트(`[Content_Types].xml`, `_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/worksheets/sheet1.xml`, `xl/sharedStrings.xml`)의 내용을
//   글자까지 같게 만들고 같은 순서로 쓴다. 문자열은 python `html.escape`(& < > " ' → &amp; &lt; &gt; &quot; &#x27;)를 거친다.
// python 판과 다른 점(알고 둔 것): zip 컨테이너 바이트는 다르다(파일 시각을 1980-01-01 로 고정해 같은 입력이면 같은 파일이 나온다. python 은 현재 시각).
//   27열 이상 오류. 행이 배열이 아니면 오류(python 은 문자열 행을 글자로 쪼갠다). 부모 폴더가 없으면 만든다.
//   XML 에 쓸 수 없는 문자(제어 문자·U+FFFE·U+FFFF·짝 없는 서로게이트)는 XLSX 관례의 `_xHHHH_` 로 인코딩하고(원문의 `_x0041_` 같은 글자는 `_x005F_x0041_`),
//   xlsx-read.mjs 가 되돌린다. python 판은 이 문자를 그대로 써서 엑셀이 열지 못하는 파일을 냈다. 이 문자가 없는 입력은 python 판과 파트가 글자까지 같다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OK, VIOLATION, finish, parseCli } from '../../_shared/node/args.mjs';
import { readStdinText } from '../../_shared/node/io.mjs';
import { pyFloat, pyFloatRepr, PyFloat } from '../../_shared/node/pyjson.mjs';
import { pyReprStr } from '../../_shared/node/pyrepr.mjs';
import { writeZip } from './_zip.mjs';

export const MAX_COLUMNS = 26;

const M = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// XML 1.0 이 문자로 허용하지 않는 것: 제어 문자(0x00~0x08, 0x0B, 0x0C, 0x0E~0x1F), U+FFFE·U+FFFF, 짝 없는 서로게이트.
const XML_FORBIDDEN_CHAR = '[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\uFFFE\\uFFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]';
const XML_FORBIDDEN_RE = new RegExp(XML_FORBIDDEN_CHAR, 'g');
// 밑줄 뒤에 `x` + 16진 4자리가 오고 그 뒤가 `_` 이거나 곧 `_xHHHH_` 로 바뀔 금지 문자이면, 그 밑줄은 이스케이프 표기의 시작으로 읽힌다.
const XSTRING_LOOKALIKE_RE = new RegExp(`_(?=x[0-9A-Fa-f]{4}(?:_|${XML_FORBIDDEN_CHAR}))`, 'g');

/**
 * XLSX 문자열 이스케이프(ISO 29500 ST_Xstring). XML 에 쓸 수 없는 문자는 `_xHHHH_`(대문자 16진 4자리, UTF-16 코드 단위)로 바꾸고,
 * 원문에 이미 있는 `_xHHHH_` 모양의 글자는 앞 밑줄을 `_x005F_` 로 바꿔 되돌릴 때 같은 글자로 돌아오게 한다. python 원본은 이 처리가 없어
 * 제어 문자가 그대로 XML 에 들어가 엑셀이 파일을 열지 못했다. xlsx-read.mjs 의 `decode_xstring` 이 이 변환을 되돌린다.
 */
export function xstring_escape(s) {
  return s
    .replace(XSTRING_LOOKALIKE_RE, '_x005F_')
    .replace(XML_FORBIDDEN_RE, (ch) => `_x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
}

/** python `html.escape(s)` (quote=True). `&` 를 먼저 바꾼다. */
export function html_escape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ---- python 값 표기 (str(v)·repr(v)) ----
// JSON 해석기가 정수는 bigint, 실수는 PyFloat 로 돌려주므로 int/float 구분이 유지된다.
// 직접 부르는 JS 값은 정수형 number → int, 그 밖의 number → float(정수형 float 은 pyFloat(1) 로 감싼다).

function pyFloatStr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  return pyFloatRepr(x);
}

function isNumberCell(v) {
  return typeof v === 'bigint' || typeof v === 'number' || v instanceof PyFloat;
}

/** python `f'{v}'` — 숫자 셀용 */
export function py_number_str(v) {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof PyFloat) return pyFloatStr(v.value);
  if (Number.isInteger(v)) return BigInt(v).toString();
  return pyFloatStr(v);
}

function pyRepr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return pyReprStr(v);
  if (isNumberCell(v)) return py_number_str(v);
  if (Array.isArray(v)) return `[${v.map(pyRepr).join(', ')}]`;
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v);
  return `{${entries.map(([k, x]) => `${pyReprStr(k)}: ${pyRepr(x)}`).join(', ')}}`;
}

/** python `str(v)` — 문자열 셀용 */
export function py_str(v) {
  return typeof v === 'string' ? v : pyRepr(v);
}

/** 열 번호(0 시작) → 열 이름. 26열(A~Z)까지만 허용한다. */
function col_name(c) {
  if (c >= MAX_COLUMNS) throw new RangeError(`열이 ${MAX_COLUMNS}개(A~Z)를 넘습니다: ${c + 1}번째 열`);
  return String.fromCharCode(65 + c);
}

/**
 * rows → xlsx 파트 목록 `[{name, data}]` (python `write_xlsx` 가 `z.writestr` 하는 순서와 내용 그대로).
 * @param {Array<Array<*>>} rows rows[0] = 헤더, 셀 값은 문자열 또는 숫자
 */
export function build_xlsx_parts(rows) {
  const ss = [];
  const idx = new Map();
  const body = [];
  const sid = (v) => {
    if (!idx.has(v)) {
      idx.set(v, ss.length);
      ss.push(v);
    }
    return idx.get(v);
  };
  rows.forEach((row, ri) => {
    if (!Array.isArray(row)) throw new TypeError(`${ri + 1}번째 행이 배열이 아닙니다`);
    const r = ri + 1;
    const cs = [];
    row.forEach((v, c) => {
      const ref = `${col_name(c)}${r}`;
      if (isNumberCell(v)) {
        cs.push(`<c r="${ref}"><v>${py_number_str(v)}</v></c>`);
      } else {
        cs.push(`<c r="${ref}" t="s"><v>${sid(py_str(v))}</v></c>`);
      }
    });
    body.push(`<row r="${r}">${cs.join('')}</row>`);
  });
  const sst = ss.map((s) => `<si><t>${html_escape(xstring_escape(s))}</t></si>`).join('');
  return [
    {
      name: '[Content_Types].xml',
      data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0"?><workbook xmlns="${M}" xmlns:r="${R}"><sheets><sheet name="WBS" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: `<?xml version="1.0"?><worksheet xmlns="${M}"><sheetData>${body.join('')}</sheetData></worksheet>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      data: `<?xml version="1.0"?><sst xmlns="${M}" count="${ss.length}" uniqueCount="${ss.length}">${sst}</sst>`,
    },
  ];
}

/** rows → xlsx 파일 바이트 */
export function build_xlsx(rows) {
  return writeZip(build_xlsx_parts(rows));
}

/** python `write_xlsx(path, rows)` 대응 */
export function write_xlsx(file, rows) {
  const bytes = build_xlsx(rows);
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, bytes);
}

// ---- 입력 JSON 해석 (정수·실수 구분 유지: python json.loads 와 같은 값 모델) ----
class JsonError extends Error {}

/** 정수는 bigint, 실수(소수점·지수·NaN·Infinity)는 PyFloat, 객체는 Map 으로 돌려주는 JSON 해석기. python json.loads 문법. */
export function parse_rows_json(text) {
  let i = 0;
  const n = text.length;
  const fail = (msg) => {
    throw new JsonError(`JSON 해석 오류: ${msg} (위치 ${i})`);
  };
  const ws = () => {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const str = () => {
    const start = i;
    i++; // 여는 따옴표
    while (i < n) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        try {
          return JSON.parse(text.slice(start, i));
        } catch {
          i = start;
          return fail('잘못된 문자열');
        }
      }
      if (ch === '\\') i += 2;
      else i++;
    }
    i = start;
    return fail('문자열이 닫히지 않음');
  };
  const NUM = /-?(?:0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?/y;
  const value = () => {
    ws();
    const ch = text[i];
    if (ch === '"') return str();
    if (ch === '[') {
      i++;
      const out = [];
      ws();
      if (text[i] === ']') {
        i++;
        return out;
      }
      for (;;) {
        out.push(value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') {
          i++;
          return out;
        }
        return fail("',' 또는 ']' 가 필요함");
      }
    }
    if (ch === '{') {
      i++;
      const out = new Map();
      ws();
      if (text[i] === '}') {
        i++;
        return out;
      }
      for (;;) {
        ws();
        if (text[i] !== '"') return fail('키는 큰따옴표 문자열이어야 함');
        const k = str();
        ws();
        if (text[i] !== ':') return fail("':' 가 필요함");
        i++;
        out.set(k, value());
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') {
          i++;
          return out;
        }
        return fail("',' 또는 '}' 가 필요함");
      }
    }
    if (text.startsWith('true', i)) return (i += 4), true;
    if (text.startsWith('false', i)) return (i += 5), false;
    if (text.startsWith('null', i)) return (i += 4), null;
    if (text.startsWith('NaN', i)) return (i += 3), pyFloat(NaN);
    if (text.startsWith('Infinity', i)) return (i += 8), pyFloat(Infinity);
    if (text.startsWith('-Infinity', i)) return (i += 9), pyFloat(-Infinity);
    NUM.lastIndex = i;
    const m = NUM.exec(text);
    if (!m) return fail('값이 필요함');
    i += m[0].length;
    if (m[1] !== undefined || m[2] !== undefined) return pyFloat(Number(m[0]));
    return BigInt(m[0]);
  };
  const v = value();
  ws();
  if (i < n) fail('JSON 뒤에 불필요한 내용이 있음');
  return v;
}

export async function main(argv) {
  const cli = parseCli(argv, {
    prog: 'xlsx-write.mjs',
    description: '행 배열 JSON([[헤더…],[셀…],…])을 .xlsx 로 쓴다. 입력은 파일 경로 또는 표준입력.',
    options: { out: { type: 'string', required: true, help: '출력 .xlsx 경로' } },
    positionals: [{ name: 'rows', required: false, help: '행 배열 JSON 파일 (없으면 표준입력)' }],
  });
  if (!cli) return;
  let text;
  try {
    text = cli.positionals.rows !== undefined
      ? fs.readFileSync(cli.positionals.rows, 'utf8').replace(/^\uFEFF/, '')
      : await readStdinText();
  } catch (e) {
    process.stderr.write(`입력을 읽을 수 없습니다: ${e.message}\n`);
    return finish(VIOLATION);
  }
  try {
    const rows = parse_rows_json(text);
    if (!Array.isArray(rows)) throw new JsonError('최상위 값은 행 배열이어야 합니다');
    write_xlsx(cli.values.out, rows);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return finish(VIOLATION);
  }
  return finish(OK);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMain()) await main(process.argv.slice(2));
