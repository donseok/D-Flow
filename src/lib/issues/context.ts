import 'server-only'
import type { FieldDef } from '@/lib/domain/customFields'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { pick } from '@/lib/settings/pick'
import { moduleState } from '@/lib/modules/gate'
import { issueAreasOf, type IssueAreaRef } from '@/lib/domain/issueAreas'
import { issueEntryRules, type IssueEntryRules } from './rules'
import type { IdPolicy } from './idPolicy'
import type { CauseCategoryDef, SeverityDef, SourceDef } from '@/lib/settings/vocab'

/** vocab = 설정 어휘(SP5 B4). 원인 분류는 분석서만 쓴다 — 손상이면 null(이슈 등록은 막지 않고 분석서가 사유를 낸다) */
export type IssueEntryContext = {
  /** Session-derived display permission; row writes independently recheck the actor. */
  canManageCustom?: boolean
  customFields?: FieldDef[]
  rules: IssueEntryRules; policy: IdPolicy; areas: IssueAreaRef[]
  vocab: { severities: SeverityDef[]; sources: SourceDef[]; causeCategories: CauseCategoryDef[] | null }
}
export const ERR_ISSUE_CONTEXT = '이슈 설정을 읽지 못했습니다. 잠시 후 다시 시도하세요.'
export async function loadIssueEntryContext(projectId: string): Promise<{ ok: true; value: IssueEntryContext } | { ok: false; error: string }> {
  try {
    const [cfg, analysisModule] = await Promise.all([getProjectConfig(projectId), moduleState({ projectId }, 'issue_analysis')])
    const policy = pick(cfg, 'issues.id_policy'), setting = pick(cfg, 'issues.analysis')
    if (!policy.ok) return policy
    if (!setting.ok) return setting
    const severities = pick(cfg, 'issues.severities'), sources = pick(cfg, 'issues.sources'), causes = pick(cfg, 'issues.cause_categories')
    if (!severities.ok) return severities
    if (!sources.ok) return sources
    const customFields = pick(cfg, 'fields.issue')
    if (!customFields.ok) return customFields
    if (analysisModule === 'unknown') return { ok: false, error: ERR_ISSUE_CONTEXT }
    return { ok: true, value: { customFields: customFields.value, policy: policy.value, areas: issueAreasOf(cfg.areas.issue_area),
      vocab: { severities: severities.value, sources: sources.value, causeCategories: causes.ok ? causes.value : null },
      rules: issueEntryRules({ policy: policy.value, analysisModule, analysisSetting: setting.value }) } }
  } catch (e) {
    console.error('[issues] 등록 문맥 조회 실패', e)
    return { ok: false, error: ERR_ISSUE_CONTEXT }
  }
}
