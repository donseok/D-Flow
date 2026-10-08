import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUuidLike } from '@/lib/domain/agentWork'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import {
  agentActorFromPrincipal, patProjectAllowed, apiBadRequest, apiFail, apiInternalError, apiNotFound, requireScope, resolveAgentPrincipal, type AgentPrincipal,
} from '@/lib/agent/externalApi'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { hasProjectRoleInWorkspace, isProjectMember } from '@/lib/domain/authz'
import { projectsWithModule, requireModule } from '@/lib/modules/gate'

/**
 * watch — 감시자(팀장 /dflow-team · 단독 /dflow-poll) 존재 신호. 좌석표 v1 스펙 §3-3.
 * (user_id, agent) 당 1행 upsert. 살아 있음(TTL 70분)은 화면이 판정하고, stop 은 행을 지운다.
 */
export const dynamic = 'force-dynamic'

const AGENT_MAX = 120
const STALE_ROW_MS = 7 * 24 * 3600_000
/** 한 번에 실어 보내는 재개 요청 수 — 요청이 걸린 주문은 늘 소수다. */
const RESUME_MAX = 50

export interface ResumeRequest {
  order_id: string; id8: string; project_id: string; wbs_item_id: string | null
  code: string | null; name: string | null
  /** 이어받아야 하는 PC. 팀장은 자기 host(watch 가 보내는 값과 같은 슬러그)와 맞을 때만 가져간다. */
  host: string | null
  claimed_by: string | null
  requested_at: string
}

/**
 * 내 신원이 점유한 주문 중 사람이 좌석표에서 「이어서 시작」을 누른 것(0099).
 * 팀장은 매 기상마다 watch 를 부르므로 여기에 실으면 왕복이 늘지 않는다.
 * 조회에 실패하면 빈 배열로 위장하지 않고 null 을 돌려준다 — 호출자는 "요청 없음"과 구별해야 한다.
 */
async function loadResumeRequests(
  admin: ReturnType<typeof createAdminClient>, userId: string, projectId: string | null, principal: AgentPrincipal, allowedProjectIds: ReadonlySet<string>,
): Promise<ResumeRequest[] | null> {
  let q = admin
    .from('agent_work_orders')
    .select('id, project_id, wbs_item_id, claimed_by, resume_requested_at, resume_requested_host, projects!inner(workspace_id)')
    .eq('claimed_by_user_id', userId).eq('status', 'claimed')
    .not('resume_requested_at', 'is', null)
  if (projectId !== null) q = q.eq('project_id', projectId)
  q = q.eq('projects.workspace_id', principal.credential.workspaceId)
  if (principal.credential.projectIds !== null) q = q.in('project_id', [...principal.credential.projectIds])
  const { data, error } = await q.order('resume_requested_at', { ascending: true }).limit(RESUME_MAX)
  if (error) { console.error('[agent-api] 재개 요청 조회 실패:', error.message); return null }
  const rows = ((data ?? []) as Array<{
    id: string; project_id: string; wbs_item_id: string | null; claimed_by: string | null
    resume_requested_at: string; resume_requested_host: string | null
  }>).filter(r => allowedProjectIds.has(r.project_id))
  if (rows.length === 0) return []
  // 팀장이 표로 보고할 때 TSK 코드가 있어야 사람이 어느 작업인지 안다 — 행이 소수라 한 번 더 읽는다.
  const itemIds = [...new Set(rows.map(r => r.wbs_item_id).filter((x): x is string => x !== null))]
  const labels = new Map<string, { code: string; name: string }>()
  if (itemIds.length > 0) {
    const { data: items, error: itemErr } = await admin.from('wbs_items').select('id, code, name').in('id', itemIds)
    if (itemErr) { console.error('[agent-api] 재개 요청 항목 조회 실패:', itemErr.message); return null }
    for (const it of (items ?? []) as Array<{ id: string; code: string; name: string }>) {
      labels.set(it.id, { code: it.code, name: it.name })
    }
  }
  return rows.map(r => {
    const label = r.wbs_item_id ? labels.get(r.wbs_item_id) : undefined
    return {
      order_id: r.id, id8: r.id.slice(0, 8), project_id: r.project_id, wbs_item_id: r.wbs_item_id,
      code: label?.code ?? null, name: label?.name ?? null,
      host: r.resume_requested_host, claimed_by: r.claimed_by, requested_at: r.resume_requested_at,
    }
  })
}

