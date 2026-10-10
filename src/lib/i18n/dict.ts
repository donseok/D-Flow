// 화면 문구 사전 진입점 — 제품은 한국어 전용이다(2026-10-10 결정). 사전은 "키 → 한국어 문구" 문자열 표다.
// 화면·액션은 문구를 리터럴로 흩지 않고 여기서 꺼낸다(tests/invariants/i18n-no-korean-literals.test.ts).
// Locale 과 t(locale, key) 의 첫 인자는 호출부(수백 곳)를 건드리지 않으려고 남긴 자리다 — 값은 항상 'ko' 다.
import { KO } from './dict/ko'

export type Locale = 'ko'
export type DictKey = keyof typeof KO

/** 문구 조회 — 사전에 없는 키는 키를 그대로 돌려준다 */
export function t(_locale: Locale, key: DictKey): string {
  return (KO as Record<string, string>)[key] ?? key
}
