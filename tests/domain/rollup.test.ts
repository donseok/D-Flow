import { describe, it, expect } from 'vitest'
import { computeNode, computeTree, effectiveWeights, overallProgress, weightWarnings } from '@/lib/domain/rollup'
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

const ws = (...w: (number | null)[]) => effectiveWeights(w.map(weight => ({ weight })))

describe('가중치 규칙 — 루트·하위 같은 함수(effectiveWeights, 사용자 테스트 BUG-13)', () => {
  it('규칙 표: 전부 미지정 = 균등, 전부 지정 = 지정값의 비율, 일부 지정 = 미지정이 남은 몫을 균등하게', () => {
    expect(ws(null, null, null)).toEqual([1, 1, 1])
    expect(ws(3, 1)).toEqual([3, 1])
    expect(ws(0.6, 0.4)).toEqual([0.6, 0.4])
    expect(ws(0.6, null)[1]).toBeCloseTo(0.4, 10)
    const [, b, c] = ws(0.5, null, null)
    expect([b, c]).toEqual([0.25, 0.25])
    expect(ws(0, null)).toEqual([0, 1])            // 명시 0 은 0 — 남은 몫 전부가 미지정에게
    expect(ws()).toEqual([])
  })
  it('지정 합이 100% 이상이면 미지정 몫은 0 이다(음수가 되지 않는다)', () => {
    expect(ws(1, null)).toEqual([1, 0])
    expect(ws(0.7, 0.6, null)).toEqual([0.7, 0.6, 0])
    expect(ws(0.7, 0.2, 0.1, null)[3]).toBe(0)     // 부동소수 합(0.9999…)의 찌꺼기를 몫으로 주지 않는다
  })
  it('리포트의 사례 — 1.1=60%(실적 0)·1.2=미지정(실적 40) 의 상위는 16%, 둘 다 미지정이면 20%, 60/40 도 16%', () => {
    const parent = (wa: number | null, wb: number | null) => computeTree([
      row({ id: 'P', name: 'P' }),
      row({ id: 'A', parentId: 'P', name: 'A', sortOrder: 1, weight: wa, actualPct: 0 }),
      row({ id: 'B', parentId: 'P', name: 'B', sortOrder: 2, weight: wb, actualPct: 40 }),
    ], '2026-03-02', calUtcSun, OPTS)[0].rolledActualPct
    expect(parent(null, null)).toBe(20)
    expect(parent(0.6, null)).toBe(16)             // 옛 규칙(미지정 = 100%)은 25 였다
    expect(parent(0.6, 0.4)).toBe(16)
  })
  it('W8 — 하위 [(100%, w=1), (0%, w=null)] 의 부모는 100 이다(지정 합이 100% 라 미지정 몫 0 — 옛 규칙은 50)', () => {
    const [p] = computeTree([
      row({ id: 'P', name: 'P' }),
      row({ id: 'A', parentId: 'P', name: 'A', weight: 1, actualPct: 100 }),
      row({ id: 'B', parentId: 'P', name: 'B', weight: null, actualPct: 0 }),
    ], '2026-03-02', calUtcSun, OPTS)
    expect(p.rolledActualPct).toBe(100)
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
  it('루트 그룹도 같은 규칙이다 — overallProgress', () => {
    const roots = computeTree([
      row({ id: 'A', name: 'A', sortOrder: 1, weight: 0.6, actualPct: 0 }),
      row({ id: 'B', name: 'B', sortOrder: 2, weight: null, actualPct: 40 }),
    ], '2026-03-02', calUtcSun, OPTS)
    expect(overallProgress(roots).actual).toBe(16)
  })
  it('weightWarnings — 섞인 그룹의 미지정 수와, 지정 합이 100% 를 넘은 섞인 그룹 수', () => {
    const roots = computeTree([
      row({ id: 'A', name: 'A', sortOrder: 1, weight: 0.7 }), row({ id: 'B', name: 'B', sortOrder: 2, weight: 0.6 }), row({ id: 'C', name: 'C', sortOrder: 3 }),   // 루트: 미지정 1, 초과
      row({ id: 'A1', parentId: 'A', weight: 0.5 }), row({ id: 'A2', parentId: 'A' }),                                                                            // 미지정 1, 초과 아님
      row({ id: 'B1', parentId: 'B', weight: 3 }), row({ id: 'B2', parentId: 'B', weight: 1 }),                                                                   // 전부 지정 — 비율이라 합을 따지지 않는다
    ], '2026-03-02', calUtcSun, OPTS)
    expect(weightWarnings(roots)).toEqual({ unset: 2, overGroups: 1 })
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
