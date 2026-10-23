// _pyjson_loads.mjs — python `json.loads` 와 같은 구문 규칙·같은 오류 문구를 내는 JSON 해석기.
//
// 왜 필요한가: dflow-export 의 python 스크립트는 `except json.JSONDecodeError as e` 로 잡은 오류를
// 그대로 문구에 넣어 stderr 로 낸다(예: `--dev-config-json parse error: Expecting property name
// enclosed in double quotes: line 1 column 2 (char 1)`). JS 의 JSON.parse 오류 문구는 전혀 달라서,
// stderr 까지 python 판과 같게 하려면 python 의 해석 순서와 문구를 따로 옮겨야 한다.
//
// 사용
//   import { pyJsonLoads, PyJSONDecodeError } from './_pyjson_loads.mjs';
//   try { const v = pyJsonLoads(text); } catch (e) { if (e instanceof PyJSONDecodeError) e.message ... }
//   e.message 는 python 의 `str(e)`("<msg>: line L column C (char P)")와 같다. e.msg, e.pos, e.lineno, e.colno 도 있다.
//
// python 판과 다른 점(한계)
//  - 객체는 일반 JS 객체로 돌려준다(정수형 문자열 키는 JS 가 재배치한다). 정수·실수 구분이 없고 2^53 을 넘는 정수는 정밀도를 잃는다.
//  - 오류 위치(char)는 python 처럼 코드포인트 기준으로 환산한다.
//  - 문구는 python 3.9~3.12 의 C 스캐너(_json) 기준이다. 3.13 부터 일부 문구(쉼표 뒤 닫는 괄호)가 바뀌었다.
//  - 깊이 제한(RecursionError)은 흉내 내지 않는다.

export class PyJSONDecodeError extends Error {
  constructor(msg, doc, pos) {
    const pre = doc.slice(0, pos);
    const cp = (s) => [...s].length;
    const nl = pre.lastIndexOf('\n');
    const lineno = (pre.match(/\n/g) ?? []).length + 1;
    const posCp = cp(pre);
    const colno = nl < 0 ? posCp + 1 : cp(pre.slice(nl + 1)) + 1;
    super(`${msg}: line ${lineno} column ${colno} (char ${posCp})`);
    this.name = 'PyJSONDecodeError';
    this.msg = msg;
    this.pos = posCp;
    this.lineno = lineno;
    this.colno = colno;
  }
}

class Stop extends Error {
  constructor(idx) {
    super('StopIteration');
    this.idx = idx;
  }
}

const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDigit = (c) => c !== undefined && c >= '0' && c <= '9';

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

function hex4(s, from) {
  let v = 0;
  for (let i = from; i < from + 4; i++) {
    const d = parseInt(s[i], 16);
    if (!/^[0-9a-fA-F]$/.test(s[i])) return -1;
    v = (v << 4) | d;
  }
  return v;
}

// python C scanner 의 scanstring_unicode. end 는 여는 따옴표 다음 위치. [문자열, 다음 위치] 반환.
function scanString(s, end) {
  const begin = end - 1;
  const len = s.length;
  let out = '';
  for (;;) {
    let next = end;
    let c = '';
    for (; next < len; next++) {
      const d = s[next];
      if (d === '"' || d === '\\') { c = d; break; }
      if (d.charCodeAt(0) <= 0x1f) throw new PyJSONDecodeError('Invalid control character at', s, next);
    }
    if (c !== '"' && c !== '\\') throw new PyJSONDecodeError('Unterminated string starting at', s, begin);
    out += s.slice(end, next);
    next++;
    if (c === '"') return [out, next];
    if (next === len) throw new PyJSONDecodeError('Unterminated string starting at', s, begin);
    const e = s[next];
    if (e !== 'u') {
      end = next + 1;
      if (!Object.prototype.hasOwnProperty.call(ESCAPES, e)) throw new PyJSONDecodeError('Invalid \\escape', s, end - 2);
      out += ESCAPES[e];
    } else {
      next++;
      end = next + 4;
      if (end >= len) throw new PyJSONDecodeError('Invalid \\uXXXX escape', s, next - 1);
      let cc = hex4(s, next);
      if (cc < 0) throw new PyJSONDecodeError('Invalid \\uXXXX escape', s, end - 5);
      next = end;
      if (cc >= 0xd800 && cc <= 0xdbff && end + 6 < len && s[next] === '\\' && s[next + 1] === 'u') {
        const c2 = hex4(s, next + 2);
        const end2 = end + 6;
        if (c2 < 0) throw new PyJSONDecodeError('Invalid \\uXXXX escape', s, end2 - 5);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          out += String.fromCharCode(cc, c2);
          end = end2;
          continue;
        }
      }
      out += String.fromCharCode(cc);
    }
  }
}