function nonNegInt(v: unknown, name: string): number | null | { error: string } {
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return { error: `${name} 은 0 이상의 정수여야 합니다.` }
  return v
}

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const agent = typeof b.agent === 'string' ? b.agent.trim() : ''
  if (!agent || agent.length > AGENT_MAX) return apiBadRequest(`agent 는 1~${AGENT_MAX}자여야 합니다.`)
  const stop = b.stop === true
  const host = typeof b.host === 'string' && b.host.trim() ? b.host.trim().slice(0, 80) : null
  const until = typeof b.until === 'string' && b.until.trim() ? b.until.trim().slice(0, 16) : null
  const slots = nonNegInt(b.slots, 'slots'); if (slots !== null && typeof slots === 'object') return apiBadRequest(slots.error)
  const busy = nonNegInt(b.busy, 'busy'); if (busy !== null && typeof busy === 'object') return apiBadRequest(busy.error)
  const bodyProject = b.project_id === undefined || b.project_id === null ? null : b.project_id
  if (bodyProject !== null && (typeof bodyProject !== 'string' || !isUuidLike(bodyProject))) {
    return apiBadRequest('project_id 형식이 올바르지 않습니다.')
  }

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    // 프로젝트 한정 PAT 는 그 프로젝트로 강제 — 다른 값을 대면 사칭 신호라 조용히 덮지 않는다.
    let projectId: string | null = bodyProject
    if (bodyProject !== null && !patProjectAllowed(principal, bodyProject)) return apiNotFound()
    if (principal.projectId !== null) {
      if (bodyProject !== null && bodyProject !== principal.projectId) {
        return apiFail(403, 'forbidden_role', 'PAT 가 한정된 프로젝트와 다릅니다.')
      }
      projectId = principal.projectId
    }

    if (stop) {
      const { error } = await admin.from('agent_watchers').delete().eq('user_id', principal.userId).eq('agent', agent)
        .eq('workspace_id', principal.credential.workspaceId)
      if (error) { console.error('[agent-api] watch stop 실패:', error.message); return apiInternalError() }
      return NextResponse.json({ ok: true, stopped: true })
    }

    // PAT 소유자 권한 스냅샷 — 조회 실패는 throw → 아래 catch 의 500(판정 없이 쓰지 않는다).
    const actor = await agentActorFromPrincipal(admin, principal.userId, principal)
    // SP2 — 감시자는 그 프로젝트 허브·좌석표에 "떠 있는 팀장"으로 보이는 쓰기다. 소유자가 그 프로젝트의 멤버 이상
    // (명단 권한·워크스페이스 관리자·플랫폼 관리자)이 아니면 없는 프로젝트와 같은 404 — 조회 전용·다른 워크스페이스 모두.
    // 프로젝트 한정 PAT 도 발급 때 워크스페이스를 확인하지 않으므로 같은 판정을 거친다.
    if (projectId && !isProjectMember(actor, projectId)) return apiNotFound()

    // 프로젝트 없는 감시자는 워크스페이스를 명시해야 한다(0006 not null) — 프로젝트가 있으면 트리거가 채운다.
    // 그 워크스페이스의 모든 허브·좌석표에 보이므로 그 워크스페이스에 역할(명단 권한 또는 워크스페이스 관리자)이 있어야 한다 —
    // 조회 전용은 프로젝트 분기와 같은 404(판정 T13-2).
    let workspaceId: string | null = null
    if (!projectId) {
      const w = principal.credential ? { ok: true as const, workspaceId: principal.credential.workspaceId } : resolveSoleWorkspaceId(actor)
      if (!w.ok) return apiFail(400, 'project_required', '워크스페이스가 하나가 아니면 project_id 를 지정하세요.')
      if (!hasProjectRoleInWorkspace(actor, w.workspaceId)) return apiNotFound()
      workspaceId = w.workspaceId
    }
    // agents 관문(스펙 §4.2 에이전트 API 행) — 권한 판정 뒤·쓰기 앞. 프로젝트 감시자는 그 프로젝트, 프로젝트 없는 감시자는 그 워크스페이스에서
    // agents 가 유효해야 한다(꺼지면 없는 것과 같은 404). 두 갈래가 한 호출을 지난다. stop 은 위 — 자기 행을 지우는 정리라 관문 앞이다(P19)
    const gate = await requireModule(projectId ? { projectId } : { workspaceId: workspaceId! }, 'agents', { client: admin })
    if (!gate.ok) return apiNotFound()

    const now = new Date()
    const { error: upErr } = await admin
      .from('agent_watchers')
      .upsert({
        user_id: principal.userId, project_id: projectId, agent, host, slots, busy,
        until_label: until, last_seen_at: now.toISOString(),
        // 프로젝트가 있어도 키를 싣는다(null) — insert 트리거가 제안 행을 프로젝트 워크스페이스로 채우고,
        // 충돌 갱신은 그 값(excluded)을 쓰므로 옛 행의 워크스페이스가 남아 불일치(23514)가 나지 않는다.
        workspace_id: workspaceId,
      }, { onConflict: 'workspace_id,user_id,agent' })
    if (upErr) { console.error('[agent-api] watch upsert 실패:', upErr.message); return apiInternalError() }
    // 청소를 따로 두지 않는다 — 7일 넘게 조용한 행은 여기서 지운다. 실패는 로깅만.
    const { error: gcErr } = await admin
      .from('agent_watchers').delete().eq('workspace_id', principal.credential.workspaceId).lt('last_seen_at', new Date(now.getTime() - STALE_ROW_MS).toISOString())
    if (gcErr) console.error('[agent-api] watch 오래된 행 정리 실패:', gcErr.message)
    const loaded = await loadResumeRequests(admin, principal.userId, projectId, principal, new Set([...actor.projectWorkspace.keys()].filter(pid => isProjectMember(actor, pid) && patProjectAllowed(principal, pid))))
    const onIds = loaded === null ? null : new Set(await projectsWithModule(loaded.map((r) => r.project_id), 'agents', { client: admin }))
    const resume = loaded === null ? null : loaded.filter((r) => onIds!.has(r.project_id) && patProjectAllowed(principal, r.project_id) && isProjectMember(actor, r.project_id))   // 목록형 — 꺼진 프로젝트의 재개 요청은 싣지 않는다
    return NextResponse.json({
      ok: true,
      expires_at: new Date(now.getTime() + WATCHER_TTL_MS).toISOString(),
      // 배열이면 그게 전부다. null 은 "조회에 실패했다"이며 "요청이 없다"가 아니다(에러 3원칙).
      resume_requests: resume,
      ...(resume === null ? { resume_requests_error: '재개 요청 조회에 실패했습니다.' } : {}),
    })
  } catch (e) {
    console.error('[agent-api] watch 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
