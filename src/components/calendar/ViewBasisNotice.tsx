// 전역 화면(/projects·/meetings·/minutes·/portfolio)의 '기준 시간대' 한 줄(SP5 A — A-5 리뷰 O2). 소속 워크스페이스가 여럿인데
// 달력이 서로 다르거나 하나라도 읽지 못해 제품 기본값(UTC)으로 '오늘'·달력을 계산했을 때만 그린다 — 그 사실을 화면에 적어야
// 'UTC 로 계산'이 위장이 아니다(3원칙 ① 표시 = 로깅, 원인 로그는 load.ts). 소속 달력(member)·소속 없음(none)은 그리지 않는다.
// 서버·클라이언트 어디서나 쓸 수 있다(상태 없음).
import type { MemberCalendarBasis } from '@/lib/calendar/load'
import { t, type Locale } from '@/lib/i18n/dict'

export function viewBasisText(basis: MemberCalendarBasis, timeZone: string, locale: Locale): string | null {
  if (basis === 'differs') return t(locale, 'calendar.basisDiffers').replace('{tz}', timeZone)
  if (basis === 'unreadable') return t(locale, 'calendar.basisUnreadable').replace('{tz}', timeZone)
  return null
}

export function ViewBasisNotice({ basis, timeZone, locale, className = '' }: {
  basis: MemberCalendarBasis; timeZone: string; locale: Locale; className?: string
}) {
  const text = viewBasisText(basis, timeZone, locale)
  if (!text) return null
  return <p role="note" data-view-basis={basis} className={`text-xs text-ink-muted ${className}`.trim()}>{text}</p>
}
