import type { ComputedItem, WbsRow } from './types'
import { round1 } from './format'
import { computeTree, effectiveWeights, overallProgress } from './rollup'
import { buildTree, collectLeaves, type BuildTreeOpts, type TreeNode } from './tree'
import { isWorkingDay } from './calendar'
import type { DayCal } from './progress'
import { addDaysCal, SPI_MIN_PLANNED_PCT } from './dashboard'

/** wbs_progress_snapshots 1행 (camelCase, 숫자 변환 완료 상태) */
export interface SnapshotPoint { date: string; actual: number; planned: number }
export interface TrendPoint { date: string; pct: number }
export interface SpiPoint { date: string; spi: number }

export interface TrendModel {
  empty: boolean
  axisStart: string
  axisEnd: string
  plannedSeries: TrendPoint[]
  actualSeries: TrendPoint[]   // carry-forward 적용, 오늘까지만
  spiSeries: SpiPoint[]        // planned ≥ 5 시점만(조기 불안정 가드)
  currentSpi: number | null
  velocityWeek: number | null  // 최근 7일 실적 증분(%p), 이력 부족 시 null
  hasHistory: boolean
  /** 일정(시작·종료)이 없는 잎 작업 수(BUG-34) — 계획%가 늘 0 이라 계획 곡선의 분모에만 든다(곡선이 100% 에 닿지 않는 이유).
   *  계산은 바꾸지 않는다(전체 계획%·보고서와 같은 수) — 그래프가 그 수를 주석으로 알린다 */
  unscheduledLeaves: number
}

const EMPTY: TrendModel = {
  empty: true, axisStart: '', axisEnd: '', plannedSeries: [], actualSeries: [],
  spiSeries: [], currentSpi: null, velocityWeek: null, hasHistory: false, unscheduledLeaves: 0,
}

/** ComputedItem 트리 → 평탄한 WbsRow[] — computeTree를 다른 날짜로 재실행하기 위한 입력. */
export function flattenRows(items: ComputedItem[]): WbsRow[] {
  const out: WbsRow[] = []
  const walk = (ns: ComputedItem[]) =>
    ns.forEach(n => {
      out.push({
        id: n.id, parentId: n.parentId, code: n.code, sortOrder: n.sortOrder,
        name: n.name, biz: n.biz, deliverable: n.deliverable,
        plannedStart: n.plannedStart, plannedEnd: n.plannedEnd,
        weight: n.weight, actualPct: n.actualPct, owners: n.owners, isOwnerSplit: n.isOwnerSplit,
      })
      walk(n.children)
    })
  walk(items)
  return out
}

/** 임의 날짜의 전체 계획% — computeTree를 해당 날짜로 재실행(주말·공휴일 규칙 재사용).
 *  단일 시점 조회용. 여러 날짜를 평가할 때는 plannedCurve 를 쓸 것(동일 수치, 큰 비용 차). */
export function plannedAt(rows: WbsRow[], date: string, cal: DayCal, opts: BuildTreeOpts): number {
  return overallProgress(computeTree(rows, date, cal, opts)).planned
}

/**
 * 계획 곡선 다지점 평가 — dates 각각에 plannedAt 을 부른 것과 결과가 정확히 같다
 * (plannedPct→computeNode→overallProgress 의 라운딩 구조를 그대로 복제 — 동일성은
 * trend.test 의 등가성 속성 테스트가 지킨다). 차이는 비용뿐: plannedAt 재샘플링은
 * 날짜마다 트리 재구축 + 노드×기간 영업일 루프라 O(샘플 × N × 기간일수)인 반면,
 * 여기는 트리 1회 + 축 범위 영업일 누적 인덱스 1회 + 날짜당 O(N) 워크다.
 * (대시보드 fast-follow 2026-07-09: 71행 ~104ms/요청 실측, 600 leaf 외삽 ~1.3s 해소)
 */
export function plannedCurve(
  rows: WbsRow[], dates: string[], cal: DayCal, opts: BuildTreeOpts,
): TrendPoint[] {
  if (dates.length === 0) return []
  const tree = buildTree(rows, opts)

  // 영업일 누적 인덱스 — 계획일·샘플일 전체를 덮는 구간의 날짜별 누적 영업일 수(양끝 포함)
  const bounds: string[] = [...dates]
  for (const r of rows) {
    if (r.plannedStart) bounds.push(r.plannedStart)
    if (r.plannedEnd) bounds.push(r.plannedEnd)
  }
  const rangeLo = bounds.length ? bounds.reduce((a, b) => (a < b ? a : b)) : null
  const rangeHi = bounds.length ? bounds.reduce((a, b) => (a > b ? a : b)) : null
  const cum = new Map<string, number>()
  if (rangeLo !== null && rangeHi !== null) {
    let acc = 0
    for (let d = rangeLo; d <= rangeHi; d = addDaysCal(d, 1)) {
      if (isWorkingDay(d, cal)) acc++
      cum.set(d, acc)
    }
  }
  // workingDaysBetween(a,b) 동치: 양끝 포함, b<a 는 0 (진입 날짜는 모두 feed 되어 cum 에 존재)
  const bizBetween = (a: string, b: string): number => {
    if (b < a) return 0
    return (cum.get(b) ?? 0) - (cum.get(a) ?? 0) + (isWorkingDay(a, cal) ? 1 : 0)
  }

  // plannedPct 동치(자기 날짜 기준 계획%) — progress.ts 의 가드·캡·round1 순서 유지
  const ownPlanned = (n: TreeNode, date: string): number => {
    if (!n.plannedStart || !n.plannedEnd) return 0
    if (date < n.plannedStart) return 0
    const total = bizBetween(n.plannedStart, n.plannedEnd)
    if (total === 0) return 0
    const capped = date > n.plannedEnd ? n.plannedEnd : date
    const done = bizBetween(n.plannedStart, capped)
    return Math.min(100, Math.max(0, round1((done / total) * 100)))
  }
  // computeNode 의 rolledPlanned·overallProgress 동치 — 같은 가중치 규칙(effectiveWeights) + 단계별 round1.
  // 몫은 날짜와 무관하므로 그룹마다 한 번만 낸다(날짜당 O(N) 워크를 유지한다).
  const shares = new Map<readonly TreeNode[], { ws: number[]; total: number }>()
  const sharesOf = (group: readonly TreeNode[]) => {
    let s = shares.get(group)
    if (!s) {
      const ws = effectiveWeights(group)
      s = { ws, total: ws.reduce((a, w) => a + w, 0) || 1 }
      shares.set(group, s)
    }
    return s
  }
  const groupPlanned = (group: readonly TreeNode[], date: string): number => {
    const { ws, total } = sharesOf(group)
    return round1(group.reduce((s, c, i) => s + ws[i] * nodePlanned(c, date), 0) / total)
  }
  const nodePlanned = (n: TreeNode, date: string): number =>
    n.children.length === 0 ? ownPlanned(n, date) : groupPlanned(n.children, date)
  return dates.map(date => ({ date, pct: groupPlanned(tree, date) }))
}

