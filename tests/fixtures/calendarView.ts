// 달력 화면 테스트의 공용 달력 — 일요일 규칙·월요일 규칙·워크스페이스(날짜 예외 없음). calendar.ts 의 calendarOf 로 만든다(사본 계산 없음).
import { calendarOf, type WorkCalendar } from '@/lib/domain/calendar'
import type { CalendarView } from '@/lib/domain/attendance'

const pick = (c: WorkCalendar): CalendarView => ({ workingDays: c.workingDays, offDates: c.offDates, workDates: c.workDates, weekStart: c.weekStart })

/** 일요일 시작·월~금 근무 — 날짜 예외 둘: 2026-10-05(월) 휴무, 2026-10-10(토) 근무 */
export const SUNDAY_CAL: CalendarView = pick(calendarOf({
  timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'sunday', from: null }],
  holidays: [{ date: '2026-10-05', kind: 'off' }, { date: '2026-10-10', kind: 'work' }],
}))
/** 월요일 시작·월~금 근무 — 같은 날짜 예외 */
export const MONDAY_CAL: CalendarView = pick(calendarOf({
  timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'monday', from: null }],
  holidays: [{ date: '2026-10-05', kind: 'off' }, { date: '2026-10-10', kind: 'work' }],
}))
/** 워크스페이스 달력 — 요일만(날짜 예외 표가 없다, D36), 일~목 근무 */
export const WORKSPACE_CAL: CalendarView = pick(calendarOf({
  timezone: 'UTC', workingDays: [7, 1, 2, 3, 4], weekStart: [{ day: 'sunday', from: null }],
}))
/** 휴무 이름(프로젝트 holidays.name) — 합성 이름만 */
export const HOLIDAY_NAMES: Readonly<Record<string, string>> = { '2026-10-05': '창립기념일', '2026-10-10': '대체 근무' }
