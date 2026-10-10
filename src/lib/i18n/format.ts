// 날짜·숫자 형식 태그 — `Intl.*`·`toLocale*String` 에 넘길 BCP 47 태그의 단일 출처. 제품이 한국어 전용이라 'ko-KR' 하나다.
import type { Locale } from './dict'

export type IntlLocaleTag = 'ko-KR'

const TAG: Readonly<Record<Locale, IntlLocaleTag>> = { ko: 'ko-KR' }

export function intlLocale(locale: Locale = 'ko'): IntlLocaleTag {
  return TAG[locale]
}
