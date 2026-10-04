/**
 * 승인 판정 재료 로더(SP5b D18) — 승인 액션 셋(approveAgentCompletion·approveWbsStep·setWbsStage 'xx')이 대기 단계를 먼저 읽고
 * 승인자(approverOf)에 맞는 가드를 고른 뒤, 읽은 단계를 p_expected_step 으로 넘겨 RPC 가 설정 FOR SHARE 아래에서 다시 대조한다.
 * 판정 규칙은 RPC 와 같다(judgePendingApproval). 조회 실패·설정 손상은 결과로 — 호출부가 쓰기 전에 중단한다(3원칙 ②, fail-closed).
 */
import type { AdminClient } from '@/lib/minutes/externalApi'
import { emitNotification } from '@/lib/notify/emit'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { judgePendingApproval, pendingApproval, type ApprovalStepDef, type PendingApproval } from '@/lib/domain/approvalSteps'

export const ERR_APPROVAL_STATE = '승인 단계를 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.'
export const ERR_APPROVAL_CONFIG = '프로젝트의 승인 단계 설정이 손상돼 승인할 수 없습니다 — 관리자에게 알리세요.'

export type ApprovalState =
  | { ok: true; pending: PendingApproval; steps: ApprovalStepDef[]; stage: string | null }
  | { ok: false; error: string }

