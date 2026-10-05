import type { AttendanceRecord } from '@/lib/domain/types'
import { addDaysIso } from './dates'
import { isWorkingDay, startOfWeek, type IsoDow, type WeekStartDay, type WorkCalendar } from './calendar'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

/** 달력 화면이 쓰는 달력 조각 — 시간대는 '오늘'만 정하고 그리드는 date-only 다 */
export type CalendarView = Pick<WorkCalendar, 'workingDays' | 'offDates' | 'workDates' | 'weekStart'>
export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const KEY_OF_ISO: Readonly<Record<IsoDow, WeekdayKey>> = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat', 7: 'sun' }

/** 서버 페이지 → 달력 컴포넌트 props(RSC 경계 — React 19 가 Set 을 직렬화한다). 워크스페이스·요청 달력은 날짜 예외가 없다(D36) — 빈 집합 */
export function calendarViewOf(
  cal: Pick<WorkCalendar, 'workingDays' | 'weekStart'> & Partial<Pick<WorkCalendar, 'offDates' | 'workDates'>>,
): CalendarView {
  return { workingDays: cal.workingDays, weekStart: cal.weekStart, offDates: cal.offDates ?? new Set(), workDates: cal.workDates ?? new Set() }
}

/** 날짜 예외(휴무·근무)의 이름 — 프로젝트 holidays.name, 빈 이름은 뺀다 */
export function holidayNamesOf(rows: readonly { date: string; name: string }[]): Record<string, string> {
  return Object.fromEntries(rows.filter((h) => h.name.trim() !== '').map((h) => [h.date, h.name]))
}

/** 머리 일곱 칸 — 첫 열 = firstDay(SP5 §4.4: 현재 규칙의 시작 요일). 키는 사전 'att.weekday.<key>' */
export function weekdayColumns(firstDay: WeekStartDay): { iso: IsoDow; key: WeekdayKey }[] {
  const start = firstDay === 'sunday' ? 7 : 1
  return Array.from({ length: 7 }, (_, i) => {
    const iso = (((start - 1 + i) % 7) + 1) as IsoDow
    return { iso, key: KEY_OF_ISO[iso] }
  })
}

/**
 * month0(0-based) 월을 덮는 6×7 'YYYY-MM-DD' 그리드. 첫 열 = firstDay.
 * date-only UTC 연산(calendar.ts·dates.ts)이라 브라우저·서버 시간대의 영향을 받지 않는다.
 */
export function monthMatrix(year: number, month0: number, firstDay: WeekStartDay): string[][] {
  const first = fmtUTC(new Date(Date.UTC(year, month0, 1)))   // 범위를 넘는 month0 는 Date.UTC 가 해를 넘긴다
  const start = startOfWeek(first, firstDay)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysIso(start, w * 7 + d)))
}

/** 그리드의 첫 칸·마지막 칸 — 회의 조회 범위(페이지·뷰)가 같은 그리드를 쓰게 한다 */
export function monthGridRange(year: number, month0: number, firstDay: WeekStartDay): [string, string] {
  const m = monthMatrix(year, month0, firstDay)
  return [m[0][0], m[5][6]]
}

/** 한 칸의 표시 — 쉬는 날은 근무 요일 + 날짜 예외에서만(한국 특일 오버레이 없음, 사용자 결정 5). 이름은 프로젝트 holidays.name */
export function calendarDayInfo(date: string, cal: CalendarView, holidayNames?: Readonly<Record<string, string>>): { working: boolean; name: string | null } {
  const name = holidayNames?.[date]?.trim() || null
  return { working: isWorkingDay(date, cal), name }
}

/** 날짜('YYYY-MM-DD')별로 기록을 묶는다. */
export function recordsByDate(records: AttendanceRecord[]): Record<string, AttendanceRecord[]> {
  const out: Record<string, AttendanceRecord[]> = {}
  for (const r of records) {
    const bucket = out[r.date] ?? (out[r.date] = [])
    bucket.push(r)
  }
  return out
}
