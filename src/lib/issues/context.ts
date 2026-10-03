import 'server-only'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { pick } from '@/lib/settings/pick'
import { moduleState } from '@/lib/modules/gate'
import { issueAreasOf, type IssueAreaRef } from '@/lib/domain/issueAreas'
import { issueEntryRules, type IssueEntryRules } from './rules'
import type { IdPolicy } from './idPolicy'

export type IssueEntryContext = { rules: IssueEntryRules; policy: IdPolicy; areas: IssueAreaRef[] }
export const ERR_ISSUE_CONTEXT = '이슈 설정을 읽지 못했습니다. 잠시 후 다시 시도하세요.'
export async function loadIssueEntryContext(projectId: string): Promise<{ ok: true; value: IssueEntryContext } | { ok: false; error: string }> {
  try {
    const [cfg, analysisModule] = await Promise.all([getProjectConfig(projectId), moduleState({ projectId }, 'issue_analysis')])
    const policy = pick(cfg, 'issues.id_policy'), setting = pick(cfg, 'issues.analysis')
    if (!policy.ok) return policy
    if (!setting.ok) return setting
    if (analysisModule === 'unknown') return { ok: false, error: ERR_ISSUE_CONTEXT }
    return { ok: true, value: { policy: policy.value, areas: issueAreasOf(cfg.areas.issue_area),
      rules: issueEntryRules({ policy: policy.value, analysisModule, analysisSetting: setting.value }) } }
  } catch (e) {
    console.error('[issues] 등록 문맥 조회 실패', e)
    return { ok: false, error: ERR_ISSUE_CONTEXT }
  }
}
