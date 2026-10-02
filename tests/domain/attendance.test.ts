import { describe, it, expect } from 'vitest'
import { summarize, monthMatrix, monthGridRange, weekdayColumns, calendarDayInfo, calendarViewOf, holidayNamesOf, recordsByDate, ATTENDANCE_META } from '@/lib/domain/attendance'
import { SUNDAY_CAL, MONDAY_CAL, WORKSPACE_CAL, HOLIDAY_NAMES } from '../fixtures/calendarView'
import type { AttendanceRecord, AttendanceType } from '@/lib/domain/types'

function rec(id: string, date: string, type: AttendanceType, memberId = 'm1'): AttendanceRecord {
  return { id, projectId: 'p1', memberId, date, type, note: null }
}

describe('summarize', () => {
  it('counts total / leave(annual+half+sick) / trip / remote', () => {
    const records = [
      rec('1', '2026-09-01', 'annual'),
      rec('2', '2026-09-02', 'half'),
      rec('3', '2026-09-03', 'sick'),
      rec('4', '2026-09-04', 'trip'),
      rec('5', '2026-09-05', 'remote'),
      rec('6', '2026-09-06', 'work'),
      rec('7', '2026-09-07', 'official'),
    ]
    expect(summarize(records)).toEqual({ total: 7, leave: 3, trip: 1, remote: 1 })
  })

  it('returns zeros for empty input', () => {
    expect(summarize([])).toEqual({ total: 0, leave: 0, trip: 0, remote: 0 })
  })
})

describe('monthMatrix — 첫 열 = 규칙 시작 요일(SP5 §4.4)', () => {
  it('6×7 이다(일·월 둘 다)', () => {
    for (const first of ['sunday', 'monday'] as const) {
      const m = monthMatrix(2026, 8, first)
      expect(m).toHaveLength(6)
      m.forEach(week => expect(week).toHaveLength(7))
    }
  })

  it('일요일 시작 — 1일 이전의 일요일에서 시작한다(2026-09-01 화 → 08-30 일)', () => {
    const m = monthMatrix(2026, 8, 'sunday')
    expect(m[0][0]).toBe('2026-08-30')
    expect(m[0][2]).toBe('2026-09-01')
  })

  it('월요일 시작 — 1일 이전의 월요일에서 시작한다(2026-09-01 화 → 08-31 월)', () => {
    const m = monthMatrix(2026, 8, 'monday')
    expect(m[0][0]).toBe('2026-08-31')
    expect(m[0][1]).toBe('2026-09-01')
  })

  it('1일이 시작 요일이면 그 날이 첫 칸이다(2026-06-01 월 · 2026-11-01 일)', () => {
    expect(monthMatrix(2026, 5, 'monday')[0][0]).toBe('2026-06-01')
    expect(monthMatrix(2026, 10, 'sunday')[0][0]).toBe('2026-11-01')
  })

  it('그 달의 모든 날을 담는다', () => {
    for (const first of ['sunday', 'monday'] as const) {
      const flat = monthMatrix(2026, 8, first).flat()
      expect(flat).toContain('2026-09-15')
      expect(flat).toContain('2026-09-30')
    }
  })

  it('1월(month0=0)은 앞 해 12월에서 시작한다', () => {
    expect(monthMatrix(2026, 0, 'sunday')[0][0]).toBe('2025-12-28')   // 2026-01-01 목
    expect(monthMatrix(2026, 0, 'monday')[0][0]).toBe('2025-12-29')
    expect(monthMatrix(2026, 0, 'monday').flat()).toContain('2026-01-31')
  })

  it('12월(month0=11)은 다음 해 1월까지 덮는다', () => {
    const flat = monthMatrix(2026, 11, 'monday').flat()
    expect(flat).toContain('2026-12-31')
    expect(flat).toContain('2027-01-01')
  })

  it('month0 가 범위를 넘으면 Date.UTC 처럼 해를 넘긴다(12 → 다음 해 1월)', () => {
    expect(monthMatrix(2026, 12, 'sunday')).toEqual(monthMatrix(2027, 0, 'sunday'))
  })
})

describe('monthGridRange — 그리드 첫 칸·마지막 칸(회의 페이지·뷰의 사본 넷을 대체)', () => {
  it('일요일 시작 2026-10 = 09-27 ~ 11-07', () => {
    expect(monthGridRange(2026, 9, 'sunday')).toEqual(['2026-09-27', '2026-11-07'])
  })
  it('월요일 시작 2026-10 = 09-28 ~ 11-08', () => {
    expect(monthGridRange(2026, 9, 'monday')).toEqual(['2026-09-28', '2026-11-08'])
  })
  it('monthMatrix 의 첫 칸·마지막 칸과 같다', () => {
    const m = monthMatrix(2026, 1, 'monday')
    expect(monthGridRange(2026, 1, 'monday')).toEqual([m[0][0], m[5][6]])
  })
})

