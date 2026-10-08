import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/domain/authz'
import { makeActor as baseActor, makeAdminActor as baseAdminActor, makeMemberActor as baseMemberActor, makeSuperuser as baseSuperuser } from '../fixtures/actor'
import { agentCredential, agentPrincipal, CRED_OWNER, CRED_WS } from '../fixtures/credentials'

// SP2 결정 8·SP7 §5.1.3 — 외부 API 판정은 actorFromCredential(= buildActor 를 자격증명 범위로 narrowActor) + roleIn. 스냅샷을 주입해 판정만 본다.
// 공용 fixture 의 소속 워크스페이스('ws-1')를 자격증명 워크스페이스로 바꿔 쓴다 — 좁힌 뒤에도 프로젝트가 남아야 판정이 의미가 있다.
const WS = CRED_WS
const inCredWs = (a: Actor): Actor => ({
  ...a,
  workspaceRoles: new Map([...a.workspaceRoles].map(([w, r]) => [w === 'ws-1' ? WS : w, r])),
  projectWorkspace: new Map([...a.projectWorkspace].map(([p, w]) => [p, w === 'ws-1' ? WS : w])),
})
const makeActor = (over: Partial<Actor> = {}) => inCredWs(baseActor(over))
const makeAdminActor = (pid: string) => inCredWs(baseAdminActor(pid))
const makeMemberActor = (pid: string) => inCredWs(baseMemberActor(pid))
const makeSuperuser = (over: Partial<Actor> = {}) => inCredWs(baseSuperuser(over))
const mocks = vi.hoisted(() => ({ buildActor: vi.fn() }))
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: mocks.buildActor }))

import { agentMemberRole, isAgentProjectAdmin, isAgentProjectMember } from '@/lib/agent/externalApi'

const P = 'p-1'
const OTHER_WS_P = 'p-other'
const admin = {} as never
const CRED = agentCredential()
/** 토큰 소유자의 principal — 판정 함수는 이 자격증명 범위로 스냅샷을 좁힌다. */
const PR = agentPrincipal(CRED)
const U = CRED_OWNER
const withActor = (a: Actor) => mocks.buildActor.mockResolvedValue(a)

beforeEach(() => { vi.clearAllMocks() })

