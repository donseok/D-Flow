import { beforeEach, describe, expect, it, vi } from 'vitest'

// SP2 Task 16b — 챗봇 근거(knowledge)의 팀 축은 대상 프로젝트의 팀이다. 옛 전역 접근자는 전 워크스페이스의 공용 팀
// 합집합이라, 팀별 답변에 다른 워크스페이스의 팀 이름이 행으로 나왔다.
const mocks = vi.hoisted(() => ({
  getComputedWbs: vi.fn(async () => ({ items: [], today: '2026-09-26', calendar: (await import('../helpers/calendarFixture')).calUtcSun })),
  activeTeamCodesForProjectSync: vi.fn((pid: string) => (pid === 'p1' ? ['A팀'] : pid === 'p2' ? ['B팀'] : [])),
  projectTeams: vi.fn(),
}))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme' }, { id: 'p2', name: 'Beta' }]),
}))
// 팀 원천(SP4 A2 — 요청 범위). 코드는 위 함수가 정하고 행으로 바꿔 돌려준다
vi.mock('@/lib/teams/source', async () => {
  const { teamRows } = await import('../helpers/teams-source-mock')
  mocks.projectTeams.mockImplementation(async (pid: string) => teamRows(mocks.activeTeamCodesForProjectSync(pid)))
  return { projectTeams: mocks.projectTeams }
})
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Acme' } }) }) }) }),
  })),
}))

import { gatherKnowledge } from '@/lib/ai/knowledge'

beforeEach(() => { vi.clearAllMocks() })

describe('knowledge — 팀 축은 대상 프로젝트의 팀', () => {
  it('팀별 답변은 그 프로젝트의 팀만 행으로 싣는다', async () => {
    const k = await gatherKnowledge('by_team', 'p1')
    expect(k.text).toContain('A팀')
    expect(k.text).not.toContain('B팀')
    expect(mocks.projectTeams).toHaveBeenCalledWith('p1')
    expect(mocks.projectTeams).not.toHaveBeenCalledWith('p2')
  })

  it('전사 요약은 프로젝트마다 그 프로젝트의 팀으로 분석한다', async () => {
    await gatherKnowledge('overview', null)
    expect(mocks.projectTeams.mock.calls.map(c => c[0]).sort()).toEqual(['p1', 'p2'])
  })
})
