// 에이전트 허브 문구의 사전 키 표 — labels.ts 의 한국어 상수(뜻·색의 정본)는 그대로 두고, 그리는 자리에서 이 표로 사전 문구를 고른다.
// 조정 버튼 이름은 WBS 상세 패널(wbs.agentOrder*)과 같은 키다 — 같은 행위에 다른 이름을 주지 않는다.
import type { HubOrderState } from '@/lib/domain/agentHub'
import type { DictKey } from '@/lib/i18n/dict'

export type HubOpKind = 'approve' | 'reject' | 'unapprove' | 'rework' | 'stop'

export const STATE_LABEL_KEY: Record<HubOrderState, DictKey> = {
  READY: 'agentHub.state.ready',
  ACTIVE: 'agentHub.tile.working',
  STALE: 'agents.state.stale',
  OFFLINE: 'agents.state.offline',
  BLOCKED: 'agents.state.blocked',
  WAIT: 'agents.state.wait',
  REJECTED: 'agentHub.state.rejected',
  DONE: 'agentHub.state.done',
}

export const OP_LABEL_KEY: Record<HubOpKind, DictKey> = {
  approve: 'wbs.agentOrderApprove',
  reject: 'wbs.agentOrderReject',
  unapprove: 'wbs.agentOrderUnapprove',
  rework: 'wbs.agentOrderRework',
  stop: 'agents.op.stop',
}

export const OP_TITLE_KEY: Record<HubOpKind, DictKey> = {
  approve: 'agentHub.op.title.approve',
  reject: 'agentHub.op.title.reject',
  unapprove: 'agentHub.op.title.unapprove',
  rework: 'agentHub.op.title.rework',
  stop: 'agents.op.title.stop',
}

export const NOTE_PLACEHOLDER_KEY: Record<'reject' | 'rework', DictKey> = {
  reject: 'wbs.agentOrderRejectNote',
  rework: 'wbs.agentOrderReworkNote',
}
