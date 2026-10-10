'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { requireProjectAdmin, requireProjectMember } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import { after } from 'next/server'
import { recordProgressSnapshot } from '@/lib/data/snapshots'
import { ERR_REPORT_STALE, isUuidLike } from '@/lib/domain/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { applyWorkflowEvent, notifyOnReached, REASON_TEXT, SKIPPED_WARN, type WorkflowEventOk, type WorkflowSkipped } from '@/lib/agent/workflowEvent'
import { requireDelegationRight } from '@/lib/agent/delegation'
import { requireCompletionApprover, requireSubtreeManagerOrAdmin } from '@/lib/agent/subtreeManager'
import { loadApprovalState, notifyApprovalStep } from '@/lib/agent/approvalState'
import { STEP_CODE_RE, type PendingApproval } from '@/lib/domain/approvalSteps'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'
import { ERR_MISSING } from '@/lib/authz/errors'

/**
 * 에이전트 작업 루프 UI 서버 액션 — 스펙 §5. 2026-08-24: 전용 관제 화면(/agent-ops)을 없애고
 * WBS 명세 패널(WbsSpecPanel)의 "진행 상황" 섹션에 흡수했다 — 위임(발행)·회수(취소)는 이미 그 패널의
 * "에이전트 위임" 체크 하나로 되므로 별도 화면이 필요 없었다(사용자 결정). 승인·반려는 여전히 사람만
 * 할 수 있는 행위라 여기 남는다. 알림 href·revalidatePath 는 그 항목이 속한 프로젝트의 WBS 화면을 가리킨다.
 *
 * 쓰기는 admin(service_role) 경유(신규 테이블은 쓰기 RLS 가 없다 — 서버 가드가 유일한 관문).
 * 조회(getAgentOrderForItem)만 세션 클라이언트로 해 RLS 조회 정책을 2차 방어선으로 쓴다.
 */

type ActionResult = { ok: boolean; error?: string; warning?: string; stale?: true
  /** SP5b: 중간 단계 승인이면 남은 단계 수(주문은 reported 그대로) */ remaining?: number }

/** 승인 계열의 agents 관문(스펙 §4.2) — 가드를 지난 주문의 프로젝트로 판정한다. */
async function withAgents<T extends { ok: true }>(projectId: string, pass: T): Promise<T | { ok: false; error: string }> {
  const mod = await requireModule({ projectId }, 'agents')
  return mod.ok ? pass : { ok: false, error: mod.error }
}

/**
 * 승인 자격 로더 — 관리자 또는 서브트리 관리자(트랙 B, 2026-09-15). 완료를 확정하는 결정이라
 * 리프 담당자 본인·그 주문을 claim 한 계정은 제외 — requireCompletionApprover 가 시행한다(분리 원칙:
 * 자기 완료를 자기가 승인 못 함, 제7부 AUTH-07a).
 * WBS 항목이 삭제된 주문(wbs_item_id 없음)은 조상을 특정할 수 없어 관리자만.
 */
async function loadOrderForAdmin(orderId: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; wbs_item_id: string | null; claimed_by_user_id: string | null }; actor: { userId: string }; pending: PendingApproval | null }
  | { ok: false; error: string }
> {
  const t = await serverTranslator()
  if (!isUuidLike(orderId)) return { ok: false, error: t('err.invalidRequest') }
  const admin = createAdminClient()
  const { data: order, error } = await admin
    .from('agent_work_orders').select('id, project_id, status, wbs_item_id, claimed_by_user_id').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: fill(t('err.couldNotLoadOrder'), { message: error.message }) }
  if (!order) return { ok: false, error: t('err.orderNotFound') }
  const row = order as { id: string; project_id: string; status: string; wbs_item_id: string | null; claimed_by_user_id: string | null }
  if (row.wbs_item_id === null) {
    const g = await requireProjectAdmin(row.project_id)
    if (!g.ok) return { ok: false, error: g.error }
    return withAgents(row.project_id, { ok: true as const, order: row, actor: { userId: g.actor.userId }, pending: null })
  }
  // SP5b(D18): 대기 단계의 승인자가 가드를 고른다 — admin 단계는 프로젝트 관리자만, subtree_or_admin 은 현행 승인 가드(자기 승인 금지 포함).
  // 판독 실패·설정 손상은 거부(fail-closed)
  const st = await loadApprovalState(admin, row.wbs_item_id, row.project_id)
  if (!st.ok) return st
  if (st.pending.approver === 'admin') {
    const g = await requireProjectAdmin(row.project_id)
    if (!g.ok) return { ok: false, error: g.error }
    return withAgents(row.project_id, { ok: true as const, order: row, actor: { userId: g.actor.userId }, pending: st.pending })
  }
  const right = await requireCompletionApprover(row.wbs_item_id, row.project_id, { claimedByUserId: row.claimed_by_user_id })
  if (!right.ok) return { ok: false, error: right.error }
  return withAgents(row.project_id, { ok: true as const, order: row, actor: right.actor, pending: st.pending })
}

