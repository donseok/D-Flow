// 착수 대기 사유 — 순수 함수. ready 주문(빈자리)이 왜 안 시작되는지를 서버가 아는 재료로 판정한다.
// 판정 축은 클레임 API(work/[id]/claim)의 거절 조건과 같다 — not_assignee · dependency_not_met. 여기서 다르게 말하면 화면이 거짓말한다.
import { predecessorReachedFor, type PredecessorGate } from './agentWork'
import { isStageCode } from './stageLabels'
import { fill, koTranslate, type Translate } from '@/lib/i18n/translate'

export type WaitReasonKind = 'dependency' | 'agent_off' | 'agents_busy' | 'pickup'
export interface WaitReason { kind: WaitReasonKind; label: string; text: string }

const STAGE_KEY = { as: 'wbs.stageAs', ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx' } as const

/** 단계 표기 — labels 는 프로젝트의 단계 이름(SP5b W2 workflow.wbs_stage_labels). 없는 칸은 기본 이름(사전 wbs.stage* — ko 는 STAGE_LABEL_KO 와 같다).
 *  t 는 화면이 넘기는 번역 함수 — 없으면 한국어(종전 출력 그대로) */
export function stageText(stage: string | null, labels?: Readonly<Partial<Record<string, string>>>, t: Translate = koTranslate): string {
  if (stage === null) return t('wait.stageNone')
  return isStageCode(stage) ? `${stage}(${labels?.[stage] ?? t(STAGE_KEY[stage])})` : stage
}

export interface PredecessorLike {
  external_ref: string; code: string; name: string; stage: string | null; order_approved: boolean
  /** 선행 충족 세 번째 축(스펙 2026-09-15 §3.7) — 실적 100 이면 충족. 선택 필드: 모르는 호출부는 앞의 두 축으로만 판정한다. */
  actual_pct?: number | null
  /** 선행 기준 final(SP5b D21)의 실적 축 재료 — 흐름 안 항목의 실적 100 은 충족이 아니다. 선택 필드: 모르면 흐름 밖으로 본다(SQL coalesce 와 같다) */
  dev_workflow?: boolean | null
}
export interface UnmetDepend { ref: string; found: boolean; code?: string; name?: string; stage?: string | null }

/** 미충족 선행 — 프로젝트의 선행 기준(SP5b D21 — claim 게이트와 같은 predecessorReachedFor)으로 판정. 프로젝트에 없는 ref 는 미충족(fail-closed, 클레임 게이트와 동일). */
export function unmetDepends(depends: string[] | null, byRef: (ref: string) => PredecessorLike | undefined, gate: PredecessorGate = 'reached'): UnmetDepend[] {
  const out: UnmetDepend[] = []
  for (const ref of depends ?? []) {
    const p = byRef(ref)
    if (!p) { out.push({ ref, found: false }); continue }
    if (predecessorReachedFor({ stage: p.stage, orderApproved: p.order_approved, actualPct: p.actual_pct, devWorkflow: p.dev_workflow }, gate)) continue
    out.push({ ref, found: true, code: p.code, name: p.name, stage: p.stage })
  }
  return out
}

export function unmetDependsList(u: UnmetDepend[], labels?: Readonly<Partial<Record<string, string>>>, t: Translate = koTranslate): string {
  return u.map(d => d.found
    ? fill(t('wait.dep.found'), { code: d.code ?? '', name: d.name ?? '', stage: stageText(d.stage ?? null, labels, t) })
    : fill(t('wait.dep.missing'), { ref: d.ref })).join(', ')
}

export interface WatcherLike { agent: string; user_id: string | null; slots: number | null; busy: number | null; until_label: string | null }

const isBusy = (w: WatcherLike) => w.slots !== null && (w.busy ?? 0) >= w.slots
const watcherLabel = (w: WatcherLike) => `${w.agent}${w.slots !== null ? ` ${w.busy ?? 0}/${w.slots}` : ''}${w.until_label ? ` ~${w.until_label}` : ''}`

export function deriveWaitReason(args: {
  depends: string[] | null
  predecessorByRef: (ref: string) => PredecessorLike | undefined
  /** 항목 담당자의 로스터 행 — 없으면 null. user_id 가 null 이면 어느 PAT 도 담당자로 인정되지 않는다. */
  assignee: { name: string; user_id: string | null } | null
  /** 이 층을 보는 살아 있는 감시자(project_id null 포함). */
  watchers: WatcherLike[]
  /** 프로젝트의 선행 기준(SP5b D21) — claim 게이트와 같은 판정·문구. 생략은 reached(호환 규칙 S1), src 호출부는 늘 넘긴다 */
  gate?: PredecessorGate
  /** 프로젝트의 단계 이름(SP5b W2) — 선행 대기 문구의 단계 표기 */
  stageLabels?: Readonly<Partial<Record<string, string>>>
  /** 화면이 넘기는 번역 함수(라벨·전문의 언어) — 없으면 한국어(종전 출력 그대로) */
  t?: Translate
}): WaitReason {
  const t = args.t ?? koTranslate
  const gate = args.gate ?? 'reached'
  const unmet = unmetDepends(args.depends, args.predecessorByRef, gate)
  if (unmet.length > 0) {
    return {
      kind: 'dependency', label: t('wait.label.dependency'),
      text: fill(t(gate === 'final' ? 'wait.dep.textFinal' : 'wait.dep.textReached'), { list: unmetDependsList(unmet, args.stageLabels, t) }),
    }
  }
  const a = args.assignee
  const eligible = a ? args.watchers.filter(w => a.user_id !== null && w.user_id === a.user_id) : args.watchers
  if (eligible.length === 0) {
    if (!a) return { kind: 'agent_off', label: t('wait.label.agent_off'), text: t('wait.off.none') }
    let text = fill(t('wait.off.assignee'), { name: a.name })
    if (args.watchers.length > 0) text += fill(t('wait.off.others'), { n: args.watchers.length, agents: args.watchers.map(w => w.agent).join(', ') })
    if (a.user_id === null) text += t('wait.off.unlinked')
    return { kind: 'agent_off', label: t('wait.label.agent_off'), text }
  }
  const free = eligible.filter(w => !isBusy(w))
  if (free.length === 0) {
    return {
      kind: 'agents_busy', label: t('wait.label.agents_busy'),
      text: fill(t('wait.busy'), { n: eligible.length, agents: eligible.map(watcherLabel).join(', ') }),
    }
  }
  return { kind: 'pickup', label: t('wait.label.pickup'), text: fill(t('wait.pickup'), { agents: free.map(w => w.agent).join(', ') }) }
}
