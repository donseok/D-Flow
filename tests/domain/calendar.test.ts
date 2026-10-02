// src/lib/domain/calendar.ts ① — 날짜·시간대·근무일(SP5 스펙 §4.1·D54·R5, 개정 §4.2.3·§4.2.6). 순수 모듈 — now 를 주입한다.
// 날짜 기대값은 손으로 셌다: 2026-09-27·2026-03-08·2026-11-01 은 일요일, 2026-10-03 은 토요일, 2026-10-05 는 월요일.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CalendarError, DEFAULT_TIMEZONE, DEFAULT_WEEK_RULES, DEFAULT_WORKING_DAYS, IANA_NAME, WEEK_START_DAYS, WORKDAY_SEARCH_LIMIT,
  calendarOf, isWorkingDay, isoDowOf, nextWorkingDay, parseTimezone, parseWorkingDays, stampIn, todayIn, workingDaysBetween, ymdIn,
  zonedMidnightUtc, type IsoDow,
  applyWeekStartChange, currentRuleDay, nextWeekKey, parseWeekRules, parseWeekStartDay, prevWeekKey, previewWeekStart, startOfWeek,
  weekDisplayDays, weekKeyOf, weekLabelOf, weekPeriodOf, type WeekStartRule,
} from '@/lib/domain/calendar'
import {
  GOLDEN_TZ_NAMES, GOLDEN_TZ_REJECT, GOLDEN_WEEK_CASES, GOLDEN_WORKDAY_CASES, RULES_MON_TO_SUN, RULES_MON_TO_SUN_LATE, RULES_SUN_TO_MON, RULES_TWO_SWITCHES,
} from '../fixtures/calendar-golden'

const cal = (workingDays: IsoDow[], off: string[] = [], work: string[] = []) =>
  calendarOf({ timezone: 'UTC', workingDays, weekStart: DEFAULT_WEEK_RULES, holidays: [...off.map((date) => ({ date, kind: 'off' as const })), ...work.map((date) => ({ date, kind: 'work' as const }))] })

describe('상수 — 제품 기본값(개정 §4.2.2)', () => {
  it('기본 시간대 UTC·근무 월~금·주 시작 일요일 하나, 선택지는 일·월 둘(D6)', () => {
    expect(DEFAULT_TIMEZONE).toBe('UTC')
    expect(DEFAULT_WORKING_DAYS).toEqual([1, 2, 3, 4, 5])
    expect(DEFAULT_WEEK_RULES).toEqual([{ day: 'sunday', from: null }])
    expect(WEEK_START_DAYS).toEqual(['sunday', 'monday'])
    expect(WORKDAY_SEARCH_LIMIT).toBe(3660)
  })
})

describe('isoDowOf — date-only 의 ISO 요일(1=월 … 7=일), 브라우저 tz 와 무관', () => {
  it.each([
    ['2026-09-27', 7], ['2026-09-28', 1], ['2026-10-03', 6], ['2026-03-08', 7], ['2024-02-29', 4], ['2027-01-01', 5],
  ] as const)('%s → %i', (date, dow) => {
    expect(isoDowOf(date)).toBe(dow)
  })
})

describe('todayIn·ymdIn·stampIn — instant → 그 tz 의 날짜·시각', () => {
  it('같은 instant 가 UTC·서울·LA 에서 다른 날짜(경계)', () => {
    const at = new Date('2026-12-31T15:30:00Z')
    expect(todayIn('UTC', at)).toBe('2026-12-31')
    expect(todayIn('Asia/Seoul', at)).toBe('2027-01-01')
    expect(todayIn('America/Los_Angeles', at)).toBe('2026-12-31')
    const early = new Date('2026-01-01T07:30:00Z')
    expect(ymdIn('America/Los_Angeles', early)).toBe('2025-12-31')
    expect(ymdIn('Asia/Seoul', early)).toBe('2026-01-01')
  })
  it('stampIn 은 YYYY-MM-DD HH:mm, 자정은 00:00(h23) — 문자열 instant 도 받는다', () => {
    expect(stampIn('Asia/Seoul', '2026-09-30T15:00:00Z')).toBe('2026-10-01 00:00')
    expect(stampIn('UTC', new Date('2026-09-30T23:59:00Z'))).toBe('2026-09-30 23:59')
    expect(stampIn('America/New_York', '2026-11-01T05:30:00Z')).toBe('2026-11-01 01:30')
  })
})

