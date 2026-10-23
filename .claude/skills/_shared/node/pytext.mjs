// python 문자열·정규식과 JS 의 차이를 메우는 작은 도구 모음.

/**
 * python 문자열 비교(코드포인트 순)와 같은 비교 함수.
 * JS 의 `<` 는 UTF-16 코드 유닛 순이라 U+E000~U+FFFF 와 비 BMP 문자(서로게이트 쌍)의
 * 순서가 python 과 달라진다. 정렬은 `.sort(compareCodePoint)` 를 쓴다(localeCompare 금지).
 */
export function compareCodePoint(a, b) {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ca = a.charCodeAt(i);
    const cb = b.charCodeAt(i);
    if (ca !== cb) {
      const sa = ca >= 0xd800 && ca <= 0xdfff;
      const sb = cb >= 0xd800 && cb <= 0xdfff;
      // 한쪽만 서로게이트(=코드포인트 0x10000 이상)이고 상대가 0xE000 이상 BMP 면 서로게이트 쪽이 크다.
      if (sa && !sb && cb >= 0xe000) return 1;
      if (sb && !sa && ca >= 0xe000) return -1;
      return ca < cb ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

const LINE_BREAK = /\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/g;

/**
 * python `str.splitlines(keepends)` 와 같은 분할.
 * 분할 문자: \n \r \r\n \v \f \x1c \x1d \x1e \x85 \u2028 \u2029.
 * 마지막 줄바꿈 뒤에 빈 요소를 만들지 않고, 빈 문자열은 [] 를 돌려준다.
 */
export function splitlinesPy(text, keepends = false) {
  const out = [];
  let start = 0;
  LINE_BREAK.lastIndex = 0;
  let m;
  while ((m = LINE_BREAK.exec(text)) !== null) {
    const stop = m.index + m[0].length;
    out.push(text.slice(start, keepends ? stop : m.index));
    start = stop;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

const cache = new Map();
function derive(re, kind) {
  const flags = [...new Set(re.flags.replace(/[gy]/g, ''))].join('') + 'y';
  const key = `${kind}\u0000${re.source}\u0000${flags}`;
  let r = cache.get(key);
  if (!r) {
    const src = kind === 'full' ? `(?:${re.source})(?![\\s\\S])` : re.source;
    r = new RegExp(src, flags);
    cache.set(key, r);
  }
  return r;
}

function asRegExp(re) {
  return typeof re === 'string' ? pyRe(re) : re;
}

/**
 * python `re.match(pattern, s)`: 문자열 시작에서만 일치한다. 일치하면 exec 결과, 아니면 null.
 * `^(?:…)` 로 감싸면 m 플래그에서 줄 시작마다 일치해 버리므로, 소스는 그대로 두고
 * 고정(sticky `y`) 플래그 + lastIndex=0 으로 "시작 위치에서만" 시도한다(m 플래그에도 안전).
 */
export function pyMatch(re, s) {
  const r = derive(asRegExp(re), 'match');
  r.lastIndex = 0;
  return r.exec(s);
}

/** python `re.fullmatch`: 문자열 전체가 일치해야 한다. */
export function pyFullMatch(re, s) {
  const r = derive(asRegExp(re), 'full');
  r.lastIndex = 0;
  return r.exec(s);
}

/**
 * python 문법 정규식 소스를 JS RegExp 로 변환한다.
 *  - `(?P<name>…)` → `(?<name>…)`, `(?P=name)` → `\k<name>`, `(?#…)` 주석 제거
 *  - 선행 인라인 플래그 `(?i)` `(?s)` `(?m)` (복수 가능, `a`·`u` 는 무시) → JS 플래그
 *  - `\Z` → `(?![\s\S])`, `\A` → `(?<![\s\S])` (m 플래그에서도 정확), `\a` → `\x07`
 *  - 클래스 첫머리 `[]abc]`, `[^]abc]` 의 리터럴 `]` 이스케이프
 *  - python `$`(m 없음)는 끝 또는 마지막 `\n` 앞에서 일치 → `(?=\n?(?![\s\S]))`
 *  - python `.`(s 없음)는 `\n` 만 제외 → `[^\n]` (JS `.` 는 \r \u2028 \u2029 도 제외)
 *  - opts.unicode=true 면 u 플래그를 켜고 `\w \W \d \D` 를 유니코드(`[\p{L}\p{N}_]` `\p{Nd}`)로 변환
 *    (python 3 기본 동작. u 모드는 `\-` 같은 불필요 이스케이프를 거부하므로 기본값은 false).
 * 지원하지 못하는 구문(`x` 플래그, `(?(n)…)` 조건, `(?i:…)` 중간 플래그, `\N{…}`, `\U…`,
 * `(?P>…)`, 클래스 안의 `\A \Z \W \D`)은 Error 를 던진다.
 * 한계: m 플래그의 `^`·`$` 는 JS 가 \r \u2028 \u2029 도 줄 끝으로 본다. `\b` 는 ASCII 기준 그대로다.
 */
export function pyRe(source, flags = '', opts = {}) {
  const unicode = opts.unicode === true;
  const f = new Set(flags);
  let src = source;

  // 선행 인라인 플래그
  for (;;) {
    const m = /^\(\?([A-Za-z]+)\)/.exec(src);
    if (!m) break;
    for (const c of m[1]) {
      if (c === 'i' || c === 'm' || c === 's') f.add(c);
      else if (c === 'a' || c === 'u') continue;
      else throw new Error(`pyRe: 지원하지 않는 인라인 플래그 (?${c})`);
    }
    src = src.slice(m[0].length);
  }
  if (unicode) f.add('u');
  const multiline = f.has('m');
  const dotall = f.has('s');

  const WORD = '\\p{L}\\p{N}_';
  let out = '';
  let i = 0;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined) throw new Error('pyRe: 끝에 남은 역슬래시');
      i += 2;
      if (n === 'N' || n === 'U') throw new Error(`pyRe: 지원하지 않는 이스케이프 \\${n}`);
      if (inClass) {
        if (n === 'A' || n === 'Z') throw new Error(`pyRe: 클래스 안의 \\${n} 는 잘못된 구문`);
        if (unicode && n === 'w') out += WORD;
        else if (unicode && n === 'd') out += '\\p{Nd}';
        else if (unicode && (n === 'W' || n === 'D')) throw new Error(`pyRe: 클래스 안의 \\${n} 는 unicode 변환 불가`);
        else if (n === 'a') out += '\\x07';
        else out += c + n;
      } else if (n === 'A') out += '(?<![\\s\\S])';
      else if (n === 'Z') out += '(?![\\s\\S])';
      else if (n === 'a') out += '\\x07';
      else if (unicode && n === 'w') out += `[${WORD}]`;
      else if (unicode && n === 'W') out += `[^${WORD}]`;
      else if (unicode && n === 'd') out += '\\p{Nd}';
      else if (unicode && n === 'D') out += '\\P{Nd}';
      else out += c + n;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      i++;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += '[';
      i++;
      if (src[i] === '^') { out += '^'; i++; }
      if (src[i] === ']') { out += '\\]'; i++; }
      continue;
    }
    if (c === '(' && src[i + 1] === '?') {
      if (src.startsWith('(?P<', i)) { out += '(?<'; i += 4; continue; }
      if (src.startsWith('(?P=', i)) {
        const j = src.indexOf(')', i);
        if (j < 0) throw new Error('pyRe: (?P=name) 닫는 괄호 없음');
        out += `\\k<${src.slice(i + 4, j)}>`;
        i = j + 1;
        continue;
      }
      if (src.startsWith('(?#', i)) {
        const j = src.indexOf(')', i);
        if (j < 0) throw new Error('pyRe: (?#…) 닫는 괄호 없음');
        i = j + 1;
        continue;
      }
      if (/^\(\?(?::|=|!|<=|<!)/.test(src.slice(i, i + 4))) { out += '(?'; i += 2; continue; }
      throw new Error(`pyRe: 지원하지 않는 구문 ${src.slice(i, i + 6)}`);
    }
    if (c === '$' && !multiline) { out += '(?=\\n?(?![\\s\\S]))'; i++; continue; }
    if (c === '.' && !dotall) { out += '[^\\n]'; i++; continue; }
    out += c;
    i++;
  }
  // 위에서 `.` 를 [^\n] 로 바꿨으므로 s 플래그는 JS 에 넘길 필요가 없지만, 넘겨도 무해하다.
  return new RegExp(out, [...f].join(''));
}
