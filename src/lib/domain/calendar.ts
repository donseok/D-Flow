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
/** IANA 이름 꼴(영문 마디) — 참고용 패턴. parseTimezone 은 쓰지 않는다(K8 — EST5EDT·GMT0 같은 실재 이름을 받는다. 오프셋 꼴은 OFFSET_FORM 이 막는다) */
export const IANA_NAME = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/
/** 오프셋 꼴 사전 거부 — Intl 의 수용 여부(엔진 판에 따라 다르다)에 기대지 않는다. 유니코드 마이너스(U+2212)도 Intl 이 받으므로 같이 막는다 */
const OFFSET_FORM = /^(?:[+\-\u2212]\d|(?:GMT|UTC|UT)\s*[+\-\u2212]\s*\d)/i

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
 * 그 tz 에서 dateIso 가 시작하는 instant(그날의 첫 시각) — `${d}T00:00:00+09:00` 리터럴 대체. [zonedMidnightUtc(d), zonedMidnightUtc(d+1)) 이
 * 그날의 범위다. 후보 둘(추정 시각의 오프셋·첫 후보의 오프셋으로 맞춘 값) 가운데 그 tz 에서 같은 날짜인 이른 것을 고르고, 그 직전 1초의
 * 오프셋으로 한 번 더 당겨 같은 날이면 그것을 쓴다(K1):
 * - 자정에 시계가 앞으로 가는 날(America/Santiago 2026-09-06 — 00:00~00:59 없음)은 그 뒤 첫 유효 시각(01:00)이다 — 전날 23:00 이 아니다.
 * - 자정이 두 번인 날(Asia/Amman 2010-10-29 — 01:00 에 00:00 으로 돌아간다)은 첫 자정이다.
 * - 그 tz 에 없는 날짜(날짜선 이동 — Pacific/Apia 2011-12-30)는 다음 날의 시작이다(그날의 범위는 빈 구간).
 */
export function zonedMidnightUtc(dateIso: string, tz: string): Date {
  const guess = utcOf(dateIso)
  const c1 = guess - offsetMs(tz, guess)
  const c2 = guess - offsetMs(tz, c1)
  const cands = c1 <= c2 ? [c1, c2] : [c2, c1]
  const dayOf = (t: number) => ymdIn(tz, new Date(t))
  let t = cands.find((c) => dayOf(c) === dateIso)
  if (t === undefined) return new Date(cands.find((c) => dayOf(c) > dateIso) ?? c2)
  for (let i = 0; i < 2; i++) {
    const earlier = guess - offsetMs(tz, t - 1000)
    if (earlier < t && dayOf(earlier) === dateIso) t = earlier
    else break
  }
  return new Date(t)
}

/** Intl.supportedValuesOf('timeZone') 의 소문자 → 표기(대소문자 정규화용). 엔진이 목록을 모르면 빈 표 — 입력 그대로 저장한다 */
let tzSpellings: ReadonlyMap<string, string> | null = null
function tzSpellingOf(lower: string): string | undefined {
  if (!tzSpellings) {
    const m = new Map<string, string>()
    try {
      for (const n of Intl.supportedValuesOf('timeZone')) m.set(n.toLowerCase(), n)
    } catch { /* 목록 없음 — 입력 그대로 */ }
    tzSpellings = m
  }
  return tzSpellings.get(lower)
}