describe('zonedMidnightUtc — 그 tz 의 자정 instant(DST 전환일 포함, 개정 §4.2.6)', () => {
  it.each([
    ['2026-10-04', 'Asia/Seoul', '2026-10-03T15:00:00.000Z'],
    ['2026-10-04', 'UTC', '2026-10-04T00:00:00.000Z'],
    ['2026-03-08', 'America/New_York', '2026-03-08T05:00:00.000Z'],   // 자정은 아직 EST — 02:00 에 EDT 로 바뀐다
    ['2026-03-09', 'America/New_York', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', 'America/New_York', '2026-11-01T04:00:00.000Z'],   // 자정은 아직 EDT — 02:00 에 EST 로 돌아간다
    ['2026-11-02', 'America/New_York', '2026-11-02T05:00:00.000Z'],
    ['2026-03-08', 'America/Los_Angeles', '2026-03-08T08:00:00.000Z'],
    ['2026-10-25', 'Europe/Berlin', '2026-10-24T22:00:00.000Z'],
  ] as const)('%s @ %s → %s', (date, tz, iso) => {
    expect(zonedMidnightUtc(date, tz).toISOString()).toBe(iso)
  })
  it('되돌린 날짜가 같은 날이다 — ymdIn(tz, zonedMidnightUtc(d, tz)) = d', () => {
    for (const tz of ['Asia/Seoul', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata']) {
      for (const d of ['2026-03-08', '2026-03-29', '2026-10-25', '2026-11-01', '2026-12-31']) expect(ymdIn(tz, zonedMidnightUtc(d, tz)), `${tz} ${d}`).toBe(d)
    }
  })
})

describe('parseTimezone — 생성 성공 + 정규화 + 이름 꼴(D54·R5). 폴백 없이 거부', () => {
  it('UTC 를 받는다(Intl.supportedValuesOf 목록에 없어도 — E29)', () => {
    expect(parseTimezone('UTC')).toEqual({ ok: true, value: 'UTC' })
  })
  it('대소문자·앞뒤 공백을 resolvedOptions 로 정규화한다', () => {
    expect(parseTimezone(' asia/seoul ')).toEqual({ ok: true, value: 'Asia/Seoul' })
    expect(parseTimezone('America/Los_Angeles')).toEqual({ ok: true, value: 'America/Los_Angeles' })
  })
  it('별칭은 고른 이름 그대로 저장한다 — ICU 의 옛 이름(Asia/Calcutta·Europe/Kiev)으로 바꾸지 않는다(판정 J2·K8)', () => {
    expect(parseTimezone('Asia/Kolkata')).toEqual({ ok: true, value: 'Asia/Kolkata' })
    expect(parseTimezone(' Europe/Kyiv ')).toEqual({ ok: true, value: 'Europe/Kyiv' })
    expect(parseTimezone('Asia/Calcutta')).toEqual({ ok: true, value: 'Asia/Calcutta' })
  })
  it('Intl 목록과 대소문자만 다르면 목록의 표기로 저장한다(K8)', () => {
    expect(parseTimezone('asia/tokyo')).toEqual({ ok: true, value: 'Asia/Tokyo' })
    expect(parseTimezone('EUROPE/BERLIN')).toEqual({ ok: true, value: 'Europe/Berlin' })
  })
  it.each(['EST5EDT', 'PST8PDT', 'CST6CDT', 'GMT0'])('숫자가 든 실재 IANA 이름 %s 을 받아 그대로 저장한다 — 이름 꼴 정규식을 쓰지 않는다(K8)', (tz) => {
    expect(parseTimezone(tz)).toEqual({ ok: true, value: tz })
  })
  it.each(['−09:00', '−0900', 'GMT−1'])('유니코드 마이너스 오프셋 %j 도 거부한다(Intl 은 −09:00 을 받는다)', (tz) => {
    expect(parseTimezone(tz).ok).toBe(false)
  })
  it('Etc/UTC 는 받고 정규화 값이 이름 꼴이다', () => {
    const r = parseTimezone('Etc/UTC')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatch(IANA_NAME)
  })
  it.each(['+09:00', '-05:00', 'GMT+1', 'UTC+9', 'utc-3'])('오프셋 꼴 %s 은 거부한다(PG 가 POSIX 로 읽어 부호를 뒤집는다)', (tz) => {
    expect(parseTimezone(tz)).toMatchObject({ ok: false, error: expect.stringContaining('오프셋') })
  })
  it.each(['Asia/Seol', 'Mars/Olympus', ''])('모르는 이름·빈 값 %j 은 거부한다', (tz) => {
    expect(parseTimezone(tz).ok).toBe(false)
  })
  it('EST 처럼 이름 꼴을 지나는 약칭은 받으면 이름 꼴 그대로다(PG 대조는 tests/rls/calendar-parity)', () => {
    const r = parseTimezone('EST')
    if (r.ok) expect(r.value).toMatch(IANA_NAME)
  })
  it('문자열이 아니면 거부한다', () => {
    for (const raw of [null, 9, ['UTC'], { tz: 'UTC' }]) expect(parseTimezone(raw).ok, JSON.stringify(raw)).toBe(false)
  })
})

describe('parseWorkingDays — 길이 ≥1·1..7 정수·유일, 정렬해 저장', () => {
  it('정렬한 목록을 돌려준다', () => {
    expect(parseWorkingDays([5, 1, 3])).toEqual({ ok: true, value: [1, 3, 5] })
    expect(parseWorkingDays([7, 1, 2, 3, 4])).toEqual({ ok: true, value: [1, 2, 3, 4, 7] })
  })
  it.each([[[]], [[0]], [[8]], [[1.5]], [['1']], [[1, 1]], ['1,2'], [null]])('%j 은 거부한다', (raw) => {
    expect(parseWorkingDays(raw).ok).toBe(false)
  })
})

describe('isWorkingDay — workDates → offDates → workingDays(개정 §4.2.3 판정 순서)', () => {
  it.each([
    ['월~금 토요일', cal([1, 2, 3, 4, 5]), '2026-10-03', false],
    ['월~금 월요일', cal([1, 2, 3, 4, 5]), '2026-10-05', true],
    ['일~목 일요일', cal([7, 1, 2, 3, 4]), '2026-10-04', true],
    ['일~목 금요일', cal([7, 1, 2, 3, 4]), '2026-10-02', false],
    ['월~토 토요일', cal([1, 2, 3, 4, 5, 6]), '2026-10-03', true],
    ['월~토 일요일', cal([1, 2, 3, 4, 5, 6]), '2026-10-04', false],
    ['특정 토요일 근무', cal([1, 2, 3, 4, 5], [], ['2026-10-03']), '2026-10-03', true],
    ['평일 휴무', cal([1, 2, 3, 4, 5], ['2026-10-05']), '2026-10-05', false],
  ] as const)('%s', (_n, c, date, want) => {
    expect(isWorkingDay(date, c)).toBe(want)
  })
})

describe('workingDaysBetween — 양끝 포함, end < start 면 0', () => {
  it('한 주 월~금 5, 일~목 5, 월~토 6', () => {
    expect(workingDaysBetween('2026-10-04', '2026-10-10', cal([1, 2, 3, 4, 5]))).toBe(5)
    expect(workingDaysBetween('2026-10-04', '2026-10-10', cal([7, 1, 2, 3, 4]))).toBe(5)
    expect(workingDaysBetween('2026-10-04', '2026-10-10', cal([1, 2, 3, 4, 5, 6]))).toBe(6)
  })
  it('휴일만 있는 기간은 0, 특정일 근무가 더한다, 거꾸로는 0', () => {
    const offWeek = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
    expect(workingDaysBetween('2026-10-05', '2026-10-09', cal([1, 2, 3, 4, 5], offWeek))).toBe(0)
    expect(workingDaysBetween('2026-10-03', '2026-10-09', cal([1, 2, 3, 4, 5], offWeek, ['2026-10-03']))).toBe(1)
    expect(workingDaysBetween('2026-10-09', '2026-10-05', cal([1, 2, 3, 4, 5]))).toBe(0)
  })
})

describe('nextWorkingDay — 다음(이전) 근무일, 3,660일 상한에서 CALENDAR_NO_WORKDAY', () => {
  it('금 → 월, inclusive 면 그날, 거꾸로', () => {
    const c = cal([1, 2, 3, 4, 5])
    expect(nextWorkingDay('2026-10-02', c)).toBe('2026-10-05')
    expect(nextWorkingDay('2026-10-05', c, { inclusive: true })).toBe('2026-10-05')
    expect(nextWorkingDay('2026-10-05', c, { direction: -1 })).toBe('2026-10-02')
  })
  it('근무 요일이 월요일 하나인데 모든 월요일이 휴무면 상한에서 throw — 무한 루프가 없다', () => {
    const mondays: string[] = []
    for (let d = '2026-10-05'; mondays.length < 600; d = new Date(Date.parse(`${d}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10)) mondays.push(d)
    const c = cal([1], mondays)
    let thrown: unknown
    try { nextWorkingDay('2026-10-04', c) } catch (e) { thrown = e }
    expect(thrown).toBeInstanceOf(CalendarError)
    expect((thrown as CalendarError).code).toBe('CALENDAR_NO_WORKDAY')
  })
})

describe('calendarOf — 입력 → WorkCalendar(off·work 를 나눈다)', () => {
  it('집합으로 나누고 규칙·tz 를 그대로 싣는다', () => {
    const c = calendarOf({ timezone: 'Asia/Seoul', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'monday', from: null }],
      holidays: [{ date: '2026-10-09', kind: 'off' }, { date: '2026-10-10', kind: 'work' }] })
    expect(c.timezone).toBe('Asia/Seoul')
    expect([...c.workingDays]).toEqual([1, 2, 3, 4, 5])
    expect([...c.offDates]).toEqual(['2026-10-09'])
    expect([...c.workDates]).toEqual(['2026-10-10'])
    expect(c.weekStart).toEqual([{ day: 'monday', from: null }])
  })
})

describe('순수성 — now 주입, 서버·설정 모듈을 import 하지 않는다(Global Constraints 도메인 층)', () => {
  it('인자 없는 new Date()·Date.now·@/lib/(supabase|settings)·@/app import 가 없다', () => {
    const src = readFileSync('src/lib/domain/calendar.ts', 'utf8')
    expect(src).not.toMatch(/new Date\(\)/)
    expect(src).not.toMatch(/Date\.now\(/)
    expect(src).not.toMatch(/from ['"]@\/(app|lib\/supabase|lib\/settings)\//)
  })
})

const MON0: WeekStartRule[] = [{ day: 'monday', from: null }]
const SUN0: WeekStartRule[] = [{ day: 'sunday', from: null }]
const days = (n: number) => (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const plus1 = days(1)

describe('골든 행렬 — TS 쪽(SQL 쪽은 tests/rls/calendar-parity.test.ts 가 같은 배열로)', () => {
  it.each(GOLDEN_WEEK_CASES.map((c) => [c.name, c] as const))('weekKeyOf — %s', (_n, c) => {
    expect(weekKeyOf(c.rules, c.date)).toBe(c.key)
  })
  it.each(GOLDEN_WORKDAY_CASES.map((c) => [c.name, c] as const))('isWorkingDay — %s', (_n, c) => {
    const cal = calendarOf({ timezone: 'UTC', workingDays: c.workingDays, weekStart: SUN0,
      holidays: [...c.off.map((date) => ({ date, kind: 'off' as const })), ...c.work.map((date) => ({ date, kind: 'work' as const }))] })
    expect(isWorkingDay(c.date, cal)).toBe(c.working)
  })
  it('시간대 — 받는 이름은 모두 통과, 거부 목록은 모두 거부', () => {
    for (const tz of GOLDEN_TZ_NAMES) expect(parseTimezone(tz), tz).toMatchObject({ ok: true })
    for (const tz of GOLDEN_TZ_REJECT) expect(parseTimezone(tz).ok, JSON.stringify(tz)).toBe(false)
  })
})

describe('주 키 불변식 — 모든 날짜는 정확히 한 주 기간에 속한다(겹침·틈 0, 개정 §4.2.4)', () => {
  it.each([['월', MON0], ['일', SUN0], ['월→일', RULES_MON_TO_SUN], ['일→월', RULES_SUN_TO_MON], ['월→일 늦은 E', RULES_MON_TO_SUN_LATE], ['전환 둘', RULES_TWO_SWITCHES]] as const)(
    '%s', (_n, rules) => {
      let key = weekKeyOf(rules, '2026-08-30')
      while (key < '2026-11-15') {
        const p = weekPeriodOf(rules, key)
        expect(p.start).toBe(key)
        for (let d = p.start; d < p.endExclusive; d = plus1(d)) expect(weekKeyOf(rules, d), d).toBe(key)
        const next = nextWeekKey(rules, key)
        expect(next).toBe(p.endExclusive)                                  // 틈 0
        expect(weekKeyOf(rules, next)).toBe(next)                          // 다음 주의 시작이 그 주의 키
        expect(prevWeekKey(rules, next)).toBe(key)                         // 이웃 키가 서로 되돌아간다(D35)
        key = next
      }
    })
  it('과도기 길이 — 월→일 6일, 일→월 8일, 늦은 E 의 앞 주는 정상 7일', () => {
    expect(weekPeriodOf(RULES_MON_TO_SUN, '2026-09-21')).toEqual({ start: '2026-09-21', endExclusive: '2026-09-27' })
    expect(weekPeriodOf(RULES_SUN_TO_MON, '2026-09-20')).toEqual({ start: '2026-09-20', endExclusive: '2026-09-28' })
    expect(weekPeriodOf(RULES_MON_TO_SUN_LATE, '2026-09-21')).toEqual({ start: '2026-09-21', endExclusive: '2026-09-28' })
    expect(weekPeriodOf(RULES_MON_TO_SUN_LATE, '2026-09-28')).toEqual({ start: '2026-09-28', endExclusive: '2026-10-04' })
    expect(weekPeriodOf(RULES_TWO_SWITCHES, '2026-10-04')).toEqual({ start: '2026-10-04', endExclusive: '2026-10-12' })
  })
  it('이웃 키 — ±7일이 아니다(과도기, D35)', () => {
    expect(prevWeekKey(RULES_MON_TO_SUN, '2026-09-27')).toBe('2026-09-21')
    expect(nextWeekKey(RULES_MON_TO_SUN, '2026-09-21')).toBe('2026-09-27')
    expect(nextWeekKey(RULES_SUN_TO_MON, '2026-09-20')).toBe('2026-09-28')
    expect(prevWeekKey(RULES_SUN_TO_MON, '2026-09-28')).toBe('2026-09-20')
    expect(nextWeekKey(MON0, '2026-09-21')).toBe('2026-09-28')
    expect(prevWeekKey(SUN0, '2026-09-27')).toBe('2026-09-20')
  })
  it('startOfWeek·currentRuleDay', () => {
    expect(startOfWeek('2026-09-23', 'monday')).toBe('2026-09-21')
    expect(startOfWeek('2026-09-23', 'sunday')).toBe('2026-09-20')
    expect(startOfWeek('2026-09-27', 'sunday')).toBe('2026-09-27')
    expect(currentRuleDay(RULES_MON_TO_SUN, '2026-09-26')).toBe('monday')
    expect(currentRuleDay(RULES_MON_TO_SUN, '2026-09-27')).toBe('sunday')
    expect(currentRuleDay(MON0, '2030-01-01')).toBe('monday')
  })
})

describe('라벨·표시 요일(개정 §4.2.5, 스펙 D4 — 기준일 = 키 + 3일)', () => {
  it.each([
    ['sunday 2026-06-28', SUN0, '2026-06-28', { year: 2026, month: 7, ordinal: 1 }],
    ['sunday 2026-06-21', SUN0, '2026-06-21', { year: 2026, month: 6, ordinal: 4 }],
    ['monday 2026-06-29', MON0, '2026-06-29', { year: 2026, month: 7, ordinal: 1 }],
    ['monday 2026-09-21', MON0, '2026-09-21', { year: 2026, month: 9, ordinal: 4 }],
    ['월→일 과도기 키 09-21', RULES_MON_TO_SUN, '2026-09-21', { year: 2026, month: 9, ordinal: 4 }],
    ['월→일 E 09-27', RULES_MON_TO_SUN, '2026-09-27', { year: 2026, month: 9, ordinal: 5 }],
    ['월→일 10-04', RULES_MON_TO_SUN, '2026-10-04', { year: 2026, month: 10, ordinal: 1 }],
  ] as const)('%s', (_n, rules, key, want) => {
    expect(weekLabelOf(rules, key)).toEqual(want)
  })
  it('과도기가 있어도 같은 (연, 월, 주차) 가 두 키에 붙지 않는다', () => {
    for (const rules of [RULES_MON_TO_SUN, RULES_SUN_TO_MON, RULES_TWO_SWITCHES]) {
      const seen = new Set<string>()
      for (let key = weekKeyOf(rules, '2026-08-01'); key < '2026-12-31'; key = nextWeekKey(rules, key)) {
        const l = weekLabelOf(rules, key)
        const tag = `${l.year}-${l.month}-${l.ordinal}`
        expect(seen.has(tag), `${key} ${tag}`).toBe(false)
        seen.add(tag)
      }
    }
  })
  it('표시 요일 = 기간 안 근무일, 근무일이 0이면 기간 전체', () => {
    const c = (workingDays: IsoDow[], rules: WeekStartRule[], off: string[] = []) =>
      calendarOf({ timezone: 'UTC', workingDays, weekStart: rules, holidays: off.map((date) => ({ date, kind: 'off' as const })) })
    expect(weekDisplayDays(c([1, 2, 3, 4, 5], SUN0), '2026-06-28')).toEqual(['2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02', '2026-07-03'])
    expect(weekDisplayDays(c([1, 2, 3, 4, 5, 6], MON0), '2026-09-21')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
    expect(weekDisplayDays(c([1, 2, 3, 4, 5], RULES_SUN_TO_MON), '2026-09-20')).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'])
    const allOff = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
    expect(weekDisplayDays(c([1, 2, 3, 4, 5], MON0, allOff), '2026-10-05')).toEqual([...allOff, '2026-10-10', '2026-10-11'])
  })
})

describe('규칙 검증 — parseWeekStartDay·parseWeekRules(개정 §4.2.2·§2.8.7)', () => {
  it('요일 하나만 입력으로 받는다 — 목록·다른 요일은 거부(클라이언트 patch 의 목록은 CONFIG_INVALID)', () => {
    expect(parseWeekStartDay('sunday')).toEqual({ ok: true, value: 'sunday' })
    expect(parseWeekStartDay('monday')).toEqual({ ok: true, value: 'monday' })
    for (const raw of ['friday', 'Sunday', ['monday'], [{ day: 'monday', from: null }], null]) expect(parseWeekStartDay(raw).ok, JSON.stringify(raw)).toBe(false)
  })
  it('올바른 규칙 목록', () => {
    for (const rules of [MON0, SUN0, RULES_MON_TO_SUN, RULES_SUN_TO_MON, RULES_MON_TO_SUN_LATE, RULES_TWO_SWITCHES]) {
      expect(parseWeekRules(rules), JSON.stringify(rules)).toEqual({ ok: true, value: rules })
    }
  })
  it.each([
    ['빈 목록', []],
    ['목록이 아님', 'sunday'],
    ['첫 원소 from 이 날짜', [{ day: 'monday', from: '2026-09-21' }]],
    ['요일 밖', [{ day: 'friday', from: null }]],
    ['전환일 요일이 day 가 아님', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-28' }]],
    ['이웃 같은 요일', [{ day: 'monday', from: null }, { day: 'monday', from: '2026-09-28' }]],
    ['from 이 날짜가 아님', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-02-30' }]],
    ['오름차순 아님', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-04' }, { day: 'monday', from: '2026-09-28' }]],
    ['전환이 너무 가깝다(둘째 과도기 키가 첫 전환보다 앞)', [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-09-27' }, { day: 'monday', from: '2026-09-28' }]],
    ['모르는 필드', [{ day: 'monday', from: null, note: 'x' }]],
  ] as const)('%s → 거부', (_n, raw) => {
    expect(parseWeekRules(raw).ok).toBe(false)
  })
})

describe('applyWeekStartChange — 개정 §4.2.4 변경 연산 표(계획 P7 결과형)', () => {
  it('예시 세 행 — 월→일 09-23, 일→월 09-23, 월→일 09-27(E ≤ T 라 +7)', () => {
    expect(applyWeekStartChange(MON0, 'sunday', '2026-09-23', 3)).toEqual({ ok: true, rules: RULES_MON_TO_SUN })
    expect(applyWeekStartChange(SUN0, 'monday', '2026-09-23', 3)).toEqual({ ok: true, rules: RULES_SUN_TO_MON })
    expect(applyWeekStartChange(MON0, 'sunday', '2026-09-27', 3)).toEqual({ ok: true, rules: RULES_MON_TO_SUN_LATE })
  })
  it('문서 0건이면 목록을 요일 하나로 교체한다(과거 전환도 지운다)', () => {
    expect(applyWeekStartChange(RULES_MON_TO_SUN, 'monday', '2026-10-30', 0)).toEqual({ ok: true, rules: MON0 })
    expect(applyWeekStartChange(MON0, 'sunday', '2026-09-23', 0)).toEqual({ ok: true, rules: SUN0 })
  })
  it('아직 적용 전 전환 — 같은 요일이면 그대로, 직전 요일로 되돌리면 그 원소를 지운다', () => {
    expect(applyWeekStartChange(RULES_MON_TO_SUN_LATE, 'sunday', '2026-09-30', 2)).toEqual({ ok: true, rules: RULES_MON_TO_SUN_LATE })
    expect(applyWeekStartChange(RULES_MON_TO_SUN_LATE, 'monday', '2026-09-30', 2)).toEqual({ ok: true, rules: MON0 })
  })
  it('지금 규칙과 같은 요일이면 바꾸지 않는다(no-op)', () => {
    expect(applyWeekStartChange(MON0, 'monday', '2026-09-23', 3)).toEqual({ ok: true, rules: MON0 })
    expect(applyWeekStartChange(RULES_MON_TO_SUN, 'sunday', '2026-10-30', 3)).toEqual({ ok: true, rules: RULES_MON_TO_SUN })
  })
  it('적용된 전환 뒤의 새 전환은 덧붙인다 — 과거 원소는 그대로', () => {
    const r = applyWeekStartChange(RULES_MON_TO_SUN, 'monday', '2026-10-07', 5)        // K = 10-04(일), N0 = 10-11, E = 10-12(월)
    expect(r).toEqual({ ok: true, rules: [...RULES_MON_TO_SUN, { day: 'monday', from: '2026-10-12' }] })
    if (r.ok) expect(parseWeekRules(r.rules).ok).toBe(true)
  })
  it('손상된 저장 규칙은 CALENDAR_PAST_RULE — 과거 규칙을 고칠 수 없어 거부(throw 없음)', () => {
    const broken = [{ day: 'monday', from: '2026-01-05' }] as WeekStartRule[]
    expect(applyWeekStartChange(broken, 'sunday', '2026-09-23', 3)).toMatchObject({ ok: false, code: 'CALENDAR_PAST_RULE' })
  })
})

describe('previewWeekStart — 미리보기 = 저장 판정과 같은 정의(D38·D53)', () => {
  it('월→일 — E·과도기 6일·기존 문서 그대로', () => {
    expect(previewWeekStart(MON0, 'sunday', '2026-09-23', ['2026-09-07', '2026-09-14', '2026-09-21']))
      .toEqual({ effectiveFrom: '2026-09-27', transitionDays: 6, keptDocs: 3, blockingWeeks: [], error: null })
  })
  it('일→월 — 과도기 8일', () => {
    expect(previewWeekStart(SUN0, 'monday', '2026-09-23', ['2026-09-20'])).toMatchObject({ effectiveFrom: '2026-09-28', transitionDays: 8, keptDocs: 1 })
  })
  it('E 뒤 미리 만든 문서는 거부 예정 목록 — 새 규칙에서 키가 바뀌는 문서', () => {
    expect(previewWeekStart(MON0, 'sunday', '2026-09-23', ['2026-09-21', '2026-09-28', '2026-10-05']))
      .toEqual({ effectiveFrom: '2026-09-27', transitionDays: 6, keptDocs: 1, blockingWeeks: ['2026-09-28', '2026-10-05'], error: null })
  })
  it('문서 0건 — 교체라 적용일·과도기가 없다', () => {
    expect(previewWeekStart(MON0, 'sunday', '2026-09-23', [])).toEqual({ effectiveFrom: null, transitionDays: null, keptDocs: 0, blockingWeeks: [], error: null })
  })
  it('거부 예정 목록은 최대 20', () => {
    const keys = Array.from({ length: 30 }, (_, i) => days(7 * i)('2026-09-28'))
    expect(previewWeekStart(MON0, 'sunday', '2026-09-23', keys).blockingWeeks).toHaveLength(20)
  })
  it('손상된 저장 규칙 — error 문구, 적용일 없음', () => {
    expect(previewWeekStart([{ day: 'monday', from: '2026-01-05' }], 'sunday', '2026-09-23', ['2026-09-21']))
      .toMatchObject({ effectiveFrom: null, transitionDays: null, error: expect.stringContaining('손상') })
  })
})
