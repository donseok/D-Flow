import type { WorkspaceRole } from '@/lib/domain/authz'

/**
 * 공용 팀 관리(/w/[slug]/admin/teams) 권한 — 판정을 여기 한 곳에만 둔다(canViewUsage 관례).
 *
 * 슬러그 워크스페이스의 관리자(플랫폼 관리자 포함, D22). 로더·쓰기 액션은 이미 requireWorkspaceAdmin 이다.
 * workspaceId 가 없으면 옛 판정(플랫폼 관리자만) — 옛 셸 HeaderChrome 의 메뉴만 쓴다(계획 V12). 셸 전환(과제 31)이 인자를 필수로 바꾼다.
 *
 * 페이지 게이트와 헤더 어포던스(HeaderChrome 메뉴)가 같은 판정을 쓴다 — 어포던스가
 * 독자 판정을 하면 링크는 보이는데 페이지는 거부되는(또는 그 반대) 드리프트가 생긴다.
 * HeaderChrome 은 직렬화된 HeaderIdentity 를 들고 있어 시그니처는 최소 형태로 받는다.
 */
export function canManageTeams(
  actor: { isSuperuser: boolean; workspaceRoles?: ReadonlyMap<string, WorkspaceRole> } | null, workspaceId?: string,
): boolean {
  if (!actor) return false
  if (actor.isSuperuser) return true
  if (workspaceId === undefined) return false
  return actor.workspaceRoles?.get(workspaceId) === 'admin'
}
