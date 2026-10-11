import { describe, expect, it } from 'vitest'
import { workingDaysBetween, isWorkingDay, type IsoDow } from '@/lib/domain/calendar'

describe('근무일 계산의 긴 기간 대응', () => {
  it('일 단위 기준 계산과 모든 요일 조합·휴무·특정일 근무에서 일치한다', () => {
    for (let mask = 0; mask < 128; mask++) {
      const cal = { workingDays: new Set<IsoDow>([1, 2, 3, 4, 5, 6, 7].filter(day => mask & (1 << (day - 1))) as IsoDow[]), offDates: new Set(['2026-10-05', '2026-10-10']), workDates: new Set(['2026-10-05', '2026-10-11']) }
      for (let length = 1; length <= 31; length++) {
        let expected = 0
        let end = ''
        for (let day = 0; day < length; day++) {
          end = new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10)
          if (isWorkingDay(end, cal)) expected++
        }
        expect(workingDaysBetween('2026-10-01', end, cal)).toBe(expected)
      }
    }
  })
  it('0001년부터 9999년까지의 유효한 범위를 유한한 연산으로 계산한다', () => {
    const allDays = { workingDays: new Set<IsoDow>([1, 2, 3, 4, 5, 6, 7]), offDates: new Set<string>(), workDates: new Set<string>() }
    expect(workingDaysBetween('0001-01-01', '9999-12-31', allDays)).toBe(3652059)
    expect(workingDaysBetween('9999-12-31', '9999-12-31', allDays)).toBe(1)
  })
})
