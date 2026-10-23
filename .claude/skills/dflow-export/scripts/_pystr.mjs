// _pystr.mjs — python str 의 공백 의미를 JS 에서 그대로 쓰기 위한 작은 도구.
//
// JS 의 `\s`·`trim()` 은 python 과 공백 집합이 다르다.
//   python: \t \n \v \f \r, \x1c-\x1f, 공백, \x85, \xa0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000
//   JS:     위에서 \x1c-\x1f·\x85 가 빠지고 ﻿(BOM)가 더해진다.
// wbs 문서의 `str.strip()`·`\s` 를 바이트까지 맞춰야 하는 이식 모듈이 함께 쓴다.
//   - PY_SPACE_CLASS: 정규식 소스에 끼워 넣는 문자 클래스 안쪽 조각(`[${PY_SPACE_CLASS}]`, 부정은 `[^${PY_SPACE_CLASS}]`)
//   - pyStrip / pyLstrip / pyRstrip: `str.strip()` 대응(인자 없는 호출만)

export const PY_SPACE_CLASS =
  '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

const LEFT = new RegExp(`^[${PY_SPACE_CLASS}]+`);
const SPACE = new RegExp(`[${PY_SPACE_CLASS}]`);

export function pyLstrip(s) {
  return s.replace(LEFT, '');
}

// 끝에서부터 훑는다(`[공백]+$` 정규식은 중간에 긴 공백 덩어리가 있으면 시간이 제곱으로 늘어난다).
export function pyRstrip(s) {
  let end = s.length;
  while (end > 0 && SPACE.test(s[end - 1])) end -= 1;
  return end === s.length ? s : s.slice(0, end);
}

export function pyStrip(s) {
  return pyRstrip(pyLstrip(s));
}
