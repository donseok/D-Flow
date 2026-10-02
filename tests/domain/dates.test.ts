import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as dates from '@/lib/domain/dates'
import { addDaysIso } from '@/lib/domain/dates'
import { walk } from '../invariants/_walk'

// 영업일 셋·seoul* 의 계약은 tests/domain/calendar.test.ts 의 isWorkingDay·workingDaysBetween·todayIn·ymdIn·stampIn 이 넘겨받았다
// (SP5 과제 2 — 자정 h23 경계 포함). 이 파일은 남는 표면(tz 무관 산술)만 본다.
describe('dates.ts 의 남는 표면(스펙 §4.1 — 날짜 산술만, seoul* 는 calendar.ts 로)', () => {
  it('export 는 addDaysIso 뿐 — seoulToday 는 과제 32 가 지웠다', () => {
    expect(Object.keys(dates).sort()).toEqual(['addDaysIso'])
  })
  // 옛 가드는 호출 "파일"만 셌다 — UI-2 가 포털 로더 한 파일에 호출 넷을 넣어도 초록이었다(merge 리뷰 P2). 이름이 나온 자리 수를 센다:
  // 파일이 하나든 여럿이든, 호출이든 정의·import·주석이든 seoul* 이름은 src·scripts 어디에도 0 이다(오늘은 calendar.ts 의 todayIn(tz, now) 하나).
  it('seoul* 이름(seoulToday·seoulYmd·seoulStamp …)이 src·scripts 에 0 자리 — 파일 수가 아니라 나온 수를 센다', () => {
    const files = [...walk('src'), ...walk('scripts', undefined, /\.(ts|tsx|mjs|js)$/)]
    const hits = files.flatMap((f) => (readFileSync(f, 'utf8').match(/\bseoul[A-Z]\w*/g) ?? []).map((m) => `${f}: ${m}`))
    expect(hits).toEqual([])
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
