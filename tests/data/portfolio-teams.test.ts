import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getActor: vi.fn(), listProjectsWithState: vi.fn(), createServerClient: vi.fn(), getComputedWbs: vi.fn(), projectTeams: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: m.getActor }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: m.listProjectsWithState }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: m.projectTeams }))
vi.mock('@/lib/authz/portfolioAccess', () => ({ canViewPortfolio: () => true }))

import { getPortfolioInputs } from '@/lib/data/portfolio'

describe('getPortfolioInputs — 팀 원천 실패는 그 행만 degraded(SP4 A2 P19)', () => {
  it('한 프로젝트의 팀 읽기가 실패해도 화면 전체가 멈추지 않는다 — 그 행만 items null·팀 빈 목록, 나머지 행은 정상', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getActor.mockResolvedValue({ isSuperuser: true })
    m.listProjectsWithState.mockResolvedValue({ projects: [{ id: 'pA', name: 'A' }, { id: 'pB', name: 'B' }], degraded: false })
    const empty: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r) }
    for (const k of ['select', 'in', 'eq', 'gte', 'order']) empty[k] = () => empty
    m.createServerClient.mockResolvedValue({ from: () => empty })
    m.getComputedWbs.mockResolvedValue({ items: [], today: '2026-03-02' })
    m.projectTeams.mockImplementation(async (pid: string) => {
      if (pid === 'pB') throw new Error('teams down')
      return [{ id: 't', code: 'RES', name: 'RES', color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: 'pA', workspaceId: 'w' }]
    })
    const { inputs } = await getPortfolioInputs()
    const byId = new Map(inputs.map((i) => [i.projectId, i]))
    expect(byId.get('pA')).toMatchObject({ teams: ['RES'], items: [] })
    expect(byId.get('pB')).toMatchObject({ teams: [], items: null })
    expect(m.projectTeams).toHaveBeenCalledWith('pA')
    err.mockRestore()
  })
})
