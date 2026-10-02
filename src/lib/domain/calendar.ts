/**
 * 달력 순수 모듈(SP5 스펙 §4.1, 개정 §4.2.3) — 근무일·날짜 예외·시간대·주 키의 단일 출처. dates.ts 의 seoul*·주말·영업일을 흡수한다(삭제는 과제 22).
 * 순수: now 를 인자로 받는다. 서버 모듈·설정 해석기를 import 하지 않는다 — 클라이언트 컴포넌트가 import 한다.
 * date-only('YYYY-MM-DD' — 일정·휴일·주 키·근태)는 UTC 날짜 산술로만 다룬다(로컬 자정 Date 로 재해석하지 않는다 — K15).
 * instant(timestamptz)를 날짜로 바꿀 때만 Intl 을 거친다(ymdIn·todayIn·stampIn·zonedMidnightUtc).
 */
import { addDaysIso } from './dates'
import { isValidIsoDate } from './validate'

export type IsoDow = 1 | 2 | 3 | 4 | 5 | 6 | 7
export type WeekStartDay = 'sunday' | 'monday'
export interface WeekStartRule { day: WeekStartDay; from: string | null }
export interface WorkCalendar {
  timezone: string                        // IANA
  workingDays: ReadonlySet<IsoDow>
  offDates: ReadonlySet<string>           // holidays.kind = 'off'
  workDates: ReadonlySet<string>          // holidays.kind = 'work'
  weekStart: readonly WeekStartRule[]
}
/** 봇의 요청 범위 달력(D13 ③) — 날짜 예외는 프로젝트마다 다르므로 싣지 않는다 */
export type RequestCalendar = Pick<WorkCalendar, 'timezone' | 'workingDays' | 'weekStart'>
/** 설정 레지스트리의 Parsed<T> 와 같은 모양 — 도메인이 설정 모듈을 import 하지 않으려고 따로 둔다 */
export type CalendarResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const WEEK_START_DAYS: readonly WeekStartDay[] = ['sunday', 'monday']
export const DEFAULT_TIMEZONE = 'UTC'
export const DEFAULT_WORKING_DAYS: readonly IsoDow[] = [1, 2, 3, 4, 5]
export const DEFAULT_WEEK_RULES: readonly WeekStartRule[] = [{ day: 'sunday', from: null }]
/** 다음 근무일 탐색 상한(약 10년) — 긴 off 예외가 근무 요일을 다 덮어도 루프가 끝난다(개정 §4.2.3) */
export const WORKDAY_SEARCH_LIMIT = 3660
/** 정규화한 tz 가 IANA 이름 꼴이어야 한다 — 오프셋 문자열이 저장되면 PG 가 부호를 반대로 읽는다(D54·R5) */
export const IANA_NAME = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/
/** 오프셋 꼴 사전 거부 — Intl 의 수용 여부(엔진 판에 따라 다르다)에 기대지 않는다 */
const OFFSET_FORM = /^(?:[+-]\d|(?:GMT|UTC|UT)\s*[+-]\s*\d)/i

export class CalendarError extends Error {
  readonly code = 'CALENDAR_NO_WORKDAY' as const
  constructor(message: string) {
    super(message)
    this.name = 'CalendarError'
  }
}

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const pad2 = (n: number) => String(n).padStart(2, '0')
const utcOf = (date: string): number => {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** date-only 의 ISO 요일(1=월 … 7=일). UTC 산술 — 브라우저 tz 와 무관 */
export function isoDowOf(date: string): IsoDow {
  const d = new Date(utcOf(date)).getUTCDay()
  return (d === 0 ? 7 : d) as IsoDow
}

// tz 별 포맷터 — 순수 계산의 비용 줄이기(값이 아니라 Intl 객체라 요청 사이에 데이터가 새지 않는다)
const FORMATTERS = new Map<string, Intl.DateTimeFormat>()
function partsIn(tz: string, at: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  let f = FORMATTERS.get(tz)
  if (!f) {
    // hourCycle 하나만 준다 — hour12 와 같이 주면 서로 덮어써 결과가 환경 의존이 된다(dates.ts seoulStamp 의 주석)
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    FORMATTERS.set(tz, f)
  }
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(at)) p[x.type] = x.value
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) }
}

/** 임의 instant 의 그 tz 'YYYY-MM-DD' — seoulYmd 대체 */
export function ymdIn(tz: string, at: Date): string {
  const p = partsIn(tz, at)
  return `${String(p.y).padStart(4, '0')}-${pad2(p.mo)}-${pad2(p.d)}`
}
/** 그 tz 의 오늘 — seoulToday 대체. now 는 서버 진입점이 한 번 만든 값(계획 P8) */
export function todayIn(tz: string, now: Date): string {
  return ymdIn(tz, now)
}
/** 그 tz 의 'YYYY-MM-DD HH:mm' — seoulStamp 대체. 접미("(Asia/Seoul)" 등)는 호출부가 붙인다 */
export function stampIn(tz: string, at: Date | string): string {
  const p = partsIn(tz, typeof at === 'string' ? new Date(at) : at)
  return `${String(p.y).padStart(4, '0')}-${pad2(p.mo)}-${pad2(p.d)} ${pad2(p.h)}:${pad2(p.mi)}`
}
/** instant t 에서 그 tz 의 벽시계 − UTC(ms) */
function offsetMs(tz: string, t: number): number {
  const p = partsIn(tz, new Date(t))
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000
}
/**
 * 그 tz 에서 dateIso 의 자정 instant — `${d}T00:00:00+09:00` 리터럴 대체. 첫 추정의 오프셋이 그 시각의 오프셋과 다르면(DST) 한 번 더 맞춘다.
 * 자정이 없는 날(자정에 시계가 앞으로 가는 tz)은 그 뒤 첫 유효 시각이다.
 */
