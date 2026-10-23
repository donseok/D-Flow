#!/usr/bin/env node
// xlsx-read.mjs — .xlsx 첫 시트를 헤더 기준 객체 배열 JSON 으로 읽는다 (dflow-wbs SKILL.md 「포맷별 읽기」의 python 표준 라이브러리 리더 블록의 node 이식).
//
// 사용: node xlsx-read.mjs <파일.xlsx>
// 출력: stdout 에 한 줄 JSON `[{"헤더": "값", …}, …]` (python `json.dumps(…, ensure_ascii=False)` 와 바이트까지 같음, 들여쓰기 없음) + 줄바꿈 하나.
//   모든 셀 값은 문자열이다(숫자 셀도 `<v>` 의 원문 그대로 — 12 는 "12", 1.5E-3 은 "1.5E-3"). 빈 셀은 "".
// 종료 코드: 0 정상, 1 읽기 오류(zip 이 깨짐·시트 없음·XML 오류 등, stderr 에 한 줄 사유), 2 사용 오류.
//
// python 블록과 같은 규칙(줄 단위로 옮김)
//   - sharedStrings: `xl/sharedStrings.xml` 이 있으면 루트의 자식마다 안의 모든 `<t>` 텍스트(서식 run·`rPh` 읽기 포함)를 이어 붙인다.
//   - 시트: `xl/worksheets/sheet` 로 시작하는 이름을 코드포인트 순으로 정렬한 첫 번째. (`workbook.xml` 의 시트 순서는 보지 않는다.)
//   - 열 이름은 셀의 `r` 속성(`B3`)에서 앞쪽 대문자 부분(`B`). `t="s"` 면 sharedStrings 색인, `t="inlineStr"` 이면 셀 안의 모든 `<t>`, 그 밖이면 `<v>` 텍스트 원문.
//   - 첫 행이 헤더. 열은 `(길이, 이름)` 순(A…Z, AA…)으로 정렬하고 헤더 행에 있는 열만 쓴다. 데이터 행에 없는 열은 "".
// python 판과 다른 점(알고 둔 것)
//   - 오류 문구: python 은 예외 역추적, 이 판은 stderr 한 줄(종료 코드는 둘 다 1).
//   - XML 해석기는 직접 구현했다(요소·속성·네임스페이스 접두어·CDATA·문자 참조·기본 5 엔티티). DTD 로 정의한 엔티티는 지원하지 않는다(오류).
//     UTF-8·UTF-16(BOM)과 선언된 단일 바이트 인코딩을 읽는다. 문서 안 줄바꿈(\r\n·\r)은 python(expat)처럼 \n 으로 정규화한다.
//   - XLSX 문자열 이스케이프 `_xHHHH_`(엑셀이 제어 문자 등에 씀)를 되돌린다(공유 문자열·inlineStr·`t="str"` 셀). python 블록은 되돌리지 않고 글자 그대로 냈다.
//     `_x005F_x0041_` 은 글자 그대로의 `_x0041_` 이 된다.
//   - `<v/>` 처럼 값이 빈 비문자열 셀은 python 이 null 을 내고 이 판도 null 을 낸다(같음). 헤더가 null 이면 키는 "null".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OK, VIOLATION, finish, parseCli } from '../../_shared/node/args.mjs';
import { pyJsonDumps } from '../../_shared/node/pyjson.mjs';
import { compareCodePoint } from '../../_shared/node/pytext.mjs';
import { readZip } from './_zip.mjs';

export const NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}';

class XlsxError extends Error {}

// ---- 최소 XML 해석기 (xml.etree.ElementTree.fromstring 과 같은 모양의 트리) ----
// 요소: {tag: '{uri}local' 또는 'local', attrib: Map, text: 첫 자식 전의 문자 데이터, children: []}

const NAME_START = /[:A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]/;
const NAME_RE = /[^\s/>=<"'&]+/y;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// XML 1.0 에서 허용하지 않는 문자(제어 문자, 짝 없는 서로게이트, U+FFFE·FFFF)
const BAD_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function decode_xml_bytes(buf) {
  let enc = 'utf-8';
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    start = 3;
  } else if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    enc = 'utf-16le';
    start = 2;
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    enc = 'utf-16be';
    start = 2;
  } else {
    const head = buf.subarray(0, 200).toString('latin1');
    const m = /^<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/.exec(head);
    if (m) enc = m[1].toLowerCase();
  }
  if (enc === 'utf8') enc = 'utf-8';
  if (enc === 'utf-16') throw new XlsxError('XML 인코딩 utf-16 은 BOM 이 있어야 합니다');
  try {
    return new TextDecoder(enc, { fatal: true, ignoreBOM: true }).decode(buf.subarray(start));
  } catch {
    throw new XlsxError(`XML 을 ${enc} 로 읽을 수 없습니다`);
  }
}

