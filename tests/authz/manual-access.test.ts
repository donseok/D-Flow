import { describe, it, expect, vi } from 'vitest'
import type { Actor } from '@/lib/domain/authz'
import { manualAudienceOf, manualViewer } from '@/lib/authz/manualAccess'

const actor = (p: Partial<Actor> = {}): Actor => ({
  userId: 'u1', isSuperuser: false, workspaceRoles: new Map(), projectWorkspace: new Map(),
  projectRoles: new Map(), memberIds: new Map(), rosterTeams: new Map(), ...p,
} as Actor)

describe('manualAudienceOf', () => {
  it.each([
    ['플랫폼 관리자', actor({ isSuperuser: true }), 'platformAdmin'],
    ['워크스페이스 관리자', actor({ workspaceRoles: new Map([['w1', 'member'], ['w2', 'admin']]) as Actor['workspaceRoles'] }), 'workspaceAdmin'],
    ['프로젝트 관리자', actor({ workspaceRoles: new Map([['w1', 'member']]) as Actor['workspaceRoles'], projectRoles: new Map([['p1', 'member'], ['p2', 'admin']]) as Actor['projectRoles'] }), 'projectAdmin'],
    ['워크스페이스 관리자이면서 프로젝트 관리자', actor({ workspaceRoles: new Map([['w1', 'admin']]) as Actor['workspaceRoles'], projectRoles: new Map([['p1', 'admin']]) as Actor['projectRoles'] }), 'workspaceAdmin'],
    ['플랫폼 관리자이면서 워크스페이스 관리자', actor({ isSuperuser: true, workspaceRoles: new Map([['w1', 'admin']]) as Actor['workspaceRoles'] }), 'platformAdmin'],
    ['소속 없음', actor(), 'member'],
    ['멤버', actor({ workspaceRoles: new Map([['w1', 'member']]) as Actor['workspaceRoles'], projectRoles: new Map([['p1', 'member']]) as Actor['projectRoles'] }), 'member'],
    ['actor 없음', null, 'member'],
  ])('%s', (_n, a, want) => { expect(manualAudienceOf(a)).toBe(want) })
})

describe('manualViewer', () => {
  it('열화·actor 없음은 member + uncertain, 로그를 남긴다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(manualViewer({ actor: actor({ isSuperuser: true }), degraded: true })).toEqual({ audience: 'member', uncertain: true })
    expect(manualViewer({ actor: null, degraded: false })).toEqual({ audience: 'member', uncertain: true })
    expect(err).toHaveBeenCalledTimes(2)
    err.mockRestore()
  })
  it('정상이면 판정 그대로', () => {
    expect(manualViewer({ actor: actor({ isSuperuser: true }), degraded: false })).toEqual({ audience: 'platformAdmin', uncertain: false })
  })
  it('정상이면 로그를 남기지 않는다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    manualViewer({ actor: actor({ isSuperuser: true }), degraded: false })
    manualViewer({ actor: actor(), degraded: false })
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
