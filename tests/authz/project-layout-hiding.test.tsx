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
  projectTeams: vi.fn(async () => []),
  teams: vi.fn(),
  workspaceRefById: vi.fn(),
  listMyWorkspaces: vi.fn(),
  loadShell: vi.fn(async () => ({ projects: [] })),
  minimalShell: vi.fn(() => ({ projects: [] })),
  getHiddenProjectIds: vi.fn(async (): Promise<ReadonlySet<string>> => new Set()),
}))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: mocks.getHiddenProjectIds }))
vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => 'alice') }))
// generateMetadata 는 비공개 판정 catch 에서 unstable_rethrow 를 부른다(HH3) — 원본을 두고 notFound 만 바꾼다
vi.mock('next/navigation', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/navigation')>()), notFound: mocks.notFound }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: mocks.projectTeams, workspaceTeams: vi.fn(async () => []) }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: mocks.workspaceRefById }))
vi.mock('@/lib/workspace/list', () => ({ listMyWorkspaces: mocks.listMyWorkspaces }))
vi.mock('@/lib/shell/loadShell', () => ({ loadShell: mocks.loadShell, minimalShell: mocks.minimalShell }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('@/components/app/TeamsProvider', () => ({ TeamsProvider: ({ teams, children }: { teams: unknown; children: ReactNode }) => { mocks.teams(teams); return children } }))
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <div data-shell>{children}</div> }))
vi.mock('@/components/app/ShellScope', () => ({ ShellScope: () => null }))

import ProjectLayout, { generateMetadata } from '@/app/(app)/p/[projectId]/layout'
import { canSeeProject, type Actor } from '@/lib/domain/authz'

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
    expect(mocks.projectTeams).not.toHaveBeenCalled()
    for (const c of mocks.teams.mock.calls) expect(c[0]).toEqual([])
  })
  it('볼 수 있는 프로젝트면 그 프로젝트의 활성 팀을 내린다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    await render('p1')
    expect(mocks.projectTeams).toHaveBeenCalledWith('p1')
  })
  it('비로그인(actor null, 정상 조회)은 404 — 판정 대상이 없다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    await expect(render('p1')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

// GG1(UI-2b 최종 보안 리뷰 P2-2) — 비공개 숨김의 판정자는 하나다: 프로젝트 화면도 canSeeProject(명단 밖 비공개 → 숨김)를 따른다.
// 숨김 집합은 getHiddenProjectIds 의 정본 규칙(비공개 ∧ canSeeProject 거짓)으로 흉내 낸다. 판정 실패는 404 가 아니라 오류(범위 오류 경계).
describe('ProjectLayout — 명단 밖 비공개 프로젝트(GG1)', () => {
  const PRIV = 'p-priv'
  const as = (actor: Actor | null, degraded = false) => {
    mocks.getActorViewState.mockResolvedValue({ actor, degraded })
    mocks.getHiddenProjectIds.mockResolvedValue(new Set([PRIV].filter((id) => !canSeeProject(actor, { id, is_private: true }))))
  }
  const inWs = { projectWorkspace: new Map([[PRIV, WS]]) }
  it('같은 워크스페이스의 명단 밖 멤버는 404 — 셸 데이터를 조회하지 않는다', async () => {
    as(makeActor(inWs))
    await expect(render(PRIV)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.workspaceRefById).not.toHaveBeenCalled(); expect(mocks.loadShell).not.toHaveBeenCalled(); expect(mocks.projectTeams).not.toHaveBeenCalled()
  })
  // HH5(GG 재리뷰 P3-5) — '명단 밖'의 실제 경계는 access_role 이다: 명단 행(memberIds)이 있어도 access_role 이 null 이면 buildActor 가
  // projectRoles 에 싣지 않으므로 canSeeProject 거짓 → 404. 정본(회의록·위키·AI·포털 목록)과 같은 축이다
  it('명단 행은 있지만 access_role 이 null 인 사람도 404 — 명단 권한 없는 사람은 명단 밖과 같다', async () => {
    as(makeActor({ ...inWs, memberIds: new Map([[PRIV, 'm-priv']]) }))
    await expect(render(PRIV)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.loadShell).not.toHaveBeenCalled()
  })
  it('명단 멤버·워크스페이스 관리자·플랫폼 관리자는 통과한다', async () => {
    for (const actor of [
      makeMemberActor(PRIV),
      makeActor({ ...inWs, workspaceRoles: new Map([[WS, 'admin']]) }),
      makeSuperuser({ workspaceRoles: new Map(), ...inWs }),
    ]) {
      vi.clearAllMocks(); as(actor)
      expect(await render(PRIV)).toContain('page')
      expect(mocks.notFound).not.toHaveBeenCalled()
    }
  })
  it('비공개 판정이 실패하면 404 로 위장하지 않고 던진다(오류 경계) — 셸 데이터도 조회하지 않는다', async () => {
    as(makeMemberActor(PRIV))
    mocks.getHiddenProjectIds.mockRejectedValue(new Error('비공개 프로젝트 판정을 하지 못했습니다'))
    await expect(render(PRIV)).rejects.toThrow('비공개 프로젝트 판정을 하지 못했습니다')
    expect(mocks.notFound).not.toHaveBeenCalled(); expect(mocks.loadShell).not.toHaveBeenCalled()
  })
  it('권한 조회 실패(degraded)에 비공개 프로젝트면 명단을 모른다 — 404 도 최소 셸도 아닌 오류(fail-closed)', async () => {
    as(null, true)
    await expect(render(PRIV)).rejects.toThrow()
    expect(mocks.notFound).not.toHaveBeenCalled(); expect(mocks.minimalShell).not.toHaveBeenCalled(); expect(mocks.loadShell).not.toHaveBeenCalled()
  })
  it('degraded 라도 비공개가 아니면 종전대로 최소 셸', async () => {
    as(null, true)
    expect(await render('p1')).toContain('page')
    expect(mocks.minimalShell).toHaveBeenCalledWith(expect.objectContaining({ degraded: true }))
  })
})

// HH3(GG 재리뷰 P3-3) — 아이콘 메타데이터의 비공개 판정 실패는 아이콘 없음이지만 로그 없이 삼키지 않고, Next 제어 신호는 다시 던진다
describe('ProjectLayout generateMetadata — 비공개 판정 실패', () => {
  const meta = () => generateMetadata({ params: Promise.resolve({ projectId: 'p1' }) })
  it('판정 실패는 아이콘 없음({}) + 로그', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    mocks.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await meta()).toEqual({})
    expect(err.mock.calls.some((c) => String(c[0]).includes('[project layout]'))).toBe(true)
    err.mockRestore()
  })
  it('Next 제어 신호(동적 사용)는 삼키지 않고 다시 던진다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    const signal = Object.assign(new Error('signal'), { digest: 'DYNAMIC_SERVER_USAGE' })
    mocks.getHiddenProjectIds.mockRejectedValue(signal)
    await expect(meta()).rejects.toBe(signal)
  })
})
