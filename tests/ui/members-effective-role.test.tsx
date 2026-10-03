
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ state: vi.fn(), roster: vi.fn(), list: vi.fn(), invites: vi.fn(), roles: vi.fn(), projects: vi.fn() }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: vi.fn(async () => {}) }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.state }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set() }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: h.roster }))
vi.mock('@/app/actions/roster', () => ({ listRoster: h.list, upsertRosterMember: vi.fn(), removeRosterMember: vi.fn() }))
vi.mock('@/app/actions/projectInvites', () => ({ listProjectInvites: h.invites }))
vi.mock('@/app/actions/project', () => ({ listProjects: h.projects }))
vi.mock('@/lib/data/workspaceRoles', () => ({ getWorkspaceRoleMap: h.roles }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('404') }, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: () => {} }))
import MembersPage from '@/app/(app)/p/[projectId]/members/page'

const P = '00000000-0000-0000-7e57-000000001870', W = '00000000-0000-0000-7e57-000000001871'
const viewer = { userId: 'me', isSuperuser: false, projectWorkspace: new Map([[P, W]]), workspaceRoles: new Map([[W, 'member']]), projectRoles: new Map([[P, 'member']]), memberIds: new Map(), rosterTeams: new Map() }
const mem = (id: string, over: object) => ({ id, projectId: P, personId: id, name: id, email: null, userId: null, kind: 'account', accessRole: 'member', roleLabel: null, title: null, active: true, sortOrder: 0, createdAt: '', teams: [], hasAccount: true, ...over })
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.state.mockResolvedValue({ actor: viewer, degraded: false }); h.projects.mockResolvedValue([{ id: P, name: 'Acme' }])
  h.roster.mockResolvedValue({ ok: true, rows: [mem('r1', { userId: 'ua' }), mem('r2', { userId: 'um' }), mem('r3', { userId: 'un', accessRole: null }), mem('r4', { kind: 'external', hasAccount: false })] })
  h.roles.mockResolvedValue({ ok: true, map: new Map([['ua', 'admin'], ['um', 'member'], ['un', 'member']]) })
})
const render = async () => renderToString(await MembersPage({ params: Promise.resolve({ projectId: P }) }))

describe('명단 실효 역할 열(P7-6.3, D37)', () => {
  it('열 머리와 행별 값 — 상속 배지는 워크스페이스 관리자에서 온 관리자에게만', async () => {
    const html = await render()
    expect(html).toContain('실효 역할')
    expect(html).toMatch(/data-effective-role="r1"[\s\S]*?관리자[\s\S]*?워크스페이스 관리자에서 상속/)
    expect(html).toMatch(/data-effective-role="r2"[^>]*>[\s\S]*?멤버/); expect(html).toMatch(/data-effective-role="r3"[^>]*>[\s\S]*?조회 전용/)
    expect((html.match(/워크스페이스 관리자에서 상속/g) ?? []).length).toBe(1)
  })
  it('워크스페이스 역할 조회 실패 — 열 전체 "확인 불가"(명단 역할로 위장하지 않는다) + 로그', async () => {
    h.roles.mockResolvedValue({ ok: false, error: 'down' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = await render()
    expect((html.match(/확인 불가/g) ?? []).length).toBe(3)                    // 계정 행 셋, 외부 인력은 명단 역할
    expect(err).toHaveBeenCalled(); err.mockRestore()
  })
  it('역할 조회는 숨김 판정 뒤(숨김 프로젝트면 부르지 않는다)', async () => {
    h.state.mockResolvedValue({ actor: { ...viewer, projectWorkspace: new Map() }, degraded: false })
    await expect(render()).rejects.toThrow('404'); expect(h.roles).not.toHaveBeenCalled()
  })
})
