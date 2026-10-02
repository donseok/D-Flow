import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import type { Team } from '@/lib/domain/teams'
import type { ConfigArea, ConfigTeam } from '@/lib/settings/projectConfig'

// 설정 화면의 팀 절·업무영역 편집기는 요청 범위 팀 원천(src/lib/teams/source.ts — 스펙 §4.2.1·D19)을 쓴다. "상속할 공용 팀이 있는가"
// (hasGlobalTeams)는 그 프로젝트 워크스페이스의 공용 팀으로 본다(SP2 Task 16b — 다른 워크스페이스의 팀은 판정에 들어오지 않는다).
// 조회 실패는 빈 목록으로 위장하지 않는다(에러 3원칙 ①).
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  ProjectTeamsManager: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  ProjectAreasManager: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  ReindexButton: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn(async () => makeAdminActor('p1')), getActorViewState: async () => ({ actor: makeAdminActor('p1'), degraded: false }) }))
// GG1 — 프로젝트 페이지 관문(requireModulePage)이 화면 숨김을 다시 판정한다(getActorViewState + 비공개 숨김 집합). 이 파일은 비공개를 다루지 않는다 — 빈 집합
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]),
}))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: vi.fn(async () => ({ ok: true, rows: [], nextBefore: null })) }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: (...a: unknown[]) => mocks.config(...a) }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: vi.fn(async () => ({ keys: { 'modules.allowed': { status: 'set', value: ['agents'] } } })) }))
vi.mock('@/lib/settings/workspaceLinks', () => ({ manageableWorkspaceLinks: vi.fn(async () => []) }))
vi.mock('@/components/settings/ModuleToggleEditor', () => ({ ModuleToggleEditor: () => null }))
vi.mock('@/lib/ai/health', () => ({ assistantIndexStatus: vi.fn(async () => ({ freshness: 'disabled', indexed: 0 })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
// actions 도 그린다 — 재색인 버튼·권한 배지가 카드 머리(actions)에 있다.
vi.mock('@/components/ui/SectionCard', () => ({
  SectionCard: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <>{actions}{children}</>,
}))
vi.mock('@/components/ui/PageHero', () => ({ PageHero: () => null, HeroBadge: () => null }))
vi.mock('@/components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('@/components/settings/ProjectTeamsManager', () => ({ ProjectTeamsManager: mocks.ProjectTeamsManager }))
vi.mock('@/components/settings/ProjectAreasManager', () => ({ ProjectAreasManager: mocks.ProjectAreasManager }))
vi.mock('@/components/settings/LevelSettingsManager', () => ({ LevelSettingsManager: () => null }))
vi.mock('@/components/settings/MilestoneKeywordsEditor', () => ({ MilestoneKeywordsEditor: () => null }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: () => null }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: () => null }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: mocks.ReindexButton }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: () => null }))

import { TeamsUnavailableError, projectOwnTeams, projectTeams, workspaceTeams } from '@/lib/teams/source'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () =>
  renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
const team = (id: string, code: string, over: Partial<Team> = {}): Team => ({
  id, code, name: code, color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId: null, workspaceId: 'ws-1', ...over,
})
const cfgTeam = (id: string, code: string, over: Partial<ConfigTeam> = {}): ConfigTeam => ({
  id, code, name: code, sortOrder: 0, active: true, color: '#6b7280', progressVisible: true, projectId: null, ...over,
})
const AREA: ConfigArea = {
  id: 'a-exp', kind: 'weekly_section', code: 'EXP', name: '실험', sortOrder: 0, active: true,
  teams: [{ teamId: 't-res', kind: 'primary' }, { teamId: 't-old', kind: 'support' }],
}
const ERR_TEAMS_UI = '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.config.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['P'] }, {
    projectId: 'p1', workspaceId: 'ws-1', areas: { weekly_section: [AREA], issue_area: [] },
    teams: [cfgTeam('t-res', 'RES'), cfgTeam('t-old', 'OLD', { active: false })],
  }))
  vi.mocked(projectOwnTeams).mockResolvedValue([])
  vi.mocked(projectTeams).mockResolvedValue([team('t-res', 'RES')])
  vi.mocked(workspaceTeams).mockResolvedValue([team('t-res', 'RES')])
})

