import { buildTree, type BuildTreeOpts, type TreeNode } from './tree'
import { round1 } from './format'
import { plannedPct, achievementOf, statusOf } from './progress'
import type { ComputedItem, WbsRow } from './types'

export function computeTree(
  rows: WbsRow[], today: string, holidays: Set<string>, opts: BuildTreeOpts,
): ComputedItem[] {
  const tree = buildTree(rows, opts)
  return tree.map(node => computeNode(node, today, holidays))
}

/** 가중치 규칙 하나(SP4 D20) — null(미지정) = 1, 명시 0 = 0. 루트 그룹(전체 공정율)·하위 그룹(롤업)·계획 곡선·주간 보고 점유율이 같은
 *  규칙을 쓴다. 위험 신호의 최상위 가중 루트 판정(dashboard.ts topWeightPhaseDelayed — null = 0)은 사용자 결정 3 그대로라 이것을 쓰지 않는다. */
export function weightOf(w: number | null): number {
  return w ?? 1
}

/**
 * 프로젝트 전체 공정율 — 루트(Phase) 가중 평균(weightOf — null = 1, 합이 0 이면 1 로 나눠 0).
 * 대시보드·현황 보고서·기타 요약이 같은 값을 쓰도록 단일 출처로 공유한다. 가상 루트의 computeNode 와 같은 값이다(W9).
 */
export function overallProgress(roots: ComputedItem[]): { actual: number; planned: number } {
  const totalEff = roots.reduce((s, r) => s + weightOf(r.weight), 0) || 1
  return {
    actual: round1(roots.reduce((s, r) => s + weightOf(r.weight) * r.rolledActualPct, 0) / totalEff),
    planned: round1(roots.reduce((s, r) => s + weightOf(r.weight) * r.plannedPct, 0) / totalEff),
  }
}

/**
 * 한 노드와 그 하위를 계산한다. `ComputedItem` 은 구조적으로 `TreeNode` 를 만족하므로
 * **이미 계산된 트리에 다시 돌려도 안전하다** — 스프레드 뒤에 계산값을 덮어쓰므로 멱등이다.
 * 실시간 부분 패치(`applyWbsChange`)가 리프를 고친 뒤 조상 롤업을 다시 내는 데 쓴다.
 */
export function computeNode(node: TreeNode, today: string, holidays: Set<string>): ComputedItem {
  const children = node.children.map(c => computeNode(c, today, holidays))
  const planned = plannedPct(node.plannedStart, node.plannedEnd, today, holidays)

  let rolledActual: number
  let rolledPlanned = planned
  if (children.length === 0) {
    rolledActual = node.actualPct ?? 0
  } else {
    const totalW = children.reduce((s, c) => s + weightOf(c.weight), 0) || 1
    rolledActual = round1(
      children.reduce((s, c) => s + weightOf(c.weight) * c.rolledActualPct, 0) / totalW,
    )
    rolledPlanned = round1(
      children.reduce((s, c) => s + weightOf(c.weight) * c.plannedPct, 0) / totalW,
    )
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
 *  null 은 1 로 계산되므로(weightOf) 섞인 그룹의 null 은 사용자가 의도한 비중과 다를 수 있다 — 화면이 그 수를 알린다(B). */
export function unsetWeightCount(roots: readonly ComputedItem[]): number {
  let n = 0
  const group = (g: readonly ComputedItem[]) => {
    if (g.some((x) => x.weight != null)) n += g.filter((x) => x.weight == null).length
    for (const x of g) if (x.children.length) group(x.children)
  }
  group(roots)
  return n
}
