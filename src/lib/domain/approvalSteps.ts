/**
 * WBS 승인 단계(SP5b 스펙 D15·D18, 개정 §3.3.2) — 순수 함수만. 설정 `workflow.approval_steps`(1~3단)의 판독과
 * "유효 단계 목록" 한 규칙. RPC apply_workflow_event·트리거 guard_workflow_actual 이 같은 규칙을 SQL 로 판정한다
 * (tests/fixtures/parity/workflow.json 이 두 쪽을 실행 결과로 대조).
 *
 * - 라운드: 항목이 im 으로 들어갈 때(또는 1단계 설정에서 사람이 xx 로 직행할 때) 1 증가하고 그때의 단계 code 를 `review_steps` 에 스냅샷한다.
 * - 유효 단계 목록(D15): stage ∈ {im, xx} **이고 스냅샷이 있으면** 스냅샷, 그 밖(스냅샷 없음 포함)은 현재 설정.
 * - 대기 단계: 유효 단계 순서에서 이번 라운드의 유효(미철회) 승인이 없는 첫 단계.
 * - 승인자: 현재 설정에서 찾는다(라벨·승인자는 즉시 적용). 스냅샷에 있으나 설정에서 사라진 단계는 `admin`(fail-closed).
 */
import type { Parsed } from '@/lib/settings/def'

export const APPROVERS = ['subtree_or_admin', 'admin'] as const
export type Approver = (typeof APPROVERS)[number]
export interface ApprovalStepDef { code: string; label: string | null; approver: Approver }

/** 기본 1단계 = 현행(서브트리 관리자 또는 관리자의 승인 한 번) */
export const DEFAULT_APPROVAL_STEPS: readonly ApprovalStepDef[] = [{ code: 'review', label: null, approver: 'subtree_or_admin' }]
export const DEFAULT_STEP_CODE = 'review'
export const MAX_APPROVAL_STEPS = 3
export const STEP_CODE_RE = /^[a-z][a-z0-9_]{0,19}$/
/** 스냅샷을 유지하는 단계 — 이 밖으로 나가면 review_steps 는 null 이다 */
export const REVIEW_STAGES: ReadonlySet<string> = new Set(['im', 'xx'])

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })

/** 설정 값 판독 — 길이 1~3, code 정규식·유일, label null(기본 단계 review 만) 또는 트림 1~20자, approver 2값. 모르는 필드 거부 */
export function parseApprovalSteps(raw: unknown): Parsed<ApprovalStepDef[]> {
  if (!Array.isArray(raw)) return fail('승인 단계 목록이어야 합니다.')
  if (raw.length < 1) return fail('승인 단계가 최소 1개 필요합니다.')
  if (raw.length > MAX_APPROVAL_STEPS) return fail(`승인 단계는 최대 ${MAX_APPROVAL_STEPS}개까지입니다.`)
  const out: ApprovalStepDef[] = []
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i] as Record<string, unknown>
    const n = i + 1
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return fail(`${n}번째 단계는 객체여야 합니다.`)
    for (const k of Object.keys(e)) if (k !== 'code' && k !== 'label' && k !== 'approver') return fail(`${n}번째 단계에 모르는 필드가 있습니다: ${k}`)
    if (typeof e.code !== 'string' || !STEP_CODE_RE.test(e.code)) return fail(`${n}번째 단계 code 는 영소문자로 시작하는 1~20자(영소문자·숫자·_)여야 합니다.`)
    if (out.some((s) => s.code === e.code)) return fail(`단계 code 가 중복됩니다: ${e.code}`)
    let label: string | null
    if (e.label === null) {
      if (e.code !== DEFAULT_STEP_CODE) return fail(`${n}번째 단계의 이름이 필요합니다(이름 생략은 기본 단계 ${DEFAULT_STEP_CODE} 만).`)
      label = null
    } else if (typeof e.label === 'string') {
      label = e.label.trim()
      if (label.length < 1 || label.length > 20) return fail(`${n}번째 단계 이름은 1~20자여야 합니다.`)
    } else return fail(`${n}번째 단계 이름은 문자열이어야 합니다.`)
    if (typeof e.approver !== 'string' || !(APPROVERS as readonly string[]).includes(e.approver)) {
      return fail(`${n}번째 단계 승인자는 ${APPROVERS.join(' 또는 ')} 여야 합니다.`)
    }
    out.push({ code: e.code, label, approver: e.approver as Approver })
  }
  return { ok: true, value: out }
}

export interface ReviewState { stage: string | null; reviewSteps: readonly string[] | null }

