// 에이전트 허브 — 표·큐가 공유하는 색·코드 표. 화면 문구(상태·조정 버튼·위임 안내)는 사전(agentHub.* — labelKeys.ts)에 있다.
import type { HubOrderState } from '@/lib/domain/agentHub'
import type { WaitReasonKind } from '@/lib/domain/waitReason'
import { STAGE_NONE_LABEL_KO } from '@/lib/domain/stageLabels'

/**
 * 상태 칩 색 — globals.css 의 기존 토큰만 쓴다(새 색을 만들지 않으므로 .dark 오버라이드가 그대로 따라온다).
 * 기준은 "지금 누가 손대야 하나" 다. 사람 차례(승인 대기·결정 대기·반려)는 눈에 띄게, 기계 차례
 * (작업 중·대기)는 조용하게, 끝난 것(승인됨)은 초록으로 둔다. 컴포넌트에 if (state === ...) 를
 * 흩지 않으려고 표 하나로 모은다.
 */
export const STATE_TONE: Record<HubOrderState, string> = {
  READY: 'bg-pending-weak text-pending',
  ACTIVE: 'bg-progress-weak text-progress',
  STALE: 'bg-danger-weak text-danger',
  OFFLINE: 'bg-surface-subtle text-fg-muted',
  BLOCKED: 'bg-pending-weak text-warning',
  WAIT: 'bg-action-soft text-action',
  REJECTED: 'bg-danger-weak text-danger',
  DONE: 'bg-success-weak text-success',
}

/**
 * 착수 대기 사유 칩 색(waitReason.ts 의 네 종류). 위 둘은 사람이 움직여야 풀리고, 아래 둘은
 * 시간이 지나면 저절로 풀린다 — 색이 그 차이를 말한다.
 */
export const REASON_TONE: Record<WaitReasonKind, string> = {
  dependency: 'bg-danger-weak text-danger',
  agent_off: 'bg-pending-weak text-warning',
  agents_busy: 'bg-progress-weak text-progress',
  pickup: 'bg-pending-weak text-pending',
}

/** 위임이 안 된 개발 리프 — 사유 칩과 같은 자리에 같은 모양으로 둔다(사람이 체크를 켜야 풀린다). */
export const NEEDS_DELEGATION_TONE = 'bg-pending-weak text-warning'

/** 주문이 없는 행의 상태 칸. */
export const NO_ORDER = '—'

/** 단계 select 의 순서와 문구(§11) — 정본은 src/lib/domain/stageLabels.ts(스펙 2026-09-15 §3.2, fp 제거). */
export { STAGE_CODES } from '@/lib/domain/stageLabels'
export const STAGE_NONE_LABEL = STAGE_NONE_LABEL_KO
