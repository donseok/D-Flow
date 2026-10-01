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

  it('weight 가 일부만 있으면 null 은 1 — 하위 롤업과 같은 규칙(SP4 D20, 사용자 결정 3 의 정합 수정)', () => {
    const r = overallProgress([
      root({ rolledActualPct: 100, plannedPct: 100, weight: 2 }),
      root({ rolledActualPct: 50, plannedPct: 50, weight: null }),
    ])
    // (100*2 + 50*1) / 3 = 83.3
    expect(r.actual).toBe(83.3)
    expect(r.planned).toBe(83.3)
  })

  it('W8 — [(100%, w=1), (0%, w=null)] 은 50(루트)', () => {
    expect(overallProgress([root({ rolledActualPct: 100, plannedPct: 100, weight: 1 }), root({ rolledActualPct: 0, plannedPct: 0, weight: null })]))
      .toEqual({ actual: 50, planned: 50 })
  })

  it('[RF4] 명시 0 은 0, null 은 1 — [0, null] 은 null 쪽 값, 전부 0 이면 합 0 → || 1 로 0(지금과 같다)', () => {
    expect(overallProgress([root({ rolledActualPct: 100, plannedPct: 100, weight: 0 }), root({ rolledActualPct: 20, plannedPct: 30, weight: null })]))
      .toEqual({ actual: 20, planned: 30 })
    expect(overallProgress([root({ rolledActualPct: 100, plannedPct: 100, weight: 0 }), root({ rolledActualPct: 20, plannedPct: 30, weight: 0 })]))
      .toEqual({ actual: 0, planned: 0 })
  })
})