/** 유효 단계 목록(D15 — 한 규칙): im·xx 이고 스냅샷이 있으면 스냅샷, 그 밖은 현재 설정의 code 목록 */
export function effectiveSteps(item: ReviewState, current: readonly ApprovalStepDef[]): string[] {
  if (item.stage !== null && REVIEW_STAGES.has(item.stage) && item.reviewSteps !== null) return [...item.reviewSteps]
  return current.map((s) => s.code)
}

/** 판정 사건이 라운드를 먼저 열어야 하는가(D15) — 스냅샷 없는 im·xx 행(서비스 가져오기 등) */
export function needsRoundOpen(item: ReviewState): boolean {
  return item.stage !== null && REVIEW_STAGES.has(item.stage) && item.reviewSteps === null
}

/** 이번 라운드에서 유효 승인이 없는 첫 단계. null = 전부 승인됨 */
export function nextPendingStep(steps: readonly string[], liveApprovals: readonly { stepCode: string }[]): string | null {
  const done = new Set(liveApprovals.map((a) => a.stepCode))
  return steps.find((s) => !done.has(s)) ?? null
}

/** 스냅샷 단계의 승인자 — 현재 설정에서 찾고, 사라졌으면 'admin'(fail-closed) */
export function approverOf(stepCode: string, current: readonly ApprovalStepDef[]): Approver {
  return current.find((s) => s.code === stepCode)?.approver ?? 'admin'
}

/** 스냅샷 단계의 표시 이름 — 현재 설정의 라벨, label null(기본 단계)은 defaultLabel, 사라진 단계는 code 그대로(표시 = 로깅) */
export function stepLabelOf(stepCode: string, current: readonly ApprovalStepDef[], defaultLabel: string): string {
  const def = current.find((s) => s.code === stepCode)
  if (!def) return stepCode
  return def.label ?? defaultLabel
}

/** 대기 단계 요약 — 화면 "승인(1/2 · 내부 검토)"·액션의 승인자 가드가 같이 쓴다. 대기 없음(전부 승인·im 아님)은 null */
export interface PendingApproval { step: string; index: number; total: number; approver: Approver }
export function pendingApproval(
  item: ReviewState, current: readonly ApprovalStepDef[], liveApprovals: readonly { stepCode: string }[],
): PendingApproval | null {
  const steps = effectiveSteps(item, current)
  const step = nextPendingStep(steps, liveApprovals)
  if (step === null) return null
  return { step, index: steps.indexOf(step) + 1, total: steps.length, approver: approverOf(step, current) }
}

/**
 * 사람의 실적 100 입력 차단(D14 — DB guard_workflow_actual 과 같은 순서). 값이 99 이하이면 호출부가 부르지 않는다.
 * ① im ∧ 유효 단계 ≥2 → approval_required(dev_workflow 무관 — 서버 경로로 흐름을 꺼도 대기 라운드는 막힌다)
 * ② dev_workflow 아님 → 통과 ③ 위임·점유 → locked ④ xx 아님 ∧ 유효 단계 ≥2 → approval_required
 */
export function actualHundredBlocked(p: {
  devWorkflow: boolean; locked: boolean; stage: string | null; reviewSteps: readonly string[] | null; approvalSteps: readonly ApprovalStepDef[]
}): 'locked' | 'approval_required' | null {
  const n = effectiveSteps(p, p.approvalSteps).length
  if (p.stage === 'im' && n >= 2) return 'approval_required'
  if (!p.devWorkflow) return null
  if (p.locked) return 'locked'
  if (p.stage !== 'xx' && n >= 2) return 'approval_required'
  return null
}

/**
 * 승인 판정 사건(approve·approve_step·set_stage 'xx')이 기록할 대기 단계 — RPC apply_workflow_event 와 같은 규칙.
 * 열린 라운드(im·xx 이고 스냅샷 있음)에 미승인 단계가 있으면 그 단계, 없으면(스냅샷 없음 — D15, 또는 그 라운드가 이미 다 승인됨) 새 라운드를
 * 현재 설정으로 연다고 보고 첫 단계. liveApprovals 는 항목의 현재 라운드(review_round)의 미철회 승인이다.
 */
export function judgePendingApproval(
  item: ReviewState, current: readonly ApprovalStepDef[], liveApprovals: readonly { stepCode: string }[],
): PendingApproval {
  const open = item.stage !== null && REVIEW_STAGES.has(item.stage) && item.reviewSteps !== null
  const p = open ? pendingApproval(item, current, liveApprovals) : null
  return p ?? pendingApproval({ stage: null, reviewSteps: null }, current, [])!
}