describe('외부 API 역할 판정 — actorFromCredential + roleIn(SP2 결정 8 · SP7 §5.1.3)', () => {
  it('워크스페이스 관리자는 명단 없이 그 워크스페이스 프로젝트의 관리자다(승계)', async () => {
    withActor(makeActor({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P, WS]]) }))
    expect(await isAgentProjectAdmin(admin, U, P, PR)).toBe(true)
    expect(await isAgentProjectMember(admin, U, P, PR)).toBe(true)
    expect(await agentMemberRole(admin, U, P, PR)).toBe('admin')
    expect(mocks.buildActor).toHaveBeenCalledWith(admin, U)
  })
  it('명단 member 는 멤버이고 관리자가 아니다', async () => {
    withActor(makeMemberActor(P))
    expect(await isAgentProjectMember(admin, U, P, PR)).toBe(true)
    expect(await isAgentProjectAdmin(admin, U, P, PR)).toBe(false)
    expect(await agentMemberRole(admin, U, P, PR)).toBe('member')
  })
  it('다른 워크스페이스 프로젝트 — 명단 admin 이 있어도 스냅샷에 없으면 멤버 아님·역할 null', async () => {
    withActor(makeAdminActor(P))
    expect(await isAgentProjectMember(admin, U, OTHER_WS_P, PR)).toBe(false)
    expect(await isAgentProjectAdmin(admin, U, OTHER_WS_P, PR)).toBe(false)
    expect(await agentMemberRole(admin, U, OTHER_WS_P, PR)).toBeNull()
  })
  it('같은 워크스페이스의 조회 전용(명단 없음)은 멤버 아님·역할 null', async () => {
    withActor(makeActor({ projectWorkspace: new Map([[P, WS]]) }))
    expect(await isAgentProjectMember(admin, U, P, PR)).toBe(false)
    expect(await agentMemberRole(admin, U, P, PR)).toBeNull()
  })
  // 옛 케이스 '플랫폼 관리자는 어느 프로젝트든 superuser' 의 후신(반전) — 그 승격은 좁히지 않은 스냅샷(시크릿·옛 PAT 경로)의 것이었다.
  // 자격증명 경로에는 플랫폼 관리자 승격이 없다(§5.1.3 "isSuperuser 는 항상 false") — 소속·명단으로만 판정한다.
  it('플랫폼 관리자여도 승격이 없다 — 스냅샷에 없는 프로젝트는 null, 같은 워크스페이스라도 명단이 없으면 멤버 아님', async () => {
    withActor(makeSuperuser({ projectWorkspace: new Map([[P, WS], [OTHER_WS_P, 'ws-other']]) }))
    expect(await agentMemberRole(admin, U, OTHER_WS_P, PR)).toBeNull()
    expect(await isAgentProjectAdmin(admin, U, OTHER_WS_P, PR)).toBe(false)
    expect(await isAgentProjectMember(admin, U, OTHER_WS_P, PR)).toBe(false)
    expect(await agentMemberRole(admin, U, P, PR)).toBeNull()
    expect(await isAgentProjectAdmin(admin, U, P, PR)).toBe(false)
  })
  it('자격증명의 project_ids 밖 프로젝트는 명단 admin 이어도 멤버 아님·역할 null', async () => {
    const P_UUID = '11111111-1111-4111-8111-111111111111', Q_UUID = '22222222-2222-4222-8222-222222222222'
    const scoped = agentPrincipal(CRED.with({ project_ids: [Q_UUID] }))
    withActor(makeAdminActor(P_UUID))
    expect(await isAgentProjectMember(admin, U, P_UUID, scoped)).toBe(false)
    expect(await isAgentProjectAdmin(admin, U, P_UUID, scoped)).toBe(false)
    expect(await agentMemberRole(admin, U, P_UUID, scoped)).toBeNull()
    expect(await agentMemberRole(admin, U, P_UUID, PR)).toBe('admin') // 대조 — 범위가 전체면 admin
  })
  it('토큰 소유자가 아닌 userId 로는 판정하지 않는다 — 멤버 false·역할 null(fail-closed), 관리자 판정은 throw', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    withActor(makeAdminActor(P))
    expect(await isAgentProjectMember(admin, 'someone-else', P, PR)).toBe(false)
    expect(await agentMemberRole(admin, 'someone-else', P, PR)).toBeNull()
    await expect(isAgentProjectAdmin(admin, 'someone-else', P, PR)).rejects.toThrow()
    expect(mocks.buildActor).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('스냅샷 조회 실패 — 멤버 false·역할 null(fail-closed), 관리자 판정은 throw(라우트 500)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.buildActor.mockRejectedValue(new Error('db down'))
    expect(await isAgentProjectMember(admin, U, P, PR)).toBe(false)
    expect(await agentMemberRole(admin, U, P, PR)).toBeNull()
    await expect(isAgentProjectAdmin(admin, U, P, PR)).rejects.toThrow('db down')
    err.mockRestore()
  })
})

describe('agentRoleFromActor — 스냅샷을 이미 가진 라우트용 순수판', () => {
  it('agentMemberRole 과 같은 판정(조회 전용은 null)이고 스냅샷을 조립하지 않는다', async () => {
    const { agentRoleFromActor } = await import('@/lib/agent/externalApi')
    expect(agentRoleFromActor(makeActor({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P, WS]]) }), P)).toBe('admin')
    expect(agentRoleFromActor(makeMemberActor(P), P)).toBe('member')
    expect(agentRoleFromActor(makeActor({ projectWorkspace: new Map([[P, WS]]) }), P)).toBeNull()
    expect(agentRoleFromActor(makeAdminActor(P), OTHER_WS_P)).toBeNull()
    expect(agentRoleFromActor(makeSuperuser(), OTHER_WS_P)).toBe('superuser')
    expect(mocks.buildActor).not.toHaveBeenCalled()
  })
})
