// src/components/agents/labelKeys.ts
// 좌석 화면 문구의 사전 키 표 — 순수 표(seatOps)는 한국어 상수를 그대로 두고, 그리는 자리에서 이 표로 사전 문구를 고른다.
// 훅을 못 쓰는 순수 함수(seatMetaLine·ownerLabel·rosterHero 등)는 t 를 인자로 받는다(Translate).
import type { DictKey } from '@/lib/i18n/dict'
import { ERR_NO_RIGHT, ERR_NO_RIGHT_REVIEW, ERR_SELF_APPROVAL_HINT, RESUME_PENDING, opSpec, type SeatOpKind } from './seatOps'

export type Translate = (k: DictKey) => string

/** 사전 문구의 {이름} 자리를 한 번에 채운다 — 값에 든 `$`·`{…}` 는 다시 해석하지 않는다(사용자 데이터가 들어온다). */
export function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** 결재 버튼 이름 — 승인·반려·승인 취소·재작업 요청은 WBS 상세 패널(wbs.agentOrder*)과 같은 문구다. */
export const OP_LABEL_KEY: Record<SeatOpKind, DictKey> = {
  approve: 'wbs.agentOrderApprove', reject: 'wbs.agentOrderReject', unapprove: 'wbs.agentOrderUnapprove', rework: 'wbs.agentOrderRework',
  stop: 'agents.op.stop', resume: 'agents.op.resume',
}

export const OP_TITLE_KEY: Record<SeatOpKind, DictKey> = {
  approve: 'agents.op.title.approve', reject: 'agents.op.title.reject', unapprove: 'agents.op.title.unapprove', rework: 'agents.op.title.rework',
  stop: 'agents.op.title.stop', resume: 'agents.op.title.resume',
}

const WHY_KEY: Readonly<Record<string, DictKey>> = {
  [RESUME_PENDING]: 'agents.op.resumePending',
  [ERR_NO_RIGHT]: 'agents.op.noRight',
  [ERR_NO_RIGHT_REVIEW]: 'agents.op.noRightReview',
  [ERR_SELF_APPROVAL_HINT]: 'agent.seat.selfApprovalHint',
}

/** 그리는 자리의 why 문구 — opsFor 가 돌려준 상수(설명·거부 사유)를 사전 문구로 바꾼다. 모르는 값은 그대로 보인다. */
export function opWhyText(kind: SeatOpKind, why: string, t: Translate): string {
  if (why === opSpec(kind).title) return t(OP_TITLE_KEY[kind])
  const key = WHY_KEY[why]
  return key ? t(key) : why
}