/**
 * 검토 계열(반려·승인 취소·재작업 요청)의 자격 로더(2026-09-14, 사용자 결정 "담당자 본인도 허용";
 * 2026-09-15 트랙 B — 서브트리 관리자 추가). 승인(approve)은 완료를 확정하는 결정이라 별도로
 * loadOrderForAdmin(관리자 또는 서브트리 관리자, 리프 담당자 본인·claim 계정은 제외)을 쓴다. 이쪽은
 * "되돌리는" 결정이라 더 넓다 — 관리자, 그 항목의 담당자 본인(requireDelegationRight), 그
 * 항목의 서브트리 관리자(requireSubtreeManagerOrAdmin) 중 하나면 된다.
 * 담당자 본인 판정(관리자 포함)을 먼저 보고 실패할 때만 서브트리 관리자를 추가로 본다 — 흔한
 * 경로(관리자·담당자 본인)에서는 조상 조회가 돌지 않는다.
 * WBS 항목이 삭제된 주문(wbs_item_id 없음)은 담당자도 조상도 특정할 수 없어 관리자만.
 */
async function loadOrderForReview(orderId: string): Promise<
  | { ok: true; order: { id: string; project_id: string; status: string; wbs_item_id: string | null }; actor: { userId: string } }
  | { ok: false; error: string }
> {
  const t = await serverTranslator()
  if (!isUuidLike(orderId)) return { ok: false, error: t('err.invalidRequest') }
  const admin = createAdminClient()
  const { data: order, error } = await admin
    .from('agent_work_orders').select('id, project_id, status, wbs_item_id').eq('id', orderId).maybeSingle()
  if (error) return { ok: false, error: fill(t('err.couldNotLoadOrder'), { message: error.message }) }
  if (!order) return { ok: false, error: t('err.orderNotFound') }
  const row = order as { id: string; project_id: string; status: string; wbs_item_id: string | null }
  if (row.wbs_item_id === null) {
    const g = await requireProjectAdmin(row.project_id)
    if (!g.ok) return { ok: false, error: g.error }
    return withAgents(row.project_id, { ok: true as const, order: row, actor: { userId: g.actor.userId } })
  }
  const right = await requireDelegationRight(row.wbs_item_id)
  if (right.ok) return withAgents(row.project_id, { ok: true as const, order: row, actor: { userId: right.actor.userId } })
  // 관리자도 리프 담당자 본인도 아니다 — 서브트리 관리자인지 추가로 본다. 최종 거부는
  // requireDelegationRight 의 사유를 그대로 쓴다(ERR_NOT_ASSIGNEE — 기존 계약·테스트 유지).
  const subtree = await requireSubtreeManagerOrAdmin(row.wbs_item_id, row.project_id)
  if (!subtree.ok) return { ok: false, error: right.error }
  return withAgents(row.project_id, { ok: true as const, order: row, actor: subtree.actor })
}

/**
 * 승인/반려 알림 — fire-and-forget. 수신자는 그 항목의 배정자(없으면 발행 생략).
 * work.unblocked 는 여기서 발행하지 않는다 — 전이 결과(reachedFirst)를 보고 notifyOnReached(후행의 선행 전체
 * 충족 게이트)가 발행한다. 이 함수가 게이트·dedupeKey 없이 판단하면 거짓 알림을 낼 수 있었다(최종 리뷰 I2).
 */
