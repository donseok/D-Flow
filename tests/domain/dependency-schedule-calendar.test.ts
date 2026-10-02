// 의존성 일정의 근무일(SP5 A 과제 16 — 스펙 §4.1·§4.4, 개정 §4.2.3) — 요일 규칙·특정일 근무(work)·휴무(off)를 달력 하나로 판정하고,
// 근무일 탐색은 3,660일 상한에서 멈춘다. [RF5] 상한에 걸리면 화면·봇이 멈추지 않고 그 계산만 건너뛴 결과(calendarError)를 받는다.
import { describe, expect, it } from 'vitest'
import { computeDependencySchedule, shiftBusinessDays } from '@/lib/domain/dependencySchedule'
import { calendarOf } from '@/lib/domain/calendar'
import type { TaskDependency } from '@/lib/domain/types'

const SUN = [{ day: 'sunday' as const, from: null }]
const weekdays = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: SUN })
const sunToThu = calendarOf({ timezone: 'UTC', workingDays: [7, 1, 2, 3, 4], weekStart: SUN })
const dep = (id: string, p: string, s: string): TaskDependency =>
  ({ id, projectId: 'p', predecessorId: p, successorId: s, type: 'FS', lagDays: 0, origin: 'manual' })

describe('shiftBusinessDays — 달력의 근무일', () => {
  it('월~금: 금요일 다음 근무일은 월요일', () => {
    expect(shiftBusinessDays('2026-10-09', 1, weekdays)).toBe('2026-10-12')
  })
  it('일~목: 목요일 다음 근무일은 일요일(금·토 비근무)', () => {
    expect(shiftBusinessDays('2026-10-08', 1, sunToThu)).toBe('2026-10-11')
  })
  it('특정일 근무(토 work)는 근무일, 휴무(월 off)는 건너뛴다', () => {
    const cal = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: SUN,
      holidays: [{ date: '2026-10-10', kind: 'work' }, { date: '2026-10-12', kind: 'off' }] })
    expect(shiftBusinessDays('2026-10-09', 1, cal)).toBe('2026-10-10')
    expect(shiftBusinessDays('2026-10-10', 1, cal)).toBe('2026-10-13')
  })
  it('음수 이동·0 이동(비근무일이면 다음 근무일로 정규화)', () => {
    expect(shiftBusinessDays('2026-10-12', -1, weekdays)).toBe('2026-10-09')
    expect(shiftBusinessDays('2026-10-10', 0, weekdays)).toBe('2026-10-12')
  })
})

describe('[RF5] 근무일을 3,660일 안에 찾지 못하면', () => {
  // 2026-01-05(월)만 근무일이고 그 뒤 3,700일이 전부 휴무 — 후행의 시작을 찾는 탐색이 상한에 닿는다
  const off = Array.from({ length: 3700 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 6 + i))
    return d.toISOString().slice(0, 10)
  })
  const cal = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: SUN, holidays: off.map(date => ({ date, kind: 'off' as const })) })
  const tasks = [
    { id: 'A', plannedStart: '2026-01-05', plannedEnd: '2026-01-05', actualPct: 0 },
    { id: 'B', plannedStart: '2026-01-05', plannedEnd: '2026-01-05', actualPct: 0 },
  ]
  it('throw 하지 않고 일정 없음 + calendarError 를 돌려준다(화면이 에러 바운더리로 가지 않는다)', () => {
    const r = computeDependencySchedule(tasks, [dep('ab', 'A', 'B')], '2026-01-05', cal)
    expect(r.calendarError).toBe('CALENDAR_NO_WORKDAY')
    expect([...r.unscheduledTaskIds].sort()).toEqual(['A', 'B'])
    expect(r.byId.size).toBe(0)
    expect(r.criticalTaskIds.size).toBe(0)
  })
  it('정상 달력이면 calendarError 는 null', () => {
    expect(computeDependencySchedule(tasks, [dep('ab', 'A', 'B')], '2026-01-05', weekdays).calendarError).toBeNull()
  })
})
