import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as dates from '@/lib/domain/dates'
import { addDaysIso } from '@/lib/domain/dates'
import { walk } from '../invariants/_walk'

// 영업일 셋·seoul* 의 계약은 tests/domain/calendar.test.ts 의 isWorkingDay·workingDaysBetween·todayIn·ymdIn·stampIn 이 넘겨받았다
// (SP5 과제 2 — 자정 h23 경계 포함). 이 파일은 남는 표면(tz 무관 산술 + 과제 32 까지의 seoulToday)만 본다.
describe('dates.ts 의 남는 표면(스펙 §4.1 — 날짜 산술만, seoul* 는 calendar.ts 로)', () => {
  it('export 는 addDaysIso 와 과제 32 까지의 seoulToday 뿐', () => {
    expect(Object.keys(dates).sort()).toEqual(['addDaysIso', 'seoulToday'])
  })
  // UI-2(레인 B)가 셸의 '오늘'을 (app)/layout.tsx 에서 포털 로더로 옮겼다 — 과제 32 의 새 자리(UI 위험 파일이 아니다, merge 뒤 기록)
  it('seoulToday( 호출은 포털 로더(src/lib/data/portal.ts) 한 곳뿐 — 새 호출 금지(D-22a, 과제 32 가 지운다)', () => {
    const callers = walk('src').filter((f) => /\.(ts|tsx)$/.test(f) && f !== 'src/lib/domain/dates.ts')
      .filter((f) => /\bseoulToday\(/.test(readFileSync(f, 'utf8')))
    expect(callers).toEqual(['src/lib/data/portal.ts'])
  })
})

describe('addDaysIso', () => {
  it('월 경계를 넘긴다', () => {
    expect(addDaysIso('2026-01-31', 1)).toBe('2026-02-01')
  })
  it('연 경계를 넘긴다', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('음수 델타는 뒤로 간다(월 경계)', () => {
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('음수 델타는 뒤로 간다(연 경계)', () => {
    expect(addDaysIso('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('윤년 2월 29일을 만든다', () => {
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('평년 2월은 28일에서 3월로 넘어간다', () => {
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01')
  })
  it('0일은 그대로', () => {
    expect(addDaysIso('2026-08-18', 0)).toBe('2026-08-18')
  })
  it('한 자리 월·일은 zero-pad 된다', () => {
    expect(addDaysIso('2026-08-30', 3)).toBe('2026-09-02')
  })
})
