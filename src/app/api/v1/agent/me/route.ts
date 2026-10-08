import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  AGENT_CONTRACT_VERSION, agentActorFromPrincipal, agentRoleFromActor, apiInternalError, apiNotFound,
  patProjectAllowed, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { fetchAllPages } from '@/lib/data/paging'
import { projectsWithModule } from '@/lib/modules/gate'

type Registration = { project_id: string; projects: { name: string } | Array<{ name: string }> | null }

/** GET /api/v1/agent/me — whoami. 404 존재 은닉 아래의 유일한 진단 창구(계약 v2.0). */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal

    // SP2 §4.2·SP7 §5.1.3 — 후보를 자격증명 범위(그 워크스페이스·project_ids)로 좁힌 PAT 소유자의 스냅샷에서 읽는다.
    // 플랫폼 관리자 승격은 없다. 권한 조회 실패는 throw → catch 의 500.
    const actor = await agentActorFromPrincipal(admin, principal.userId, principal)
    // 프로젝트 id 목록을 .in() 으로 싣지 않는다 — URL 이 프로젝트 수에 비례해 늘어 약 205개부터 게이트웨이가 414 로 거절한다.
    // 등록 행을 projects 임베드(!inner)의 워크스페이스로 좁혀 이름까지 한 번에 읽는다(페이지로 끝까지). 플랫폼 관리자는 필터 없음.
    let regs: Array<{ projectId: string; name: string }> = []
    if (actor.projectWorkspace.size > 0) {
      const workspaceIds = [...actor.workspaceRoles.keys()]
      try {
        if (principal.credential) {
          regs = (await fetchAllPages<{ id: string; name: string }>('projects', (from, to) =>
            admin.from('projects').select('id, name', { count: 'exact' })
              .eq('workspace_id', principal.credential!.workspaceId).order('id').range(from, to)))
            .map(r => ({ projectId: r.id, name: r.name }))
        } else {
          const rows = await fetchAllPages<Registration>('agent_projects', (from, to) => {
            const q = admin.from('agent_projects').select('project_id, projects!inner(name)', { count: 'exact' }).eq('enabled', true)
            return (actor.isSuperuser ? q : q.in('projects.workspace_id', workspaceIds)).order('project_id').range(from, to)
          })
          regs = rows.map(r => ({
            projectId: r.project_id, name: (Array.isArray(r.projects) ? r.projects[0]?.name : r.projects?.name) ?? '',
          }))
        }
      } catch (e) {
        console.error('[agent-api] enabled 프로젝트 조회 실패:', e instanceof Error ? e.message : e)
        return apiInternalError()
      }
    }

    const projects: Array<{ id: string; name: string; role: string }> = []
    // 응답 행도 스냅샷 키로 한 번 더 거른다 — 워크스페이스 필터가 빠지는 회귀가 생겨도 남의 워크스페이스 프로젝트가 실리지 않게.
    for (const { projectId, name } of regs) {
      if (!actor.projectWorkspace.has(projectId) || !patProjectAllowed(principal, projectId)) continue
      // 프로젝트별 역할 — 위 스냅샷 하나로 판정한다(프로젝트마다 다시 조립하지 않는다). 조회 전용은 싣지 않는다.
      const role = agentRoleFromActor(actor, projectId)
      if (role) projects.push({ id: projectId, name, role })
    }
    // 목록형 — agents 가 꺼진 프로젝트는 생략(스펙 §4.2, E2E 4단계). 역할 판정 뒤라 비멤버 프로젝트의 설정은 읽지 않는다
    const on = new Set(await projectsWithModule(projects.map((p) => p.id), 'agents', { client: admin }))
    const visible = projects.filter((p) => on.has(p.id))
    return NextResponse.json({
      ok: true, user_email: principal.userEmail,
      // 계약 2.4 — .env 에 토큰이 여럿일 때 사람이 키를 알아보게 한다. prefix 는 토큰 안에 평문으로 든 조회 키다.
      token_name: principal.runnerName, token_prefix: principal.tokenPrefix,
      scopes: principal.scopes,
      kind: principal.runnerKind, token_expires_at: principal.tokenExpiresAt,
      contract_version: AGENT_CONTRACT_VERSION, projects: visible,
    })
  } catch (e) {
    console.error('[agent-api] me 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const POST = apiNotFound
export const PUT = POST
export const DELETE = POST
export const PATCH = POST
export const OPTIONS = POST
