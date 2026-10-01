import { describe, expect, it } from 'vitest'
import { computeTree, unsetWeightCount } from '@/lib/domain/rollup'
import type { WbsRow } from '@/lib/domain/types'

const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })
const tree = (rows: WbsRow[]) => computeTree(rows, '2026-03-02', new Set(), { subActTeamOrder: new Map() })

describe('unsetWeightCount — "가중치 미지정 N개"(SP4 D20 — 화면 표시는 B)', () => {
  it('값과 null 이 섞인 형제 그룹의 null 만 센다 — 루트·하위 모두', () => {
    expect(unsetWeightCount(tree([
      row({ id: 'A', weight: 2 }), row({ id: 'B', weight: null }), row({ id: 'C', weight: null }),                       // 루트: 2
      row({ id: 'A1', parentId: 'A', weight: null }), row({ id: 'A2', parentId: 'A', weight: 0 }),                       // A 아래: 1(명시 0 은 값)
      row({ id: 'B1', parentId: 'B', weight: null }), row({ id: 'B2', parentId: 'B', weight: null }),                    // B 아래: 전부 null — 0
    ]))).toBe(3)
  })
  it('전부 null·전부 값·빈 트리는 0', () => {
    expect(unsetWeightCount(tree([row({ id: 'A' }), row({ id: 'B' })]))).toBe(0)
    expect(unsetWeightCount(tree([row({ id: 'A', weight: 1 }), row({ id: 'B', weight: 0 })]))).toBe(0)
    expect(unsetWeightCount([])).toBe(0)
  })
})
