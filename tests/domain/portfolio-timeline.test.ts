import { describe, expect, it } from 'vitest'
import { portfolioMonthTicks } from '@/lib/domain/portfolioTimeline'

describe('포트폴리오 월 눈금', () => {
  it('첫날을 포함하고 중간 날짜에서 시작하면 다음 달부터 표시한다', () => {
    expect(portfolioMonthTicks('2026-01-01', '2026-03-31')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01'])
    expect(portfolioMonthTicks('2026-12-15', '2027-02-01')).toEqual(['2027-01-01', '2027-02-01'])
  })
  it('9999년 말에서도 유한한 눈금을 반환하며 축 범위를 벗어나지 않는다', () => {
    const ticks = portfolioMonthTicks('2026-01-01', '9999-12-31')
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThanOrEqual(8)
    expect(ticks.every(date => date >= '2026-01-01' && date <= '9999-12-31')).toBe(true)
    expect(portfolioMonthTicks('9999-12-01', '9999-12-31')).toEqual(['9999-12-01'])
  })
  it('범위가 비었거나 입력이 잘못되면 눈금을 만들지 않는다', () => {
    expect(portfolioMonthTicks('2026-03-02', '2026-03-31')).toEqual([])
    expect(portfolioMonthTicks('invalid', '2026-03-31')).toEqual([])
  })
})