/** carry-forward 조회: date 이전(포함) 마지막 스냅샷의 실적. 없으면 null. */
function actualAt(sorted: SnapshotPoint[], date: string): number | null {
  let v: number | null = null
  for (const s of sorted) {
    if (s.date > date) break
    v = s.actual
  }
  return v
}

export function buildTrend(input: {
  items: ComputedItem[]
  snapshots: SnapshotPoint[]
  /** 근무일 판정 달력(SP5 A — 요일 규칙·휴무·특정일 근무) */
  calendar: DayCal
  startDate: string | null
  endDate: string | null
  today: string
  opts: BuildTreeOpts
}): TrendModel {
  const { items, calendar, startDate, endDate, today, opts } = input

  // 축 — 프로젝트 기간 우선, 없으면 WBS leaf 날짜 min/max
  const leaves = collectLeaves(items)
  const leafDates = leaves
    .flatMap(l => [l.plannedStart, l.plannedEnd])
    .filter((d): d is string => d != null)
  const axisStart = startDate ?? (leafDates.length ? leafDates.reduce((a, b) => (a < b ? a : b)) : null)
  const axisEnd = endDate ?? (leafDates.length ? leafDates.reduce((a, b) => (a > b ? a : b)) : null)
  if (!axisStart || !axisEnd || axisStart >= axisEnd) return EMPTY

  // 계획 누적곡선 — 주 단위 샘플 + 종료일 + (구간 내) 오늘
  const rows = flattenRows(items)
  const sampleDates = new Set<string>()
  for (let d = axisStart; d <= axisEnd; d = addDaysCal(d, 7)) sampleDates.add(d)
  sampleDates.add(axisEnd)
  if (today >= axisStart && today <= axisEnd) sampleDates.add(today)
  const plannedSeries = plannedCurve(rows, [...sampleDates].sort(), calendar, opts)

  // 실적 이력 — 오늘 이후 제외, carry-forward로 오늘까지 연장.
  // '실적선은 항상 보인다' 불변식: 이력이 축 시작 이후에야 시작되면 (축 시작, 0)에서 직선 보간으로
  // 연결하고, 이력이 전혀 없으면 현재 실적으로 (축 시작,0)→(오늘,실적) 선을 합성한다 —
  // 스냅샷 축적 초기(0~1건)에도 점이 아니라 선이 그려지게.
  const snaps = input.snapshots.filter(s => s.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1))
  const actualSeries: TrendPoint[] = snaps.map(s => ({ date: s.date, pct: s.actual }))
  const lastSnap = snaps[snaps.length - 1]
  if (lastSnap && lastSnap.date < today) actualSeries.push({ date: today, pct: lastSnap.actual })
  if (snaps.length) {
    if (snaps[0].date > axisStart) actualSeries.unshift({ date: axisStart, pct: 0 })
  } else if (today > axisStart) {
    const end = today <= axisEnd ? today : axisEnd
    actualSeries.push({ date: axisStart, pct: 0 }, { date: end, pct: overallProgress(items).actual })
  }

  // SPI — 계획 5% 미만 시점 제외(scheduleModel 조기 가드와 동일 원칙)
  const spiSeries: SpiPoint[] = snaps
    .filter(s => s.planned >= SPI_MIN_PLANNED_PCT)
    .map(s => ({ date: s.date, spi: Math.round((s.actual / s.planned) * 100) / 100 }))
  const currentSpi = spiSeries.length ? spiSeries[spiSeries.length - 1].spi : null

  // 주간 velocity — 7일 전 시점 값이 없으면(이력 부족) null
  const nowV = actualAt(snaps, today)
  const prevV = actualAt(snaps, addDaysCal(today, -7))
  const velocityWeek = nowV != null && prevV != null ? round1(nowV - prevV) : null

  return {
    empty: false, axisStart, axisEnd, plannedSeries, actualSeries,
    spiSeries, currentSpi, velocityWeek, hasHistory: snaps.length > 0,
    // plannedPct 의 가드와 같은 조건 — 시작·종료 가운데 하나라도 없으면 계획%는 0 이다
    unscheduledLeaves: leaves.filter(l => !l.plannedStart || !l.plannedEnd).length,
  }
}
