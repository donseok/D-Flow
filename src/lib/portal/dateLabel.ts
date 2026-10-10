import type { Locale } from '@/lib/i18n/dict'
import { intlLocale } from '@/lib/i18n/format'

/**
 * 포털 머리의 날짜 한 줄(SP3b 스펙 §6.1 머리 행 — '9월 29일 화요일'). 순수 함수 — 시간대는 호출부가 화면 워크스페이스의 달력(viewTimezone)에서
 * 준다(판정 R1: 서울 상수를 두지 않는다). 시간대 이름이 아니면 null — 다른 시간대로 대신 그려 날짜를 속이지 않는다.
 */
export function portalDateLabel(date: Date, timeZone: string, locale: Locale): string | null {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, month: 'long', day: 'numeric', weekday: 'long' }).format(date)
  } catch {
    return null
  }
}
