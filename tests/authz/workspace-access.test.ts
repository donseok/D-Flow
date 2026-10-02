import { describe, expect, it } from 'vitest'
import { canManageWorkspaceAccounts } from '@/lib/authz/accountsAccess'
import { canViewAgents, seatmapProjectIds } from '@/lib/authz/agentsAccess'
import { canManageTeams } from '@/lib/authz/teamsAccess'
import { makeActor, makeMemberActor, makeSuperuser } from '../fixtures/actor'

const W = 'ws-1', W2 = 'ws-2'
const P1 = '00000000-0000-0000-7e57-000000001612', P2 = '00000000-0000-0000-7e57-000000001613', PX = '00000000-0000-0000-7e57-000000001614'

describe('계정·공용 팀 — 슬러그 워크스페이스 관리자(D22)', () => {
  it('워크스페이스 관리자·플랫폼 관리자만, 다른 워크스페이스는 아니다', () => {
    const admin = makeActor({ workspaceRoles: new Map([[W, 'admin']]) })
    expect(canManageWorkspaceAccounts(admin, W)).toBe(true)
    expect(canManageWorkspaceAccounts(admin, W2)).toBe(false)
    expect(canManageWorkspaceAccounts(makeActor(), W)).toBe(false)
    expect(canManageWorkspaceAccounts(makeSuperuser({ workspaceRoles: new Map() }), W2)).toBe(true)
    expect(canManageWorkspaceAccounts(null, W)).toBe(false)
    expect(canManageTeams(admin, W)).toBe(true)
    expect(canManageTeams(admin, W2)).toBe(false)
  })
})

describe('좌석표 — 그 워크스페이스로 한정(D21, §5.8)', () => {
  it('canViewAgents = 그 워크스페이스에 역할', () => {
    const m = makeMemberActor(P1, [], { projectWorkspace: new Map([[P1, W], [PX, W2]]) })
    expect(canViewAgents(m, W)).toBe(true)
    expect(canViewAgents(m, W2)).toBe(false)
    expect(canViewAgents(null, W)).toBe(false)
  })
  it('seatmapProjectIds — 멤버 이상인 그 워크스페이스 프로젝트만, 플랫폼 관리자는 그 워크스페이스 전부(다른 워크스페이스 제외)', () => {
    const m = makeMemberActor(P1, [], { projectWorkspace: new Map([[P1, W], [P2, W], [PX, W2]]) })
    expect(seatmapProjectIds(m, W)).toEqual([P1])
    const su = makeSuperuser({ projectWorkspace: new Map([[P1, W], [P2, W], [PX, W2]]) })
    expect(seatmapProjectIds(su, W).sort()).toEqual([P1, P2].sort())
    expect(seatmapProjectIds(null, W)).toEqual([])
  })
})