export async function loadApprovalState(admin: AdminClient, itemId: string, projectId: string): Promise<ApprovalState> {
  const { data: row, error } = await admin
    .from('wbs_items').select('stage, review_round, review_steps').eq('id', itemId).eq('project_id', projectId).maybeSingle()
  if (error) {
    console.error('[approvalState] 항목 조회 실패:', error.message)
    return { ok: false, error: ERR_APPROVAL_STATE }
  }
  if (!row) return { ok: false, error: '항목 없음' }
  const item = row as { stage: string | null; review_round: number; review_steps: string[] | null }
  let steps: ApprovalStepDef[]
  try {
    steps = valueOf(await getProjectConfig(projectId, { client: admin }), 'workflow.approval_steps')
  } catch (e) {
    console.error('[approvalState] 승인 단계 설정 판독 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_APPROVAL_CONFIG }
  }
  let live: { stepCode: string }[] = []
  if (item.review_steps !== null && (item.stage === 'im' || item.stage === 'xx')) {
    const { data, error: aErr } = await admin
      .from('wbs_stage_approvals').select('step_code')
      .eq('wbs_item_id', itemId).eq('round', item.review_round).is('revoked_at', null)
    if (aErr) {
      console.error('[approvalState] 승인 원장 조회 실패:', aErr.message)
      return { ok: false, error: ERR_APPROVAL_STATE }
    }
    live = ((data ?? []) as { step_code: string }[]).map((r) => ({ stepCode: r.step_code }))
  }
  const pending = judgePendingApproval({ stage: item.stage, reviewSteps: item.review_steps }, steps, live)
  return { ok: true, pending, steps, stage: item.stage }
}

/** 승인자 → 가드 이름(액션이 고른다 — RPC 는 admin 단계만 재판정한다, S3) */
export function guardForApprover(p: PendingApproval): 'projectAdmin' | 'completionApprover' {
  return p.approver === 'admin' ? 'projectAdmin' : 'completionApprover'
}

/**
 * 중간 단계 승인 알림(work.approval_step — 개정 §3.3.2). 수신자는 work.reported 와 같은 기준(이 프로젝트 활성 명단의 관리자 · 계정 연결)이고
 * 승인한 본인은 뺀다. 다음 단계가 subtree_or_admin 이어도 서브트리 관리자 전수는 W2 의 승인 가능 셈(canApproveCompletion)과 함께 넓힌다.
 * fire-and-forget — 실패는 로깅만.
 */
export async function notifyApprovalStep(
  admin: AdminClient,
  a: { projectId: string; itemId: string; entity: { type: 'agent_order' | 'wbs_item'; id: string }; actorUserId: string; nextIndex: number; total: number },
): Promise<void> {
  const [{ data: admins, error: adminsErr }, { data: itemRow, error: itemErr }] = await Promise.all([
    admin.from('project_members').select('people!inner(user_id, active)')
      .eq('project_id', a.projectId).eq('access_role', 'admin').eq('active', true).eq('people.active', true),
    admin.from('wbs_items').select('name').eq('id', a.itemId).maybeSingle(),
  ])
  if (adminsErr) { console.error('[approvalState] 관리자 조회 실패(알림 생략):', adminsErr.message); return }
  if (itemErr) console.error('[approvalState] 항목 이름 조회 실패(알림 계속):', itemErr.message)
  const recipients = ((admins ?? []) as { people: { user_id: string | null } | { user_id: string | null }[] | null }[])
    .map((r) => (Array.isArray(r.people) ? r.people[0] : r.people)?.user_id)
    .filter((u): u is string => typeof u === 'string' && u !== '' && u !== a.actorUserId)
  if (recipients.length === 0) return
  emitNotification({
    type: 'work.approval_step', projectId: a.projectId, actorUserId: a.actorUserId,
    entityType: a.entity.type, entityId: a.entity.id,
    payload: {
      title: (itemRow as { name: string } | null)?.name ?? '작업',
      detail: `승인 ${a.nextIndex - 1}/${a.total} 통과 — 다음 단계 승인 대기`,
      href: `/p/${a.projectId}/wbs`,
    },
    recipientUserIds: recipients,
  }).catch(() => {})
}

/** 결재 대기열 카드의 단계 표시 재료(허브 큐 — "n/m · 라벨", expectedStep). label null = 기본 단계(사전 문구).
 *  승인 가능 셈(canApproveCompletion — S20) 재료: approvedBy = 이번 라운드의 미철회 승인자, distinct = 서로 다른 승인자 설정 */
export type QueueApproval = PendingApproval & { label: string | null; approvedBy: string[]; distinct: boolean }

/**
 * 결재 대기열 항목들의 대기 단계를 한 번에 읽는다(항목 한 번·원장 한 번·설정 한 번) — 규칙은 loadApprovalState 와 같다.
 * 판독 실패·설정 손상은 로그를 남기고 빈 맵(카드는 단계 표시 없이 그려지고, 승인은 액션·RPC 가 다시 판정한다).
 */
export async function loadQueueApprovals(admin: AdminClient, projectId: string, itemIds: readonly string[]): Promise<Map<string, QueueApproval>> {
  const out = new Map<string, QueueApproval>()
  if (itemIds.length === 0) return out
  const [{ data: items, error: iErr }, { data: live, error: aErr }] = await Promise.all([
    admin.from('wbs_items').select('id, stage, review_round, review_steps').eq('project_id', projectId).in('id', [...itemIds]),
    admin.from('wbs_stage_approvals').select('wbs_item_id, round, step_code, approved_by').eq('project_id', projectId).in('wbs_item_id', [...itemIds]).is('revoked_at', null),
  ])
  if (iErr || aErr) {
    console.error('[approvalState] 결재 대기열 단계 판독 실패:', (iErr ?? aErr)!.message)
    return out
  }
  let steps: ApprovalStepDef[]
  let distinct: boolean
  try {
    const cfg = await getProjectConfig(projectId, { client: admin })
    steps = valueOf(cfg, 'workflow.approval_steps')
    distinct = valueOf(cfg, 'workflow.approval_distinct_approvers')
  } catch (e) {
    console.error('[approvalState] 결재 대기열 승인 단계 설정 판독 실패:', e instanceof Error ? e.message : e)
    return out
  }
  const liveRows = (live ?? []) as { wbs_item_id: string; round: number; step_code: string; approved_by: string }[]
  for (const it of (items ?? []) as { id: string; stage: string | null; review_round: number; review_steps: string[] | null }[]) {
    const round = it.review_steps !== null ? liveRows.filter((a) => a.wbs_item_id === it.id && a.round === it.review_round) : []
    const state = { stage: it.stage, reviewSteps: it.review_steps }
    const liveSteps = round.map((a) => ({ stepCode: a.step_code }))
    // 열린 라운드에 대기 단계가 있으면 그 라운드의 승인자가 "이번 라운드" 다. 없으면 판정 사건이 새 라운드를 연다(승인자 없음) — RPC 와 같은 규칙
    const open = it.review_steps !== null && (it.stage === 'im' || it.stage === 'xx') && pendingApproval(state, steps, liveSteps) !== null
    const p = judgePendingApproval(state, steps, liveSteps)
    out.set(it.id, { ...p, label: steps.find((d) => d.code === p.step)?.label ?? null, approvedBy: open ? round.map((a) => a.approved_by) : [], distinct })
  }
  return out
}
