import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeActor, makeAdminActor, WS } from '../fixtures/actor'

// 존재 은닉과 팀 후보(SP2 T15 리뷰 Critical). 레이아웃과 페이지는 병렬로 렌더돼 레이아웃의 notFound 가
// 이 페이지를 멈추지 않는다. 타 워크스페이스 사용자의 세션 명단 조회는 RLS 로 0행(ok)이라, 페이지가 게이트 없이
// 팀 후보(projectTeams — SP4 B 뒤 요청 범위 원천)를 읽으면 그 팀 id·코드가 404 digest 옆 RSC 페이로드로 나갈 수 있다 — 게이트 뒤에서만 읽는다.
const TEAM = { id: 'team-a', code: 'ERP', active: true, sortOrder: 0, progressVisible: true, projectId: 'p1', workspaceId: WS }
const mocks = vi.hoisted(() => ({
  state: { actor: null as unknown, degraded: false },
  projectTeams: vi.fn(),
  getProjectRoster: vi.fn(),
  listRoster: vi.fn(),
  RosterManager: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  hidden: new Set<string>() as ReadonlySet<string>,
}))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: vi.fn(async () => mocks.hidden) }))
vi.mock('@/lib/authz', () => ({
  getActorViewState: vi.fn(async () => mocks.state),
  getActorForView: vi.fn(async () => mocks.state.actor),
}))
vi.mock('@/lib/teams/source', () => ({ projectTeams: mocks.projectTeams }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster }))
vi.mock('@/app/actions/roster', () => ({ listRoster: mocks.listRoster }))
// 초대 허용 도메인 사전 안내(워크스페이스 설정 조회)는 이 파일의 관심사가 아니다 — 안내 없이 그린다
vi.mock('@/lib/data/inviteDomainNotice', () => ({ loadInviteDomainNotice: vi.fn(async () => null) }))
vi.mock('@/app/actions/projectInvites', () => ({ listProjectInvites: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => []) }))
// 초대 칸의 tz = 프로젝트 달력(SP5 과제 21) — 해석기만 바꿔 끼운다
vi.mock('@/lib/settings/pageConfig', async () => {
  const { calSeoulMon } = await import('../helpers/calendarFixture')
  return { loadProjectConfigForPage: vi.fn(async () => ({ ok: true, cfg: { calendar: calSeoulMon, calendarError: null } })) }
})
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/roster/RosterManager', () => ({ RosterManager: mocks.RosterManager }))
vi.mock('@/components/settings/ProjectInviteManager', () => ({ ProjectInviteManager: () => null }))

import MembersPage from '@/app/(app)/p/[projectId]/members/page'

const render = async () =>
  renderToStaticMarkup((await MembersPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.hidden = new Set()
  mocks.projectTeams.mockResolvedValue([TEAM])
  mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [] })   // RLS — 타 워크스페이스 명단은 0행으로 읽힌다
  mocks.listRoster.mockResolvedValue({ ok: true, rows: [] })
})

describe('members 페이지 — 숨은 프로젝트에서 service_role 팀 캐시를 읽지 않는다', () => {
  it('타 워크스페이스 사용자: 404 이고, 팀 캐시를 읽지 않으며 클라이언트로 팀 후보가 나가지 않는다', async () => {
    mocks.state = { actor: makeActor(), degraded: false }   // 기본 fixture — p1 을 모른다(roleIn null)
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.projectTeams).not.toHaveBeenCalled()
    expect(mocks.RosterManager).not.toHaveBeenCalled()
  })
  it('권한 조회 실패(degraded): 404 로 위장하지 않되, 가시성을 모르므로 팀 캐시는 읽지 않는다(fail-closed)', async () => {
    mocks.state = { actor: null, degraded: true }
    await render()
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.projectTeams).not.toHaveBeenCalled()
    expect(mocks.RosterManager.mock.calls.at(-1)![0].teamOptions).toEqual([])
  })
  it('같은 워크스페이스의 조회 전용: 읽기 전용 표에는 팀 후보가 필요 없다 — 캐시를 읽지 않는다', async () => {
    mocks.state = { actor: makeActor({ projectWorkspace: new Map([['p1', WS]]) }), degraded: false }
    await render()
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.projectTeams).not.toHaveBeenCalled()
    expect(mocks.RosterManager.mock.calls.at(-1)![0]).toMatchObject({ canEdit: false, teamOptions: [] })
  })
  it('관리자: 편집에 쓰는 팀 후보를 받는다', async () => {
    mocks.state = { actor: makeAdminActor('p1'), degraded: false }
    await render()
    expect(mocks.projectTeams).toHaveBeenCalledWith('p1')
    expect(mocks.RosterManager.mock.calls.at(-1)![0]).toMatchObject({ canEdit: true, teamOptions: [{ id: 'team-a', code: 'ERP' }] })
  })
})

// GG1 — 명단 밖 비공개 프로젝트도 레이아웃과 같은 판정자로 페이지가 다시 끊는다(팀 캐시·명단 표 전에)
describe('members 페이지 — 명단 밖 비공개 프로젝트(GG1)', () => {
  it('같은 워크스페이스의 명단 밖 멤버: 404 이고 명단·팀 캐시를 읽지 않는다', async () => {
    mocks.state = { actor: makeActor({ projectWorkspace: new Map([['p1', WS]]) }), degraded: false }
    mocks.hidden = new Set(['p1'])
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.getProjectRoster).not.toHaveBeenCalled(); expect(mocks.projectTeams).not.toHaveBeenCalled()
  })
  it('degraded 에 비공개면 404 로 위장하지 않고 던진다', async () => {
    mocks.state = { actor: null, degraded: true }
    mocks.hidden = new Set(['p1'])
    await expect(render()).rejects.toThrow()
    expect(mocks.notFound).not.toHaveBeenCalled(); expect(mocks.RosterManager).not.toHaveBeenCalled()
  })
})
