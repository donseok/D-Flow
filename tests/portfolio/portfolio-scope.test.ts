import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getActor: vi.fn(), listProjectsWithState: vi.fn(), createServerClient: vi.fn(), getComputedWbs: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: h.getActor }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: h.listProjectsWithState }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
// 프로젝트별 로더 — WBS 계산·팀 캐시는 입력의 프로젝트 목록과 무관하다(단언은 프로젝트 id 목록 하나)
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: h.getComputedWbs }))
vi.mock('@/lib/teams/master', () => ({ teamsForProjectSync: () => [] }))

import { getPortfolioInputs } from '@/lib/data/portfolio'
import { makeSuperuser } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-0000000016b5', WB = '00000000-0000-0000-7e57-0000000016b6'
let ins: unknown[] = []
beforeEach(() => {
  vi.clearAllMocks()
  h.getActor.mockResolvedValue(makeSuperuser())
  h.getComputedWbs.mockResolvedValue({ today: '2026-10-02', items: [] })
  h.listProjectsWithState.mockResolvedValue({ projects: [
    { id: 'p-a', name: 'A1', workspace_id: WA, start_date: null, end_date: null },
    { id: 'p-b', name: 'B1', workspace_id: WB, start_date: null, end_date: null },
  ], degraded: false })
  // 리더·진척 조회 — 어떤 체인이든 빈 결과(in 인자를 기록한다)
  ins = []
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'order', 'gte', 'lte']) chain[k] = () => chain
  chain.in = (_c: string, v: unknown) => { ins.push(v); return chain }
  chain.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
  h.createServerClient.mockResolvedValue({ from: () => chain })
})

describe('getPortfolioInputs(workspaceId) — 그 워크스페이스로 한정(D21)', () => {
  it('다른 워크스페이스 프로젝트는 입력에 없다', async () => {
    const r = await getPortfolioInputs(WA)
    expect(r.inputs.map((x) => x.projectId)).toEqual(['p-a'])
    // 리더·스냅샷 IN 조회도 그 워크스페이스 프로젝트만
    expect(ins).toEqual([['p-a'], ['p-a']])
    expect(h.getComputedWbs).toHaveBeenCalledTimes(1)
    expect(h.getComputedWbs).toHaveBeenCalledWith('p-a')
  })
  it('그 워크스페이스에 프로젝트가 없으면 빈 입력(다른 워크스페이스로 넓히지 않는다)', async () => {
    const r = await getPortfolioInputs('00000000-0000-0000-7e57-0000000016b7')
    expect(r.inputs).toEqual([])
    expect(h.getComputedWbs).not.toHaveBeenCalled()
  })
})
