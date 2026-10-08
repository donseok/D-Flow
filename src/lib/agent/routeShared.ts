import { NextResponse } from 'next/server'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { AGENT_NAME_RE } from '@/lib/domain/agentWork'
import {
  apiFail, apiInternalError, apiNotFound, isAgentProjectMember, patProjectAllowed,
  requireAgentProject, requireScope, resolveAgentPrincipal, type AgentPrincipal,
} from '@/lib/agent/externalApi'

/*
 * 쓰기 라우트(claim/release/report/heartbeat) 공통 선행부.
 * route.ts 안에 두지 않는 이유: App Router 는 라우트 파일에서 HTTP 메서드 외 export 를
 * 빌드에서 거부한다 — 공용 로직은 lib 로 빼는 것이 유일한 합법 경로다.
 */

type OrderRow = {
  id: string; project_id: string; status: string
  claimed_by: string | null; claimed_by_user_id: string | null; wbs_item_id: string | null
}

/** 주문 조회 공통부. claimed_by_user_id 미선택·구행(0072 이전)은 undefined 로 온다 — null 과 동일하게 다룬다(무소유). */
async function fetchOrderRow(admin: AdminClient, id: string): Promise<
  { ok: true; row: OrderRow } | { ok: false; res: NextResponse }
> {
  const { data: order, error } = await admin
    .from('agent_work_orders')
    .select('id, project_id, status, claimed_by, claimed_by_user_id, wbs_item_id')
    .eq('id', id).maybeSingle()
  if (error) {
    console.error('[agent-api] 주문 조회 실패:', error.message)
    return { ok: false, res: apiInternalError() }
  }
  if (!order) return { ok: false, res: apiNotFound() }
  const raw = order as OrderRow
  return { ok: true, row: { ...raw, claimed_by_user_id: raw.claimed_by_user_id ?? null } }
}

/**
 * 주문 로드 + 프로젝트 게이트 + 멤버 판정 — principal 의 userId 로 직접 멤버십을 판정한다. 실패는 완성된 NextResponse 로 돌려준다.
 * principal: patProjectAllowed 로 project_ids 한정을 강제한다 — 읽기 라우트(work/route.ts,
 * work/[id]/route.ts)와 동일하게 존재 은닉(404)로 응답한다.
 */
export async function loadGatedOrderForUser(
  admin: AdminClient, id: string, userId: string, userEmail: string, principal: AgentPrincipal,
): Promise<
  | { ok: true; order: OrderRow; userId: string }
  | { ok: false; res: NextResponse }
> {
  const loaded = await fetchOrderRow(admin, id)
  if (!loaded.ok) return loaded
  const row = loaded.row
  if (!patProjectAllowed(principal, row.project_id)) return { ok: false, res: apiNotFound() }
  if (!(await isAgentProjectMember(admin, userId, row.project_id, principal))) {
    console.error(`[agent-api] PAT 멤버십 거절: user=${userEmail} project=${row.project_id}`)
    return { ok: false, res: apiFail(403, 'forbidden_role', '그 프로젝트의 멤버 이상만 실행할 수 있습니다.') }
  }
  if (!(await requireAgentProject(admin, row.project_id, principal))) return { ok: false, res: apiNotFound() }
  return { ok: true, order: row, userId }
}

/**
 * 쓰기 라우트 공통 신원 해석 — 계약 v2.0.
 * principal 이 신원이다. body user_email 이 있는데 다르면 400 identity_mismatch(사칭 신호 — 조용히 무시 금지).
 */
export async function resolveWriteActor(
  req: Request, admin: AdminClient, raw: unknown,
  scope: 'work:claim',
): Promise<
  | { ok: true; principal: AgentPrincipal; userId: string; agentLabel: string }
  | { ok: false; res: NextResponse }
> {
  const principal = await resolveAgentPrincipal(req, admin)
  if (principal instanceof NextResponse) return { ok: false, res: principal }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const scopeErr = requireScope(principal, scope)
  if (scopeErr) return { ok: false, res: scopeErr }
  const bodyEmail = typeof b.user_email === 'string' ? b.user_email.trim().toLowerCase() : ''
  if (bodyEmail && bodyEmail !== principal.userEmail) {
    return { ok: false, res: apiFail(400, 'identity_mismatch', 'user_email이 토큰 소유자와 다릅니다.') }
  }
  const agent = typeof b.agent === 'string' && AGENT_NAME_RE.test(b.agent.trim())
    ? b.agent.trim() : `pat-${principal.runnerId.slice(0, 8)}`
  return { ok: true, principal, userId: principal.userId, agentLabel: agent }
}
