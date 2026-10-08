import type { AdminClient } from '@/lib/minutes/externalApi'
import { agentActorFromPrincipal, patProjectAllowed, type AgentPrincipal } from '@/lib/agent/externalApi'
import { myMemberIds } from '@/lib/agent/assignee'
import { isProjectMember } from '@/lib/domain/authz'
import { projectsWithModule } from '@/lib/modules/gate'

/**
 * PAT 가 접근 가능한 프로젝트 ID 목록 — 자격증명 범위(워크스페이스·project_ids) ∩ 멤버 프로젝트 ∩ agents 모듈이 켜진 프로젝트.
 * 에이전트 사용 여부의 원천은 agents 모듈 하나다(SP7 — 등록 표는 없다). 모듈은 워크스페이스 단위로 한 번에 판정한다.
 * Task 7: GET /work/mine · Task 10·15: /work/mine (claimed/all/assigned 스코프 확장용)
 */
export async function accessibleProjectIds(
  admin: AdminClient,
  principal: AgentPrincipal,
): Promise<string[]> {
  const actor = await agentActorFromPrincipal(admin, principal.userId, principal)
  const ids = [...actor.projectWorkspace.keys()].filter(pid => isProjectMember(actor, pid) && patProjectAllowed(principal, pid))
  // 목록형 — agents 가 꺼진 프로젝트는 생략(스펙 §4.2)
  return projectsWithModule(ids, 'agents', { client: admin, workspaceId: principal.credential.workspaceId })
}

/**
 * scope=assigned 재료 — 접근 가능 프로젝트별로 myMemberIds 를 구해 합집합·중복 제거.
 * Task 15: /work/mine?scope=assigned.
 */
export async function myMemberIdsAcrossProjects(
  admin: AdminClient,
  args: { userId: string; projectIds: string[] },
): Promise<string[]> {
  const out = new Set<string>()
  for (const projectId of args.projectIds) {
    const ids = await myMemberIds(admin, { userId: args.userId, projectId })
    for (const id of ids) out.add(id)
  }
  return [...out]
}
