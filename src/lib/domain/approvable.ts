// 결재(완료 승인) 대상 판정 — 순수. 사이드바 결재 배지(countApprovable)와 포털 '검토' 원천이 같은 판정을 쓴다.
// data/agentApprovals.ts 에 두지 않는 이유: 그 파일은 service_role 로더를 함께 가져 import 하는 쪽이 service_role 원천으로 분류된다.
import { canApproveCompletion, isSubtreeManagerOf } from '@/lib/domain/seatmap'

export type ApprovalItemRow = { id: string; parent_id: string | null; assignee_member_id: string | null }

/**
 * 승인 가능한 주문만 — 관리자면 전부, 아니면 내가 조상 담당자인(서브트리 관리자) 항목의 주문 중 리프 담당자가 나도 아니고
 * 내가 claim 하지도 않은 것만. 리프가 트리에 없으면 세지 않는다(서버의 leafFound 거부와 같다).
 */
export function filterApprovable<T extends { wbs_item_id: string | null; claimed_by_user_id: string | null }>(
  orders: readonly T[], items: ReadonlyArray<ApprovalItemRow>, viewer: { isAdmin: boolean; memberIds: readonly string[]; userId: string },
): T[] {
  if (viewer.isAdmin) return [...orders]
  if (viewer.memberIds.length === 0) return []
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
  })
}