function skipWs(s, i) {
  while (i < s.length && isWs(s[i])) i++;
  return i;
}

function setKey(obj, key, value) {
  if (key === '__proto__') Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
  else obj[key] = value;
}

function scanOnce(s, idx) {
  const len = s.length;
  if (idx >= len) throw new Stop(idx);
  const ch = s[idx];
  switch (ch) {
    case '"': return scanString(s, idx + 1);
    case '{': return parseObject(s, idx + 1);
    case '[': return parseArray(s, idx + 1);
    case 'n': if (s.startsWith('null', idx)) return [null, idx + 4]; break;
    case 't': if (s.startsWith('true', idx)) return [true, idx + 4]; break;
    case 'f': if (s.startsWith('false', idx)) return [false, idx + 5]; break;
    case 'N': if (s.startsWith('NaN', idx)) return [NaN, idx + 3]; break;
    case 'I': if (s.startsWith('Infinity', idx)) return [Infinity, idx + 8]; break;
    case '-': if (s.startsWith('-Infinity', idx)) return [-Infinity, idx + 9]; break;
    default:
  }
  return matchNumber(s, idx);
}

function matchNumber(s, start) {
  const len = s.length;
  let idx = start;
  if (s[idx] === '-') {
    idx++;
    if (idx >= len) throw new Stop(start);
  }
  if (s[idx] >= '1' && s[idx] <= '9') {
    idx++;
    while (idx < len && isDigit(s[idx])) idx++;
  } else if (s[idx] === '0') {
    idx++;
  } else {
    throw new Stop(start);
  }
  if (idx < len - 1 && s[idx] === '.' && isDigit(s[idx + 1])) {
    idx += 2;
    while (idx < len && isDigit(s[idx])) idx++;
  }
  if (idx < len - 1 && (s[idx] === 'e' || s[idx] === 'E')) {
    const eStart = idx;
    idx++;
    if (idx < len - 1 && (s[idx] === '-' || s[idx] === '+')) idx++;
    while (idx < len && isDigit(s[idx])) idx++;
    if (!isDigit(s[idx - 1])) idx = eStart;
  }
  return [Number(s.slice(start, idx)), idx];
}

function parseObject(s, idx) {
  const obj = {};
  idx = skipWs(s, idx);
  if (idx >= s.length || s[idx] !== '}') {
    for (;;) {
      if (idx >= s.length || s[idx] !== '"') throw new PyJSONDecodeError('Expecting property name enclosed in double quotes', s, idx);
      const [key, afterKey] = scanString(s, idx + 1);
      idx = skipWs(s, afterKey);
      if (idx >= s.length || s[idx] !== ':') throw new PyJSONDecodeError("Expecting ':' delimiter", s, idx);
      idx = skipWs(s, idx + 1);
      let val;
      [val, idx] = scanOnce(s, idx);
      setKey(obj, key, val);
      idx = skipWs(s, idx);
      if (idx < s.length && s[idx] === '}') break;
      if (idx >= s.length || s[idx] !== ',') throw new PyJSONDecodeError("Expecting ',' delimiter", s, idx);
      idx = skipWs(s, idx + 1);
    }
  }
  return [obj, idx + 1];
}

function parseArray(s, idx) {
  const arr = [];
  idx = skipWs(s, idx);
  if (idx >= s.length || s[idx] !== ']') {
    for (;;) {
      let val;
      [val, idx] = scanOnce(s, idx);
      arr.push(val);
      idx = skipWs(s, idx);
      if (idx < s.length && s[idx] === ']') break;
      if (idx >= s.length || s[idx] !== ',') throw new PyJSONDecodeError("Expecting ',' delimiter", s, idx);
      idx = skipWs(s, idx + 1);
    }
  }
  return [arr, idx + 1];
}

/** python `json.loads(str)` 와 같은 규칙으로 해석한다. 실패하면 PyJSONDecodeError. */
export function pyJsonLoads(text) {
  if (typeof text !== 'string') throw new TypeError('pyJsonLoads: 문자열이 필요함');
  if (text.charCodeAt(0) === 0xfeff) {
    throw new PyJSONDecodeError('Unexpected UTF-8 BOM (decode using utf-8-sig)', text, 0);
  }
  let value;
  let end;
  try {
    [value, end] = scanOnce(text, skipWs(text, 0));
  } catch (e) {
    if (e instanceof Stop) throw new PyJSONDecodeError('Expecting value', text, e.idx);
    throw e;
  }
  end = skipWs(text, end);
  if (end !== text.length) throw new PyJSONDecodeError('Extra data', text, end);
  return value;
}
