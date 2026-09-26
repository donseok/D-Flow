import { describe, expect, it, vi } from 'vitest'

// 회의록 도메인의 팀 목록 — 범위(프로젝트, 미지정이면 워크스페이스)로 좁힌다(SP2 Task 16a).
const master = vi.hoisted(() => ({
  activeTeamCodesForProjectSync: vi.fn((pid: string) => (pid === 'p1' ? ['MES'] : [])),
  activeTeamCodesForWorkspaceSync: vi.fn((wid: string) => (wid === 'ws-a' ? ['PMO', 'ERP'] : wid === 'ws-b' ? ['ERP', 'QA'] : [])),
  teamsForProjectSync: vi.fn(() => [{ code: 'MES', active: false }]),
  teamsForWorkspaceSync: vi.fn(() => [{ code: 'PMO', active: true }, { code: 'OLD', active: false }]),
}))
vi.mock('@/lib/teams/master', () => master)

import { activeTeamCodesForMinuteScope, teamCodesForMinuteScope } from '@/lib/minutes/teamScope'

describe('activeTeamCodesForMinuteScope', () => {
  it('프로젝트가 있으면 그 프로젝트의 팀 — 워크스페이스 목록은 보지 않는다', () => {
    expect(activeTeamCodesForMinuteScope({ projectId: 'p1', workspaceId: 'ws-a' })).toEqual(['MES'])
    expect(master.activeTeamCodesForWorkspaceSync).not.toHaveBeenCalled()
  })
  it('미지정이면 그 워크스페이스의 공용 팀', () => {
    expect(activeTeamCodesForMinuteScope({ projectId: null, workspaceId: 'ws-b' })).toEqual(['ERP', 'QA'])
  })
  it('팀 캐시 실패(throw)는 삼키지 않는다 — 빈 목록으로 위장하지 않는다', () => {
    master.activeTeamCodesForWorkspaceSync.mockImplementationOnce(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    expect(() => activeTeamCodesForMinuteScope({ projectId: null, workspaceId: 'ws-a' })).toThrow('팀 마스터')
  })
})

describe('teamCodesForMinuteScope — 등록 팀(비활성 포함)', () => {
  it('앵커 예약어 판정용이라 비활성 팀도 싣는다', () => {
    expect(teamCodesForMinuteScope({ projectId: null, workspaceId: 'ws-a' })).toEqual(['PMO', 'OLD'])
    expect(teamCodesForMinuteScope({ projectId: 'p1', workspaceId: 'ws-a' })).toEqual(['MES'])
  })
})
