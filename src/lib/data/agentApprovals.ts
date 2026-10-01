// 사이드바 「에이전트」 메뉴의 결재 대기 배지(2026-09-18 사용자 요청) — 서버 전용.
// "승인할 것이 있으면 왼쪽 에이전트 아이콘에 표시가 있어야 사람이 알 수 있다."
//
// 셸 조회(/api/shell)는 내비게이션마다 부르므로 허브 조회(getAgentHub, 8건)를 쓰지 않고 좁게 읽는다:
// 승인 대기(reported) 주문 → 0건이면 끝. 관리자는 그 수 그대로, 아니면 로스터 + 항목 트리를 읽어
// 서브트리 관리자로서 승인할 수 있는 것만 센다 — 자기 담당 리프·자기가 claim 한 주문은 빼고
// (canApproveCompletion: 서버 requireCompletionApprover 와 같은 축, AUTH-07a).
// service_role 로 읽으므로 RLS 가 없다 — 판정은 여기서 세션 actor 로 직접 한다. 셸 라우트에 가드가 없어
// 임의의 menu=<uuid> 가 들어올 수 있으니, 관리자가 아니면 로스터에 내가 없을 때 0 이다(남의 프로젝트 수를 흘리지 않는다).
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { canApproveCompletion, isSubtreeManagerOf } from '@/lib/domain/seatmap'
import { myMemberIds } from '@/lib/agent/assignee'

type ItemRow = { id: string; parent_id: string | null; assignee_member_id: string | null }

/**
 * 순수 판정 — 관리자면 전부, 아니면 내가 조상 담당자인(서브트리 관리자) 항목의 주문 중 리프 담당자가 나도 아니고
 * 내가 claim 하지도 않은 것만. 리프가 트리에 없으면 세지 않는다(서버의 leafFound 거부와 같다).
 */
export function countApprovable(
  orders: ReadonlyArray<{ wbs_item_id: string | null; claimed_by_user_id: string | null }>,
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[]; userId: string },
): number {
  if (viewer.isAdmin) return orders.length
  if (viewer.memberIds.length === 0) return 0
  const itemById = new Map(items.map(i => [i.id, i]))
  const mine = new Set(viewer.memberIds)
  return orders.filter(o => {
    const leaf = o.wbs_item_id !== null ? itemById.get(o.wbs_item_id) : undefined
    if (!leaf) return false
    return canApproveCompletion({
      isAdmin: false,
      subtreeManager: isSubtreeManagerOf(leaf.id, itemById, mine),
      assigneeMine: leaf.assignee_member_id !== null && mine.has(leaf.assignee_member_id),
      claimedByMe: o.claimed_by_user_id === viewer.userId,
    })
  }).length
}

/** 이 프로젝트에서 내가 승인할 수 있는 결재 대기 수. 비로그인·잘못된 id 는 0. 조회 실패·잘림은 throw(호출부 — 셸 — 가 로그 + 배지 0). */
export async function getPendingApprovalCount(projectId: string): Promise<number> {
  if (!isUuidLike(projectId)) return 0
  const actor = await getActorForView()
  if (!actor) return 0
  const admin = createAdminClient()
  // 끝까지 읽는다(SP4 A2 §4.6 — limit(500) 은 배지를 500 에서 포화시켰다). 키는 바뀌지 않는 id(P15). 잘림·읽는 사이 변경·조회 오류는 throw —
  // 호출부(셸)가 로그 + 배지 0 으로 격리한다(이 함수의 계약 그대로).
  const rows = await fetchAllByKeyset<{ id: string; wbs_item_id: string | null; claimed_by_user_id: string | null }>(
    '[approvals] 결재 대기', (r) => r.id, (after, limit) => {
      const q = admin.from('agent_work_orders').select('id, wbs_item_id, claimed_by_user_id', { count: 'exact' })
        .eq('project_id', projectId).eq('status', 'reported')
      return (after ? q.gt('id', after.id) : q).order('id').limit(limit)
    })
  if (rows.length === 0) return 0
  if (isProjectAdmin(actor, projectId)) return rows.length
  // 조회 전용 명단(access_role null)은 부모 항목 담당자여도 승인할 수 없다 — 서버 requireCompletionApprover 가
  // requireProjectMember 부터 본다. 배지를 서버와 같은 축에 두고 service_role 조회 둘도 건너뛴다.
  if (!isProjectMember(actor, projectId)) return 0
  const memberIds = await myMemberIds(admin, { userId: actor.userId, projectId })
  if (memberIds.length === 0) return 0
  const items = await fetchAllByKeyset<ItemRow>('[approvals] 항목 트리', (r) => r.id, (after, limit) => {
    const q = admin.from('wbs_items').select('id, parent_id, assignee_member_id', { count: 'exact' }).eq('project_id', projectId)
    return (after ? q.gt('id', after.id) : q).order('id').limit(limit)
  })
  return countApprovable(rows, items, { isAdmin: false, memberIds, userId: actor.userId })
}