async function notifyReviewResult(
  admin: AdminClient,
  order: { id: string; project_id: string; wbs_item_id: string | null },
  type: 'work.approved' | 'work.rejected',
  actorUserId: string,
  detail?: string,
) {
  if (!order.wbs_item_id) return
  const { data: itemRow, error } = await admin
    .from('wbs_items').select('name, assignee_member_id')
    .eq('id', order.wbs_item_id).maybeSingle()
  if (error) {
    console.error('[agentWork] 알림용 항목 조회 실패:', error.message)
    return
  }
  if (!itemRow) return
  const item = itemRow as { name: string; assignee_member_id: string | null }
  if (!item.assignee_member_id) return
  emitNotification({
    type, projectId: order.project_id, actorUserId,
    entityType: 'agent_order', entityId: order.id,
    payload: {
      title: item.name,
      detail: detail ?? (type === 'work.approved' ? '완료가 승인되었습니다' : '완료가 반려되었습니다'),
      href: `/p/${order.project_id}/wbs`,
    },
    recipientMemberIds: [item.assignee_member_id],
  }).catch(() => {
    // 알림 실패는 로깅만 하고 본 동작에 영향을 주지 않는다.
  })
}

/** 주문 사건이 단계·실적을 건너뛴 사유가 있으면 사람용 경고로. 사유가 무엇이든 알린다 — 종전 경로에서 'parent' 를 빠뜨려 반쪽 상태가 무음으로 끝난 적이 있다. */
function skippedWarning(t: ServerTranslate, skipped: WorkflowSkipped | null): string | undefined {
  if (!skipped) return undefined
  // 모르는 사유도 무음으로 끝내지 않는다 — RPC 가 새 사유를 돌려줘도 여기서 걸리게.
  return SKIPPED_WARN[skipped] ?? fill(t('srv.agentWork.requestProcessedButStageProgress'), { skipped })
}

/** 전이 뒤 공통 부수효과 — 화면 갱신, 실적이 바뀌었으면 진척 스냅샷, im·xx 첫 도달이면 후행 알림. 실패는 로깅만. */
async function afterTransition(
  admin: AdminClient,
  args: { projectId: string; itemId: string | null; actorUserId: string; transition: WorkflowEventOk },
): Promise<void> {
  revalidatePath(`/p/${args.projectId}`, 'layout')
  if (args.transition.actualChanged) after(() => recordProgressSnapshot(args.projectId))
  if (args.transition.reachedFirst && args.itemId) await notifyOnReached(admin, args.itemId, args.actorUserId)
}

/**
 * 주문의 최신 완료 보고 id(없으면 null). 조회 실패는 결과로 — 호출부가 쓰기 전에 중단한다(3원칙 ②).
 * created_at 이 같으면 id 가 큰 쪽이 최신이다 — 화면(seatmap.ts isLaterReport, getAgentOrderForItem 의 보고 순서)도
 * 같은 순서라 두 쪽이 같은 보고를 "최신"으로 고른다.
 */
async function latestCompletionReportId(
  admin: AdminClient, orderId: string,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const t = await serverTranslator()
  const { data, error } = await admin
    .from('agent_work_reports').select('id').eq('work_order_id', orderId).eq('kind', 'completion')
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle()
  if (error) return { ok: false, error: fill(t('srv.agentWork.couldNotLoadReport'), { message: error.message }) }
  return { ok: true, id: (data as { id: string } | null)?.id ?? null }
}

/** 화면이 보낸 "본 보고" id 의 모양 — uuid 또는 null(보고 없음). 서버 액션은 직접 호출될 수 있어 런타임에 본다. */
function isExpectedReportId(v: unknown): v is string | null {
  return v === null || (typeof v === 'string' && isUuidLike(v))
}

/** 사람이 본 보고가 지금도 최신인가 — 반려 뒤 재보고된 주문을 옛 카드로 승인·반려하지 못하게 한다. */
async function checkReportFresh(
  admin: AdminClient, orderId: string, expectedReportId: string | null,
): Promise<{ ok: true; reportId: string | null } | { ok: false; error: string; stale?: true }> {
  const latest = await latestCompletionReportId(admin, orderId)
  if (!latest.ok) return latest
  if (latest.id !== expectedReportId) return { ok: false, stale: true, error: ERR_REPORT_STALE }
  return { ok: true, reportId: latest.id }
}

