// 좌석표(/w/[slug]/agents) 접근 — 그 워크스페이스에 역할이 있는가(D21, §5.8). 판정은 여기 한 곳(페이지·재조회 액션이 같이 쓴다).
// 층 목록도 그 워크스페이스로 한정한다 — 지금까지는 플랫폼 관리자에게 전 워크스페이스 프로젝트가 나갔다(SP2 스펙 :50).
import { hasProjectRoleInWorkspace, isProjectMember, type Actor } from '@/lib/domain/authz'

export function canViewAgents(actor: Actor | null, workspaceId: string): boolean {
  return hasProjectRoleInWorkspace(actor, workspaceId)
}

/**
 * 층(프로젝트) 목록 — 그 워크스페이스의 프로젝트 가운데 멤버 이상(roleIn — 워크스페이스 관리자 승계 포함). 플랫폼 관리자는 그 워크스페이스 전부
 * (buildActor 가 플랫폼 관리자에게 전 프로젝트를 싣는다). 내 워크스페이스 밖 pid 는 projectWorkspace 에 없어 빠진다(존재 은닉).
 */
export function seatmapProjectIds(actor: Actor | null, workspaceId: string): string[] {
  if (!actor) return []
  const inWs = [...actor.projectWorkspace].filter(([, wid]) => wid === workspaceId).map(([pid]) => pid)
  return actor.isSuperuser ? inWs : inWs.filter((pid) => isProjectMember(actor, pid))
}
