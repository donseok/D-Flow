import { describe, expect, it } from 'vitest'
import { judgeRegression, median, percentile, perfBaseUrl } from '../../scripts/lib/perf.mjs'

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

describe('median — 표준 중앙값(짝수 개는 가운데 둘의 평균, percentile 과 다르게 보간한다)', () => {
  it('홀수 개는 가운데 관측값', () => {
    expect(median([3, 1, 2])).toBe(2)
  })
  it('짝수 개(정확히 2회 반복 측정)는 산술평균', () => {
    expect(median([4, 6])).toBe(5)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('빈 배열은 throw', () => {
    expect(() => median([])).toThrow('표본 없음')
  })
})

describe('perfBaseUrl — 격리된 로컬 앱만 측정', () => {
  it('3101·3102 는 통과하고 사용자 dev 서버 3000 과 원격은 거부한다', () => {
    expect(perfBaseUrl('http://localhost:3101/')).toBe('http://localhost:3101')
    expect(perfBaseUrl('http://127.0.0.1:3102')).toBe('http://127.0.0.1:3102')
    expect(() => perfBaseUrl('http://localhost:3000')).toThrow('3000')
    expect(() => perfBaseUrl('https://example.vercel.app')).toThrow()
  })
})

describe('judgeRegression — 반복 측정의 p95 중앙값 비교', () => {
  it('중앙값 비율로 +20% 이내를 판정한다', () => {
    expect(judgeRegression([100, 110, 90], [115, 119, 130], 0.2)).toEqual({ base: 100, cand: 119, ratio: 1.19, ok: true })
    expect(judgeRegression([100, 100, 100], [121, 125, 119], 0.2)).toMatchObject({ ratio: 1.21, ok: false })
  })
  it('빈 표본은 거부한다', () => { expect(() => judgeRegression([], [1])).toThrow('표본 없음') })
})
