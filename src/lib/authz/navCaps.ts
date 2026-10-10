/** 내비 어포던스의 caps 한 곳(D42) — actor null(열화)이면 전부 false(어포던스 fail-closed). 라벨도 범위 기준이다 */
import { isProjectAdmin, isWorkspaceAdmin, roleIn, workspaceRoleIn, type Actor } from '@/lib/domain/authz'
import type { NavCaps } from '@/lib/nav/registry'
import { koTranslate } from '@/lib/i18n/translate'
import { canViewPortfolio } from './portfolioAccess'
import { canViewUsage } from './usageAccess'

type NavScopeRef = { workspaceId: string | null; projectId?: string | null }

export const NO_CAPS: NavCaps = Object.freeze({
  isPlatformAdmin: false, isWorkspaceAdmin: false, isProjectAdmin: false, canViewUsage: false, canViewPortfolio: false, canCreateProject: false,
})

export function navCapsFor(actor: Actor | null, scope: NavScopeRef): NavCaps {
  if (!actor) return NO_CAPS
  const wsAdmin = scope.workspaceId ? isWorkspaceAdmin(actor, scope.workspaceId) : false
  return {
    isPlatformAdmin: actor.isSuperuser,
    isWorkspaceAdmin: wsAdmin,
    isProjectAdmin: scope.projectId ? isProjectAdmin(actor, scope.projectId) : false,
    canViewUsage: canViewUsage(actor),
    canViewPortfolio: canViewPortfolio(actor),
    canCreateProject: wsAdmin,
  }
}

/** 범위 기준 역할의 사전 키 — 화면(계정 메뉴)은 이 키를 사전으로 푼다 */
export type ScopeRoleKey = 'role.platformAdmin' | 'role.admin' | 'role.member' | 'role.viewer' | 'role.unknown'
export function scopeRoleKey(actor: Actor | null, scope: NavScopeRef, degraded: boolean): ScopeRoleKey {
  if (!actor) return degraded ? 'role.unknown' : 'role.viewer'
  const r = scope.projectId ? roleIn(actor, scope.projectId) : scope.workspaceId ? workspaceRoleIn(actor, scope.workspaceId) : null
  return r === 'superuser' ? 'role.platformAdmin' : r === 'admin' ? 'role.admin' : r === 'member' ? 'role.member' : 'role.viewer'
}

/** 한국어 라벨(종전 출력 그대로) — 화면은 scopeRoleKey 를 쓴다 */
export function scopeRoleLabel(actor: Actor | null, scope: NavScopeRef, degraded: boolean): string {
  return koTranslate(scopeRoleKey(actor, scope, degraded))
}
