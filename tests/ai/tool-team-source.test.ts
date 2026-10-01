import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ projectTeams: vi.fn(), teamCodesVisibleTo: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: m.projectTeams, teamCodesVisibleTo: m.teamCodesVisibleTo }))

import { createToolTeamSource } from '@/lib/ai/tools/teamSource'
import { teamRows } from '../helpers/teams-source-mock'

beforeEach(() => vi.clearAllMocks())

describe('createToolTeamSource — 봇 도구의 팀 원천(요청 범위, 레지스트리의 세션 클라이언트로)', () => {
  it('projectTeamCodes 는 그 프로젝트 팀의 활성 코드(activeCodes 순), 받은 클라이언트로 읽는다', async () => {
    m.projectTeams.mockResolvedValue([...teamRows(['RES', 'OPS']), ...teamRows(['ARC'], { active: false, id: 't-ARC2' })])
    const client = { from: vi.fn() }
    expect(await createToolTeamSource(client as never).projectTeamCodes('p1')).toEqual(['RES', 'OPS'])
    expect(m.projectTeams).toHaveBeenCalledWith('p1', { client })
  })
  it('visibleTeamCodes 는 원천의 teamCodesVisibleTo(view, { client })', async () => {
    m.teamCodesVisibleTo.mockResolvedValue(['CIV'])
    const client = { from: vi.fn() }
    const view = { all: false as const, workspaceIds: ['w'], projectIds: [] }
    expect(await createToolTeamSource(client as never).visibleTeamCodes(view)).toEqual(['CIV'])
    expect(m.teamCodesVisibleTo).toHaveBeenCalledWith(view, { client })
  })
  it('원천 실패는 그대로 올린다 — 오케스트레이터가 도구 실패로 올린다(팀 없음으로 위장하지 않는다)', async () => {
    m.projectTeams.mockRejectedValue(new Error('teams down'))
    await expect(createToolTeamSource({ from: vi.fn() } as never).projectTeamCodes('p1')).rejects.toThrow('teams down')
  })
})
