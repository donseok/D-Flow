import { describe, expect, it } from 'vitest'
import { DEFAULT_ISSUE_ANALYSIS_VOCAB, analysisVocab, issueAnalysisVocabOf } from '@/lib/report/issues/model'
import { deckLabelsOf, issueSourceLines } from '@/lib/report/issues/deckPlan'
import { defaultVocab } from '@/lib/settings/vocab'

// SP5 B4 — 분석 실행의 어휘 스냅샷. 기본 어휘 프로젝트는 싣지 않아(입력 해시·저장 실행이 B4 이전과 같다) 캐시가 유지된다.
describe('issueAnalysisVocabOf', () => {
  it('기본 어휘면 undefined, 라벨·활성·순서가 다르면 스냅샷', () => {
    expect(issueAnalysisVocabOf(defaultVocab('issues.cause_categories'), defaultVocab('issues.sources'))).toBeUndefined()
    const renamed = defaultVocab('issues.cause_categories').map(e => (e.code === 'it' ? { ...e, label: 'D · 디지털' } : e))
    expect(issueAnalysisVocabOf(renamed, defaultVocab('issues.sources'))?.causeCategories.at(-1)).toEqual({ code: 'it', label: 'D · 디지털' })
    const off = defaultVocab('issues.cause_categories').map(e => (e.code === 'organization' ? { ...e, active: false } : e))
    expect(issueAnalysisVocabOf(off, defaultVocab('issues.sources'))?.causeCategories.map(e => e.code)).toEqual(['strategy_policy', 'process', 'it'])
  })
  it('없는 실행은 기본 어휘로 읽는다', () => {
    expect(analysisVocab({})).toBe(DEFAULT_ISSUE_ANALYSIS_VOCAB)
  })
})

describe('덱 표기', () => {
  it('기본 라벨 그대로인 출처는 B4 이전 덱 문구, 바꾼 라벨은 그 라벨, 목록 밖 code 는 code', () => {
    const def = deckLabelsOf(DEFAULT_ISSUE_ANALYSIS_VOCAB)
    expect(def.source('interview')).toBe('현업 인터뷰')
    expect(def.cause('it')).toBe('I · IT')
    const custom = deckLabelsOf({ ...DEFAULT_ISSUE_ANALYSIS_VOCAB, sources: [{ code: 'interview', label: '고객 면담' }] })
    expect(custom.source('interview')).toBe('고객 면담')
    expect(custom.source('ghost')).toBe('ghost')
  })
  it('issueSourceLines 는 넘긴 표기를 쓴다', () => {
    const labels = deckLabelsOf({ ...DEFAULT_ISSUE_ANALYSIS_VOCAB, sources: [{ code: 'survey', label: '설문' }] })
    const issue = { source: { manual: { type: 'survey', detail: '1차' }, minutes: [] } } as unknown as Parameters<typeof issueSourceLines>[0]
    expect(issueSourceLines(issue, labels)).toEqual(['설문', '1차'])
  })
})