/** 최신 completion 보고의 review 필드를 갱신한다 — 되감기(승인 취소·재작업) 전용. 전이 뒤 부수 기록이라 실패는 로깅만(전이 자체는 확정됐다). */
async function recordReview(admin: AdminClient, orderId: string, patch: Record<string, unknown>, label: string): Promise<void> {
  const latest = await latestCompletionReportId(admin, orderId)
  if (!latest.ok || latest.id === null) {
    // latest.error 는 이미 "보고 조회 실패: …" 다 — 접두어를 다시 붙이지 않는다.
    console.error(`[agentWork] ${label}:`, latest.ok ? '보고 조회 실패: 0행' : latest.error)
    return
  }
  await recordReviewOn(admin, latest.id, patch, label)
}

/**
 * 승인·반려의 검토 기록 — checkReportFresh 가 대조한 그 보고 행에 직접 쓴다. 전이 뒤 "최신"을 다시 찾으면
 * 그 사이 들어온 새 보고에 찍힌다. reportId 가 null 이면 기록할 보고가 없으니 건너뛴다. 실패는 로깅만.
 */
async function recordReviewOn(admin: AdminClient, reportId: string | null, patch: Record<string, unknown>, label: string): Promise<void> {
  if (reportId === null) return
  const { error } = await admin.from('agent_work_reports').update(patch).eq('id', reportId).select('id')
  if (error) console.error(`[agentWork] ${label} 기록 실패:`, error.message)
}

/**
 * 승인 — 원자 전이(스펙 2026-09-15 §4). reported→approved CAS + 단계 xx + 실적 100 + change_logs 가 한 트랜잭션이다.
 * 종전에는 실적 100 을 먼저 쓰고 CAS 에서 밀리면 "실적만 100" 인 반쪽 상태가 남았고, 단계 전이는 그 뒤에 따로
 * 실행돼 뒤처지곤 했다(리허설에서 3회 재현). 이제 CAS 가 지면 아무것도 쓰이지 않는다.
 * 주문 사건은 dev_workflow 를 보지 않는다 — 주문의 존재가 곧 워크플로 증거다(구 force 의 일반화).
 * 실적 쓰기가 담당 팀 게이트(updateActual)를 거치지 않는 이유는 종전과 같다 — 승인 자격(관리자·서브트리 관리자)은
 * loadOrderForAdmin 이 이미 확정했고, 실적은 사람이 치는 값이 아니라 승인 사건의 크레딧이다.
 */
