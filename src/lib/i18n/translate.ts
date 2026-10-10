// lib 의 문구 생성 함수가 사전에서 문구를 꺼내게 하는 얇은 도우미.
// 문구를 만드는 순수 함수는 조회 함수(Translate)를 선택 인자로 받는다 — 화면은 `useLocale().t`(서버 화면은 `koTranslate`)를 넘기고,
// 넘기지 않는 호출부(색인 본문·알림·내보내기·AI 프롬프트 등 저장되는 글자)의 기본값도 koTranslate 다. 둘은 같은 글자를 낸다.
import { t, type DictKey } from './dict'

export type Translate = (key: DictKey) => string

/** 조회 함수를 넘기지 않은 호출부의 기본값 */
export const koTranslate: Translate = t

/** 사전 문구의 {이름} 자리를 한 번에 채운다 — 값에 든 `$`·`{…}` 는 다시 해석하지 않는다(사용자 데이터가 들어온다). */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** 고정 문구(코드 겸용 상수) → 사전 문구. 표는 문구 → 사전 키(src/lib/wbs/actionErrors.ts 의 KEY 꼴)이고, 표에 없는 문구(원문·동적 문구)는 받은 그대로다. */
export function textBy<K extends string>(t: (key: K) => string, table: Readonly<Record<string, K>>, message: string): string {
  return Object.hasOwn(table, message) ? t(table[message]) : message
}
