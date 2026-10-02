// 사이드바 「에이전트」 메뉴의 결재 대기 배지(2026-09-18 사용자 요청) — 서버 전용.
// "승인할 것이 있으면 왼쪽 에이전트 아이콘에 표시가 있어야 사람이 알 수 있다."
//
// 셸 조회(/api/shell)는 내비게이션마다 부른다 — 허브 조회(getAgentHub)를 쓰지 않고 배지에 필요한 것만 읽는다:
// 먼저 판정(관리자도 멤버도 아니면 아무것도 읽지 않고 0), 그다음 승인 대기(reported) 주문 → 0건이면 끝. 관리자는 그 수 그대로,
// 멤버는 로스터 + 항목 트리를 읽어 서브트리 관리자로서 승인할 수 있는 것만 센다 — 자기 담당 리프·자기가 claim 한 주문은 빼고
// (canApproveCompletion: 서버 requireCompletionApprover 와 같은 축, AUTH-07a). 주문·항목 트리는 끝까지 읽는다(SP4 A2 §4.6) —
// 그래서 비관리자 멤버는 대기 주문이 있으면 이동마다 그 프로젝트의 항목 트리 전체(1,000행 넘으면 여러 쪽)를 읽는다.
// service_role 로 읽으므로 RLS 가 없다 — 판정은 여기서 세션 actor 로 직접, 조회보다 먼저 한다(A2-3 리뷰 보안 P3 — X3). 셸 라우트에 가드가
// 없어 임의의 menu=<uuid> 가 들어올 수 있으니, 관리자·멤버가 아니면 주문조차 읽지 않는다(남의 프로젝트를 끝까지 읽게 하지 않는다).
// 기록(A2-3 리뷰 정확성 P3): 1,000행을 넘는 대기 주문·항목 트리를 읽는 사이 한 행이라도 바뀌면 끝까지 읽기가 throw 하고 셸이 로그 + 배지 0 으로
// 격리한다 — 그 한 번의 이동에서 배지가 사라졌다 다음 이동에 돌아온다. 재시도·SQL 한 번으로 옮기는 개선은 SPU2 후보다.
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllByKeyset } from '@/lib/data/paging'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { isUuidLike } from '@/lib/domain/agentWork'
import { filterApprovable, type ApprovalItemRow } from '@/lib/domain/approvable'
import { myMemberIds } from '@/lib/agent/assignee'

type ItemRow = ApprovalItemRow

/** 승인 가능한 주문 수 — 판정은 domain/approvable 의 filterApprovable(포털 '검토' 원천과 같은 함수) */
export function countApprovable(
  orders: ReadonlyArray<{ wbs_item_id: string | null; claimed_by_user_id: string | null }>,
  items: ReadonlyArray<ItemRow>,
  viewer: { isAdmin: boolean; memberIds: readonly string[]; userId: string },
): number {
  return filterApprovable(orders, items, viewer).length
}

/** 이 프로젝트에서 내가 승인할 수 있는 결재 대기 수. 비로그인·잘못된 id 는 0. 조회 실패·잘림은 throw(호출부 — 셸 — 가 로그 + 배지 0). */
export async function getPendingApprovalCount(projectId: string): Promise<number> {
  if (!isUuidLike(projectId)) return 0
  const actor = await getActorForView()
  if (!actor) return 0
  const isAdmin = isProjectAdmin(actor, projectId)
  // 조회 전용 명단(access_role null)은 부모 항목 담당자여도 승인할 수 없다 — 서버 requireCompletionApprover 가
  // requireProjectMember 부터 본다. 배지를 서버와 같은 축에 두고, 판정을 조회 앞에 둬 service_role 조회를 하나도 하지 않는다(X3)
  if (!isAdmin && !isProjectMember(actor, projectId)) return 0
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
  if (isAdmin) return rows.length
  const memberIds = await myMemberIds(admin, { userId: actor.userId, projectId })
  if (memberIds.length === 0) return 0
  const items = await fetchAllByKeyset<ItemRow>('[approvals] 항목 트리', (r) => r.id, (after, limit) => {
    const q = admin.from('wbs_items').select('id, parent_id, assignee_member_id', { count: 'exact' }).eq('project_id', projectId)
    return (after ? q.gt('id', after.id) : q).order('id').limit(limit)
  })
  return countApprovable(rows, items, { isAdmin: false, memberIds, userId: actor.userId })
}