export async function approveAgentCompletion(orderId: string, expectedReportId: string | null, expectedStep?: string | null): Promise<ActionResult> {
  const t = await serverTranslator()
  if (!isExpectedReportId(expectedReportId)) return { ok: false, error: t('err.invalidRequest') }
  if (expectedStep != null && (typeof expectedStep !== 'string' || !STEP_CODE_RE.test(expectedStep))) return { ok: false, error: t('err.invalidRequest') }
  const loaded = await loadOrderForAdmin(orderId)
  if (!loaded.ok) return loaded
  const { order, actor, pending } = loaded
  if (order.status !== 'reported') return { ok: false, error: fill(t('srv.agentWork.orderCannotApprovedState'), { status: order.status }) }
  if (!order.wbs_item_id) return { ok: false, error: t('srv.agentWork.wbsItemOrderDeleted') }
  // 화면이 본 단계가 지금 대기 단계가 아니면 쓰기 전에 돌려보낸다 — RPC 가 같은 대조를 설정 FOR SHARE 아래에서 다시 한다
  if (expectedStep != null && pending && pending.step !== expectedStep) return { ok: false, stale: true, error: REASON_TEXT.approval_stale }

  const admin = createAdminClient()
  // RPC 가 주문 행 잠금 아래에서 같은 보고 id 를 다시 대조한다(0011 H2-i) — 이 대조와 전이 사이의 재보고도 stale 로 막힌다.
  const fresh = await checkReportFresh(admin, orderId, expectedReportId)
  if (!fresh.ok) return fresh
  const transition = await applyWorkflowEvent(admin, { event: 'approve', actorUserId: actor.userId, orderId, expectedReportId, expectedStep })
  if (!transition.ok) {
    if (transition.stale) return { ok: false, stale: true, error: ERR_REPORT_STALE }
    if (transition.reason === 'approval_stale') return { ok: false, stale: true, error: transition.error }
    return { ok: false, error: transition.conflict ? t('srv.agentWork.stateChangedApprovalNotApplied') : transition.error }
  }
  // 중간 단계(SP5b): 주문은 reported·단계 im 그대로 — 검토 기록(review_action)은 마지막 단계에서만 쓴다. 다음 단계 승인 자격자에게 알린다
  if (transition.approval && transition.approval.remaining > 0) {
    const total = pending?.total ?? transition.approval.remaining + 1
    await notifyApprovalStep(admin, {
      projectId: order.project_id, itemId: order.wbs_item_id, entity: { type: 'agent_order', id: order.id },
      actorUserId: actor.userId, nextIndex: total - transition.approval.remaining + 1, total,
    })
    await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
    return { ok: true, remaining: transition.approval.remaining }
  }
  await recordReviewOn(admin, fresh.reportId, { review_action: 'approve', reviewed_by: actor.userId, reviewed_at: new Date().toISOString() }, '승인')
  await notifyReviewResult(admin, order, 'work.approved', actor.userId)
  await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
  const warning = skippedWarning(t, transition.skipped)
  return warning ? { ok: true, warning } : { ok: true }
}

/** 반려 — 원자 전이. reported→claimed CAS + 단계 ip + 실적 표.rw(반려·재작업 크레딧 — 작업은 했으므로 claim 보다 높다, 스펙 D4). */
export async function rejectAgentCompletion(orderId: string, note: string, expectedReportId: string | null): Promise<ActionResult> {
  const t = await serverTranslator()
  if (!isExpectedReportId(expectedReportId)) return { ok: false, error: t('err.invalidRequest') }
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: t('srv.agentWork.rejectionReasonRequired') }
  const loaded = await loadOrderForReview(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'reported') {
    return { ok: false, error: fill(t('srv.agentWork.orderCannotRejectedState'), { status: order.status }) }
  }
  const admin = createAdminClient()
  // RPC 가 주문 행 잠금 아래에서 같은 보고 id 를 다시 대조한다(0011 H2-i) — 이 대조와 전이 사이의 재보고도 stale 로 막힌다.
  const fresh = await checkReportFresh(admin, orderId, expectedReportId)
  if (!fresh.ok) return fresh
  const transition = await applyWorkflowEvent(admin, { event: 'reject', actorUserId: actor.userId, orderId, expectedReportId })
  if (!transition.ok) {
    if (transition.stale) return { ok: false, stale: true, error: ERR_REPORT_STALE }
    return { ok: false, error: transition.conflict ? t('srv.agentWork.stateChangedRejectionNotApplied') : transition.error }
  }
  await recordReviewOn(admin, fresh.reportId, { review_action: 'reject', reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_note: trimmed }, '반려')
  await notifyReviewResult(admin, order, 'work.rejected', actor.userId)
  await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
  const warning = skippedWarning(t, transition.skipped)
  return warning ? { ok: true, warning } : { ok: true }
}

/**
 * 승인 되감기 공통부(2026-08-27) — 승인 취소(reported 로)와 재작업 요청(claimed 로). 원자 전이 RPC 가 주문 CAS·
 * 단계·실적을 한 트랜잭션으로 쓴다(스펙 §3.4): 승인 취소 = 단계 im·실적 표.im, 재작업 = 단계 ip·실적 표.rw.
 * 종전에는 change_logs 에서 승인 전 실적을 찾아 되돌렸는데, 승인 이후 이력이 바뀌면 복원을 포기하고 경고만 남겼다.
 * 사건 표의 크레딧으로 쓰면 되돌릴 값을 추측할 필요가 없다.
 *
 * 승인 취소가 단계를 im 에 두는 이유는 그대로다 — im 아래로 내리면 이 항목을 선행으로 둔 후속 작업의 claim 이
 * 다시 막히는데, "선행 완료, 착수 가능" 알림은 이미 나갔고 회수할 수 없다.
 */
