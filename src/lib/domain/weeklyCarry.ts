/* ── 주간 이월 계약(SP4 스펙 §4.1.1 이월 규칙 표, D31·D33·Q37) — 순수. 원본(가장 최근 이전 문서)의 차주계획이 새 문서의 금주실적
 *    초안이 된다. 영역 id 로 옮긴다 — 활성 영역은 자기 자리로, 지금 비활성인 영역의 대기 내용은 명시 매핑(다른 활성 영역 또는 'skip')
 *    으로만. 첫 영역·폴백 흡수·절단·원본 수정은 없다. 넘치면(20,000자) 거부한다 — 개정 §4.3.3 의 "상한에서 자름"과 다르다(E25).
 *    옛 구분 기반 이월(weeklySheet.ts 의 carryOverRows)은 지웠다 — 이 모듈이 유일한 이월 규칙이다. ── */
import {
  NEXT_CELLS, UNKNOWN_AREA_LABEL, WEEKLY_CELL_MAX, hasContent, orderAreas,
  type NewWeeklyRow, type WeeklyArea, type WeeklyCellKey, type WeeklyCells,
} from './weeklySheet'

/** 매핑 값 — 옮기지 않음(원본 문서는 바뀌지 않으므로 유실이 아니다) */
export const CARRY_SKIP = 'skip'
/** 원본 영역 id → 지금 활성인 영역 id | 'skip'. 뜻의 판정은 carryOverRows 가 한다(Q37 — 무효면 다시 대기) */
export type CarryMapping = Readonly<Record<string, string>>
export interface CarryPending { areaId: string; areaName: string; cells: (keyof WeeklyCells)[] }
export interface CarryOverflow { areaId: string; areaName: string; cell: WeeklyCellKey; length: number }
export type CarryOverResult =
  | { ok: true; rows: NewWeeklyRow[] }
  | { ok: false; pending: CarryPending[]; overflow: CarryOverflow[] }

/** 새 문서의 빈 시드 — 지금 활성인 영역마다 빈 행 하나(영역 순) */
export function defaultWeeklyRows(areas: readonly WeeklyArea[]): NewWeeklyRow[] {
  return orderAreas(areas).filter((a) => a.active)
    .map((a) => ({ areaId: a.id, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '' }))
}

/** 덧붙이기 — 붙일 값의 앞뒤 공백·개행을 걷고(셀 마지막 줄의 Enter 가 빈 불릿이 되지 않게) '\n' 로 잇는다. 상한에서 자르지 않는다 */
const append = (cur: string, add: string): string => {
  const t = add.trim()
  if (!t) return cur
  return cur ? `${cur}\n${t}` : t
}

/**
 * 이월 초안. 결과 행 = 지금 활성인 영역마다 1행. 비활성(·목록에 없는) 영역의 대기 내용은 mapping 이 활성 영역 id 면 그 영역에, 'skip'
 * 이면 버리지 않고 원본에 남기며, 그 밖이면 pending 으로 돌려준다. 덧붙인 칸이 WEEKLY_CELL_MAX 를 넘으면 overflow. 하나라도 있으면
 * ok:false(문서를 만들지 않는다). carryCustom 은 SP4 에서 쓰지 않는다 — custom 열이 없다(SP5c 가 행·시드에 싣는다, 스펙 E28).
 */
export function carryOverRows(
  prev: readonly ({ areaId: string } & WeeklyCells)[],
  areas: readonly WeeklyArea[],
  mapping: CarryMapping = {},
  carryCustom: (custom: unknown) => Record<string, unknown> = () => ({}),
): CarryOverResult {
  void carryCustom
  const ordered = orderAreas(areas)
  const rank = new Map(ordered.map((a, i) => [a.id, i]))
  const rankOf = (id: string): number => rank.get(id) ?? ordered.length
  const nameOf = (id: string): string => ordered.find((a) => a.id === id)?.name ?? UNKNOWN_AREA_LABEL
  const activeIds = new Set(ordered.filter((a) => a.active).map((a) => a.id))
  const rows = defaultWeeklyRows(areas)
  const slot = new Map(rows.map((r) => [r.areaId, r]))
  const moves: { from: string; to: string; i: number; row: WeeklyCells }[] = []
  const waiting = new Map<string, Set<keyof WeeklyCells>>()

  prev.forEach((r, i) => {
    const own = slot.get(r.areaId)
    if (own) {                                       // 활성 영역 X — 자기 자리로
      own.thisContent = append(own.thisContent, r.nextContent)
      own.thisIssue = append(own.thisIssue, r.nextIssue)
      return
    }
    if (!hasContent(r, NEXT_CELLS)) return           // 비활성·모르는 영역이고 대기 내용 없음 — 무시
    const dest = Object.hasOwn(mapping, r.areaId) ? mapping[r.areaId] : undefined
    if (dest === CARRY_SKIP) return                  // 옮기지 않음
    if (dest !== undefined && activeIds.has(dest)) { moves.push({ from: r.areaId, to: dest, i, row: r }); return }
    const cells = waiting.get(r.areaId) ?? new Set<keyof WeeklyCells>()   // 매핑 없음·무효 — (다시) 대기, 오류 아님
    for (const c of NEXT_CELLS) if (hasContent(r, [c])) cells.add(c)
    waiting.set(r.areaId, cells)
  })

  // 매핑된 대기 내용 — Y 자신의 이월분 뒤에, 원본 영역의 영역 순서대로(같은 영역은 원본 행 순)
  for (const m of [...moves].sort((a, b) => rankOf(a.from) - rankOf(b.from) || a.i - b.i)) {
    const y = slot.get(m.to)!
    y.thisContent = append(y.thisContent, m.row.nextContent)
    y.thisIssue = append(y.thisIssue, m.row.nextIssue)
  }

  const pending: CarryPending[] = [...waiting]
    .sort(([a], [b]) => rankOf(a) - rankOf(b))
    .map(([areaId, cells]) => ({ areaId, areaName: nameOf(areaId), cells: NEXT_CELLS.filter((c) => cells.has(c)) }))
  const overflow: CarryOverflow[] = []
  for (const r of rows) {
    for (const [field, cell] of [['thisContent', 'this_content'], ['thisIssue', 'this_issue']] as const) {
      if (r[field].length > WEEKLY_CELL_MAX) overflow.push({ areaId: r.areaId, areaName: nameOf(r.areaId), cell, length: r[field].length })
    }
  }
  return pending.length > 0 || overflow.length > 0 ? { ok: false, pending, overflow } : { ok: true, rows }
}

/** RPC create_weekly_report 의 p_seed 모양 — 영역 id + 네 칸(snake). custom 은 싣지 않는다(SP5c) */
export function seedOf(rows: readonly NewWeeklyRow[]): {
  area_id: string; this_content: string; this_issue: string; next_content: string; next_issue: string
}[] {
  return rows.map((r) => ({
    area_id: r.areaId, this_content: r.thisContent, this_issue: r.thisIssue, next_content: r.nextContent, next_issue: r.nextIssue,
  }))
}
