import { RAIL_MIN_MAIN } from '@/components/app/RightRail'

/** 저장 키 wbs.detailPanelWidth는 유지하며 옛 큰 폭을 정리한다(W16). */
export const INSPECTOR_WIDTH = { min: 320, max: 640, default: 400 } as const
export function clampInspectorWidth(saved: number | null | undefined): number {
  if (typeof saved !== 'number' || !Number.isFinite(saved)) return INSPECTOR_WIDTH.default
  return Math.round(Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, saved)))
}
/** 병치에서 본문 임계를 먼저 확보한다. 오버레이에는 clampInspectorWidth를 쓴다. */
export function inspectorRailWidth(saved: number | null | undefined, viewport: number, sidebar: number): number {
  const cap = Math.max(INSPECTOR_WIDTH.min, viewport - sidebar - 48 - RAIL_MIN_MAIN)
  return Math.min(clampInspectorWidth(saved), cap)
}