/**
 * calendar.timezone 의 검증·정규화(D54 — 판정 J2·K8 정정). 유효성 = ① 오프셋 꼴 사전 거부 ② `Intl.DateTimeFormat` 생성 성공(목록 포함이
 * 아니다 — 'UTC'·EST5EDT·GMT0 같은 실재 이름을 받는다. 이름 꼴 정규식은 쓰지 않는다). 저장 값 = `Intl.supportedValuesOf('timeZone')` 에서
 * 대소문자 무시로 같은 이름이 있으면 그 표기, 없으면 입력(trim) 그대로 — ICU 의 별칭 치환(Asia/Kolkata → Asia/Calcutta)은 저장하지 않는다
 * (사용자가 고른 이름을 옛 이름으로 바꾸지 않는다). 화면 입력은 목록 선택이라 표기가 정규다. 폴백 없음.
 */
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
  // 엔진이 사전 거부 밖의 오프셋 꼴을 받아 오프셋으로 풀었으면(판마다 다르다) 같이 막는다
  if (OFFSET_FORM.test(resolved)) return fail(`오프셋 꼴 시간대는 쓸 수 없습니다 — 'Europe/Berlin' 같은 IANA 이름을 쓰세요: ${v}`)
  return { ok: true, value: tzSpellingOf(v.toLowerCase()) ?? v }
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
const DOW_OF: Readonly<Record<WeekStartDay, IsoDow>> = { sunday: 7, monday: 1 }

/** 편집 입력 — 요일 하나(개정 §2.8.7: 클라이언트 patch 는 목록을 쓸 수 없다) */
export function parseWeekStartDay(raw: unknown): CalendarResult<WeekStartDay> {
  return raw === 'sunday' || raw === 'monday' ? { ok: true, value: raw } : fail('주 시작 요일은 sunday·monday 중 하나입니다.')
}

/** date 가 속한, day 요일로 시작하는 주의 첫날(전환을 보지 않는다) */
export function startOfWeek(date: string, day: WeekStartDay): string {
  return addDaysIso(date, -((isoDowOf(date) - DOW_OF[day] + 7) % 7))
}

/** 전환 from 의 직전 규칙(prevDay)의 마지막 주 키 = [from−10, from−4] 안의 prevDay 요일(창 7일이라 유일 — 개정 §4.2.4) */
function transitionKey(prevDay: WeekStartDay, from: string): string {
  return startOfWeek(addDaysIso(from, -4), prevDay)
}

/** 저장 형태 검증 — 첫 원소 from null, 이후 from 오름차순·그 날짜 요일 = day, 이웃 day 다름, 전환끼리 겹치지 않음 */
export function parseWeekRules(raw: unknown): CalendarResult<WeekStartRule[]> {
  if (!Array.isArray(raw) || raw.length === 0) return fail('주 시작 규칙은 하나 이상의 목록이어야 합니다.')
  const out: WeekStartRule[] = []
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] as unknown
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return fail(`${i + 1}번째 규칙이 객체가 아닙니다.`)
    const o = r as Record<string, unknown>
    if (Object.keys(o).some((k) => k !== 'day' && k !== 'from')) return fail(`${i + 1}번째 규칙에 모르는 필드가 있습니다.`)
    const day = parseWeekStartDay(o.day)
    if (!day.ok) return fail(`${i + 1}번째 규칙: ${day.error}`)
    if (i === 0) {
      if (o.from !== null) return fail('첫 규칙의 from 은 null 이어야 합니다.')
      out.push({ day: day.value, from: null })
      continue
    }
    const from = o.from
    if (!isCalendarDate(from)) return fail(`${i + 1}번째 규칙의 from 이 날짜가 아닙니다.`)
    if (isoDowOf(from) !== DOW_OF[day.value]) return fail(`${i + 1}번째 규칙의 from(${from}) 요일이 ${day.value} 가 아닙니다.`)
    const prev = out[i - 1]
    if (prev.day === day.value) return fail(`${i + 1}번째 규칙이 앞 규칙과 같은 요일입니다.`)
    if (prev.from !== null && from <= prev.from) return fail('규칙의 from 은 오름차순이어야 합니다.')
    if (prev.from !== null && transitionKey(prev.day, from) < prev.from) return fail(`${i + 1}번째 전환이 앞 전환(${prev.from})과 너무 가깝습니다.`)
    out.push({ day: day.value, from })
  }
  return { ok: true, value: out }
}

