import type { WorkspaceRole } from '@/lib/domain/authz'

/**
 * 공용 팀 관리(/w/[slug]/admin/teams) 권한 — 판정을 여기 한 곳에만 둔다(canViewUsage 관례).
 *
 * 슬러그 워크스페이스의 관리자(플랫폼 관리자 포함, D22). 로더·쓰기 액션은 이미 requireWorkspaceAdmin 이다.
 * 워크스페이스 인자는 필수다(계획 V12 — 옛 셸의 인자 없는 판정은 셸 전환과 함께 지웠다). 내비 항목은 navCapsFor 의 isWorkspaceAdmin 이 같은 축이다.
 */
export function canManageTeams(
  actor: { isSuperuser: boolean; workspaceRoles?: ReadonlyMap<string, WorkspaceRole> } | null, workspaceId: string,
): boolean {
  if (!actor) return false
  if (actor.isSuperuser) return true
  return actor.workspaceRoles?.get(workspaceId) === 'admin'
}
