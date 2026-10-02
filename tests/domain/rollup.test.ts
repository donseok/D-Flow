import { describe, it, expect } from 'vitest'
import { computeNode, computeTree, overallProgress, weightOf } from '@/lib/domain/rollup'
import type { BuildTreeOpts } from '@/lib/domain/tree'
import type { WbsRow } from '@/lib/domain/types'
import { teamOrderMap } from '@/lib/domain/teams'
import { FIXTURE_TEAM_CODES } from '../fixtures/teams'
import { calUtcSun } from '../helpers/calendarFixture'

const OPTS: BuildTreeOpts = { subActTeamOrder: teamOrderMap(FIXTURE_TEAM_CODES) }

const leaf = (id: string, parentId: string, actual: number, weight: number | null = null): WbsRow => ({
  id, parentId, code: id, sortOrder: 1, name: id,
  biz: null, deliverable: null, plannedStart: '2026-07-06', plannedEnd: '2026-07-10',
  weight, actualPct: actual, owners: [], isOwnerSplit: false,
})

describe('computeTree rollup', () => {
  it('균등 가중치 롤업 = 단순 평균', () => {
    const rows: WbsRow[] = [
      { id: 'P', parentId: null, code: '1', sortOrder: 1, name: 'P',
        biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false },
      leaf('a', 'P', 100), leaf('b', 'P', 0),
    ]
    const tree = computeTree(rows, '2026-07-20', calUtcSun, OPTS)
    expect(tree[0].rolledActualPct).toBe(50)
  })
  it('가중치 반영 롤업', () => {
    const rows: WbsRow[] = [
      { id: 'P', parentId: null, code: '1', sortOrder: 1, name: 'P',
        biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false },
      leaf('a', 'P', 100, 3), leaf('b', 'P', 0, 1),
    ]
    const tree = computeTree(rows, '2026-07-20', calUtcSun, OPTS)
    expect(tree[0].rolledActualPct).toBe(75) // (100*3+0*1)/4
  })
  it('나누어떨어지지 않는 롤업은 소수 1자리 유지(정수로 뭉개지 않음)', () => {
    const rows: WbsRow[] = [
      { id: 'P', parentId: null, code: '1', sortOrder: 1, name: 'P',
        biz: null, deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false },
      leaf('a', 'P', 100), leaf('b', 'P', 0), leaf('c', 'P', 0),
    ]
    const tree = computeTree(rows, '2026-07-20', calUtcSun, OPTS)
    expect(tree[0].rolledActualPct).toBe(33.3) // 100/3 = 33.333…
  })
  it('leaf는 자기 actualPct, status 계산', () => {
    const rows: WbsRow[] = [leaf('a', 'ROOTLESS', 100)]
    // parent 없는 leaf는 root로 취급
    const tree = computeTree([{ ...rows[0], parentId: null }], '2026-07-20', calUtcSun, OPTS)
    expect(tree[0].rolledActualPct).toBe(100)
    expect(tree[0].status).toBe('done')
  })
})

const row = (over: Partial<WbsRow>): WbsRow => ({ id: 'x', parentId: null, code: 'x', sortOrder: 0, name: 'x', biz: null, deliverable: null,
  plannedStart: null, plannedEnd: null, weight: null, actualPct: null, owners: [], isOwnerSplit: false, ...over })

describe('weightOf — 루트·하위 같은 규칙(SP4 D20)', () => {
  it('weightOf: null → 1, 명시 값은 그대로(0 포함)', () => {
    expect([weightOf(null), weightOf(0), weightOf(0.5), weightOf(3)]).toEqual([1, 0, 0.5, 3])
  })
  it('W8 — 하위 [(100%, w=1), (0%, w=null)] 의 부모는 50', () => {
    const [p] = computeTree([
      row({ id: 'P', name: 'P' }),
      row({ id: 'A', parentId: 'P', name: 'A', weight: 1, actualPct: 100 }),
      row({ id: 'B', parentId: 'P', name: 'B', weight: null, actualPct: 0 }),
    ], '2026-03-02', calUtcSun, OPTS)
    expect(p.rolledActualPct).toBe(50)
  })
  it('[RF4] 하위 [0, null] 과 [0, 0] — 루트와 같은 결과', () => {
    const tree = (wa: number | null, wb: number | null) => computeTree([
      row({ id: 'P', name: 'P' }),
      row({ id: 'A', parentId: 'P', name: 'A', weight: wa, actualPct: 100 }),
      row({ id: 'B', parentId: 'P', name: 'B', weight: wb, actualPct: 20 }),
    ], '2026-03-02', calUtcSun, OPTS)[0].rolledActualPct
    expect(tree(0, null)).toBe(20)
    expect(tree(0, 0)).toBe(0)
  })
  it('W9 — overallProgress(roots) = 가상 루트의 computeNode(무작위 트리 30종, 혼재 가중치 포함)', () => {
    let seed = 7
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const pickW = () => { const x = rand(); return x < 0.3 ? null : x < 0.4 ? 0 : Math.round(rand() * 40) / 10 }
    for (let n = 0; n < 30; n++) {
      const rows: WbsRow[] = []
      for (let i = 0; i < 12; i++) {
        const parent = i < 3 ? null : `n${Math.floor(rand() * i)}`
        rows.push(row({ id: `n${i}`, parentId: parent, name: `n${i}`, sortOrder: i, weight: pickW(), actualPct: Math.round(rand() * 100),
          plannedStart: '2026-03-02', plannedEnd: `2026-03-${String(3 + Math.floor(rand() * 20)).padStart(2, '0')}` }))
      }
      const roots = computeTree(rows, '2026-03-10', calUtcSun, OPTS)
      const virtual = computeNode({ ...roots[0], id: 'virtual', parentId: null, weight: null, plannedStart: null, plannedEnd: null, actualPct: null, children: roots, depth: -1 }, '2026-03-10', calUtcSun)
      expect(overallProgress(roots), `tree ${n}`).toEqual({ actual: virtual.rolledActualPct, planned: virtual.plannedPct })
    }
  })
})
