import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Team } from '@/lib/domain/teams'

// 회의록 범위의 팀(SP4 A2 — 요청 범위 원천). 프로젝트면 그 프로젝트 팀(전용 우선·공용 폴백 — projectTeams 규칙), 없으면 그 워크스페이스 공용.
const m = vi.hoisted(() => ({ projectTeams: vi.fn(), workspaceTeams: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: m.projectTeams, workspaceTeams: m.workspaceTeams }))

import { activeTeamCodesForMinuteScope, teamCodesForMinuteScope } from '@/lib/minutes/teamScope'

const t = (code: string, sortOrder: number, active = true): Team => ({
  id: `t-${code}`, code, name: code, color: '#6b7280', sortOrder, active, progressVisible: true, projectId: null, workspaceId: 'ws-a' })

beforeEach(() => {
  vi.clearAllMocks()
  m.projectTeams.mockResolvedValue([t('MEP', 0), t('ARC', 1, false)])
  m.workspaceTeams.mockResolvedValue([t('OPS', 1), t('RES', 0), t('OLD', 2, false)])
})

describe('activeTeamCodesForMinuteScope', () => {
  it('프로젝트가 있으면 그 프로젝트의 활성 팀 — 워크스페이스 목록은 읽지 않는다', async () => {
    expect(await activeTeamCodesForMinuteScope({ projectId: 'p1', workspaceId: 'ws-a' })).toEqual(['MEP'])
    expect(m.workspaceTeams).not.toHaveBeenCalled()
  })
  it('프로젝트가 없으면 그 워크스페이스의 활성 공용 팀(activeCodes 순)', async () => {
    expect(await activeTeamCodesForMinuteScope({ projectId: null, workspaceId: 'ws-a' })).toEqual(['RES', 'OPS'])
    expect(m.workspaceTeams).toHaveBeenCalledWith('ws-a', undefined)
  })
  it('받은 클라이언트를 원천에 넘긴다 — 세션 없는 외부 API 의 service_role', async () => {
    const client = { from: vi.fn() }
    await activeTeamCodesForMinuteScope({ projectId: 'p1', workspaceId: 'ws-a' }, { client: client as never })
    expect(m.projectTeams).toHaveBeenCalledWith('p1', { client })
  })
  it('원천 실패는 그대로 올린다 — 빈 목록(모든 담당 거부)으로 위장하지 않는다', async () => {
    m.projectTeams.mockRejectedValue(new Error('teams down'))
    await expect(activeTeamCodesForMinuteScope({ projectId: 'p1', workspaceId: 'ws-a' })).rejects.toThrow('teams down')
  })
})

describe('teamCodesForMinuteScope — 등록 코드(비활성 포함) — 폴더 루트의 팀 기본 폴더명 예약어 판정용', () => {
  it('프로젝트·워크스페이스 각각 비활성까지', async () => {
    expect(await teamCodesForMinuteScope({ projectId: 'p1', workspaceId: 'ws-a' })).toEqual(['MEP', 'ARC'])
    expect(await teamCodesForMinuteScope({ projectId: null, workspaceId: 'ws-a' })).toEqual(['OPS', 'RES', 'OLD'])
  })
})
