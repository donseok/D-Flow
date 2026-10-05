import type { IssueAreaRef } from '@/lib/domain/issueAreas'
import { DEFAULT_ID_POLICY } from '@/lib/issues/idPolicy'
import { defaultVocab } from '@/lib/settings/vocab'
// 이관된 기존 프로젝트를 표현하는 픽스처. 런타임 정본은 프로젝트마다 주입한다.
export const TEST_AREAS: IssueAreaRef[] = ['기준관리', '손익관리', '영업', '품질·설계', '생산계획', '조업', '출하', '원가'].map((name, index) => ({
  id: String(index).padStart(2, '0'), code: String(index).padStart(2, '0'), name, sortOrder: index, active: true,
}))
/** 이슈 어휘(SP5 B4) — 기본 어휘. 분석 스냅샷의 심각도 칸은 기본 순서(high·medium·low) */
export const TEST_ISSUE_VOCAB = {
  severities: defaultVocab('issues.severities'), sources: defaultVocab('issues.sources'), causeCategories: defaultVocab('issues.cause_categories'),
}
export const TEST_SEVERITY_CODES = TEST_ISSUE_VOCAB.severities.map(e => e.code)
export const TEST_ENTRY_CONTEXT = { policy: DEFAULT_ID_POLICY, areas: TEST_AREAS, rules: { analysis: 'optional' as const, areaRequired: false }, vocab: TEST_ISSUE_VOCAB }
export const actionAreaId = (code: string) => `00000000-0000-0000-7e57-000000001b${code}`
export const ACTION_ENTRY_CONTEXT = { ...TEST_ENTRY_CONTEXT, areas: TEST_AREAS.map(area => ({ ...area, id: actionAreaId(area.code) })) }
export const REQUIRED_ENTRY_CONTEXT = { ...TEST_ENTRY_CONTEXT, rules: { analysis: 'required' as const, areaRequired: true } }
/** 분석 실행 어휘 인자(ensureIssueAnalysis 6번째) — 기본 어휘 프로젝트(analysis 생략 = 스냅샷에 싣지 않음) */
export const TEST_VOCAB_ARG = { severityCodes: TEST_SEVERITY_CODES }
export const TEST_CAUSE_CODES = TEST_ISSUE_VOCAB.causeCategories.map(e => e.code)
