import { describe, it, expect } from 'vitest'
import { buildGanttScale as buildGanttScaleReal, centeredTimelineScrollLeft, collectPlannedDates, ganttWeekSpans, groupGanttMilestones } from '@/lib/domain/ganttScale'
import type { WeekStartRule } from '@/lib/domain/calendar'
import { calUtcSun, MON_RULES, SUN_RULES } from '../helpers/calendarFixture'

// 과제 16 — 달력은 넷째 인자(필수). 이 파일의 기존 단언은 월~금 근무(UTC·일요일 규칙) 달력으로 같다
const buildGanttScale = (dates: string[], today: string, dayPx: number) => buildGanttScaleReal(dates, today, dayPx, calUtcSun)

describe('buildGanttScale', () => {
  it('양끝 일자 포함하여 day 배열 생성', () => {
    const s = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(s.rangeStart).toBe('2026-07-06')
    expect(s.rangeEnd).toBe('2026-07-10')
    expect(s.days).toEqual(['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10'])
    expect(s.ganttW).toBe(5 * 24)
  })

  it('xOf는 시작일 기준 일수 × dayPx', () => {
    const s = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(s.xOf('2026-07-06')).toBe(0)
    expect(s.xOf('2026-07-08')).toBe(2 * 24)
  })

  it('비근무일 판정(월~금 달력 — 토·일)', () => {
    const s = buildGanttScale(['2026-07-06', '2026-07-12'], '2026-07-06', 24)
    expect(s.isOffDay('2026-07-11')).toBe(true) // 토
    expect(s.isOffDay('2026-07-12')).toBe(true) // 일
    expect(s.isOffDay('2026-07-10')).toBe(false) // 금
  })

  it('기준일이 일정 밖이어도 축에 포함해 todayX를 항상 계산', () => {
    const inRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-07-08', 24)
    expect(inRange.todayX).toBe(2 * 24 + 12)

    const afterRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-08-01', 24)
    expect(afterRange.rangeEnd).toBe('2026-08-01')
    expect(afterRange.todayX).toBe(afterRange.ganttW - 12)

    const beforeRange = buildGanttScale(['2026-07-06', '2026-07-10'], '2026-06-20', 24)
    expect(beforeRange.rangeStart).toBe('2026-06-20')
    expect(beforeRange.todayX).toBe(12)
  })

  it('일자 없으면 today를 단일 범위로', () => {
    const s = buildGanttScale([], '2026-07-08', 24)
    expect(s.rangeStart).toBe('2026-07-08')
    expect(s.rangeEnd).toBe('2026-07-08')
    expect(s.days).toEqual(['2026-07-08'])
  })

  it('월/주 밴드 생성', () => {
    const s = buildGanttScale(['2026-07-06', '2026-08-05'], '2026-07-10', 24)
    expect(s.months.map(m => m.label)).toEqual(['7월', '8월'])
    expect(s.weeks[0].label).toBe('W01')
    expect(s.weeks.length).toBeGreaterThan(1)
  })
})

describe('centeredTimelineScrollLeft', () => {
  it('sticky 열을 제외한 실제 타임라인 가시 영역 중앙에 기준일을 배치', () => {
    expect(centeredTimelineScrollLeft({
      timelineLeft: 1198,
      dateX: 1068,
      frozenWidth: 404,
      viewportWidth: 1200,
      scrollWidth: 3406,
    })).toBe(1464)
  })

  it('스크롤 가능 범위의 시작과 끝으로 안전하게 제한', () => {
    expect(centeredTimelineScrollLeft({
      timelineLeft: 100,
      dateX: 0,
      frozenWidth: 400,
      viewportWidth: 1200,
      scrollWidth: 1000,
    })).toBe(0)
    expect(centeredTimelineScrollLeft({
      timelineLeft: 1198,
      dateX: 5000,
      frozenWidth: 404,
      viewportWidth: 1200,
      scrollWidth: 3406,
    })).toBe(2206)
  })
})

describe('collectPlannedDates', () => {
  it('트리 전체에서 계획 일자를 평탄 수집', () => {
    const tree = [
      {
        plannedStart: '2026-07-01', plannedEnd: '2026-07-09', children: [
          { plannedStart: '2026-07-01', plannedEnd: '2026-07-07', children: [] },
          { plannedStart: null, plannedEnd: null, children: [] },
        ],
      },
    ]
    const dates = collectPlannedDates(tree)
    expect(dates).toContain('2026-07-01')
    expect(dates).toContain('2026-07-09')
    expect(dates).toContain('2026-07-07')
    expect(dates).not.toContain(null as unknown as string)
  })
})

