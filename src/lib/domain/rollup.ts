import { buildTree, type BuildTreeOpts, type TreeNode } from './tree'
import { round1 } from './format'
import { plannedPct, achievementOf, statusOf, type DayCal } from './progress'
import type { ComputedItem, WbsRow } from './types'

export function computeTree(
  rows: WbsRow[], today: string, cal: DayCal, opts: BuildTreeOpts,
): ComputedItem[] {
  const tree = buildTree(rows, opts)
  return tree.map(node => computeNode(node, today, cal))
}

/** 지정 합이 1(100%)을 넘었는지 볼 때의 부동소수 여유 — 0.7 + 0.2 + 0.1 같은 합이 1 을 살짝 넘어 보이지 않게 */
const WEIGHT_EPS = 1e-9

/**
 * 가중치 규칙 하나(사용자 테스트 BUG-13 로 바뀐 규칙 — 옛 규칙은 "미지정 = 1(100%)"이었다).
 * 한 형제 그룹(루트 포함)의 실제 몫을 낸다. 저장 단위는 분수(1 = 100%), 미지정은 null 이다.
 *  - 전부 미지정 → 균등(각 1).
 *  - 전부 지정 → 지정값의 비율(합이 1 이 아니어도 된다 — 3:1 은 75:25).
 *  - 일부만 지정 → 지정값은 그대로, 미지정 항목은 남은 몫 `max(0, 1 − 지정 합)` 을 균등하게 나눈다.
 *    지정 합이 1 을 넘으면 미지정 몫은 0 이다(화면이 "가중치 합 100% 초과"를 알린다 — weightWarnings).
 * 명시 0 은 0 이다. 음수는 저장되지 않지만(wbsValueRules) 옛 데이터가 있으면 0 으로 본다 — 몫이 음수면 평균이 범위를 벗어난다.
 * 전체 공정율(루트)·하위 롤업·계획 곡선(trend.ts)·주간 보고 점유율(report/weekly.ts)이 이 함수 하나를 쓴다. 위험 신호의 최상위 가중
 * 루트 판정(dashboard.ts topWeightPhaseDelayed — null = 0)은 진척 숫자가 아니라 "어느 루트가 가장 무거운가"라 이것을 쓰지 않는다.
 */
export function effectiveWeights(group: readonly { weight: number | null }[]): number[] {
  const set = group.filter(g => g.weight != null)
  if (set.length === 0) return group.map(() => 1)
  const given = (w: number) => Math.max(0, w)
  if (set.length === group.length) return group.map(g => given(g.weight!))
  const sum = set.reduce((s, g) => s + given(g.weight!), 0)
  const rest = Math.max(0, 1 - sum) / (group.length - set.length)
  return group.map(g => (g.weight == null ? (rest < WEIGHT_EPS ? 0 : rest) : given(g.weight)))
}

/** 한 그룹의 가중 평균 — 몫의 합이 0 이면 1 로 나눠 0(전부 0 을 지정한 그룹) */
function weightedAvg<T extends { weight: number | null }>(group: readonly T[], valueOf: (x: T) => number): number {
  const ws = effectiveWeights(group)
  const total = ws.reduce((s, w) => s + w, 0) || 1
  return group.reduce((s, x, i) => s + ws[i] * valueOf(x), 0) / total
}

/**
 * 프로젝트 전체 공정율 — 루트(Phase) 가중 평균(effectiveWeights, 몫의 합이 0 이면 1 로 나눠 0).
 * 대시보드·현황 보고서·기타 요약이 같은 값을 쓰도록 단일 출처로 공유한다. 가상 루트의 computeNode 와 같은 값이다(W9).
 */
export function overallProgress(roots: ComputedItem[]): { actual: number; planned: number } {
  return {
    actual: round1(weightedAvg(roots, r => r.rolledActualPct)),
    planned: round1(weightedAvg(roots, r => r.plannedPct)),
  }
}

/**
 * 한 노드와 그 하위를 계산한다. `ComputedItem` 은 구조적으로 `TreeNode` 를 만족하므로
 * **이미 계산된 트리에 다시 돌려도 안전하다** — 스프레드 뒤에 계산값을 덮어쓰므로 멱등이다.
 * 실시간 부분 패치(`applyWbsChange`)가 리프를 고친 뒤 조상 롤업을 다시 내는 데 쓴다.
 */
export function computeNode(node: TreeNode, today: string, cal: DayCal): ComputedItem {
  const children = node.children.map(c => computeNode(c, today, cal))
  const planned = plannedPct(node.plannedStart, node.plannedEnd, today, cal)

  let rolledActual: number
  let rolledPlanned = planned
  if (children.length === 0) {
    rolledActual = node.actualPct ?? 0
  } else {
    rolledActual = round1(weightedAvg(children, c => c.rolledActualPct))
    rolledPlanned = round1(weightedAvg(children, c => c.plannedPct))
  }

  return {
    ...node,
    plannedPct: rolledPlanned,
    rolledActualPct: rolledActual,
    achievement: achievementOf(rolledActual, rolledPlanned),
    status: statusOf(rolledActual, rolledPlanned, node.plannedStart, today),
    children,
    depth: node.depth,
  }
}

/** "가중치 미지정 N개"(SP4 D20) — 값과 null 이 섞인 형제 그룹(루트 포함)의 null 항목 수. 전부 null 인 그룹은 균등 의도라 세지 않는다.
 *  섞인 그룹의 null 은 남은 몫을 나눠 받는다(effectiveWeights) — 화면이 그 수와 규칙을 알린다. */
export function unsetWeightCount(roots: readonly ComputedItem[]): number {
  return weightWarnings(roots).unset
}

/**
 * 가중치 알림 재료 — unset: 섞인 그룹의 미지정 항목 수, overGroups: 일부만 지정했는데 지정 합이 이미 100% 를 넘은 그룹 수
 * (그 그룹의 미지정 항목은 몫이 0 이라 진척에 반영되지 않는다 — "가중치 합 100% 초과"). 전부 지정한 그룹은 비율이라 합을 따지지 않는다.
 */
export function weightWarnings(roots: readonly ComputedItem[]): { unset: number; overGroups: number } {
  let unset = 0
  let overGroups = 0
  const group = (g: readonly ComputedItem[]) => {
    const set = g.filter((x) => x.weight != null)
    if (set.length > 0 && set.length < g.length) {
      unset += g.length - set.length
      if (set.reduce((s, x) => s + Math.max(0, x.weight!), 0) > 1 + WEIGHT_EPS) overGroups++
    }
    for (const x of g) if (x.children.length) group(x.children)
  }
  group(roots)
  return { unset, overGroups }
}
