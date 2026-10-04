import type { AdminClient } from '@/lib/minutes/externalApi'
import { notifySuccessorsOnReached } from '@/lib/agent/stageTransition'
import { ERR_REPORT_STALE } from '@/lib/domain/agentWork'
import { UUID_RE } from '@/lib/domain/validate'

/**
 * 원자 전이 RPC apply_workflow_event 의 앱 층 입구(스펙 2026-09-15 §4, 마이그레이션 0096). 주문 CAS·단계·
 * 실적 크레딧·change_logs 는 DB 트랜잭션 하나가 한다 — 여기서는 인자 매핑·결과 파싱·사유 문구만 맡는다.
 * 호출부는 성공 뒤 actualChanged 면 진척 스냅샷을, reachedFirst 면 notifyOnReached 를 부른다(둘 다 실패는 로깅만).
 */
export type WorkflowEvent =
  | 'assign' | 'unassign' | 'claim' | 'report_completion' | 'approve' | 'approve_step' | 'unapprove' | 'reject' | 'rework' | 'release' | 'set_stage'

export type WorkflowEventArgs = {
  event: WorkflowEvent
  actorUserId: string
  /** assign·unassign·set_stage 필수. 주문 사건은 생략한다(주문의 wbs_item_id 를 쓴다). */
  itemId?: string | null
  orderId?: string | null
  stage?: string | null
  /** claim 은 기록, report_completion·release 는 점유자 일치 조건. 사람 사건은 null. */
  agent?: string | null
  agentUserId?: string | null
  /** approve·reject 전용 — 사람이 본 completion 보고 id(보고 없음 = null). RPC 가 주문 행 잠금 아래에서 최신 보고와 대조한다(0011 H2-i).
   *  생략하면 null 로 대조한다(보고가 있으면 stale). */
  expectedReportId?: string | null
  /** SP5b(D18·S6): 승인 판정 사건(approve·approve_step·set_stage 'xx')이 본 대기 단계 code. RPC 가 설정 FOR SHARE 아래 대기 단계와 대조한다.
   *  있을 때만 보낸다(호환 규칙 S1) — 생략은 유효 단계가 하나일 때만 통과한다. */
  expectedStep?: string | null
}

/** 승인 판정 결과(중간 단계면 remaining > 0 — 주문 reported·stage im·실적 불변). RPC 가 돌려줄 때만 실린다 */
export type WorkflowApproval = { round: number; stepCode: string; remaining: number }

export type WorkflowSkipped = 'parent' | 'not_workflow' | 'stage' | 'no_item'
export type WorkflowEventOk = {
  ok: true; orderStatus: string | null; stage: string | null; actualPct: number | null
  stageChanged: boolean; actualChanged: boolean; reachedFirst: boolean; skipped: WorkflowSkipped | null
  approval?: WorkflowApproval
}
export type WorkflowEventFail = { ok: false; conflict: boolean; reason: string; orderStatus: string | null; error: string; stale?: true }

/** RPC 호출 자체가 실패했을 때의 고정 문구 — DB 오류 원문은 로그에만 남긴다. */
export const ERR_TRANSITION_RPC = '처리하지 못했습니다. 잠시 뒤 다시 시도하세요.'

/** RPC 실패 사유 → 사람 문구. 모르는 사유는 코드 그대로 드러낸다(표시 = 로깅). */
export const REASON_TEXT: Record<string, string> = {
  conflict: '상태가 바뀌어 처리하지 못했습니다. 다시 시도하세요.',
  locked: '에이전트에 위임된 작업입니다. 단계는 승인·반려로 바뀝니다. 직접 바꾸려면 위임을 끄세요.',
  not_workflow: '개발 워크플로 대상이 아닌 항목입니다.',
  parent: '하위 항목이 있습니다 — 개발 워크플로 단계는 최종단계에만 지정합니다.',
  item_required: '항목이 필요한 사건입니다.',
  item_not_found: '항목 없음',
  order_required: '주문이 필요한 사건입니다.',
  order_not_found: '주문 없음',
  order_item_mismatch: '주문의 항목이 다릅니다.',
  bad_event: '알 수 없는 사건입니다.',
  bad_stage: '허용되지 않는 단계입니다.',
  report_stale: ERR_REPORT_STALE,
  // SP5b W1 — 승인 단계(스펙 §3.4)
  approval_stale: '승인 단계가 바뀌었습니다 — 새로고침한 뒤 다시 처리하세요.',
  approval_same_actor: '같은 검수 라운드의 다른 단계를 이미 승인했습니다 — 다른 사람이 승인해야 합니다.',
  approval_required: '이 프로젝트는 승인 단계가 둘 이상입니다 — 검수 대기로 올린 뒤 단계별 승인으로 완료하세요.',
  approval_forbidden: '이 승인 단계는 프로젝트 관리자만 승인할 수 있습니다.',
  not_in_review: '검수 대기 중인 항목만 단계 승인할 수 있습니다.',
  config_invalid: '프로젝트의 업무 흐름 설정이 손상돼 처리하지 못했습니다 — 관리자에게 알리세요.',
}

