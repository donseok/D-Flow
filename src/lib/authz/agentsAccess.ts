// 좌석표(/agents) 접근 — 슈퍼유저 또는 역할(member/admin)이 있는 프로젝트가 1개 이상. usageAccess 와 같은 자리(페이지·사이드바가 함께 쓴다).
// (2026-09-14 사용자 결정) 기본 범위가 '내 작업'이 되면서 관리자 전용에서 멤버까지 연다. 역할이 없는 조회 전용 계정은 여전히 못 본다.
import { hasAnyProjectRole, isProjectMember, type Actor } from '@/lib/domain/authz'

export function canViewAgents(actor: Actor | null): boolean {
  return hasAnyProjectRole(actor)
}

/**
 * 층(프로젝트) 목록. null = 전체(슈퍼유저). 그 외는 roleIn 기준 member 이상인 프로젝트 — 멤버가 보는 화면(WBS·칸반)과 같은 범위.
 * 워크스페이스 관리자는 명단 행이 없어도 그 워크스페이스 프로젝트 전부가 들어온다(roleIn ⑤ 승계) — canViewAgents 와 같은 축.
 * 내 워크스페이스 밖 프로젝트(projectWorkspace 에 없는 pid)는 명단 역할이 있어도 빠진다(존재 은닉과 같은 판정).
 */
export function seatmapProjectIds(actor: Actor | null): string[] | null {
  if (!actor) return []
  if (actor.isSuperuser) return null
  return [...actor.projectWorkspace.keys()].filter(pid => isProjectMember(actor, pid))
}
