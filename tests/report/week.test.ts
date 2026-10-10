// 주간 시트 주차 서식(SP5 A 과제 14 — 스펙 D4·D35, 개정 §4.2.5) — 라벨은 "키 + 3일이 속한 달의 몇 번째 주" 하나, 범위·칸은 표시 요일(근무일),
// 이웃 주는 키 함수(±7일이 아니다 — 과도기 주 6·8일). 의도된 동작 변화: 2026-06-29(월) 주가 '6월5주차' → '7월1주차',
// 2026-07-06 주가 '7월1주차' → '7월2주차'(같은 주가 생성일에 따라 둘로 갈리던 일이 사라진다).
import { describe, expect, it } from 'vitest'
import { normalizeWeekParam, sheetWeekMeta, weekDisplayLabel, weekLabelTexts } from '@/lib/report/week'
import { calendarOf, nextWeekKey, prevWeekKey, type WeekStartRule } from '@/lib/domain/calendar'
import { MON_RULES, SUN_RULES, calUtcMon, calUtcSun } from '../helpers/calendarFixture'

const TRANSITION: WeekStartRule[] = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }]
const calTransition = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: TRANSITION })

describe('weekLabelTexts — 개정 §4.2.5 표', () => {
  it.each([
    ['sunday', calUtcSun, '2026-06-28', '7월1주차', '7월 1주차', '2026년 7월 1주차 (6/29~7/3)', '6/29~7/3'],
    ['sunday', calUtcSun, '2026-06-21', '6월4주차', '6월 4주차', '2026년 6월 4주차 (6/22~6/26)', '6/22~6/26'],
    ['monday', calUtcMon, '2026-06-29', '7월1주차', '7월 1주차', '2026년 7월 1주차 (6/29~7/3)', '6/29~7/3'],
  ])('%s 키 %s', (_d, cal, key, weekTag, label, reportLabel, range) => {
    expect(weekLabelTexts(cal, key)).toEqual({ weekTag, label, reportLabel, range })
  })
  it('monday + 근무 [1..6] — 2026-09-21 주는 9월 4주차, 6칸 9/21~9/26', () => {
    const cal = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5, 6], weekStart: MON_RULES })
    expect(weekLabelTexts(cal, '2026-09-21')).toEqual({
      weekTag: '9월4주차', label: '9월 4주차', reportLabel: '2026년 9월 4주차 (9/21~9/26)', range: '9/21~9/26',
    })
  })
  it('근무일이 0인 주는 기간 전체가 범위(빈 범위를 만들지 않는다)', () => {
    const cal = calendarOf({
      timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: SUN_RULES,
      holidays: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(date => ({ date, kind: 'off' as const })),
    })
    expect(weekLabelTexts(cal, '2026-10-04').range).toBe('10/4~10/10')
  })
  it('특정일 근무(토요일 work)는 범위에 든다', () => {
    const cal = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: SUN_RULES, holidays: [{ date: '2026-10-10', kind: 'work' }] })
    expect(weekLabelTexts(cal, '2026-10-04').range).toBe('10/5~10/10')
  })
})

describe('sheetWeekMeta — 시트 머리(금주 범위·차주 범위)', () => {
  it('월요일 규칙: 2026-07-06 주는 7월 2주차(옛 규칙 7월 1주차)', () => {
    expect(sheetWeekMeta(calUtcMon, '2026-07-06')).toEqual({
      weekTag: '7월2주차', label: '7월 2주차', thisRange: '7/6~7/10', nextRange: '7/13~7/17',
    })
  })
  it('월요일 규칙: 2026-06-29 주는 7월 1주차(옛 규칙 6월 5주차)', () => {
    const m = sheetWeekMeta(calUtcMon, '2026-06-29')
    expect(m.weekTag).toBe('7월1주차')
    expect(m.thisRange).toBe('6/29~7/3')
  })
  it('과도기 주(월→일, E = 10-11): 10-05 주는 표시 5칸(10/5~10/9), 차주는 일요일 키 10-11 의 범위 10/12~10/16', () => {
    expect(sheetWeekMeta(calTransition, '2026-10-05')).toEqual({
      weekTag: '10월2주차', label: '10월 2주차', thisRange: '10/5~10/9', nextRange: '10/12~10/16',
    })
    expect(sheetWeekMeta(calTransition, '2026-10-11').label).toBe('10월 3주차')
  })
})

describe('weekDisplayLabel — 화면 표시용 주차 라벨', () => {
  it('시트 머리의 라벨·범위와 글자까지 같다', () => {
    for (const [cal, key] of [[calUtcMon, '2026-07-06'], [calUtcSun, '2026-06-28'], [calTransition, '2026-10-05']] as const) {
      const m = sheetWeekMeta(cal, key)
      expect(weekDisplayLabel(cal, key)).toBe(`${m.label} (${m.thisRange})`)
    }
  })
})

describe('normalizeWeekParam — URL ?week= 정규화 [RF2]', () => {
  const TODAY = '2026-10-14'
  it('과도기 주 안의 아무 날짜는 과도기 키로 — 같은 문서를 연다', () => {
    for (const d of ['2026-10-05', '2026-10-07', '2026-10-10']) expect(normalizeWeekParam(TRANSITION, d, TODAY), d).toBe('2026-10-05')
  })
  it('옛 월요일 키 URL 은 그대로(과거 규칙으로 해석 — 과거 URL 유지)', () => {
    expect(normalizeWeekParam(TRANSITION, '2026-09-28', TODAY)).toBe('2026-09-28')
    expect(normalizeWeekParam(TRANSITION, '2026-09-30', TODAY)).toBe('2026-09-28')
  })
  it('일요일 규칙 뒤의 날짜는 일요일 키', () => {
    expect(normalizeWeekParam(TRANSITION, '2026-10-14', TODAY)).toBe('2026-10-11')
  })
  it('형식·달력이 틀린 값·없는 값은 오늘의 키', () => {
    for (const raw of [undefined, null, '', 'abc', '2026-02-30', '2026-10-7']) expect(normalizeWeekParam(TRANSITION, raw, TODAY), String(raw)).toBe('2026-10-11')
  })
})

describe('이웃 키 — 과도기 주를 건너뛰지 않는다 [RF2]', () => {
  it('다음 주: 옛 월요일 키 09-28 → 과도기 키 10-05 → 일요일 키 10-11 → 10-18', () => {
    expect(nextWeekKey(TRANSITION, '2026-09-28')).toBe('2026-10-05')
    expect(nextWeekKey(TRANSITION, '2026-10-05')).toBe('2026-10-11')
    expect(nextWeekKey(TRANSITION, '2026-10-11')).toBe('2026-10-18')
  })
  it('이전 주: 10-18 → 10-11 → 10-05 → 09-28', () => {
    expect(prevWeekKey(TRANSITION, '2026-10-18')).toBe('2026-10-11')
    expect(prevWeekKey(TRANSITION, '2026-10-11')).toBe('2026-10-05')
    expect(prevWeekKey(TRANSITION, '2026-10-05')).toBe('2026-09-28')
  })
})
