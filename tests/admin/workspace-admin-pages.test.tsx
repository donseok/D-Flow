import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(), listProjects: vi.fn(), listAccounts: vi.fn(), listTeamsAdmin: vi.fn<(w: string) => Promise<{ ok: boolean; rows: unknown[] }>>(async () => ({ ok: true, rows: [] })), managerProps: vi.fn(),
  redirect: vi.fn((u: string) => { throw new Error(`NEXT_REDIRECT:${u}`) }), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/app/actions/project', () => ({ listProjects: h.listProjects }))
vi.mock('@/app/actions/accounts', () => ({ listAccounts: h.listAccounts }))
vi.mock('@/app/actions/teams', () => ({ listTeamsAdmin: h.listTeamsAdmin }))
vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: h.notFound }))
vi.mock('@/components/admin/AccountsManager', () => ({ AccountsManager: (p: unknown) => { h.managerProps(p); return null } }))
vi.mock('@/components/admin/TeamsManager', () => ({ TeamsManager: () => null }))

import AccountsPage from '@/app/(app)/w/[slug]/admin/accounts/page'
import TeamsPage from '@/app/(app)/w/[slug]/admin/teams/page'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-0000000016c5', slug: 'acme', name: 'Acme' }
const P1 = '00000000-0000-0000-7e57-0000000016c6', PB = '00000000-0000-0000-7e57-0000000016c7'
const wsAdmin = makeActor({ workspaceRoles: new Map([[WS.id, 'admin']]), projectWorkspace: new Map([[P1, WS.id], [PB, 'ws-b']]) })
const scopeOf = (actor: unknown) => ({ ws: WS, actor, degraded: false, role: 'admin' })
const accounts = (q: Record<string, string> = {}) => AccountsPage({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve(q) })
// 페이지는 요소를 돌려줄 뿐이다 — 관리자 컴포넌트의 props 는 렌더해야 기록된다
const renderAccounts = async (q: Record<string, string> = {}) => renderToString(await accounts(q))

beforeEach(() => {
  vi.clearAllMocks()
  h.listProjects.mockResolvedValue([{ id: P1, name: 'Apollo', workspace_id: WS.id }, { id: PB, name: 'Other', workspace_id: 'ws-b' }])
  h.listAccounts.mockResolvedValue({ ok: true, rows: [], workspaceId: WS.id })
})

describe('/w/[slug]/admin/accounts — 슬러그 워크스페이스 관리자(D22)', () => {
  it('워크스페이스 관리자가 연다 — 후보는 그 워크스페이스 프로젝트만, 플랫폼 조작은 렌더하지 않는다', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(wsAdmin))
    await renderAccounts({ project: PB })
    expect(h.listAccounts).toHaveBeenCalledWith(P1)               // 다른 워크스페이스 pid 는 후보가 아니다(W11)
    expect(h.managerProps).toHaveBeenCalledWith(expect.objectContaining({ projects: [{ id: P1, name: 'Apollo' }], canPlatformOps: false }))
  })
  it('플랫폼 관리자에게만 플랫폼 조작', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(makeSuperuser({ projectWorkspace: new Map([[P1, WS.id]]) })))
    await renderAccounts()
    expect(h.managerProps).toHaveBeenCalledWith(expect.objectContaining({ canPlatformOps: true }))
  })
  it('플랫폼 관리자도 ?project= 로 다른 워크스페이스 프로젝트를 이 주소에서 고를 수 없다(W11)', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(makeSuperuser({ projectWorkspace: new Map([[P1, WS.id], [PB, 'ws-b']]) })))
    await accounts({ project: PB })
    expect(h.listAccounts).toHaveBeenCalledWith(P1)
    expect(h.listAccounts).not.toHaveBeenCalledWith(PB)
  })
  it('멤버 → /w/acme, 응답의 워크스페이스가 다르면 404, 관리할 프로젝트 0 → 빈 상태', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) })))
    await expect(accounts()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(wsAdmin))
    h.listAccounts.mockResolvedValue({ ok: true, rows: [], workspaceId: 'ws-b' })
    await expect(accounts()).rejects.toThrow('NEXT_NOT_FOUND')
    h.listProjects.mockResolvedValue([])
    expect(renderToString(await accounts())).toContain('관리할 프로젝트가 없습니다')
  })
  it('열화(actor null)는 그 워크스페이스 홈 — 명단 로더를 부르지 않는다(fail-closed)', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    await expect(accounts()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
    expect(h.listProjects).not.toHaveBeenCalled()
    expect(h.listAccounts).not.toHaveBeenCalled()
  })
})

describe('/w/[slug]/admin/teams', () => {
  it('워크스페이스 관리자 — 슬러그 워크스페이스의 공용 팀', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(wsAdmin))
    await TeamsPage({ params: Promise.resolve({ slug: 'acme' }) })
    expect(h.listTeamsAdmin).toHaveBeenCalledWith(WS.id)
  })
  it('멤버 → /w/acme', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) })))
    await expect(TeamsPage({ params: Promise.resolve({ slug: 'acme' }) })).rejects.toThrow('NEXT_REDIRECT:/w/acme')
    expect(h.listTeamsAdmin).not.toHaveBeenCalled()
  })
  it('다른 워크스페이스의 관리자는 이 워크스페이스 팀을 열지 못한다', async () => {
    h.loadWorkspaceScope.mockResolvedValue(scopeOf(makeActor({ workspaceRoles: new Map([[WS.id, 'member'], ['ws-b', 'admin']]) })))
    await expect(TeamsPage({ params: Promise.resolve({ slug: 'acme' }) })).rejects.toThrow('NEXT_REDIRECT:/w/acme')
    expect(h.listTeamsAdmin).not.toHaveBeenCalled()
  })
})