function decode_entities(s, where) {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z_][\w.-]*);)?/g, (all, body) => {
    if (body === undefined) throw new XlsxError(`XML 에 해석할 수 없는 & 가 있습니다 (${where})`);
    if (body[0] === '#') {
      const cp = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      const ch = Number.isFinite(cp) && cp <= 0x10ffff ? String.fromCodePoint(cp) : '￾';
      if (BAD_CHARS.test(ch) || cp === 0) throw new XlsxError(`XML 문자 참조가 올바르지 않습니다: ${all}`);
      return ch;
    }
    if (!(body in ENTITIES)) throw new XlsxError(`XML 엔티티를 알 수 없습니다: ${all}`);
    return ENTITIES[body];
  });
}

/** xml.etree.ElementTree.fromstring 대응. 입력은 바이트(Buffer). */
export function parse_xml(buf) {
  const src = decode_xml_bytes(buf).replace(/\r\n?/g, '\n');
  if (BAD_CHARS.test(src)) throw new XlsxError('XML 에 허용되지 않는 문자가 있습니다');
  let i = 0;
  const n = src.length;
  const fail = (msg) => {
    throw new XlsxError(`XML 해석 오류: ${msg} (위치 ${i})`);
  };

  const skipMisc = () => {
    // 공백·주석·처리 명령·DOCTYPE 을 건너뛴다(루트 앞뒤).
    for (;;) {
      while (i < n && /\s/.test(src[i])) i++;
      if (src.startsWith('<?', i)) {
        const e = src.indexOf('?>', i + 2);
        if (e < 0) fail('처리 명령이 닫히지 않음');
        i = e + 2;
      } else if (src.startsWith('<!--', i)) {
        const e = src.indexOf('-->', i + 4);
        if (e < 0) fail('주석이 닫히지 않음');
        i = e + 3;
      } else if (src.startsWith('<!DOCTYPE', i)) {
        let depth = 0;
        let j = i + 9;
        for (; j < n; j++) {
          const c = src[j];
          if (c === '[') depth++;
          else if (c === ']') depth--;
          else if (c === '>' && depth <= 0) break;
        }
        if (j >= n) fail('DOCTYPE 이 닫히지 않음');
        i = j + 1;
      } else {
        return;
      }
    }
  };

  skipMisc();
  if (src[i] !== '<') fail('루트 요소가 없음');

  // 네임스페이스 범위 스택: 접두어('' = 기본) → uri
  const nsStack = [new Map([['xml', 'http://www.w3.org/XML/1998/namespace']])];
  const lookup = (prefix) => {
    for (let k = nsStack.length - 1; k >= 0; k--) if (nsStack[k].has(prefix)) return nsStack[k].get(prefix);
    return undefined;
  };
  const stack = []; // 열린 요소 {el, qname}
  let root = null;

  const readName = () => {
    NAME_RE.lastIndex = i;
    const m = NAME_RE.exec(src);
    if (!m || !NAME_START.test(m[0][0])) fail('이름이 올바르지 않음');
    i += m[0].length;
    return m[0];
  };

  while (i < n) {
    if (root && stack.length === 0) {
      skipMisc();
      if (i < n) fail('루트 요소 뒤에 내용이 있음');
      break;
    }
    if (src[i] !== '<') {
      const e = src.indexOf('<', i);
      const end = e < 0 ? n : e;
      const raw = src.slice(i, end);
      if (stack.length === 0) fail('루트 요소 밖의 텍스트');
      const top = stack[stack.length - 1];
      if (raw.includes(']]>')) fail("']]>' 는 텍스트에 쓸 수 없음");
      if (!top.sawChild) top.el.text += decode_entities(raw, '텍스트');
      i = end;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i + 4);
      if (e < 0) fail('주석이 닫히지 않음');
      i = e + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const e = src.indexOf(']]>', i + 9);
      if (e < 0) fail('CDATA 가 닫히지 않음');
      if (stack.length === 0) fail('루트 요소 밖의 CDATA');
      const top = stack[stack.length - 1];
      if (!top.sawChild) top.el.text += src.slice(i + 9, e);
      i = e + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const e = src.indexOf('?>', i + 2);
      if (e < 0) fail('처리 명령이 닫히지 않음');
      i = e + 2;
      continue;
    }
    if (src.startsWith('</', i)) {
      i += 2;
      const qname = readName();
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] !== '>') fail("종료 태그에 '>' 가 필요함");
      i++;
      const top = stack.pop();
      if (!top || top.qname !== qname) fail(`종료 태그가 짝이 맞지 않음: </${qname}>`);
      nsStack.pop();
      continue;
    }
    if (src.startsWith('<!', i)) fail('지원하지 않는 선언');
    // 시작 태그
    i++;
    const qname = readName();
    const rawAttrs = [];
    let selfClose = false;
    for (;;) {
      const before = i;
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] === '>') {
        i++;
        break;
      }
      if (src.startsWith('/>', i)) {
        i += 2;
        selfClose = true;
        break;
      }
      if (i === before) fail('속성 앞에 공백이 필요함');
      const an = readName();
      while (i < n && /\s/.test(src[i])) i++;
      if (src[i] !== '=') fail("속성에 '=' 가 필요함");
      i++;
      while (i < n && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q !== '"' && q !== "'") fail('속성 값은 따옴표로 감싸야 함');
      const e = src.indexOf(q, i + 1);
      if (e < 0) fail('속성 값이 닫히지 않음');
      const rawVal = src.slice(i + 1, e);
      if (rawVal.includes('<')) fail("속성 값에 '<' 를 쓸 수 없음");
      // 속성 값 정규화: 탈자 공백 문자(\t \n)는 공백으로
      rawAttrs.push([an, decode_entities(rawVal.replace(/[\t\n]/g, ' '), '속성')]);
      i = e + 1;
    }
    // 네임스페이스 선언 처리
    const scope = new Map();
    const plain = [];
    for (const [an, av] of rawAttrs) {
      if (an === 'xmlns') scope.set('', av);
      else if (an.startsWith('xmlns:')) scope.set(an.slice(6), av);
      else plain.push([an, av]);
    }
    nsStack.push(scope);
    const colon = qname.indexOf(':');
    let tag;
    if (colon >= 0) {
      const uri = lookup(qname.slice(0, colon));
      if (uri === undefined) fail(`접두어가 선언되지 않음: ${qname}`);
      tag = `{${uri}}${qname.slice(colon + 1)}`;
    } else {
      const uri = lookup('');
      tag = uri ? `{${uri}}${qname}` : qname;
    }
    const attrib = new Map();
    for (const [an, av] of plain) {
      const c = an.indexOf(':');
      let key = an;
      if (c >= 0) {
        const uri = lookup(an.slice(0, c));
        if (uri === undefined) fail(`접두어가 선언되지 않음: ${an}`);
        key = `{${uri}}${an.slice(c + 1)}`;
      }
      if (attrib.has(key)) fail(`속성이 중복됨: ${an}`);
      attrib.set(key, av);
    }
    const el = { tag, attrib, text: '', children: [] };
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      top.el.children.push(el);
      top.sawChild = true;
    } else {
      if (root) fail('루트 요소가 둘 이상');
      root = el;
    }
    if (selfClose) {
      nsStack.pop();
    } else {
      stack.push({ el, qname, sawChild: false });
    }
  }
  if (stack.length > 0) fail('닫히지 않은 요소가 있음');
  if (!root) fail('루트 요소가 없음');
  return root;
}