describe('groupGanttMilestones', () => {
  const p = (id: string, name: string, date: string, status: 'done' | 'overdue' | 'upcoming', dday: number) =>
    ({ id, name, date, status, dday })

  it('빈 입력은 빈 배열', () => {
    expect(groupGanttMilestones([])).toEqual([])
  })

  it('같은 날짜는 마커 1개로 병합하고 이름을 입력 순서대로 모은다', () => {
    const out = groupGanttMilestones([
      p('a', '분석 완료', '2026-08-01', 'done', -9),
      p('b', '설계 승인', '2026-08-01', 'done', -9),
      p('c', '개발 착수', '2026-08-20', 'upcoming', 10),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].names).toEqual(['분석 완료', '설계 승인'])
    expect(out[0].dday).toBe(-9)
    expect(out[1].names).toEqual(['개발 착수'])
  })

  it('대표 상태는 overdue > upcoming > done 우선', () => {
    const mixed = groupGanttMilestones([
      p('a', 'A', '2026-08-01', 'done', 0),
      p('b', 'B', '2026-08-01', 'overdue', 0),
      p('c', 'C', '2026-08-01', 'upcoming', 0),
    ])
    expect(mixed[0].status).toBe('overdue')
    const noOverdue = groupGanttMilestones([
      p('a', 'A', '2026-08-01', 'done', 0),
      p('c', 'C', '2026-08-01', 'upcoming', 0),
    ])
    expect(noOverdue[0].status).toBe('upcoming')
  })

  it('마커는 날짜 오름차순 정렬, tier는 0/1 교차', () => {
    const out = groupGanttMilestones([
      p('c', 'C', '2026-09-01', 'upcoming', 40),
      p('a', 'A', '2026-07-01', 'done', -20),
      p('b', 'B', '2026-08-01', 'done', -9),
    ])
    expect(out.map(m => m.date)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01'])
    expect(out.map(m => m.tier)).toEqual([0, 1, 0])
  })
})

describe('[BUG-16] ganttWeekSpans — 주 머리는 주 시작 설정(calendar.week_start)의 주로 끊는다', () => {
  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10))
  it('리포트의 사례 — 축이 토요일(10/10)에 시작, 주 시작 일요일: W01 은 10/10 하루, W02 는 10/11(일)부터 7일', () => {
    expect(ganttWeekSpans(days('2026-10-10', 16), SUN_RULES)).toEqual([
      { label: 'W01', sub: '10/10', startIndex: 0, length: 1 },
      { label: 'W02', sub: '10/11', startIndex: 1, length: 7 },
      { label: 'W03', sub: '10/18', startIndex: 8, length: 7 },
      { label: 'W04', sub: '10/25', startIndex: 15, length: 1 },
    ])
  })
  it('주 시작 월요일이면 같은 축이 월요일(10/12)에 끊긴다 — 설정을 따른다', () => {
    expect(ganttWeekSpans(days('2026-10-10', 10), MON_RULES).map(w => [w.sub, w.length])).toEqual([['10/10', 2], ['10/12', 7], ['10/19', 1]])
  })
  it('주간보고와 같은 주 경계 — 과도기 주(월→일, E = 10/11)는 6일', () => {
    const rules: WeekStartRule[] = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }]
    expect(ganttWeekSpans(days('2026-10-05', 14), rules).map(w => [w.sub, w.length])).toEqual([['10/5', 6], ['10/11', 7], ['10/18', 1]])
  })
  it('buildGanttScale 에 주 시작을 넘기면 주 밴드가 그 경계다(생략하면 축 첫날부터 7일씩 — 옛 동작)', () => {
    const withRule = buildGanttScaleReal(['2026-10-10', '2026-10-25'], '2026-10-10', 10, calUtcSun, SUN_RULES)
    expect(withRule.weeks.map(w => [w.label, w.left, w.width])).toEqual([['W01', 0, 10], ['W02', 10, 70], ['W03', 80, 70], ['W04', 150, 10]])
    expect(buildGanttScale(['2026-10-10', '2026-10-25'], '2026-10-10', 10).weeks.map(w => w.width)).toEqual([70, 70, 20])
  })
  it('빈 축은 빈 배열', () => { expect(ganttWeekSpans([], SUN_RULES)).toEqual([]) })
})

