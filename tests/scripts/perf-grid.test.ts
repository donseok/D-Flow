import { describe, it, expect } from 'vitest'
import { GRID_SHAPE, gridRows, gridTarget, mulberry32, rowCountVerdict, summarize } from '../../scripts/perf-grid.mjs'
import { median, percentile } from '../../scripts/lib/perf.mjs'

const CTX = {
  projectId: '00000000-0000-0000-7e57-000000001510', today: '2026-09-29',
  teamIds: ['00000000-0000-0000-7e57-000000001511', '00000000-0000-0000-7e57-000000001512', '00000000-0000-0000-7e57-000000001513', '00000000-0000-0000-7e57-000000001514', '00000000-0000-0000-7e57-000000001515'],
  memberIds: Array.from({ length: 20 }, (_, i) => `00000000-0000-0000-7e57-0000000015${String(20 + i).padStart(2, '0')}`),
}

describe('gridRows — 1만 행 합성(스펙 §3.2)', () => {
  const g = gridRows(CTX)
  it('같은 입력이면 같은 행(고정 PRNG)', () => {
    expect(gridRows(CTX)).toEqual(g)
    expect([mulberry32(7)(), mulberry32(7)()]).toEqual([mulberry32(7)(), mulberry32(7)()])
  })
  it('행 수 = 10+100+1000+9000 = 10,110, 깊이 4, 부모가 먼저', () => {
    expect(g.wbs).toHaveLength(GRID_SHAPE.phases * (1 + GRID_SHAPE.tasks * (1 + GRID_SHAPE.activities * (1 + GRID_SHAPE.details))))
    expect(g.wbs).toHaveLength(10110)
    expect(new Set(g.wbs.map((r) => r.level_idx))).toEqual(new Set([0, 1, 2, 3]))
    const seen = new Set<string>()
    for (const r of g.wbs) { if (r.parent_id) expect(seen.has(r.parent_id)).toBe(true); seen.add(r.id) }
  })
  it('분리 부모 접힘이 행 수를 줄이지 않게 is_owner_split 은 전부 false(판정 Q9)', () => {
    expect(g.wbs.every((r) => r.is_owner_split === false)).toBe(true)
  })
  it('잎마다 primary 담당 하나, 팀 5·담당 20 안에서', () => {
    const leaves = g.wbs.filter((r) => r.level_idx === 3)
    expect(g.owners).toHaveLength(leaves.length)
    expect(new Set(g.owners.map((o) => o.team_id)).size).toBe(5)
    expect(new Set(leaves.map((r) => r.assignee_member_id)).size).toBeLessThanOrEqual(20)
  })
})

describe('측정 판정', () => {
  it('DOM 행 수가 시드 행 수와 다르면 실패 — max_rows 잘림을 측정으로 삼지 않는다(D51)', () => {
    expect(() => rowCountVerdict(10110, 10110)).not.toThrow()
    expect(() => rowCountVerdict(1000, 10110)).toThrow(/1000.*10110/)
  })
  it('요약은 run 마다의 중앙값', () => {
    const runs = [1, 5, 3].map((x) => ({ firstRowMs: x, longTaskMs: x * 2, frameAvgMs: 16, framesOver50: x, htmlEndMs: x * 10, ttfbMs: x, domRows: 10110 }))
    expect(summarize(runs)).toEqual({ firstRowMs: 3, longTaskMs: 6, frameAvgMs: 16, framesOver50: 3, htmlEndMs: 30, ttfbMs: 3, domRows: 10110 })
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
  })
  it.each([
    ['LOCAL_DB_URL 없음', { LOCAL_DB_URL: undefined }, /LOCAL_DB_URL/],
    ['레인 A 54322', { LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' }, /54422/],
    ['앱 3000', { appUrl: 'http://127.0.0.1:3000' }, /3000/],
    ['원격 Supabase', { supabaseUrl: 'https://x.supabase.co' }, /로컬이 아니다/],
  ])('대상 거부 — %s', (_n, over, re) => {
    const env = { LOCAL_DB_URL: 'postgresql://postgres:postgres@127.0.0.1:54422/postgres', supabaseUrl: 'http://127.0.0.1:54421', appUrl: 'http://127.0.0.1:3201', ...over }
    expect(() => gridTarget(env)).toThrow(re)
  })
})