export function zonedMidnightUtc(dateIso: string, tz: string): Date {
  const guess = utcOf(dateIso)
  let t = guess - offsetMs(tz, guess)
  t = guess - offsetMs(tz, t)
  return new Date(t)
}

/** calendar.timezone 의 검증·정규화(D54) — 생성 성공이 기준(목록 포함이 아니다 — 'UTC' 를 받는다), 오프셋 꼴 거부, 폴백 없음 */
export function parseTimezone(raw: unknown): CalendarResult<string> {
  if (typeof raw !== 'string') return fail('시간대는 문자열이어야 합니다.')
  const v = raw.trim()
  if (!v) return fail('시간대가 비어 있습니다.')
  if (OFFSET_FORM.test(v)) return fail(`오프셋 꼴 시간대는 쓸 수 없습니다 — 'Europe/Berlin' 같은 IANA 이름을 쓰세요: ${v}`)
  let resolved: string
  try {
    resolved = new Intl.DateTimeFormat('en', { timeZone: v }).resolvedOptions().timeZone
  } catch {
    return fail(`모르는 시간대입니다: ${v}`)
  }
  if (!IANA_NAME.test(resolved)) return fail(`IANA 이름 꼴이 아닌 시간대입니다(오프셋 꼴 포함): ${v}`)
  return { ok: true, value: resolved }
}

/** calendar.working_days 의 검증 — 길이 ≥1, 1..7 정수, 유일. 저장은 오름차순 */
export function parseWorkingDays(raw: unknown): CalendarResult<IsoDow[]> {
  if (!Array.isArray(raw)) return fail('근무 요일은 목록이어야 합니다.')
  if (raw.length === 0) return fail('근무 요일이 최소 하나 필요합니다.')
  if (raw.some((d) => typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 7)) return fail('근무 요일은 1(월)~7(일) 정수여야 합니다.')
  if (new Set(raw).size !== raw.length) return fail('근무 요일이 중복됩니다.')
  return { ok: true, value: [...(raw as IsoDow[])].sort((a, b) => a - b) }
}

type DayRules = Pick<WorkCalendar, 'workingDays' | 'offDates' | 'workDates'>

/** 판정 순서: workDates(특정일 근무) → offDates(휴무) → 근무 요일. 날짜 하나에 holidays 행은 하나뿐이다(PK) */
export function isWorkingDay(date: string, cal: DayRules): boolean {
  if (cal.workDates.has(date)) return true
  if (cal.offDates.has(date)) return false
  return cal.workingDays.has(isoDowOf(date))
}

/** start~end 양끝 포함 근무일 수. end < start 면 0 — businessDaysBetween 대체 */
export function workingDaysBetween(start: string, end: string, cal: DayRules): number {
  if (end < start) return 0
  let n = 0
  for (let d = start; d <= end; d = addDaysIso(d, 1)) if (isWorkingDay(d, cal)) n++
  return n
}

/** 다음(direction -1 이면 이전) 근무일. inclusive 면 그날부터 본다. WORKDAY_SEARCH_LIMIT 일을 넘으면 CalendarError */
export function nextWorkingDay(date: string, cal: DayRules, opts?: { inclusive?: boolean; direction?: 1 | -1 }): string {
  const dir = opts?.direction ?? 1
  let d = opts?.inclusive ? date : addDaysIso(date, dir)
  for (let i = 0; i <= WORKDAY_SEARCH_LIMIT; i++) {
    if (isWorkingDay(d, cal)) return d
    d = addDaysIso(d, dir)
  }
  throw new CalendarError(`근무일을 찾지 못했습니다(${date} 부터 ${WORKDAY_SEARCH_LIMIT}일) — 근무 요일·휴무 예외를 확인하세요.`)
}

/** 해석된 키 셋 + 날짜 예외 → WorkCalendar. 값 검증은 호출부(설정 parse)가 이미 했다 */
export function calendarOf(input: {
  timezone: string; workingDays: readonly IsoDow[]; weekStart: readonly WeekStartRule[]
  holidays?: readonly { date: string; kind: 'off' | 'work' }[]
}): WorkCalendar {
  const hs = input.holidays ?? []
  return {
    timezone: input.timezone,
    workingDays: new Set(input.workingDays),
    offDates: new Set(hs.filter((h) => h.kind === 'off').map((h) => h.date)),
    workDates: new Set(hs.filter((h) => h.kind === 'work').map((h) => h.date)),
    weekStart: input.weekStart,
  }
}

/** 날짜 문자열이 실재하는 'YYYY-MM-DD' 인가 — 주 규칙 검증(과제 3)이 쓴다 */
export function isCalendarDate(raw: unknown): raw is string {
  return typeof raw === 'string' && isValidIsoDate(raw)
}

// ── 주(과제 3 이 이 아래에 더한다) ────────────────────────────────────────────────────────────────