async function unapproveOrder(
  orderId: string,
  opts: { to: 'reported' | 'claimed'; note: string | null; detail: string },
): Promise<ActionResult> {
  const t = await serverTranslator()
  const loaded = await loadOrderForReview(orderId)
  if (!loaded.ok) return loaded
  const { order, actor } = loaded
  if (order.status !== 'approved') return { ok: false, error: fill(t('srv.agentWork.approvalCannotUndoneState'), { status: order.status }) }
  if (!order.wbs_item_id) return { ok: false, error: t('srv.agentWork.wbsItemOrderDeleted') }

  const admin = createAdminClient()
  const transition = await applyWorkflowEvent(admin, {
    event: opts.to === 'reported' ? 'unapprove' : 'rework', actorUserId: actor.userId, orderId,
  })
  if (!transition.ok) {
    return { ok: false, error: transition.conflict ? t('err.stateChangedRequestNotProcessed') : transition.error }
  }
  // 재작업은 반려로 남긴다(사유 보존) — review_action 은 CHECK 로 approve|reject 뿐이고,
  // 에이전트 쪽 반려 감지가 이 값을 본다. 승인 취소는 "아직 검토 안 함"으로 되돌린다.
  const reviewPatch = opts.note === null
    ? { review_action: null, reviewed_by: null, reviewed_at: null, review_note: null }
    : { review_action: 'reject', reviewed_by: actor.userId, reviewed_at: new Date().toISOString(), review_note: opts.note }
  await recordReview(admin, orderId, reviewPatch, '되감기')
  await notifyReviewResult(admin, order, 'work.rejected', actor.userId, opts.detail)
  await afterTransition(admin, { projectId: order.project_id, itemId: order.wbs_item_id, actorUserId: actor.userId, transition })
  const warning = skippedWarning(t, transition.skipped)
  return warning ? { ok: true, warning } : { ok: true }
}

/** 승인 취소 — 검토 대기열(reported)로 되돌린다. 아무도 작업하지 않는 상태이며 다시 승인/반려할 수 있다. */
export async function unapproveAgentCompletion(orderId: string): Promise<ActionResult> {
  return unapproveOrder(orderId, { to: 'reported', note: null, detail: '완료 승인이 취소되었습니다' })
}

/** 재작업 요청 — 에이전트에게 되돌린다(claimed). 반려와 같은 착지점이라 에이전트 쪽 감지가 그대로 동작한다. */
export async function requestAgentRework(orderId: string, note: string): Promise<ActionResult> {
  const t = await serverTranslator()
  const trimmed = note.trim()
  if (!trimmed) return { ok: false, error: t('srv.agentWork.reworkReasonRequired') }
  return unapproveOrder(orderId, { to: 'claimed', note: trimmed, detail: '재작업이 요청되었습니다' })
}

/**
 * 이 WBS 항목의 최신 에이전트 주문 + 그 앞에 있던 주문들 — 명세 패널 "진행 상황" 섹션이 읽는다
 * (2026-08-24, agent-ops 대체).
 * 위임한 적 없으면 order:null. 조회 실패는 null 로 위장하지 않고 error 를 그대로 올린다(3원칙).
 * 프로젝트 멤버면 누구나 읽을 수 있다(스펙 읽기와 같은 등급) — 승인·반려 버튼 노출 여부는 호출부가
 * editable(관리자)로 가리고, 액션 자체도 requireProjectAdmin 으로 재검증한다.
 */
