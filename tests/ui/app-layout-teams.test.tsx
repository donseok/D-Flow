import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Team } from '@/lib/domain/teams'
import { makeActor, makeSuperuser } from '../fixtures/actor'

// SP2 Task 16b — 앱 레이아웃의 TeamsProvider 는 모든 로그인 사용자에게 내려간다. 종전(teamsSync)엔 전 워크스페이스의
// 공용 팀을 실어 다른 워크스페이스의 팀 코드가 회의록 탭·필터로 흘렀다. 이제 actor 가 속한 워크스페이스들의 활성 공용
// 팀만 내린다(플랫폼 관리자도 자기 소속으로 한정 — 표시 목적). degraded(actor null)면 빈 목록이다.
const TEAMS = vi.hoisted((): Team[] => {
  const t = (code: string, workspaceId: string, projectId: string | null = null, active = true): Team =>
    ({ id: `${workspaceId}-${code}`, code, name: code, color: '#6b7280', sortOrder: 0, active, progressVisible: true, projectId, workspaceId })
  return [t('PMO', 'ws-a'), t('휴면', 'ws-a', null, false), t('A전용', 'ws-a', 'pa'), t('ERP', 'ws-b')]
})
const mocks = vi.hoisted(() => ({
  state: { actor: null as unknown, degraded: false },
  activeTeamsForWorkspacesSync: vi.fn(),
  pass: ({ children }: { children?: ReactNode }) => children,
}))
vi.mock('@/lib/teams/master', () => ({ activeTeamsForWorkspacesSync: mocks.activeTeamsForWorkspacesSync }))
vi.mock('@/lib/authz', () => ({ getActorViewState: vi.fn(async () => mocks.state) }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => 'alice') }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: vi.fn(async () => ({ projects: [], degraded: false })) }))
vi.mock('@/app/actions/preferences', () => ({ getUiPrefs: vi.fn(async () => ({ lastProjectId: null })) }))
vi.mock('@/lib/data/wbs', () => ({ getProjectsCompletion: vi.fn(async () => ({})) }))
vi.mock('@/components/app/TeamsProvider', () => ({ TeamsProvider: mocks.pass }))
vi.mock('@/components/app/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('@/components/app/HeaderChrome', () => ({ HeaderChrome: () => null }))
vi.mock('@/components/app/DegradedNotice', () => ({ DegradedNotice: () => null }))
vi.mock('@/components/app/ProjectNavigationContext', () => ({ ProjectNavigationProvider: mocks.pass }))
vi.mock('@/components/app/PrefsSync', () => ({ PrefsSync: () => null }))
vi.mock('@/components/app/ShellStateProvider', () => ({ ShellStateProvider: mocks.pass }))
vi.mock('@/components/app/UsageTracker', () => ({ UsageTracker: () => null }))
vi.mock('@/components/chat/AssistantChat', () => ({ AssistantChat: () => null }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ BotPageContextProvider: mocks.pass }))

import AppLayout from '@/app/(app)/layout'
import { activeTeamsForWorkspaces } from '@/lib/domain/teams'

/** 레이아웃이 TeamsProvider 에 넘긴 팀 — 최상위 엘리먼트가 TeamsProvider 다. */
const providedTeams = async () =>
  ((await AppLayout({ children: 'page' })) as { props: { teams: Team[] } }).props.teams

beforeEach(() => {
  vi.clearAllMocks()
  mocks.activeTeamsForWorkspacesSync.mockImplementation((ws: Iterable<string>) => activeTeamsForWorkspaces(TEAMS, ws))
})

describe('앱 레이아웃 TeamsProvider — actor 소속 워크스페이스의 활성 공용 팀만', () => {
  it('워크스페이스 멤버: 그 워크스페이스의 활성 공용 팀만 — 다른 워크스페이스·프로젝트 전용·비활성 팀은 없다', async () => {
    mocks.state = { actor: makeActor({ workspaceRoles: new Map([['ws-a', 'member']]) }), degraded: false }
    expect((await providedTeams()).map(t => `${t.workspaceId}:${t.code}`)).toEqual(['ws-a:PMO'])
  })

  it('플랫폼 관리자도 자기 소속 워크스페이스로 한정한다(표시 목적 — 전 워크스페이스 팀을 한 탭 목록에 섞지 않는다)', async () => {
    mocks.state = { actor: makeSuperuser({ workspaceRoles: new Map([['ws-b', 'admin']]) }), degraded: false }
    expect((await providedTeams()).map(t => t.code)).toEqual(['ERP'])
  })

  it('degraded(actor null)면 빈 목록 — 팀 캐시를 읽지 않는다', async () => {
    mocks.state = { actor: null, degraded: true }
    expect(await providedTeams()).toEqual([])
    expect(mocks.activeTeamsForWorkspacesSync).not.toHaveBeenCalled()
  })

  it('팀 캐시를 한 번도 못 채웠으면 로그를 남기고 팀 없이 그린다 — 루트 레이아웃이 throw 하면 앱 전 화면이 에러가 된다', async () => {
    mocks.state = { actor: makeActor({ workspaceRoles: new Map([['ws-a', 'member']]) }), degraded: false }
    mocks.activeTeamsForWorkspacesSync.mockImplementation(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await providedTeams()).toEqual([])
    expect(err).toHaveBeenCalledWith(expect.stringContaining('팀 마스터 조회 실패'), expect.stringContaining('팀 마스터'))
    err.mockRestore()
  })
})
