// 서브트리 관리자 가드(트랙 B, 2026-09-15) — 허브 "개발 프로세스 조정" op(승인·반려/승인취소/재작업·
// 중단·단계 조정)의 관리자 전용 판정에 "서브트리 관리자"를 더한다. 별도 파일로 두는 이유는
// delegation.ts 에 섞지 않기 위해서다 — delegation.ts 는 ensureOrder(3 export)·stageTransition·
// agentSeatmap 을 끌고 오는 무거운 모듈이고, requireDelegationRight 는 위임 토글·프롬프트 편집이
// 공유하는 "관리자 또는 리프 담당자 본인" 계약이라 서브트리 관리자를 거기 섞으면 위임 토글까지
// 조용히 넓어진다(이번 범위 밖). wbsAssign.ts·agentHub.ts 가 이 파일 하나만 가져가면 그 무게가
// 따라오지 않는다 — 이 리포는 부분 목킹으로 같은 문제를 이미 두 번 우회했다(authz/errors.ts,
// wbs-assign.test.ts 의 stageTransition importOriginal).
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { myMemberIds, isSubtreeManager, subtreeStanding } from '@/lib/agent/assignee'

export const ERR_NOT_SUBTREE_MANAGER = '관리자 또는 서브트리 관리자만 할 수 있습니다.'
export const ERR_SELF_APPROVAL = '자기 담당이거나 자기가 착수한 항목의 완료는 승인할 수 없습니다 — 다른 관리자나 상위 담당자에게 요청하세요.'

export type SubtreeGuardResult =
  | { ok: true; actor: { userId: string }; isAdmin: boolean }
  | { ok: false; error: string }

/**
 * 개발 프로세스 조정 op(중단·재개·단계 조정, 그리고 반려/승인취소/재작업의 "관리자도 리프
 * 담당자 본인도 아니다" 경로)의 공용 자격 — 관리자 또는 그 항목의 서브트리 관리자.
 * 승인은 여기에 자기 승인 금지를 더한 requireCompletionApprover 를 쓴다.
 *
 * "서브트리 관리자" = 대상 항목의 strict 조상(부모·조부모…루트, 자신 제외) 중 어느 노드의
 * 담당자가 나인 경우(isSubtreeManager, assignee.ts). 관리자 가드를 먼저 물어 관리자는 추가
 * 조회 없이 통과한다(requireDelegationRight 와 같은 패턴).
 *
 * fail-closed: 로스터·조상 조회가 던지면(myMemberIds·isSubtreeManager 계약) 거부로 잡는다.
 */
export async function requireSubtreeManagerOrAdmin(
  itemId: string, projectId: string,
): Promise<SubtreeGuardResult> {
  const a = await requireProjectAdmin(projectId)
  if (a.ok) return { ok: true, actor: { userId: a.actor.userId }, isAdmin: true }
  const m = await requireProjectMember(projectId)
  if (!m.ok) return { ok: false, error: m.error }
  const admin = createAdminClient()
  try {
    const mine = await myMemberIds(admin, { userId: m.actor.userId, projectId })
    const manager = await isSubtreeManager(admin, { itemId, projectId, myMemberIds: mine })
    if (!manager) return { ok: false, error: ERR_NOT_SUBTREE_MANAGER }
    return { ok: true, actor: { userId: m.actor.userId }, isAdmin: false }
  } catch (e) {
    console.error('[subtreeManager] 서브트리 관리자 판정 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '서브트리 관리자 판정에 실패했습니다.' }
  }
}

/**
 * 완료 승인(approve) 자격 — 관리자, 또는 서브트리 관리자이면서 그 리프의 담당자 본인도 그 주문을 claim 한 계정도 아닌 사람
 * (분리 원칙: 자기 완료를 자기가 승인하지 못한다 — 제7부 AUTH-07a). 반려·승인 취소·재작업은 requireSubtreeManagerOrAdmin·
 * loadOrderForReview 그대로다 — 되돌리는 결정은 담당자 본인에게도 열려 있다.
 * 리프 행을 찾지 못하면 담당자를 확인할 수 없으므로 거부한다. 조회가 던져도 거부한다(fail-closed).
 * 레거시 비밀로 claim 한 주문(claimedByUserId null)은 claim 계정을 알 수 없어 담당자 검사만 받는다(SP7 에서 닫는다).
 */
export async function requireCompletionApprover(
  itemId: string, projectId: string, opts: { claimedByUserId: string | null },
): Promise<SubtreeGuardResult> {
  const a = await requireProjectAdmin(projectId)
  if (a.ok) return { ok: true, actor: { userId: a.actor.userId }, isAdmin: true }
  const m = await requireProjectMember(projectId)
  if (!m.ok) return { ok: false, error: m.error }
  const admin = createAdminClient()
  try {
    const mine = await myMemberIds(admin, { userId: m.actor.userId, projectId })
    if (mine.length === 0) return { ok: false, error: ERR_NOT_SUBTREE_MANAGER }
    const s = await subtreeStanding(admin, { itemId, projectId, myMemberIds: mine })
    if (!s.leafFound || !s.manager) return { ok: false, error: ERR_NOT_SUBTREE_MANAGER }
    const assigneeMine = s.leafAssigneeMemberId !== null && mine.includes(s.leafAssigneeMemberId)
    if (assigneeMine || opts.claimedByUserId === m.actor.userId) return { ok: false, error: ERR_SELF_APPROVAL }
    return { ok: true, actor: { userId: m.actor.userId }, isAdmin: false }
  } catch (e) {
    console.error('[subtreeManager] 승인 자격 판정 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: '승인 자격 판정에 실패했습니다.' }
  }
}