export type AgentOrderReport = {
  id: string; kind: 'progress' | 'completion'; percent: number; summary: string
  links: { label?: string; url: string }[]; agent: string
  review_action: 'approve' | 'reject' | null; review_note: string | null; created_at: string
}
export type AgentOrderStatus = {
  id: string; status: string
  claimed_by: string | null; claimed_at: string | null; updated_at: string
  reports: AgentOrderReport[]
  /** SP5b W2 — 결재 대기(reported)이고 유효 승인 단계가 둘 이상일 때만: 대기 단계("승인(i/n · 라벨)"·expectedStep). label null = 기본 단계 */
  approval?: { step: string; index: number; total: number; label: string | null }
}
/** 이전 주문 한 줄 — 본문 없이 "있었다"는 사실만. 상세는 주문 id 로 단건 조회한다. */
export type AgentOrderBrief = { id: string; status: string; updated_at: string }

export async function getAgentOrderForItem(itemId: string): Promise<
  | { ok: true; order: AgentOrderStatus | null; priorOrders: AgentOrderBrief[]; projectId: string }
  | { ok: false; error: string }
> {
  const t = await serverTranslator()
  if (!isUuidLike(itemId)) return { ok: false, error: t('err.invalidRequest') }
  const sb = await createServerClient()
  const { data: item, error: itemErr } = await sb.from('wbs_items').select('project_id').eq('id', itemId).maybeSingle()
  if (itemErr) return { ok: false, error: fill(t('err.couldNotLoadItems'), { message: itemErr.message }) }
  if (!item) return { ok: false, error: ERR_MISSING }
  const projectId = (item as { project_id: string }).project_id
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'agents')
  if (!mod.ok) return { ok: true, order: null, priorOrders: [], projectId }   // 명세 패널은 core 화면 — 오류 대신 '주문 없음'(P19)

  // limit(1) 을 쓰지 않는다 — 한 항목에 주문이 여러 개 쌓인다. approved 는 "활성 주문" 검사
  // 어디에도 안 들어가므로(ensureOrder Step4·wbsImport:361·unique index) 승인된 주문은 항목을
  // 비워주고, 재발행이 새 주문을 만든다. 최신 하나만 읽으면 그 앞의 승인 이력이 통째로 사라진다.
  const { data: orders, error: ordErr } = await sb
    .from('agent_work_orders')
    .select('id, status, claimed_by, claimed_at, updated_at')
    .eq('wbs_item_id', itemId)
    .order('updated_at', { ascending: false })
  if (ordErr) return { ok: false, error: fill(t('err.couldNotLoadOrder'), { message: ordErr.message }) }
  const rows = (orders ?? []) as Array<{
    id: string; status: string; claimed_by: string | null; claimed_at: string | null; updated_at: string
  }>
  if (rows.length === 0) return { ok: true, order: null, priorOrders: [], projectId }
  const row = rows[0]
  const priorOrders: AgentOrderBrief[] = rows.slice(1)
    .map(o => ({ id: o.id, status: o.status, updated_at: o.updated_at }))

  const { data: reports, error: repErr } = await sb
    .from('agent_work_reports')
    .select('id, kind, percent, summary, links, agent, review_action, review_note, created_at')
    .eq('work_order_id', row.id)
    // created_at 이 같으면 id 순 — 명세 패널이 고르는 마지막 completion 이 서버의 최신(latestCompletionReportId)과 같다.
    .order('created_at', { ascending: true }).order('id', { ascending: true })
  if (repErr) return { ok: false, error: fill(t('srv.agentWork.couldNotLoadReport'), { message: repErr.message }) }
  // 결재 대기면 대기 승인 단계(SP5b) — 둘 이상일 때만 싣는다(1단계는 expectedStep 생략이 계약이고 기존 반환 형태를 지킨다).
  // 판독 실패는 로그 + 생략(버튼은 그대로 — 서버가 approval_stale 로 다시 판정한다)
  let approval: AgentOrderStatus['approval']
  if (row.status === 'reported') {
    const st = await loadApprovalState(createAdminClient(), itemId, projectId)   // 멤버 가드·모듈 관문 뒤
    if (!st.ok) console.error('[agentWork] 명세 패널 대기 단계 판독 실패:', st.error)
    else if (st.pending.total >= 2) {
      const { step, index, total } = st.pending
      approval = { step, index, total, label: st.steps.find((d) => d.code === step)?.label ?? null }
    }
  }
  return { ok: true, order: { ...row, reports: (reports ?? []) as AgentOrderReport[], ...(approval ? { approval } : {}) }, priorOrders, projectId }
}