/** 날짜 → 주 키(개정 §4.2.4 키 함수). 규칙이 먼저다(인터페이스 일람 — SQL week_key_from_rules 와 같은 순서) */
export function weekKeyOf(rules: readonly WeekStartRule[], date: string): string {
  for (let i = rules.length - 1; i >= 1; i--) {
    const from = rules[i].from as string
    if (date >= from) return startOfWeek(date, rules[i].day)
    const kp = transitionKey(rules[i - 1].day, from)
    if (date >= kp) return kp                                   // 과도기 주 [Kp, E)
  }
  return startOfWeek(date, rules[0].day)
}

/** 키 → 주 기간 [start, endExclusive). 과도기 키면 [Kp, E), 아니면 7일 */
export function weekPeriodOf(rules: readonly WeekStartRule[], key: string): { start: string; endExclusive: string } {
  for (let i = 1; i < rules.length; i++) {
    const from = rules[i].from as string
    if (key === transitionKey(rules[i - 1].day, from)) return { start: key, endExclusive: from }
  }
  return { start: key, endExclusive: addDaysIso(key, 7) }
}

/** 이웃 키(D35) — ±7일이 아니다(과도기 주는 6·8일) */
export function prevWeekKey(rules: readonly WeekStartRule[], key: string): string {
  return weekKeyOf(rules, addDaysIso(key, -1))
}
export function nextWeekKey(rules: readonly WeekStartRule[], key: string): string {
  return weekPeriodOf(rules, key).endExclusive
}

/** 표시 요일(D4) — 기간 안 근무일(주 순서). 근무일이 0이면 기간 전체(5칸 고정 폐기) */
export function weekDisplayDays(cal: Pick<WorkCalendar, 'workingDays' | 'offDates' | 'workDates' | 'weekStart'>, key: string): string[] {
  const { start, endExclusive } = weekPeriodOf(cal.weekStart, key)
  const all: string[] = []
  for (let d = start; d < endExclusive; d = addDaysIso(d, 1)) all.push(d)
  const working = all.filter((d) => isWorkingDay(d, cal))
  return working.length ? working : all
}

/** 주차 라벨(개정 §4.2.5) — 기준일 = 키 + 3일의 연·월, 주차 = 1 + 같은 달에 기준일이 떨어지는 앞선 키 수. 서식 문자열은 report/week.ts(P4) */
export function weekLabelOf(rules: readonly WeekStartRule[], key: string): { year: number; month: number; ordinal: number } {
  const anchor = addDaysIso(key, 3)
  const ym = anchor.slice(0, 7)
  let ordinal = 1
  for (let k = prevWeekKey(rules, key); addDaysIso(k, 3).slice(0, 7) === ym; k = prevWeekKey(rules, k)) ordinal++
  return { year: Number(anchor.slice(0, 4)), month: Number(anchor.slice(5, 7)), ordinal }
}

/** 그 날짜에 적용되는 규칙의 요일(달력 첫 열·이슈 추이 — 과도기 키는 보지 않는다) */
export function currentRuleDay(rules: readonly WeekStartRule[], date: string): WeekStartDay {
  let day = rules[0].day
  for (const r of rules) if (r.from !== null && r.from <= date) day = r.day
  return day
}

const ERR_PAST_RULE = '저장된 주 시작 규칙이 손상되어 바꿀 수 없습니다 — 이미 적용된(과거) 규칙은 고칠 수 없습니다.'

/** 과거 원소(from ≤ T 와 첫 원소)가 같은 자리에 그대로인가 — 정상 입력에서는 늘 참(도달 불가 방어, 계획 P7) */
function pastRulesPreserved(prev: readonly WeekStartRule[], next: readonly WeekStartRule[], today: string): boolean {
  return prev.every((r, i) => (r.from !== null && r.from > today) || (next[i]?.day === r.day && next[i]?.from === r.from))
}

/**
 * 변경 연산(개정 §4.2.4 표) — 입력은 새 요일 하나, 목록은 서버가 만든다. T = 프로젝트 tz 의 오늘.
 * 문서 0건 → 교체 / 마지막 전환이 아직 적용 전(from > T) → 그 원소 교체·삭제 / 그 밖 → 다음 주부터의 전환을 덧붙인다(E ≤ T 면 +7).
 * E 이후 문서가 있으면 거부하는 판정은 DB(settings_ref_check — D53)다. 이 함수는 throw 하지 않는다(P7).
 */
