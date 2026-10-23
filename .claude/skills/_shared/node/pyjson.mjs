// python `json.dumps` 와 바이트까지 같은 출력을 내는 직렬화기. 골든 비교의 바탕이다.
//
// 알려진 한계 (JS 값 모델 때문에 구분이 불가능한 경우)
//  1. 정수형 float: JS 에는 int 와 float 구분이 없어 `1.0` 도 `1` 로 출력한다.
//     float 로 출력해야 하면 `pyFloat(1)` 로 감싼다 → `1.0`. (-0 은 int 0 으로 보고 `0` 을 낸다.)
//  2. 정수형 문자열 키("1", "10", "2")를 가진 일반 객체: JS 가 키를 오름차순 정수 순으로
//     재배치한다. 삽입 순서가 필요하면 `Map` 을 넘긴다(Map 은 삽입순 그대로 출력).
//  3. undefined·Set·Date·함수·Symbol 은 python 에 대응이 없어 TypeError 를 던진다.
//  5. 2^53 을 넘는 정수는 JS number 라 정밀도를 잃는다(python int 는 임의 정밀도). 필요하면 BigInt 를 넘기는 방식을 레인에서 정한다.
//  4. NaN·Infinity 는 python 기본(allow_nan=True)처럼 `NaN` `Infinity` `-Infinity` 로 출력한다.

import { compareCodePoint } from './pytext.mjs';

/** python float 로 출력하라는 표시. */
export class PyFloat {
  constructor(value) {
    this.value = Number(value);
  }
}
export const pyFloat = (v) => new PyFloat(v);

/** python `repr(float)` 과 같은 문자열 (json.dumps 가 float 에 쓰는 형식). */
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const neg = x < 0;
  // toExponential() 인자 없음 = 왕복 가능한 최단 자릿수(python repr 과 같은 digits)
  const [mant, e] = Math.abs(x).toExponential().split('e');
  const digits = mant.replace('.', '');
  const exp = parseInt(e, 10);
  let s;
  if (exp < -4 || exp >= 16) {
    // python 은 지수 < -4 또는 >= 16 일 때 지수 표기, 지수는 부호 포함 최소 2자리 (1e-05, 1e+16)
    s = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') +
      'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  } else if (exp >= 0) {
    s = digits.length <= exp + 1
      ? digits.padEnd(exp + 1, '0') + '.0'
      : digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
  } else {
    s = '0.' + '0'.repeat(-exp - 1) + digits;
  }
  return neg ? '-' + s : s;
}

const ESC = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
const RE_ASCII = /[\\"]|[^ -~]/g; // python ESCAPE_ASCII (DEL 0x7f 도 이스케이프)
const RE_PLAIN = /[\x00-\x1f\\"]/g; // python ESCAPE

function encodeString(s, ensureAscii) {
  return '"' + s.replace(ensureAscii ? RE_ASCII : RE_PLAIN, (ch) =>
    ESC[ch] ?? '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
}

function encodeNumber(x) {
  if (Number.isNaN(x) || !Number.isFinite(x)) return pyFloatRepr(x);
  if (Number.isInteger(x)) return BigInt(x).toString(); // -0 도 "0"
  return pyFloatRepr(x);
}

function keyToString(k, ensureAscii) {
  if (typeof k === 'string') return k;
  if (k === true) return 'true';
  if (k === false) return 'false';
  if (k === null) return 'null';
  if (typeof k === 'number') return encodeNumber(k);
  if (typeof k === 'bigint') return k.toString();
  if (k instanceof PyFloat) return pyFloatRepr(k.value);
  throw new TypeError(`pyJsonDumps: 키 형식을 지원하지 않음 (${typeof k})`);
}

function compareKeys(a, b) {
  const ta = typeof a;
  if (ta !== typeof b) throw new TypeError("pyJsonDumps: sortKeys 에 서로 다른 형식의 키가 섞여 있음 (python 도 TypeError)");
  if (ta === 'string') return compareCodePoint(a, b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * python `json.dumps(value, indent=…, ensure_ascii=…, sort_keys=…)` 와 같은 문자열.
 * @param {*} value
 * @param {{indent?: number|string|null, ensureAscii?: boolean, sortKeys?: boolean}} [opts]
 *  indent 가 null 이면 구분자 `", "`·`": "`, 숫자·문자열이면 줄바꿈 들여쓰기(구분자 `","`·`": "`).
 */
export function pyJsonDumps(value, { indent = null, ensureAscii = true, sortKeys = false } = {}) {
  let unit = null;
  if (indent !== null && indent !== undefined) {
    unit = typeof indent === 'number' ? ' '.repeat(Math.max(0, indent)) : String(indent);
  }
  const stack = new Set();

  const wrap = (open, close, parts, level) => {
    if (parts.length === 0) return open + close;
    if (unit === null) return open + parts.join(', ') + close;
    const nl = '\n' + unit.repeat(level + 1);
    return open + nl + parts.join(',' + nl) + '\n' + unit.repeat(level) + close;
  };

  const enc = (v, level) => {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string': return encodeString(v, ensureAscii);
      case 'number': return encodeNumber(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'bigint': return v.toString();
      case 'object': break;
      default: throw new TypeError(`pyJsonDumps: 직렬화할 수 없는 값 (${typeof v})`);
    }
    if (v instanceof PyFloat) return pyFloatRepr(v.value);
    if (v instanceof Date || v instanceof Set || v instanceof RegExp) {
      throw new TypeError(`pyJsonDumps: 직렬화할 수 없는 값 (${v.constructor.name})`);
    }
    if (stack.has(v)) throw new TypeError('pyJsonDumps: 순환 참조');
    stack.add(v);
    try {
      if (Array.isArray(v)) {
        return wrap('[', ']', v.map((x) => enc(x, level + 1)), level);
      }
      let entries;
      if (v instanceof Map) entries = [...v.entries()];
      else entries = Object.keys(v).map((k) => [k, v[k]]);
      if (sortKeys) entries.sort((a, b) => compareKeys(a[0], b[0]));
      const sep = ': ';
      return wrap('{', '}', entries.map(([k, x]) =>
        encodeString(keyToString(k), ensureAscii) + sep + enc(x, level + 1)), level);
    } finally {
      stack.delete(v);
    }
  };
  return enc(value, 0);
}
