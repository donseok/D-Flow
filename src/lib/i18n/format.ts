// 로캘별 날짜·숫자 형식 태그 — `Intl.*`·`toLocale*String` 에 넘길 BCP 47 태그의 단일 출처.
// 화면 사전 locale('ko'|'en')을 받아 형식 태그로 바꾼다. ko 의 출력은 종전의 'ko-KR' 고정과 같다.
import type { Locale } from './dict'

export type IntlLocaleTag = 'ko-KR' | 'en-US'

export function intlLocale(locale: Locale): IntlLocaleTag {
  return locale === 'en' ? 'en-US' : 'ko-KR'
}
