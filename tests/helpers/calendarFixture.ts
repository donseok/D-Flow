// 달력 테스트 픽스처(SP5 A 과제 13) — 근무 [1..5] 의 네 달력과 주 규칙 둘. 월요일 회귀를 덮는 테스트는 MON_RULES 를 프로젝트에 준다(D28).
import { calendarOf, type WeekStartRule, type WorkCalendar } from '@/lib/domain/calendar'

export const SUN_RULES: WeekStartRule[] = [{ day: 'sunday', from: null }]
export const MON_RULES: WeekStartRule[] = [{ day: 'monday', from: null }]
const WEEKDAYS = [1, 2, 3, 4, 5] as const

export const calUtcSun: WorkCalendar = calendarOf({ timezone: 'UTC', workingDays: WEEKDAYS, weekStart: SUN_RULES })
export const calUtcMon: WorkCalendar = calendarOf({ timezone: 'UTC', workingDays: WEEKDAYS, weekStart: MON_RULES })
export const calSeoulMon: WorkCalendar = calendarOf({ timezone: 'Asia/Seoul', workingDays: WEEKDAYS, weekStart: MON_RULES })
export const calLaSun: WorkCalendar = calendarOf({ timezone: 'America/Los_Angeles', workingDays: WEEKDAYS, weekStart: SUN_RULES })

/** WorkspaceConfig 리터럴에 펼친다 — 제품 기본값(UTC·일요일·월~금) */
export const CAL_FIELDS_UTC_SUN = { calendar: calUtcSun, calendarError: null } as const
/** makeProjectConfig(monProjectValues) — 월요일 주를 가정한 기존 기대값을 그대로 덮는다 */
export const monProjectValues = { 'calendar.week_start': MON_RULES } as const
/** 옛 '휴일 목록(string[])' 픽스처를 달력으로 — UTC·일요일·월~금 + 그 날짜들을 off 로(봇 리포지토리 스냅샷·근거 픽스처가 쓴다) */
export function calWithOff(off: readonly string[], base: { timezone?: string; weekStart?: WeekStartRule[] } = {}): WorkCalendar {
  return calendarOf({
    timezone: base.timezone ?? 'UTC', workingDays: WEEKDAYS, weekStart: base.weekStart ?? SUN_RULES,
    holidays: off.map((date) => ({ date, kind: 'off' as const })),
  })
}

/** 클라이언트 컴포넌트 props 용 직렬화 꼴(CalendarInput 과 같은 모양 — RSC 경계, 과제 16).
 *  간트 축 끝을 단언하는 옛 테스트는 월요일 규칙이면 옛 "다음 주 일요일"과 같은 끝이다 — 기본을 월요일로 둔다 */
export type CalendarInputLike = Parameters<typeof calendarOf>[0]
export function calInputOf(off: readonly string[] = [], base: { timezone?: string; weekStart?: WeekStartRule[] } = {}): CalendarInputLike {
  return {
    timezone: base.timezone ?? 'UTC', workingDays: [...WEEKDAYS], weekStart: base.weekStart ?? MON_RULES,
    holidays: off.map((date) => ({ date, kind: 'off' as const })),
  }
}
export const calInputUtcMon: CalendarInputLike = calInputOf()
