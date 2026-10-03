import { describe, expect, it } from 'vitest'
import { INSPECTOR_WIDTH, clampInspectorWidth, inspectorRailWidth } from '@/lib/wbs/inspectorWidth'
import { RAIL_MIN_MAIN } from '@/components/app/RightRail'

describe('인스펙터 폭 — 저장값과 병치 본문 여유', () => {
  it('유한 저장값만 320~640으로 정리한다', () => {
    expect(INSPECTOR_WIDTH).toEqual({ min: 320, max: 640, default: 400 })
    expect([null, undefined, NaN, Infinity].map(clampInspectorWidth)).toEqual([400, 400, 400, 400])
    expect([100, 1400, 512, 511.6].map(clampInspectorWidth)).toEqual([320, 640, 512, 512])
  })
  it('옛 1400px 저장값도 본문 임계 아래로 줄이지 않는다', () => {
    for (const [saved, vp, sb] of [[1400, 1440, 232], [640, 1440, 232], [800, 1440, 64], [null, 1400, 232]] as const) {
      const w = inspectorRailWidth(saved, vp, sb)
      expect(w).toBeGreaterThanOrEqual(INSPECTOR_WIDTH.min)
      expect(vp - sb - 48 - w).toBeGreaterThanOrEqual(Math.min(RAIL_MIN_MAIN, vp - sb - 48 - INSPECTOR_WIDTH.min))
    }
    expect(inspectorRailWidth(null, 1440, 232)).toBe(400)
  })
})
