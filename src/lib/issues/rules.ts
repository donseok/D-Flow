// 서버와 폼이 공유하는 순수 등록 규칙. 모듈 상태 unknown은 호출부에서 실패로 처리한다.
import { policyNeedsArea, type IdPolicy } from './idPolicy'
import type { IssueAnalysisSetting } from '@/lib/settings/defs/project'

export type AnalysisMode = 'off' | 'optional' | 'required'
export type IssueEntryRules = { areaRequired: boolean; analysis: AnalysisMode }
export function issueEntryRules(v: { policy: IdPolicy; analysisModule: 'on' | 'off'; analysisSetting: IssueAnalysisSetting }): IssueEntryRules {
  const analysis = v.analysisModule === 'off' ? 'off' : v.analysisSetting
  return { areaRequired: policyNeedsArea(v.policy) || analysis === 'required', analysis }
}
