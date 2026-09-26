import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor } from '../fixtures/actor'

// SP2 Task 16b — 설정 화면 팀 관리 절의 "상속할 공용 팀이 있는가"(hasGlobalTeams)는 그 프로젝트 워크스페이스의 공용 팀으로 본다.
// 옛 판정(teamsSync)은 전 워크스페이스의 공용 팀이라, 내 워크스페이스에 공용 팀이 없어도 남의 팀 때문에 '공용 팀 복사'가 켜졌다.
const mocks = vi.hoisted(() => ({
  workspaceTeamsForProjectSync: vi.fn(),
  ProjectTeamsManager: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  ReindexButton: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))
vi.mock('@/lib/teams/master', () => ({
  projectTeamRowsSync: vi.fn(() => []),
  teamsForProjectSync: vi.fn(() => []),
  workspaceTeamsForProjectSync: mocks.workspaceTeamsForProjectSync,
}))
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn(async () => makeAdminActor('p1')) }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]),
}))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: vi.fn(async () => null) }))
vi.mock('@/app/actions/projectAreas', () => ({ listAreas: vi.fn(async () => ({ ok: true, rows: [] })) }))
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
vi.mock('@/components/settings/ProjectAreasManager', () => ({ ProjectAreasManager: () => null }))
vi.mock('@/components/settings/LevelSettingsManager', () => ({ LevelSettingsManager: () => null }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: () => null }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: () => null }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: mocks.ReindexButton }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: () => null }))

import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () =>
  renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
const team = (code: string, active: boolean) =>
  ({ id: `t-${code}`, code, sortOrder: 0, active, progressVisible: true, projectId: null, workspaceId: 'ws-1' })

beforeEach(() => { vi.clearAllMocks() })

describe('설정 화면 — hasGlobalTeams 는 그 프로젝트 워크스페이스의 공용 팀', () => {
  it('그 워크스페이스에 활성 공용 팀이 있으면 true', async () => {
    mocks.workspaceTeamsForProjectSync.mockReturnValue([team('PMO', true)])
    await render()
    expect(mocks.workspaceTeamsForProjectSync).toHaveBeenCalledWith('p1')
    expect(mocks.ProjectTeamsManager.mock.calls.at(-1)![0]).toMatchObject({ hasGlobalTeams: true, inherited: true })
  })
  it('그 워크스페이스의 공용 팀이 비활성뿐이면 false — 다른 워크스페이스의 팀은 판정에 들어오지 않는다', async () => {
    mocks.workspaceTeamsForProjectSync.mockReturnValue([team('휴면', false)])
    await render()
    expect(mocks.ProjectTeamsManager.mock.calls.at(-1)![0]).toMatchObject({ hasGlobalTeams: false })
  })
})

// 재색인 서버 가드는 requireProjectAdmin 이다(actions/chat.ts, api/chat/reindex/route.ts) — 버튼도 같은 등급에게 보인다.
// 옛 화면은 슈퍼유저에게만 버튼을 주고 프로젝트 관리자에게는 'PMO 관리자 전용' 배지를 그렸다(후보 4·DC-09).
describe('설정 화면 — 재색인 버튼은 프로젝트 관리자에게(서버 가드와 같은 등급)', () => {
  it('슈퍼유저가 아닌 프로젝트 관리자에게 재색인 버튼을 그리고, PMO 역할 문구가 없다', async () => {
    mocks.workspaceTeamsForProjectSync.mockReturnValue([])
    const html = await render()
    expect(mocks.ReindexButton).toHaveBeenCalled()
    expect(mocks.ReindexButton.mock.calls.at(-1)![0]).toMatchObject({ projectId: 'p1' })
    expect(html).not.toContain('PMO')
  })
})
