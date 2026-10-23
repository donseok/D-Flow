// python `repr(str)` / `repr(list[str])` 와 같은 문자열을 만든다.
// 이식한 도구가 `{name!r}`, `{list}` 형태로 출력하던 자리를 바이트까지 같게 맞추기 위한 헬퍼다.
//  - 따옴표: 작은따옴표가 들어 있고 큰따옴표가 없으면 큰따옴표로 감싼다(그 외는 작은따옴표, 안의 `'` 는 `\'`).
//  - 이스케이프: `\\`, `\t`, `\n`, `\r`, 그 밖의 제어·비출력 문자는 `\xNN`·`\uNNNN`·`\UNNNNNNNN`.
//  - 출력 가능한 비 ASCII 문자(한글·이모지 등)는 그대로 둔다.
// 한계: 출력 가능 여부는 node 의 유니코드 표를 따르므로 python 과 표 버전이 다르면 미할당 문자에서 차이가 날 수 있다.

const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

function escapeChar(ch) {
  const cp = ch.codePointAt(0);
  if (cp < 0x100) return `\\x${cp.toString(16).padStart(2, '0')}`;
  if (cp < 0x10000) return `\\u${cp.toString(16).padStart(4, '0')}`;
  return `\\U${cp.toString(16).padStart(8, '0')}`;
}

/** python `repr(str)` */
export function pyReprStr(s) {
  const text = String(s);
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of text) {
    if (ch === quote || ch === '\\') out += `\\${ch}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch !== ' ' && NON_PRINTABLE.test(ch)) out += escapeChar(ch);
    else out += ch;
  }
  return quote + out + quote;
}

/** python `repr(list[str])`, 예: `['V1', 'V2']` */
export function pyReprStrList(items) {
  return `[${[...items].map(pyReprStr).join(', ')}]`;
}
