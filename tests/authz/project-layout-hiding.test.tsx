import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { makeActor, makeMemberActor, makeSuperuser, WS } from '../fixtures/actor'

// 스펙 §3.2 — /p/[projectId] 레이아웃은 isHiddenProject(타 워크스페이스·미존재, 플랫폼 관리자의 미존재 pid 포함)면 404.
// 권한 조회 실패(degraded)는 404 가 아니다 — 장애를 '없는 프로젝트'로 위장하지 않고 최소 셸(열화 표시)로 그린다.
// 셸 전환(과제 31) 뒤: 숨김이면 셸 데이터(워크스페이스 이름·프로젝트 목록·브랜드)도 싣지 않는다 — loadShell·workspaceRefById 를 부르지 않는다(존재 은닉).
const mocks = vi.hoisted(() => ({
  getActorViewState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  teamsForProjectSync: vi.fn(() => []),
  teams: vi.fn(),
  workspaceRefById: vi.fn(),
  listMyWorkspaces: vi.fn(),
  loadShell: vi.fn(async () => ({ projects: [] })),
  minimalShell: vi.fn(() => ({ projects: [] })),
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => 'alice') }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/lib/teams/master', () => ({ teamsForProjectSync: mocks.teamsForProjectSync }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: mocks.workspaceRefById }))
vi.mock('@/lib/workspace/list', () => ({ listMyWorkspaces: mocks.listMyWorkspaces }))
vi.mock('@/lib/shell/loadShell', () => ({ loadShell: mocks.loadShell, minimalShell: mocks.minimalShell }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('@/components/app/TeamsProvider', () => ({ TeamsProvider: ({ teams, children }: { teams: unknown; children: ReactNode }) => { mocks.teams(teams); return children } }))
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <div data-shell>{children}</div> }))
vi.mock('@/components/app/ShellScope', () => ({ ShellScope: () => null }))

import ProjectLayout from '@/app/(app)/p/[projectId]/layout'

const render = async (projectId: string) => renderToString(await ProjectLayout({ children: 'page', params: Promise.resolve({ projectId }) }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: WS, slug: 'acme', name: 'Acme' } })
  mocks.listMyWorkspaces.mockResolvedValue({ ok: true, rows: [] })
})

describe('ProjectLayout — 존재 은닉(notFound)', () => {
  it('명단 멤버는 통과한다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    expect(await render('p1')).toContain('page')
    expect(mocks.notFound).not.toHaveBeenCalled(); expect(mocks.loadShell).toHaveBeenCalled()
  })
  it('같은 워크스페이스의 명단 없는 사람(viewer)도 통과한다 — 조회 전용은 404 가 아니다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeActor({ projectWorkspace: new Map([['p1', WS]]) }), degraded: false })
    expect(await render('p1')).toContain('page')
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('타 워크스페이스·미존재 프로젝트는 404 — 셸 조회(워크스페이스·목록)를 하지 않는다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    await expect(render('p-elsewhere')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
    expect(mocks.workspaceRefById).not.toHaveBeenCalled(); expect(mocks.loadShell).not.toHaveBeenCalled(); expect(mocks.minimalShell).not.toHaveBeenCalled()
  })
  it('플랫폼 관리자는 워크스페이스 소속 없이도 있는 프로젝트를 통과한다', async () => {
    mocks.getActorViewState.mockResolvedValue({
      actor: makeSuperuser({ workspaceRoles: new Map(), projectWorkspace: new Map([['p-any', 'ws-other']]) }), degraded: false,
    })
    mocks.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: 'ws-other', slug: 'other', name: 'Other' } })
    expect(await render('p-any')).toContain('page')
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.loadShell).toHaveBeenCalledWith(expect.objectContaining({ viewingAsPlatformAdmin: true }))
  })
  it('플랫폼 관리자라도 없는 프로젝트는 404 — 빈 화면이 아니다(T11 C3)', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ projectWorkspace: new Map([['p1', WS]]) }), degraded: false })
    await expect(render('00000000-0000-0000-0000-000000000000')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })
  it('권한 조회 실패(degraded)는 404 가 아니라 최소 셸(열화 표시)', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    expect(await render('p1')).toContain('page')
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.minimalShell).toHaveBeenCalledWith(expect.objectContaining({ degraded: true })); expect(mocks.loadShell).not.toHaveBeenCalled()
  })
  it('degraded 면 가시성을 모르므로 service_role 팀 캐시를 읽지 않는다(SP2 16b)', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    await render('p-elsewhere')
    expect(mocks.teamsForProjectSync).not.toHaveBeenCalled()
    for (const c of mocks.teams.mock.calls) expect(c[0]).toEqual([])
  })
  it('볼 수 있는 프로젝트면 그 프로젝트의 활성 팀을 내린다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    await render('p1')
    expect(mocks.teamsForProjectSync).toHaveBeenCalledWith('p1')
  })
  it('비로그인(actor null, 정상 조회)은 404 — 판정 대상이 없다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    await expect(render('p1')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
