/** 포털 요약 수치 셋(SP3b 스펙 §6.1) — 순수. 칸마다 그 칸이 기대는 원천이 실패했으면 그 칸만 실패(사유 한 줄) */
import type { MyWorkKind, MyWorkRow } from './myWork'

export type SummaryCell = { ok: true; count: number } | { ok: false; reason: string }
export interface PortalSummary { mine: SummaryCell; review: SummaryCell; dueToday: SummaryCell }
export interface SummarySources {
  rows: Record<MyWorkKind, MyWorkRow[]>; failedKinds: readonly MyWorkKind[]; fatal: string | null
  /** 프로젝트마다 그 tz 의 오늘(null = 모름) — 오늘 마감은 행의 프로젝트 오늘과 비교한다(판정 R1) */
  todays: ReadonlyMap<string, string | null>
}
const KIND_LABEL_KO: Record<MyWorkKind, string> = { wbs: '작업', issue: '이슈', approval: '검토', meeting: '회의' }

/** 오늘 마감 — 작업·이슈 가운데 기한이 그 행의 프로젝트 오늘과 같은 것(회의·검토는 기한이 아니다) */
export function isDueToday(r: MyWorkRow, todays: ReadonlyMap<string, string | null>): boolean {
  if (r.kind !== 'wbs' && r.kind !== 'issue') return false
  const t = todays.get(r.projectId) ?? null
  return r.due !== null && t !== null && r.due === t
}

export function summarize(src: SummarySources): PortalSummary {
  if (src.fatal) { const f = { ok: false as const, reason: src.fatal }; return { mine: f, review: f, dueToday: f } }
  const cell = (kinds: MyWorkKind[], count: () => number): SummaryCell => {
    const bad = kinds.filter((k) => src.failedKinds.includes(k))
    return bad.length ? { ok: false, reason: `일부 항목(${bad.map((k) => KIND_LABEL_KO[k]).join('·')})을 불러오지 못했습니다` } : { ok: true, count: count() }
  }
  const own = () => [...src.rows.wbs, ...src.rows.issue]
  return {
    mine: cell(['wbs', 'issue'], () => own().length),
    review: cell(['approval'], () => src.rows.approval.length),
    dueToday: cell(['wbs', 'issue'], () => own().filter((r) => isDueToday(r, src.todays)).length),
  }
}
