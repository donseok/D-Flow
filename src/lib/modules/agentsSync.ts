/**
 * agents 모듈을 켠 뒤의 후속 처리(스펙 §4.4, 개정 §2.2.2) — modules.enabled 에 agents 가 더해진 저장이 성공한 뒤 부른다.
 * 에이전트 사용 여부의 원천은 modules.enabled 하나다(SP7 — 등록 표와 그 행 동기는 없다). 여기서는 꺼져 있는 동안 발행되지 못한 주문을 채운다(백필).
 * 백필이 실패해도 모듈은 이미 켜져 있다 — 열린 채 에러만 반환한다(같은 허용 목록을 워크스페이스에서 다시 저장하면 백필을 재시도한다).
 * 설정 저장의 agentsNewlyEnabled 는 '새로 더해짐'만 보므로 이미 agents 가 든 프로젝트 설정을 다시 저장해도 백필은 돌지 않는다.
 */
import { backfillProjectOrders } from '@/lib/agent/ensureOrder'
import type { AdminClient } from '@/lib/supabase/adminFor'
import type { ModuleId } from './defaults'

/** 워크스페이스에서 agents 를 다시 허용한 뒤, 그 사이 발행되지 못한 주문을 프로젝트별로 채운다.
 * 프로젝트의 agents 모듈 관문은 backfillProjectOrders 가 판정한다.
 * 같은 허용 목록을 다시 저장해도 멱등으로 재시도할 수 있어야 한다. */
export async function backfillWorkspaceAgentOrders(
  admin: AdminClient,
  args: { workspaceId: string; actorUserId: string },
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const pageSize = 200
  let lastId: string | null = null
  let created = 0
  while (true) {
    let query = admin.from('projects').select('id').eq('workspace_id', args.workspaceId).order('id').limit(pageSize)
    if (lastId) query = query.gt('id', lastId)
    const { data, error } = await query
    if (error) return { ok: false, error: `프로젝트 목록 조회 실패: ${error.message}` }
    if (!Array.isArray(data)) return { ok: false, error: '프로젝트 목록 결과가 없습니다.' }
    const rows = data as { id: string }[]
    if (rows.length === 0) return { ok: true, created }
    for (const row of rows) {
      const result = await backfillProjectOrders(admin, { projectId: row.id, actorUserId: args.actorUserId })
      if (!result.ok) return { ok: false, error: `${row.id} 주문 백필 실패: ${result.error}` }
      if (result.failed.length) return { ok: false, error: `${row.id} 주문 ${result.failed.length}건 백필 실패` }
      created += result.created
    }
    lastId = rows[rows.length - 1].id
  }
}

export function agentsNewlyEnabled(prev: readonly ModuleId[] | null, next: readonly ModuleId[]): boolean {
  return next.includes('agents') && !(prev ?? []).includes('agents')
}

export async function syncAgentsModule(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string; prevEnabled: readonly ModuleId[] | null; nextEnabled: readonly ModuleId[] },
): Promise<{ ok: true; changed: false } | { ok: true; changed: true; backfilled: number; failed: string[] } | { ok: false; error: string }> {
  if (!agentsNewlyEnabled(args.prevEnabled, args.nextEnabled)) return { ok: true, changed: false }
  const { projectId, actorUserId } = args
  const bf = await backfillProjectOrders(admin, { projectId, actorUserId })
  if (!bf.ok) return { ok: false, error: `주문 백필 실패: ${bf.error}` }
  return { ok: true, changed: true, backfilled: bf.created, failed: bf.failed }
}
