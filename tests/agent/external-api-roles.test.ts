import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/domain/authz'
import { makeActor, makeAdminActor, makeMemberActor, makeSuperuser, WS } from '../fixtures/actor'

// SP2 결정 8 — 외부 API 판정은 actorFromUser(= buildActor) + roleIn. 스냅샷을 주입해 판정만 본다.
const mocks = vi.hoisted(() => ({ buildActor: vi.fn() }))
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: mocks.buildActor }))

import { agentMemberRole, isAgentProjectAdmin, isAgentProjectMember } from '@/lib/agent/externalApi'

const P = 'p-1'
const OTHER_WS_P = 'p-other'
const admin = {} as never
const withActor = (a: Actor) => mocks.buildActor.mockResolvedValue(a)

beforeEach(() => { vi.clearAllMocks() })

describe('외부 API 역할 판정 — actorFromUser + roleIn(SP2 결정 8)', () => {
  it('워크스페이스 관리자는 명단 없이 그 워크스페이스 프로젝트의 관리자다(승계)', async () => {
    withActor(makeActor({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P, WS]]) }))
    expect(await isAgentProjectAdmin(admin, 'u1', P)).toBe(true)
    expect(await isAgentProjectMember(admin, 'u1', P)).toBe(true)
    expect(await agentMemberRole(admin, 'u1', P)).toBe('admin')
    expect(mocks.buildActor).toHaveBeenCalledWith(admin, 'u1')
  })
  it('명단 member 는 멤버이고 관리자가 아니다', async () => {
    withActor(makeMemberActor(P))
    expect(await isAgentProjectMember(admin, 'u1', P)).toBe(true)
    expect(await isAgentProjectAdmin(admin, 'u1', P)).toBe(false)
    expect(await agentMemberRole(admin, 'u1', P)).toBe('member')
  })
  it('다른 워크스페이스 프로젝트 — 명단 admin 이 있어도 스냅샷에 없으면 멤버 아님·역할 null', async () => {
    withActor(makeAdminActor(P))
    expect(await isAgentProjectMember(admin, 'u1', OTHER_WS_P)).toBe(false)
    expect(await isAgentProjectAdmin(admin, 'u1', OTHER_WS_P)).toBe(false)
    expect(await agentMemberRole(admin, 'u1', OTHER_WS_P)).toBeNull()
  })
  it('같은 워크스페이스의 조회 전용(명단 없음)은 멤버 아님·역할 null', async () => {
    withActor(makeActor({ projectWorkspace: new Map([[P, WS]]) }))
    expect(await isAgentProjectMember(admin, 'u1', P)).toBe(false)
    expect(await agentMemberRole(admin, 'u1', P)).toBeNull()
  })
  it('플랫폼 관리자는 어느 프로젝트든 superuser', async () => {
    withActor(makeSuperuser())
    expect(await agentMemberRole(admin, 'u1', OTHER_WS_P)).toBe('superuser')
    expect(await isAgentProjectAdmin(admin, 'u1', OTHER_WS_P)).toBe(true)
  })
  it('스냅샷 조회 실패 — 멤버 false·역할 null(fail-closed), 관리자 판정은 throw(라우트 500)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.buildActor.mockRejectedValue(new Error('db down'))
    expect(await isAgentProjectMember(admin, 'u1', P)).toBe(false)
    expect(await agentMemberRole(admin, 'u1', P)).toBeNull()
    await expect(isAgentProjectAdmin(admin, 'u1', P)).rejects.toThrow('db down')
    err.mockRestore()
  })
})
