import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  agentActorFromPrincipal, apiBadRequest, apiInternalError, apiNotFound, patProjectAllowed, requireScope, resolveAgentPrincipal,
} from '@/lib/agent/externalApi'
import { parseLeaseBody } from '@/lib/agent/leadLease'
import { isProjectMember } from '@/lib/domain/authz'
import { projectsWithModule } from '@/lib/modules/gate'

/**
 * 팀장 lease(계약 2.5) — 신원+프로젝트당 /dflow-team 팀장 하나. 원본 wbs-web bfea5805 를 D-Flow 권한 구조로 옮겼다.
 * 판정·CAS 는 기준선의 DB 함수(lead_lease_acquire·renew·release)가 행 잠금 안에서 한다. 여기서는 신원·스코프·멤버십·agents 관문만 거른다.
 * release 는 자기 lease 의 정리라 관문 앞에서 끝낸다(watch 의 stop 과 같다). acquire·renew 는 관문 뒤다.
 * 자격증명 범위 밖·멤버 아님·agents 꺼짐은 없는 프로젝트와 같은 404 다(원본의 403 forbidden_role 대신 — 존재 은닉).
 */
export const dynamic = 'force-dynamic'

interface AcquireRow { project_id: string; ok: boolean; generation: number; host: string | null; agent: string | null; expires_at: string | null }
interface RenewRow { project_id: string; ok: boolean; expires_at: string | null }

export async function POST(req: NextRequest) {
  let raw: unknown
  try { raw = await req.json() } catch { return apiBadRequest('잘못된 요청입니다.') }
  const parsed = parseLeaseBody(raw)
  if ('error' in parsed) return apiBadRequest(parsed.error)

  try {
    const admin = createAdminClient()
    const principal = await resolveAgentPrincipal(req, admin)
    if (principal instanceof NextResponse) return principal
    const scopeErr = requireScope(principal, 'work:claim')
    if (scopeErr) return scopeErr
    const pids = parsed.op === 'acquire' ? parsed.projects : parsed.leases.map((l) => l.project_id)
    if (pids.some((pid) => !patProjectAllowed(principal, pid))) return apiNotFound()

    if (parsed.op === 'release') {
      const { data, error } = await admin.rpc('lead_lease_release', {
        p_user: principal.userId, p_holder: parsed.holder, p_leases: parsed.leases,
      })
      if (error) { console.error('[agent-api] lease release 실패:', error.message); return apiInternalError() }
      return NextResponse.json({ ok: true, released: typeof data === 'number' ? data : 0 })
    }

    // 관문 — 소유자 스냅샷(조회 실패는 throw → 아래 catch 의 500)과 agents 모듈. 핸들러 최상위에서 한 번 늘 돈다.
    const actor = await agentActorFromPrincipal(admin, principal.userId, principal)
    const on = new Set(await projectsWithModule(pids, 'agents', { client: admin, workspaceId: principal.credential.workspaceId }))
    const usable = (pid: string) => on.has(pid) && isProjectMember(actor, pid)

    if (parsed.op === 'acquire') {
      // 멤버가 아닌 프로젝트의 lease 를 잡아 그 프로젝트의 진짜 팀장을 막는 일을 막는다.
      if (!parsed.projects.every(usable)) return apiNotFound()
      const { data, error } = await admin.rpc('lead_lease_acquire', {
        p_user: principal.userId, p_projects: parsed.projects, p_holder: parsed.holder,
        p_host: parsed.host, p_agent: parsed.agent, p_takeover: parsed.takeover,
      })
      if (error) { console.error('[agent-api] lease acquire 실패:', error.message); return apiInternalError() }
      const rows = (data ?? []) as AcquireRow[]
      const held = rows.filter((r) => !r.ok)
      if (held.length > 0) {
        return NextResponse.json({
          error: '같은 신원의 다른 팀장이 이 프로젝트의 lease 를 쥐고 있습니다.', code: 'lead_lease_held',
          held: held.map((r) => ({ project_id: r.project_id, host: r.host, agent: r.agent, expires_at: r.expires_at })),
        }, { status: 409 })
      }
      return NextResponse.json({
        ok: true, leases: rows.map((r) => ({ project_id: r.project_id, generation: r.generation, expires_at: r.expires_at })),
      })
    }

    // renew — 멤버에서 빠졌거나 agents 가 꺼진 프로젝트는 연장하지 않고 lost 로 돌려준다(클라이언트가 LEASE_LOST 로 물러난다).
    const keep = parsed.leases.filter((l) => usable(l.project_id))
    const dropped = parsed.leases.filter((l) => !usable(l.project_id)).map((l) => l.project_id)
    let rows: RenewRow[] = []
    if (keep.length > 0) {
      const { data, error } = await admin.rpc('lead_lease_renew', {
        p_user: principal.userId, p_holder: parsed.holder, p_leases: keep,
      })
      if (error) { console.error('[agent-api] lease renew 실패:', error.message); return apiInternalError() }
      rows = (data ?? []) as RenewRow[]
    }
    const kept = rows.filter((r) => r.ok && r.expires_at).map((r) => r.expires_at as string).sort()
    return NextResponse.json({
      ok: true, expires_at: kept[0] ?? null, lost: [...rows.filter((r) => !r.ok).map((r) => r.project_id), ...dropped],
    })
  } catch (e) {
    console.error('[agent-api] lease 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
