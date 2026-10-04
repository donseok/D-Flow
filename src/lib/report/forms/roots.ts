/**
 * 스캔 자리표시자의 카탈로그 루트 (정본 §4.5.4).
 * 매핑이 있으면 그 값이 경로다. slide.* 는 데이터가 아니다.
 */
import type { Placeholder, RenderMapping } from '../engine/types'

export function catalogRoots(placeholders: readonly Placeholder[], mapping: RenderMapping): Set<string> {
  const roots = new Set<string>()
  for (const placeholder of placeholders) {
    const composite = [...placeholder.scope, placeholder.token].join('/')
    const path = mapping[composite] ?? mapping[placeholder.token] ?? placeholder.path
    if (path.startsWith('slide.')) continue
    if (path.split('.').includes('custom')) roots.add('custom')
    if (path.startsWith('.')) continue
    const root = path.split('.')[0]
    if (root) roots.add(root)
  }
  return roots
}

/** 주간 모델 로더 한 묶음이 채우는 루트 (정본 §4.5.4 표). */
export const WEEKLY_MODEL_ROOTS = [
  'report', 'kpi', 'phases', 'plan_actual', 'workload', 'wbs_rows', 'wbs_groups',
  'issues', 'issues_detail', 'events', 'meetings', 'announcements', 'attendance',
] as const

export function needsWeeklyModel(roots: ReadonlySet<string>): boolean {
  return WEEKLY_MODEL_ROOTS.some((root) => roots.has(root))
}
