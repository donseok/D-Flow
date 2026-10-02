import { describe, expect, it } from 'vitest'
import { NO_CAPS, navCapsFor, scopeRoleLabel } from '@/lib/authz/navCaps'
import { makeActor, makeAdminActor, makeSuperuser } from '../fixtures/actor'

const W = 'ws-1'
const P = '00000000-0000-0000-7e57-000000001611'

describe('navCapsFor — D42 표', () => {
  it('actor null(열화)은 전부 false', () => {
    expect(navCapsFor(null, { workspaceId: W, projectId: P })).toEqual(NO_CAPS)
    expect(Object.values(NO_CAPS).every((v) => v === false)).toBe(true)
  })
  it('워크스페이스 관리자 — 그 워크스페이스에서만 관리·생성', () => {
    const a = makeActor({ workspaceRoles: new Map([[W, 'admin']]) })
    expect(navCapsFor(a, { workspaceId: W })).toEqual({ isPlatformAdmin: false, isWorkspaceAdmin: true, isProjectAdmin: false, canViewUsage: false, canViewPortfolio: false, canCreateProject: true })
    expect(navCapsFor(a, { workspaceId: 'ws-2' }).isWorkspaceAdmin).toBe(false)
    expect(navCapsFor(a, { workspaceId: null }).canCreateProject).toBe(false)
  })
  it('프로젝트 범위에서만 isProjectAdmin', () => {
    const a = makeAdminActor(P)
    expect(navCapsFor(a, { workspaceId: W, projectId: P }).isProjectAdmin).toBe(true)
    expect(navCapsFor(a, { workspaceId: W }).isProjectAdmin).toBe(false)
  })
  it('플랫폼 관리자 — 전부 true(사용 현황·포트폴리오는 현행 술어)', () => {
    expect(navCapsFor(makeSuperuser(), { workspaceId: W, projectId: P })).toEqual({ isPlatformAdmin: true, isWorkspaceAdmin: true, isProjectAdmin: true, canViewUsage: true, canViewPortfolio: true, canCreateProject: true })
  })
})

describe('scopeRoleLabel — 범위 기준 역할 라벨(D42)', () => {
  it('워크스페이스 범위는 워크스페이스 역할, 프로젝트 범위는 roleIn, 열화는 확인 불가', () => {
    expect(scopeRoleLabel(makeActor({ workspaceRoles: new Map([[W, 'admin']]) }), { workspaceId: W }, false)).toBe('관리자')
    expect(scopeRoleLabel(makeActor(), { workspaceId: W }, false)).toBe('멤버')
    expect(scopeRoleLabel(makeSuperuser(), { workspaceId: W }, false)).toBe('플랫폼 관리자')
    expect(scopeRoleLabel(makeActor({ projectWorkspace: new Map([[P, W]]) }), { workspaceId: W, projectId: P }, false)).toBe('조회')
    expect(scopeRoleLabel(makeAdminActor(P), { workspaceId: W, projectId: P }, false)).toBe('관리자')
    expect(scopeRoleLabel(null, { workspaceId: W }, true)).toBe('확인 불가')
  })
})
