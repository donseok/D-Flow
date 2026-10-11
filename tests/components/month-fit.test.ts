import { describe, expect, it } from 'vitest'
import { visibleChips } from '@/components/calendar/useMonthFit'

describe('visibleChips — 한 칸에 보일 항목 수', () => {
  it('다 들어가면 전부 보인다', () => {
    expect(visibleChips(0, 3)).toBe(0)
    expect(visibleChips(3, 3)).toBe(3)
  })
  it('넘치면 한 줄을 더보기에 내준다 — 보이는 칩 + 더보기 = 칸의 줄 수', () => {
    expect(visibleChips(4, 3)).toBe(2)
    expect(visibleChips(9, 1)).toBe(0)
  })
})
