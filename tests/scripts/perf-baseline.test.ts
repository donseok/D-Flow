import { describe, expect, it } from 'vitest'
import { percentile } from '../../scripts/lib/perf.mjs'

describe('percentile — 최근접 순위(표본 밖 보간 없음)', () => {
  it('p50 은 정렬된 가운데 관측값', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
  })
  it('p95 는 1..20 중 19(20 이 아니다 — 최근접 순위는 올림한 인덱스)', () => {
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19)
  })
  it('빈 배열은 throw', () => {
    expect(() => percentile([], 50)).toThrow('표본 없음')
  })
})
