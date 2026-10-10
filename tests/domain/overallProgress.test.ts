import { describe, it, expect } from 'vitest'
import { overallProgress } from '@/lib/domain/rollup'
import type { ComputedItem } from '@/lib/domain/types'

const root = (over: Partial<ComputedItem>): ComputedItem =>
  ({
    id: 'r', parentId: null, level: 'phase', code: '1', sortOrder: 1, name: 'r',
    biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
    owners: [], plannedPct: 0, rolledActualPct: 0, achievement: null, status: 'not_started', children: [],
    ...over,
  }) as ComputedItem

describe('overallProgress', () => {
  it('weight 모두 null이면 단순 평균', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 80 }),
      root({ rolledActualPct: 0, plannedPct: 40 }),
    ])
    expect(r.actual).toBe(50)
    expect(r.planned).toBe(60)
  })

  it('weight가 있으면 가중 평균 (단순 평균과 달라짐)', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 100, weight: 3 }),
      root({ rolledActualPct: 0, plannedPct: 0, weight: 1 }),
    ])
    expect(r.actual).toBe(75) // (100*3 + 0*1) / 4
    expect(r.planned).toBe(75)
  })

  it('빈 배열이면 0', () => {
    expect(overallProgress([])).toEqual({ actual: 0, planned: 0 })
  })

  it('weight 가 일부만 있으면 미지정은 남은 몫을 받는다 — 하위 롤업과 같은 규칙(effectiveWeights, 사용자 테스트 BUG-13)', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 100, weight: 0.6 }),
      root({ rolledActualPct: 50, plannedPct: 50, weight: null }),
    ])
    // 100*0.6 + 50*0.4 = 80 (옛 규칙 — 미지정 = 1 — 은 (60 + 50) / 1.6 = 68.8)
    expect(r.actual).toBe(80)
    expect(r.planned).toBe(80)
  })

  it('W8 — [(100%, w=1), (0%, w=null)] 은 100(루트): 지정 합이 100% 라 미지정 몫이 0 이다(옛 규칙은 50)', () => {
    expect(overallProgress([root({ rolledActualPct: 100, plannedPct: 100, weight: 1 }), root({ rolledActualPct: 0, plannedPct: 0, weight: null })]))
      .toEqual({ actual: 100, planned: 100 })
  })

  it('[RF4] 명시 0 은 0, 미지정은 남은 몫 — [0, null] 은 null 쪽 값, 전부 0 이면 합 0 → || 1 로 0(지금과 같다)', () => {
    expect(overallProgress([root({ rolledActualPct: 100, plannedPct: 100, weight: 0 }), root({ rolledActualPct: 20, plannedPct: 30, weight: null })]))
      .toEqual({ actual: 20, planned: 30 })
    expect(overallProgress([root({ rolledActualPct: 100, plannedPct: 100, weight: 0 }), root({ rolledActualPct: 20, plannedPct: 30, weight: 0 })]))
      .toEqual({ actual: 0, planned: 0 })
  })
})
