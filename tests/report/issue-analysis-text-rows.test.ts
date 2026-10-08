import { describe, expect, it } from 'vitest'
import { estimateIssueAnalysisLineCount, splitIssueAnalysisTextForRows } from '@/lib/report/issues/textRows'

// 양식 엔진이 {{#rows}} 행의 긴 셀을 연속 행으로 나눌 때 쓰는 분할(정본 §4.4.6) — 원문을 잃지 않는다.
describe('splitIssueAnalysisTextForRows', () => {
  it('긴 텍스트를 유니코드 손실이나 말줄임 없이 표시 행으로 나눈다', () => {
    const text = `저장위치·플랜트 기준 불일치 ${'가'.repeat(500)} 마지막 조치 문장.`
    const chunks = splitIssueAnalysisTextForRows(text, 12, 5)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => estimateIssueAnalysisLineCount(chunk, 12) <= 5)).toBe(true)
    expect(chunks.join('')).not.toContain('…')
  })

  it('저장 상한인 20,000자 본문도 마지막 코드포인트까지 보존한다', () => {
    const text = `${'가'.repeat(19_990)}😀BODY-END`
    expect(text.length).toBe(20_000)
    const chunks = splitIssueAnalysisTextForRows(text, 34)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.join('')).toBe(text)
    expect(chunks.every(chunk => estimateIssueAnalysisLineCount(chunk, 34) <= 15)).toBe(true)
    expect(chunks.some(chunk => chunk.endsWith('\ud83d'))).toBe(false)
    expect(chunks.some(chunk => chunk.startsWith('\ude00'))).toBe(false)
  })

  it('빈 값은 빈 조각 하나, 잘못된 줄 수·열 너비는 던진다', () => {
    expect(splitIssueAnalysisTextForRows('', 12)).toEqual([''])
    expect(() => splitIssueAnalysisTextForRows('가', 12, 0)).toThrow()
    expect(() => estimateIssueAnalysisLineCount('가', 0)).toThrow()
  })
})
