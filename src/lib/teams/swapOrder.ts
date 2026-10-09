import 'server-only'

// 팀 정렬 순서 맞바꾸기 — 관리 화면의 위·아래 단추. 옛 화면은 액션을 두 번 불러(update 2건) 두 번째가 실패하면 두 팀이 같은 순번으로
// 남았다. 여기서는 한 액션 안에서 두 행을 읽고 → 첫 행 → 둘째 행 순으로 쓰고, 둘째가 실패하면 첫 행을 되돌린다(보상).
// 한 트랜잭션은 아니다(스키마·RPC 를 더하지 않는 단계 — PostgREST 두 요청): 보상 쓰기까지 실패하면 두 팀이 같은 순번으로 남을 수 있고,
// 그때는 원인을 로그에 남기고 실패로 답한다(화면은 새로고침해 실제 순서를 다시 본다). 각 쓰기는 읽은 순번을 조건으로 건다 —
// 다른 관리자가 그새 순서를 바꿨으면 덮지 않고 멈춘다.
// 호출부(updateTeam·updateProjectTeam)가 등급 가드를 통과한 뒤 부르고, scope 는 그 가드가 판정한 범위다(범위 밖 행은 건드리지 않는다).
import type { SupabaseClient } from '@supabase/supabase-js'

/** 호출부 액션이 든 service_role 클라이언트 — 여기서 새로 만들지 않는다 */
type Admin = Pick<SupabaseClient, 'from'>
/** 공용 팀(그 워크스페이스·project_id null) 또는 그 프로젝트의 전용 팀 */
export type TeamOrderScope = { workspaceId: string; projectId: null } | { projectId: string }

export type SwapTeamOrderResult =
  | { ok: true }
  | { ok: false; kind: 'missing' | 'stale' | 'failed'; cause?: unknown }

export const ERR_TEAM_ORDER_STALE = '팀 순서가 그새 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.'

export async function swapTeamOrder(admin: Admin, scope: TeamOrderScope, aId: string, bId: string): Promise<SwapTeamOrderResult> {
  if (aId === bId) return { ok: false, kind: 'missing' }
  // 쓰기 전 선행 조회 — 실패는 중단(3원칙 ②). 두 행 모두 판정한 범위 안이어야 한다
  const base = admin.from('teams').select('id, sort_order').in('id', [aId, bId])
  const found = scope.projectId === null
    ? await base.is('project_id', null).eq('workspace_id', scope.workspaceId)
    : await base.eq('project_id', scope.projectId)
  if (found.error) return { ok: false, kind: 'failed', cause: found.error }
  const rows = (found.data ?? []) as { id: string; sort_order: number }[]
  const a = rows.find((r) => r.id === aId)
  const b = rows.find((r) => r.id === bId)
  if (!a || !b) return { ok: false, kind: 'missing' }
  if (a.sort_order === b.sort_order) return { ok: true }   // 같은 순번끼리는 바꿀 것이 없다

  // 읽은 순번을 조건으로 건다(그새 바뀐 행은 0행 — 덮지 않는다)
  const set = (id: string, from: number, to: number) => {
    const q = admin.from('teams').update({ sort_order: to }).eq('id', id).eq('sort_order', from)
    return (scope.projectId === null ? q.is('project_id', null).eq('workspace_id', scope.workspaceId) : q.eq('project_id', scope.projectId)).select('id')
  }
  const first = await set(a.id, a.sort_order, b.sort_order)
  if (first.error) return { ok: false, kind: 'failed', cause: first.error }
  if (!first.data || first.data.length === 0) return { ok: false, kind: 'stale' }

  const second = await set(b.id, b.sort_order, a.sort_order)
  if (!second.error && second.data && second.data.length > 0) return { ok: true }

  // 보상 — 첫 행을 원래 순번으로. 실패하면 두 팀이 같은 순번(b 의 순번)으로 남는다 — 숨기지 않고 로그에 남긴다
  const undo = await set(a.id, b.sort_order, a.sort_order)
  if (undo.error || !undo.data || undo.data.length === 0) {
    console.error('[teams.swapOrder] 보상 실패 — 두 팀이 같은 순번으로 남았을 수 있다:', aId, bId, undo.error?.message ?? '0행')
  }
  return second.error ? { ok: false, kind: 'failed', cause: second.error } : { ok: false, kind: 'stale' }
}
