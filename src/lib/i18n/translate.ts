// lib 의 문구 생성 함수가 화면 언어를 따르게 하는 얇은 도우미.
// 문구를 만드는 순수 함수는 번역 함수(Translate)를 선택 인자로 받는다 — 화면은 `useLocale().t`(서버 화면은 `(k) => t(locale, k)`)를 넘기고,
// 넘기지 않는 호출부(색인 본문·알림·내보내기·AI 프롬프트 등 저장되는 글자)는 종전의 한국어 그대로다(koTranslate).
import { t, type DictKey, type Locale } from './dict'

export type Translate = (key: DictKey) => string

/** 한국어 고정 — 번역 함수를 넘기지 않은 호출부의 기본값(저장되는 글자는 로캘을 따르지 않는다) */
export const koTranslate: Translate = (key) => t('ko', key)

/** 서버 화면용 — 로캘을 묶은 번역 함수 */
export const translatorFor = (locale: Locale): Translate => (key) => t(locale, key)

/** 사전 문구의 {이름} 자리를 한 번에 채운다 — 값에 든 `$`·`{…}` 는 다시 해석하지 않는다(사용자 데이터가 들어온다). */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** 고정 문구(코드 겸용 상수) → 요청의 화면 언어. 표는 문구 → 사전 키(src/lib/wbs/actionErrors.ts 의 KEY 꼴)이고, 표에 없는 문구(원문·동적 문구)는 받은 그대로다. */
export function textBy<K extends string>(t: (key: K) => string, table: Readonly<Record<string, K>>, message: string): string {
  return Object.hasOwn(table, message) ? t(table[message]) : message
}
