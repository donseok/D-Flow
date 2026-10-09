// src/lib/ai/commands/apply.ts
// 제안 적용 — 제안을 만들 때 본 값(target)을 기대값으로 실어 쓰기 액션을 부른다(SPU1, 개정 §5.8 — 무통보 덮어쓰기 0건).
// 사용자가 확인을 누르는 사이 다른 사람이 바꾼 값은 서버가 충돌로 답하고 쓰지 않는다. 액션은 호출부(챗 위젯)가 넘긴다 — 이 모듈은 순수하다.
import type { CommandProposal } from './types'

type Proposal = Extract<CommandProposal, { kind: 'proposal' }>
type DateFields = { plannedStart?: string | null; plannedEnd?: string | null }
type DateLatest = { plannedStart?: string | null; plannedEnd?: string | null }

export interface ProposalActions {
  updateActual: (itemId: string, pct: number, expectedCurrent?: number | null) => Promise<{ ok: boolean; error?: string; conflict?: boolean; latest?: number | null }>
  updateWbsFields: (itemId: string, input: DateFields, expected?: DateFields) => Promise<{ ok: boolean; error?: string; conflict?: boolean; latest?: DateLatest }>
}

export type ProposalApplyResult =
  | { ok: true }
  /** latestText — 서버의 현재 값을 말로 옮긴 것(없으면 빈 문자열). 쓰지 않았다 */
  | { ok: false; conflict: true; latestText: string }
  | { ok: false; conflict?: false; error?: string }

const fmtDate = (d: string | null | undefined) => d ?? '미정'

/** 원시 params 사용 — 표시 문자열('80%', '미정') 역파싱 금지. 기대값도 표시값(displayActual)이 아니라 원시 값이다 */
export async function applyCommandProposal(p: Proposal, act: ProposalActions): Promise<ProposalApplyResult> {
  if (p.params.actualPct !== undefined) {
    const r = await act.updateActual(p.target.id, p.params.actualPct, p.target.currentActual)
    if (r.ok) return { ok: true }
    if (r.conflict) return { ok: false, conflict: true, latestText: r.latest === undefined ? '' : `실적 ${Math.round(Number(r.latest ?? 0))}%` }
    return { ok: false, error: r.error }
  }
  const hasStart = p.params.plannedStart !== undefined
  const hasEnd = p.params.plannedEnd !== undefined
  const r = await act.updateWbsFields(p.target.id, {
    ...(hasStart ? { plannedStart: p.params.plannedStart } : {}),
    ...(hasEnd ? { plannedEnd: p.params.plannedEnd } : {}),
  }, {
    ...(hasStart ? { plannedStart: p.target.plannedStart } : {}),
    ...(hasEnd ? { plannedEnd: p.target.plannedEnd } : {}),
  })
  if (r.ok) return { ok: true }
  if (r.conflict) {
    const parts: string[] = []
    if (r.latest && 'plannedStart' in r.latest) parts.push(`시작일 ${fmtDate(r.latest.plannedStart)}`)
    if (r.latest && 'plannedEnd' in r.latest) parts.push(`종료일 ${fmtDate(r.latest.plannedEnd)}`)
    return { ok: false, conflict: true, latestText: parts.join(', ') }
  }
  return { ok: false, error: r.error }
}