export function applyWeekStartChange(rules: readonly WeekStartRule[], newDay: WeekStartDay, today: string, docCount: number)
  : { ok: true; rules: WeekStartRule[] } | { ok: false; code: 'CALENDAR_PAST_RULE'; error: string } {
  if (docCount === 0) return { ok: true, rules: [{ day: newDay, from: null }] }
  const valid = parseWeekRules(rules)
  if (!valid.ok) return { ok: false, code: 'CALENDAR_PAST_RULE', error: `${ERR_PAST_RULE} (${valid.error})` }
  const cur = valid.value
  const last = cur[cur.length - 1]
  let next: WeekStartRule[]
  if (last.from !== null && last.from > today) {
    if (newDay === last.day) next = cur
    else next = cur.slice(0, -1)                              // 직전 규칙의 요일로 되돌림 = 아직 적용 전 전환을 지운다(요일이 둘뿐)
  } else if (newDay === last.day) {
    next = cur                                                // 지금 규칙과 같은 요일 — 바꿀 것이 없다
  } else {
    const n0 = addDaysIso(weekKeyOf(cur, today), 7)
    let e = startOfWeek(addDaysIso(n0, 3), newDay)            // [N0−3, N0+3] 안의 newDay 요일
    if (e <= today) e = addDaysIso(e, 7)                      // 다음 주부터 보장
    next = [...cur, { day: newDay, from: e }]
  }
  if (!pastRulesPreserved(cur, next, today)) return { ok: false, code: 'CALENDAR_PAST_RULE', error: ERR_PAST_RULE }
  return { ok: true, rules: next.map((r) => ({ ...r })) }
}

export interface WeekStartPreview {
  effectiveFrom: string | null                // 새로 생기는 전환일 E(교체·되돌림·같은 요일이면 null)
  transitionDays: 6 | 8 | null                // 과도기 주 길이
  keptDocs: number                            // 그대로 남는 기존 주간보고 수
  blockingWeeks: string[]                     // 새 규칙에서 키가 바뀌는 문서 = 저장 거부 예정(최대 20 — D53 과 같은 정의)
  error: string | null                        // 손상된 저장 규칙(CALENDAR_PAST_RULE)의 문구
}

/** 설정 화면 '변경 내용 검토'(D38) — applyWeekStartChange 와 같은 함수로 E·과도기·N건·거부 예정 문서를 낸다 */
export function previewWeekStart(rules: readonly WeekStartRule[], newDay: WeekStartDay, today: string, docKeys: readonly string[]): WeekStartPreview {
  const r = applyWeekStartChange(rules, newDay, today, docKeys.length)
  if (!r.ok) return { effectiveFrom: null, transitionDays: null, keptDocs: docKeys.length, blockingWeeks: [], error: r.error }
  const prevLast = rules[rules.length - 1]
  const nextLast = r.rules[r.rules.length - 1]
  const added = r.rules.length > 1 && nextLast.from !== null && (prevLast.from !== nextLast.from || prevLast.day !== nextLast.day)
  const effectiveFrom = added ? nextLast.from : null
  let transitionDays: 6 | 8 | null = null
  if (effectiveFrom) {
    const kp = transitionKey(r.rules[r.rules.length - 2].day, effectiveFrom)
    const len = Math.round((Date.parse(`${effectiveFrom}T00:00:00Z`) - Date.parse(`${kp}T00:00:00Z`)) / 86_400_000)
    transitionDays = len === 6 || len === 8 ? len : null
  }
  const blocking = [...docKeys].filter((d) => weekKeyOf(r.rules, d) !== d).sort()
  return { effectiveFrom, transitionDays, keptDocs: docKeys.length - blocking.length, blockingWeeks: blocking.slice(0, 20), error: null }
}
