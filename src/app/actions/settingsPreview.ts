'use server'

import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'
import { ERR_DENIED } from '@/lib/authz/errors'
import { isUuidLike } from '@/lib/domain/validate'
import { adminFor } from '@/lib/supabase/adminFor'
import { previewModuleAllowImpact, previewProjectModuleImpact, type ModuleAllowImpact, type ProjectModuleImpact } from '@/lib/settings/impactPreview'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { parseModuleList } from '@/lib/settings/defs/workspace'
import { NON_CORE_MODULES, PROJECT_TOGGLABLE } from '@/lib/modules/defaults'
import type { ModuleId } from '@/lib/modules/defaults'

export type SettingsImpactResult =
  | { ok: true; revision: number; before: ModuleId[] | null; impact: ModuleAllowImpact | null }
  | { ok: false; error: string }

/** 읽기 전용 영향 검토 — 저장 액션이 권한·CAS·교차 검사를 다시 수행한다. */
export async function previewSettingsImpact(workspaceId: string, next: ModuleId[]): Promise<SettingsImpactResult> {
  const guard = await requireWorkspaceAdmin(workspaceId)
  if (!guard.ok) return { ok: false, error: guard.error }
  if (!guard.actor.isSuperuser) return { ok: false, error: ERR_DENIED }
  if (!isUuidLike(workspaceId)) return { ok: false, error: '워크스페이스 id가 올바르지 않습니다.' }
  const parsed = parseModuleList(next, NON_CORE_MODULES)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  try {
    const admin = adminFor({ workspaceId }).admin
    const current = await getWorkspaceConfig(workspaceId, { client: admin })
    const state = current.keys['modules.allowed']
    const before = state.status === 'invalid' || state.status === 'required_missing' ? null : valueOf(current, 'modules.allowed')
    return { ok: true, revision: current.revision, before,
      impact: before === null ? null : await previewModuleAllowImpact(admin, { workspaceId, before, next: parsed.value }) }
  } catch (error) {
    console.error('[settings] 모듈 허용 영향 계산 실패:', error)
    return { ok: false, error: '영향을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.' }
  }
}

export type ProjectSettingsImpactResult =
  | { ok: true; revision: number; before: ModuleId[] | null; impact: ProjectModuleImpact | null }
  | { ok: false; error: string }

export async function previewProjectSettingsImpact(projectId: string, next: ModuleId[]): Promise<ProjectSettingsImpactResult> {
  const guard = await requireProjectAdmin(projectId)
  if (!guard.ok) return { ok: false, error: guard.error }
  if (!isUuidLike(projectId)) return { ok: false, error: '프로젝트 id가 올바르지 않습니다.' }
  const parsed = parseModuleList(next, [...PROJECT_TOGGLABLE])
  if (!parsed.ok) return { ok: false, error: parsed.error }
  try {
    const admin = adminFor({ projectId }).admin
    const current = await getProjectConfig(projectId, { client: admin })
    const state = current.keys['modules.enabled']
    const before = state.status === 'invalid' || state.status === 'required_missing' ? null : valueOf(current, 'modules.enabled')
    return { ok: true, revision: current.revision, before,
      impact: before === null ? null : await previewProjectModuleImpact(admin, { projectId, before, next: parsed.value }) }
  } catch (error) {
    console.error('[settings] 프로젝트 모듈 영향 계산 실패:', error)
    return { ok: false, error: '영향을 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.' }
  }
}
