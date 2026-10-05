import { describe, expect, it } from 'vitest'
import { weekDisplayDays } from '@/lib/domain/calendar'
import { calUtcMon, calUtcSun } from '../../helpers/calendarFixture'
import { weeklyReference } from '@/lib/report/forms/reference'

describe('weeklyReference (정본 §4.5.4)', () => {
  it('이번 주면 주말 기준일을 그대로 둔다', () => {
    const same = weeklyReference(calUtcMon, '2026-10-10', '2026-10-07')
    expect(same).toEqual({ today: '2026-10-10', weekStart: '2026-10-05' })
    const sunday = weeklyReference(calUtcSun, '2026-10-10', '2026-10-06')
    expect(sunday).toEqual({ today: '2026-10-10', weekStart: '2026-10-04' })
  })

  it('지난 주는 표시 요일 끝, 미래 주는 표시 요일 첫날', () => {
    const past = weeklyReference(calUtcMon, '2026-10-07', '2026-09-30')
    const pastDays = weekDisplayDays(calUtcMon, '2026-09-28')
    expect(past).toEqual({ today: pastDays[pastDays.length - 1], weekStart: '2026-09-28' })
    expect(past.today).toBe('2026-10-02')
    const future = weeklyReference(calUtcSun, '2026-10-07', '2026-10-12')
    const futureDays = weekDisplayDays(calUtcSun, '2026-10-11')
    expect(future).toEqual({ today: futureDays[0], weekStart: '2026-10-11' })
    expect(future.today).toBe('2026-10-12')
  })

  it('week 가 없으면 기준일과 그 주 키', () => {
    expect(weeklyReference(calUtcMon, '2026-10-07', null)).toEqual({ today: '2026-10-07', weekStart: '2026-10-05' })
  })
})
