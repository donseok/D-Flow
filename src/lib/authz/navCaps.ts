/** 내비 어포던스의 caps 한 곳(D42) — actor null(열화)이면 전부 false(어포던스 fail-closed). 라벨도 범위 기준이다 */
import { isProjectAdmin, isWorkspaceAdmin, roleIn, workspaceRoleIn, type Actor } from '@/lib/domain/authz'
import type { NavCaps } from '@/lib/nav/registry'
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

export function scopeRoleLabel(actor: Actor | null, scope: NavScopeRef, degraded: boolean): string {
  if (!actor) return degraded ? '확인 불가' : '조회'
  if (scope.projectId) {
    const r = roleIn(actor, scope.projectId)
    return r === 'superuser' ? '플랫폼 관리자' : r === 'admin' ? '관리자' : r === 'member' ? '멤버' : '조회'
  }
  const r = scope.workspaceId ? workspaceRoleIn(actor, scope.workspaceId) : null
  return r === 'superuser' ? '플랫폼 관리자' : r === 'admin' ? '관리자' : r === 'member' ? '멤버' : '조회'
}