/** ElementTree `el.iter(tag)` — 자기 자신 포함, 문서 순서(전위). */
export function* iter(el, tag) {
  if (el.tag === tag) yield el;
  for (const c of el.children) yield* iter(c, tag);
}

/** ElementTree `el.find(tag)` — 직계 자식 중 첫 번째. */
export function find(el, tag) {
  return el.children.find((c) => c.tag === tag);
}

// ---- python 블록 이식 ----

/**
 * XLSX 문자열 이스케이프(ISO 29500 ST_Xstring) 되돌리기: `_xHHHH_`(16진 4자리, 대소문자 무관)는 해당 UTF-16 코드 단위 한 글자로 바꾼다.
 * 엑셀·xlsx-write.mjs 가 XML 에 쓸 수 없는 문자(제어 문자 등)와 원문의 `_x005F_x0041_`(= 글자 그대로 `_x0041_`)에 쓴다. 왼쪽부터 겹치지 않게 한 번만 바꾼다.
 */
export function decode_xstring(s) {
  if (!s.includes('_x')) return s;
  return s.replace(/_x([0-9A-Fa-f]{4})_/g, (all, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function all_t_text(el) {
  // ''.join(t.text or '' for t in el.iter(NS + 't')) — 이어 붙인 뒤에 `_xHHHH_` 를 되돌린다(조각 경계에 걸친 표기도 읽는다).
  let out = '';
  for (const t of iter(el, `${NS}t`)) out += t.text;
  return decode_xstring(out);
}

/** python `int(str)` 의 십진 해석(공백·부호·밑줄 구분 허용). 실패하면 null. */
function py_int(s) {
  const m = /^\s*([+-]?)(\d+(?:_\d+)*)\s*$/.exec(s);
  if (!m) return null;
  return Number(m[1] + m[2].replace(/_/g, ''));
}

/**
 * xlsx 바이트 → 헤더 기준 객체 배열(`Map` 의 배열, 값은 문자열 또는 null).
 * @param {Buffer} buf
 */
export function read_xlsx(buf) {
  const z = readZip(buf);
  const ss = [];
  if (z.has('xl/sharedStrings.xml')) {
    for (const si of parse_xml(z.read('xl/sharedStrings.xml')).children) ss.push(all_t_text(si));
  }
  const sheets = z.names.filter((nm) => nm.startsWith('xl/worksheets/sheet')).sort(compareCodePoint);
  if (sheets.length === 0) throw new XlsxError('시트(xl/worksheets/sheet*)가 없습니다');
  const rows = [];
  for (const row of iter(parse_xml(z.read(sheets[0])), `${NS}row`)) {
    const vals = new Map();
    for (const c of iter(row, `${NS}c`)) {
      const ref = c.attrib.get('r');
      const m = ref === undefined ? null : /^[A-Z]+/.exec(ref);
      if (!m) throw new XlsxError(`셀의 r 속성이 올바르지 않습니다: ${ref === undefined ? '(없음)' : ref}`);
      const col = m[0];
      const v = find(c, `${NS}v`);
      let txt = v === undefined ? '' : v.text === '' ? null : v.text;
      const t = c.attrib.get('t');
      if (t === 's') {
        const k = txt === null ? null : py_int(txt);
        if (k === null) throw new XlsxError(`공유 문자열 색인이 올바르지 않습니다: ${txt}`);
        const at = k < 0 ? ss.length + k : k;
        if (at < 0 || at >= ss.length) throw new XlsxError(`공유 문자열 색인이 범위를 벗어났습니다: ${k}`);
        txt = ss[at];
      } else if (t === 'inlineStr') {
        txt = all_t_text(c);
      } else if (t === 'str' && txt !== null) {
        txt = decode_xstring(txt); // 수식 결과 문자열 셀(`<v>`)도 같은 이스케이프를 쓴다
      }
      vals.set(col, txt);
    }
    rows.push(vals);
  }
  if (rows.length === 0) throw new XlsxError('행이 없습니다');
  const hdr = rows[0];
  const cols = [...hdr.keys()].sort((a, b) => a.length - b.length || compareCodePoint(a, b));
  return rows.slice(1).map((r) => {
    const o = new Map();
    for (const c of cols) {
      const h = hdr.get(c);
      o.set(h === null ? 'null' : h, r.has(c) ? r.get(c) : '');
    }
    return o;
  });
}

/** python 블록의 `json.dumps(…, ensure_ascii=False)` 와 같은 한 줄 JSON */
export function read_xlsx_json(buf) {
  return pyJsonDumps(read_xlsx(buf), { ensureAscii: false });
}

export function main(argv = process.argv.slice(2)) {
  const cli = parseCli(argv, {
    prog: 'xlsx-read.mjs',
    description: '.xlsx 첫 시트를 헤더 기준 객체 배열 JSON 으로 stdout 에 쓴다.',
    positionals: [{ name: 'file', help: '읽을 .xlsx 파일' }],
  });
  if (!cli) return;
  try {
    const out = read_xlsx_json(fs.readFileSync(cli.positionals.file));
    process.stdout.write(`${out}\n`);
  } catch (e) {
    if (e instanceof XlsxError || e.name === 'ZipError' || e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'EACCES') {
      process.stderr.write(`xlsx-read: ${e.message}\n`);
      return finish(VIOLATION);
    }
    throw e;
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

if (isMain()) main();