/** 주문 사건이 단계·실적을 건너뛴 사유 — 사람이 할 일이 달라 warning 으로 드러낸다. */
export const SKIPPED_WARN: Record<WorkflowSkipped, string> = {
  parent: '처리는 됐지만 이 항목에 하위 항목이 있어 단계·실적을 바꾸지 않았습니다 — 개발 워크플로 단계는 최종단계의 것입니다. 주문이 상위 항목에 나간 경위를 확인하세요.',
  no_item: '처리는 됐지만 WBS 항목이 삭제된 주문이라 단계·실적을 바꾸지 않았습니다.',
  not_workflow: '처리는 됐지만 개발 워크플로 대상이 아니라 단계·실적을 바꾸지 않았습니다.',
  stage: '처리는 됐지만 현재 단계가 자동 전이 대상이 아니라 그대로 두었습니다.',
}

export async function applyWorkflowEvent(admin: AdminClient, args: WorkflowEventArgs): Promise<WorkflowEventOk | WorkflowEventFail> {
  const { data, error } = await admin.rpc('apply_workflow_event', {
    p_event: args.event, p_actor: args.actorUserId,
    p_item_id: args.itemId ?? null, p_order_id: args.orderId ?? null, p_stage: args.stage ?? null,
    p_agent: args.agent ?? null, p_agent_user_id: args.agentUserId ?? null,
    ...(args.event === 'approve' || args.event === 'reject' ? { p_expected_report_id: args.expectedReportId ?? null } : {}),
    ...(args.expectedStep != null ? { p_expected_step: args.expectedStep } : {}),
  })
  if (error) {
    // 설정 손상(D20 — workflow_value_of 의 22023 CONFIG_INVALID:<key>)은 사유로 접는다 — 관리자가 고칠 수 있는 상태라 원문은 로그에만
    if (error.code === '22023' && /^CONFIG_INVALID:/.test(error.message ?? '')) {
      console.error(`[apply_workflow_event ${args.event}] 설정 손상:`, error.message)
      return { ok: false, conflict: false, reason: 'config_invalid', orderStatus: null, error: REASON_TEXT.config_invalid }
    }
    // 로그 머리의 id 는 UUID 꼴일 때만 — 호출자가 넘긴 값이 로그 줄을 지어내지 못하게 한다.
    const id = (v: string | null | undefined) => (v == null ? '-' : UUID_RE.test(v) ? v : '(id 아님)')
    console.error(`[apply_workflow_event ${args.event} order=${id(args.orderId)} item=${id(args.itemId)}] RPC 실패:`, error.message)
    return { ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: ERR_TRANSITION_RPC }
  }
  const r = (data ?? {}) as Record<string, unknown>
  const orderStatus = typeof r.order_status === 'string' ? r.order_status : null
  if (r.ok !== true) {
    const conflict = r.conflict === true
    const reason = typeof r.reason === 'string' ? r.reason : conflict ? 'conflict' : 'unknown'
    const fail: WorkflowEventFail = { ok: false, conflict, reason, orderStatus, error: REASON_TEXT[reason] ?? `전이 실패(${reason})` }
    return r.stale === true ? { ...fail, stale: true } : fail
  }
  return {
    ok: true, orderStatus,
    stage: typeof r.stage === 'string' ? r.stage : null,
    actualPct: r.actual_pct == null ? null : Number(r.actual_pct),
    stageChanged: r.stage_changed === true,
    actualChanged: r.actual_changed === true,
    reachedFirst: r.reached_first === true,
    skipped: typeof r.skipped === 'string' ? (r.skipped as WorkflowSkipped) : null,
    ...(parseApproval(r.approval) ?? {}),
  }
}

function parseApproval(raw: unknown): { approval: WorkflowApproval } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>
  if (typeof a.step_code !== 'string' || typeof a.round !== 'number' || typeof a.remaining !== 'number') return null
  return { approval: { round: a.round, stepCode: a.step_code, remaining: a.remaining } }
}

/** im·xx 첫 도달 뒤 후행 unblocked 알림(§2.10) — 항목을 읽어 notifySuccessorsOnReached 에 넘긴다. 실패는 로깅만. */
export async function notifyOnReached(admin: AdminClient, itemId: string, actorUserId: string): Promise<void> {
  const { data, error } = await admin
    .from('wbs_items').select('id, project_id, name, external_ref').eq('id', itemId).maybeSingle()
  if (error || !data) {
    console.error('[workflowEvent] 도달 알림용 항목 조회 실패:', error?.message ?? '0행')
    return
  }
  await notifySuccessorsOnReached(admin, data as { id: string; project_id: string; name: string; external_ref: string | null }, actorUserId)
}