describe('weekdayColumns — 머리 일곱 칸', () => {
  it('일요일 시작', () => {
    expect(weekdayColumns('sunday').map(c => c.key)).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
    expect(weekdayColumns('sunday').map(c => c.iso)).toEqual([7, 1, 2, 3, 4, 5, 6])
  })
  it('월요일 시작', () => {
    expect(weekdayColumns('monday').map(c => c.key)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
    expect(weekdayColumns('monday').map(c => c.iso)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('calendarDayInfo — 쉬는 날은 근무 요일 + holidays 에서만(개정 §5.12.5 ②)', () => {
  it('평일은 근무, 토·일은 비근무(월~금 규칙)', () => {
    expect(calendarDayInfo('2026-10-06', SUNDAY_CAL)).toEqual({ working: true, name: null })     // 화
    expect(calendarDayInfo('2026-10-11', SUNDAY_CAL)).toEqual({ working: false, name: null })    // 일
  })
  it('휴무 예외는 평일이어도 비근무이고 이름이 붙는다', () => {
    expect(calendarDayInfo('2026-10-05', MONDAY_CAL, HOLIDAY_NAMES)).toEqual({ working: false, name: '창립기념일' })
  })
  it('근무 예외는 토요일이어도 근무다', () => {
    expect(calendarDayInfo('2026-10-10', MONDAY_CAL, HOLIDAY_NAMES)).toEqual({ working: true, name: '대체 근무' })
  })
  it('한국 고정 공휴일 날짜라도 holidays 에 없으면 근무일이다(오버레이 0 — 2026-10-09 금)', () => {
    expect(calendarDayInfo('2026-10-09', SUNDAY_CAL)).toEqual({ working: true, name: null })
  })
  it('워크스페이스 달력은 요일만 — 일~목 근무면 금·토가 비근무, 일요일은 근무', () => {
    expect(calendarDayInfo('2026-10-09', WORKSPACE_CAL).working).toBe(false)   // 금
    expect(calendarDayInfo('2026-10-11', WORKSPACE_CAL).working).toBe(true)    // 일
  })
})

describe('recordsByDate', () => {
  it('groups records by their date key', () => {
    const a = rec('1', '2026-09-15', 'trip', 'm3')
    const b = rec('2', '2026-09-15', 'remote', 'm4')
    const c = rec('3', '2026-09-16', 'annual', 'm1')
    const grouped = recordsByDate([a, b, c])
    expect(grouped['2026-09-15']).toEqual([a, b])
    expect(grouped['2026-09-16']).toEqual([c])
    expect(grouped['2026-09-17']).toBeUndefined()
  })

  it('returns an empty object for no records', () => {
    expect(recordsByDate([])).toEqual({})
  })
})

describe('ATTENDANCE_META', () => {
  it('has an entry with korean label for every attendance type', () => {
    const types: AttendanceType[] = ['work', 'remote', 'annual', 'half', 'sick', 'trip', 'official', 'absent']
    for (const t of types) {
      expect(ATTENDANCE_META[t]).toBeTruthy()
      expect(ATTENDANCE_META[t].label.length).toBeGreaterThan(0)
      expect(ATTENDANCE_META[t].dot).toMatch(/^bg-/)
    }
  })
})

describe('calendarViewOf·holidayNamesOf — 서버 페이지의 달력 props', () => {
  it('날짜 예외가 없는 달력(워크스페이스)은 빈 집합을 채운다', () => {
    const v = calendarViewOf({ workingDays: new Set([1, 2, 3]), weekStart: [{ day: 'monday', from: null }] })
    expect([...v.offDates]).toEqual([])
    expect([...v.workDates]).toEqual([])
    expect(v.weekStart).toEqual([{ day: 'monday', from: null }])
  })
  it('프로젝트 달력은 그대로 넘긴다', () => {
    expect(calendarViewOf(MONDAY_CAL).offDates.has('2026-10-05')).toBe(true)
  })
  it('빈 이름은 빼고 날짜 → 이름', () => {
    expect(holidayNamesOf([{ date: '2026-10-05', name: '창립기념일' }, { date: '2026-10-10', name: '  ' }])).toEqual({ '2026-10-05': '창립기념일' })
  })
})
