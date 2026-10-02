// src/lib/domain/calendar.ts ① — 날짜·시간대·근무일(SP5 스펙 §4.1·D54·R5, 개정 §4.2.3·§4.2.6). 순수 모듈 — now 를 주입한다.
// 날짜 기대값은 손으로 셌다: 2026-09-27·2026-03-08·2026-11-01 은 일요일, 2026-10-03 은 토요일, 2026-10-05 는 월요일.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CalendarError, DEFAULT_TIMEZONE, DEFAULT_WEEK_RULES, DEFAULT_WORKING_DAYS, IANA_NAME, WEEK_START_DAYS, WORKDAY_SEARCH_LIMIT,
  calendarOf, isWorkingDay, isoDowOf, nextWorkingDay, parseTimezone, parseWorkingDays, stampIn, todayIn, workingDaysBetween, ymdIn,
  zonedMidnightUtc, type IsoDow,
} from '@/lib/domain/calendar'

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
