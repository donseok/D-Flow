/**
 * 에이전트 사용 여부의 두 원천 동기화(스펙 §4.4, 개정 §2.2.2) — modules.enabled 에 agents 가 더해진 저장이 성공한 뒤 부른다.
 * agent_projects 행을 맞추고(없으면 insert, enabled=false 면 true) 옛 토글이 하던 주문 백필을 돈다. 빼는 쪽은 손대지 않는다 —
 * 사람이 멈춘 것(enabled=false)은 위임이 되살리지 못한다.
 * 행 조작 실패 시엔 관문이 두 원천의 AND 라 닫힌 채지만, 백필 실패 시엔 두 원천이 모두 켜져 있어 열린 채 에러만 반환한다(다시 누르면 백필 재시도).
 * 설정 저장의 agentsNewlyEnabled 는 '새로 더해짐'만 보므로 이미 agents 가 든 설정을 다시 저장해도 복구되지 않는다. 복구는 옛 토글(D41 — prev 에서 agents 를 빼고 부른다)이나 Phase C 의 편집기가 한다(CR-2).
 */
import { backfillProjectOrders } from '@/lib/agent/ensureOrder'
import type { AdminClient } from '@/lib/supabase/adminFor'
import type { ModuleId } from './defaults'

export function agentsNewlyEnabled(prev: readonly ModuleId[] | null, next: readonly ModuleId[]): boolean {
  return next.includes('agents') && !(prev ?? []).includes('agents')
}

export async function syncAgentsModule(
  admin: AdminClient,
  args: { projectId: string; actorUserId: string; prevEnabled: readonly ModuleId[] | null; nextEnabled: readonly ModuleId[] },
): Promise<{ ok: true; changed: false } | { ok: true; changed: true; backfilled: number; failed: string[] } | { ok: false; error: string }> {
  if (!agentsNewlyEnabled(args.prevEnabled, args.nextEnabled)) return { ok: true, changed: false }
  const { projectId, actorUserId } = args
  const { data: reg, error: regErr } = await admin.from('agent_projects').select('enabled').eq('project_id', projectId).maybeSingle()
  if (regErr) return { ok: false, error: `에이전트 등록 조회 실패: ${regErr.message}` }
  if (!reg) {
    const { error } = await admin.from('agent_projects').insert({ project_id: projectId, created_by: actorUserId, note: '설정에서 켬' })
    if (error) return { ok: false, error: `에이전트 등록 실패: ${error.message}` }
  } else if ((reg as { enabled: boolean }).enabled !== true) {
    const { error } = await admin.from('agent_projects').update({ enabled: true }).eq('project_id', projectId)
    if (error) return { ok: false, error: `에이전트 등록 갱신 실패: ${error.message}` }
  }
  const bf = await backfillProjectOrders(admin, { projectId, actorUserId })
  if (!bf.ok) return { ok: false, error: `주문 백필 실패: ${bf.error}` }
  return { ok: true, changed: true, backfilled: bf.created, failed: bf.failed }
}
