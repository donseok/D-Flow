import type { AdminClient } from '@/lib/minutes/externalApi'
import { isAgentProjectMember, patProjectAllowed, type AgentPrincipal } from '@/lib/agent/externalApi'
import { myMemberIds } from '@/lib/agent/assignee'
import { projectsWithModule } from '@/lib/modules/gate'

/**
 * PAT 가 접근 가능한 프로젝트 ID 목록 — enabled agent_projects ∩ 멤버 프로젝트 ∩ agents 모듈이 켜진 프로젝트(스펙 §4.4 두 원천 AND).
 * Task 7: GET /work/mine · Task 10·15: /work/mine (claimed/all/assigned 스코프 확장용)
 */
export async function accessibleProjectIds(
  admin: AdminClient,
  principal: Extract<AgentPrincipal, { kind: 'pat' }>,
): Promise<string[]> {
  const { data: regs, error } = await admin.from('agent_projects').select('project_id').eq('enabled', true)
  if (error) throw new Error(`enabled 프로젝트 조회 실패: ${error.message}`)
  const out: string[] = []
  for (const r of (regs ?? []) as Array<{ project_id: string }>) {
    if (!patProjectAllowed(principal, r.project_id)) continue
    if (await isAgentProjectMember(admin, principal.userId, r.project_id)) out.push(r.project_id)
  }
  return projectsWithModule(out, 'agents', { client: admin })   // 목록형 — agents 가 꺼진 프로젝트는 생략(스펙 §4.2)
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
