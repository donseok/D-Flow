'use server'

import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_DENIED } from '@/lib/authz/errors'
import { isUuidLike } from '@/lib/domain/validate'
import { adminFor } from '@/lib/supabase/adminFor'
import { previewModuleAllowImpact, previewProjectModuleImpact, previewWeekStartImpact, type ModuleAllowImpact, type ProjectModuleImpact, type WeekStartPreview } from '@/lib/settings/impactPreview'
import { parseWeekStartDay, type WeekStartDay } from '@/lib/domain/calendar'
import { configText, CONFIG_MESSAGES, ConfigKeyError } from '@/lib/settings/errors'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { parseModuleList } from '@/lib/settings/defs/workspace'
import { NON_CORE_MODULES, PROJECT_TOGGLABLE } from '@/lib/modules/defaults'
import type { ModuleId } from '@/lib/modules/defaults'
import { serverTranslator } from '@/lib/i18n/server'
import { libText } from '@/lib/i18n/serverText'

export type SettingsImpactResult =
  | { ok: true; revision: number; before: ModuleId[] | null; impact: ModuleAllowImpact | null }
  | { ok: false; error: string }

/** 읽기 전용 영향 검토 — 저장 액션이 권한·CAS·교차 검사를 다시 수행한다. */
export async function previewSettingsImpact(workspaceId: string, next: ModuleId[]): Promise<SettingsImpactResult> {
  const t = await serverTranslator()
  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: libText(t, guard.error) }
  if (!guard.actor.isSuperuser) return { ok: false, error: libText(t, ERR_DENIED) }
  if (!isUuidLike(workspaceId)) return { ok: false, error: t('err.workspaceIdNotValid') }
  const parsed = parseModuleList(next, NON_CORE_MODULES)
  if (!parsed.ok) return { ok: false, error: libText(t, parsed.error) }
  try {
    const admin = adminFor({ workspaceId }).admin
    const current = await getWorkspaceConfig(workspaceId, { client: admin })
    const state = current.keys['modules.allowed']
    const before = state.status === 'invalid' || state.status === 'required_missing' ? null : valueOf(current, 'modules.allowed')
    return { ok: true, revision: current.revision, before,
      impact: before === null ? null : await previewModuleAllowImpact(admin, { workspaceId, before, next: parsed.value }) }
  } catch (error) {
    console.error('[settings] 모듈 허용 영향 계산 실패:', error)
    return { ok: false, error: t('srv.settingsPreview.couldNotCheckImpact') }
  }
}

export type ProjectSettingsImpactResult =
  | { ok: true; revision: number; before: ModuleId[] | null; impact: ProjectModuleImpact | null }
  | { ok: false; error: string }

export async function previewProjectSettingsImpact(projectId: string, next: ModuleId[]): Promise<ProjectSettingsImpactResult> {
  const t = await serverTranslator()
  const guard = await requireProjectAdmin(projectId)
  if (!guard.ok) return { ok: false, error: libText(t, guard.error) }
  if (!isUuidLike(projectId)) return { ok: false, error: t('srv.settingsPreview.projectIdNotValid') }
  const parsed = parseModuleList(next, [...PROJECT_TOGGLABLE])
  if (!parsed.ok) return { ok: false, error: libText(t, parsed.error) }
  try {
    const admin = adminFor({ projectId }).admin
    const current = await getProjectConfig(projectId, { client: admin })
    const state = current.keys['modules.enabled']
    const before = state.status === 'invalid' || state.status === 'required_missing' ? null : valueOf(current, 'modules.enabled')
    return { ok: true, revision: current.revision, before,
      impact: before === null ? null : await previewProjectModuleImpact(admin, { projectId, before, next: parsed.value }) }
  } catch (error) {
    console.error('[settings] 프로젝트 모듈 영향 계산 실패:', error)
    return { ok: false, error: t('srv.settingsPreview.couldNotCheckImpact') }
  }
}

export type WeekStartPreviewResult = { ok: true; preview: WeekStartPreview } | { ok: false; error: string }

/** 읽기 전용 — 저장 액션이 권한·CAS·RPC 안의 정확 판정(settings_ref_check)을 다시 한다. 화면의 '변경 내용 검토'가 부른다(D38) */
export async function previewWeekStartChange(projectId: string, day: WeekStartDay): Promise<WeekStartPreviewResult> {
  const t = await serverTranslator()
  const guard = await requireProjectAdmin(projectId)
  if (!guard.ok) return { ok: false, error: libText(t, guard.error) }
  if (!isUuidLike(projectId)) return { ok: false, error: t('srv.settingsPreview.projectIdNotValid') }
  const parsed = parseWeekStartDay(day)
  if (!parsed.ok) return { ok: false, error: libText(t, parsed.error) }
  try {
    const admin = adminFor({ projectId }).admin
    return { ok: true, preview: await previewWeekStartImpact(admin, { projectId, day: parsed.value, now: new Date() }) }
  } catch (error) {
    console.error('[settings] 주 시작 변경 영향 계산 실패:', error)
    if (error instanceof ConfigKeyError) return { ok: false, error: `${configText(t, CONFIG_MESSAGES[error.code])} (${error.key})` }
    return { ok: false, error: t('srv.settingsPreview.couldNotCheckImpact') }
  }
}
