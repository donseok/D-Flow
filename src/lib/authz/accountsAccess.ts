import { isWorkspaceAdmin, type Actor } from '@/lib/domain/authz'

/**
 * 계정 관리 화면(/w/[slug]/admin/accounts) — 슬러그 워크스페이스의 관리자(플랫폼 관리자 포함, D22·§10.1 #9). 화면 안의 플랫폼 전용 조작
 * (resetPassword·setPlatformAdmin)은 actor.isSuperuser 일 때만 렌더하고 액션 가드는 그대로 requireSuperuser 다(11곳 불변).
 */
export function canManageWorkspaceAccounts(actor: Actor | null, workspaceId: string): boolean {
  return !!workspaceId && isWorkspaceAdmin(actor, workspaceId)
}