describe('설정 화면 — 팀 절은 요청 범위 팀 원천(스펙 §4.2.1·D19)', () => {
  it('hasGlobalTeams 는 그 프로젝트 워크스페이스의 활성 공용 팀 — 전용 팀 0개면 상속', async () => {
    await render()
    expect(workspaceTeams).toHaveBeenCalledWith('ws-1')
    expect(projectOwnTeams).toHaveBeenCalledWith('p1')
    expect(mocks.ProjectTeamsManager.mock.calls.at(-1)![0]).toMatchObject({ projectId: 'p1', teams: [], hasGlobalTeams: true, inherited: true })
  })
  it('그 워크스페이스의 공용 팀이 비활성뿐이면 false', async () => {
    vi.mocked(workspaceTeams).mockResolvedValue([team('t-idle', 'IDLE', { active: false })])
    await render()
    expect(mocks.ProjectTeamsManager.mock.calls.at(-1)![0]).toMatchObject({ hasGlobalTeams: false })
  })
  it('전용 팀이 있으면 그 목록(비활성 포함)을 넘기고 상속이 아니다', async () => {
    vi.mocked(projectOwnTeams).mockResolvedValue([
      team('t-civ', 'CIV', { projectId: 'p1', sortOrder: 1 }), team('t-saf', 'SAF', { projectId: 'p1', active: false }),
    ])
    await render()
    expect(mocks.ProjectTeamsManager.mock.calls.at(-1)![0]).toMatchObject({
      inherited: false,
      teams: [
        { id: 't-civ', code: 'CIV', sortOrder: 1, active: true, progressVisible: true },
        { id: 't-saf', code: 'SAF', sortOrder: 0, active: false, progressVisible: true },
      ],
    })
  })
  it('팀 원천 조회가 실패하면 빈 목록으로 그리지 않는다 — 팀 절·업무영역 편집기 대신 안내, 원문 없음', async () => {
    vi.mocked(projectOwnTeams).mockRejectedValue(new TeamsUnavailableError('프로젝트 팀을 불러오지 못했습니다: db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = await render()
    expect(mocks.ProjectTeamsManager).not.toHaveBeenCalled()
    expect(mocks.ProjectAreasManager).not.toHaveBeenCalled()
    expect(html.split(ERR_TEAMS_UI).length - 1).toBe(2)   // 팀 절·업무영역 카드
    expect(html).not.toContain('db down')
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('설정 페이지는 옛 프로세스 전역 팀 캐시를 import 하지 않는다', () => {
    const src = readFileSync('src/app/(app)/p/[projectId]/settings/page.tsx', 'utf8')
    expect(src).not.toMatch(/teams\/master/)
    expect(src).toMatch(/from '@\/lib\/teams\/source'/)
  })
})

describe('설정 화면 — 업무영역 편집기(스펙 §4.1.8·D26)', () => {
  it('kind 고정·해석기의 주간 영역·팀 선택지(프로젝트 팀 + 배정된 목록 밖 팀은 비활성)를 넘긴다', async () => {
    vi.mocked(projectTeams).mockResolvedValue([team('t-res', 'RES'), team('t-arc', 'ARC', { active: false })])
    await render()
    expect(mocks.ProjectAreasManager).toHaveBeenCalledTimes(1)
    expect(mocks.ProjectAreasManager.mock.calls[0][0]).toEqual({
      projectId: 'p1', kind: 'weekly_section', areas: [AREA],
      teamOptions: [{ id: 't-res', code: 'RES', active: true }, { id: 't-arc', code: 'ARC', active: false }, { id: 't-old', code: 'OLD', active: false }],
    })
  })
  it('설정 조회가 실패하면 편집기를 그리지 않는다 — 머리의 오류 상태 하나로 갈음하고, 팀 절은 안내를 보인다', async () => {
    mocks.config.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = await render()
    expect(mocks.ProjectAreasManager).not.toHaveBeenCalled()
    expect(mocks.ProjectTeamsManager).not.toHaveBeenCalled()
    expect(html).toContain(ERR_TEAMS_UI)
    expect(html).not.toContain('db down')
    err.mockRestore()
  })
})

// 재색인 서버 가드는 requireProjectAdmin 이다(actions/chat.ts, api/chat/reindex/route.ts) — 버튼도 같은 등급에게 보인다.
// 옛 화면은 슈퍼유저에게만 버튼을 주고 프로젝트 관리자에게는 'PMO 관리자 전용' 배지를 그렸다(후보 4·DC-09).
describe('설정 화면 — 재색인 버튼은 프로젝트 관리자에게(서버 가드와 같은 등급)', () => {
  it('슈퍼유저가 아닌 프로젝트 관리자에게 재색인 버튼을 그리고, PMO 역할 문구가 없다', async () => {
    const html = await render()
    expect(mocks.ReindexButton).toHaveBeenCalled()
    expect(mocks.ReindexButton.mock.calls.at(-1)![0]).toMatchObject({ projectId: 'p1' })
    expect(html).not.toContain('PMO')
  })
})
