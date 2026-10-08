/**
 * 이슈 분석서 PPT 를 받을 수 있는지 — /api/issue-analysis 가 렌더 전에 읽는 양식 설정과 같은 값을 본다(정본 §4.8).
 * 모듈·저장 실행은 액션이 이미 판정했다(requireModule·runId). 설정을 못 읽으면 닫는다(fail-closed).
 */
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { pick } from '@/lib/settings/pick'

export type IssueAnalysisPptExport =
  | { status: 'ready'; source: 'default' | 'custom' }
  | { status: 'unavailable'; reason: 'form_setting_invalid' | 'form_setting_unknown' }

export async function issueAnalysisPptExport(projectId: string): Promise<IssueAnalysisPptExport> {
  try {
    const form = pick(await getProjectConfig(projectId), 'forms.issue_analysis_pptx')
    if (!form.ok) return { status: 'unavailable', reason: 'form_setting_invalid' }
    return { status: 'ready', source: form.value.template_id ? 'custom' : 'default' }
  } catch (error) {
    console.error('[issue-analysis] 양식 설정 조회 실패:', error instanceof Error ? error.message : error)
    return { status: 'unavailable', reason: 'form_setting_unknown' }
  }
}
