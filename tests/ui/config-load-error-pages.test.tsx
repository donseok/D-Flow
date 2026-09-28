import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { CONFIG_MESSAGES, ConfigUnavailableError } from '@/lib/settings/errors'

// 설정을 못 읽은 화면(스펙 §3.5) — 옛 로더처럼 기본값으로 그리지 않고 '설정을 불러오지 못했습니다' 상태를 그린다.
// 본체 뷰(DashboardView·WbsGanttSheet·AgentHubView)는 부르지 않는다. 단계 이름이 손상이면 문구에 그 키 이름이 든다.
const PID = 'p1'
const LOAD_FAILED = '설정을 불러오지 못해 이 화면을 그릴 수 없습니다'

const mocks = vi.hoisted(() => {
  const view = () => vi.fn<(props: Record<string, unknown>) => null>(() => null)
  return {
    getProjectConfig: vi.fn(),
    getActorViewState: vi.fn(),
    getActorForView: vi.fn(),
    DashboardView: view(),
    WbsGanttSheet: view(),
    AgentHubView: view(),
  }
})

vi.mock('@/lib/settings/projectConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings/projectConfig')>()),
  getProjectConfig: mocks.getProjectConfig,
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState, getActorForView: mocks.getActorForView }))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/data/wbs', () => ({
  getComputedWbs: vi.fn(async () => ({ items: [], dependencies: [], unresolvedDepends: {}, holidays: [], today: '2026-09-26' })),
}))
vi.mock('@/lib/data/snapshots', () => ({ getSnapshots: vi.fn(async () => ({ ok: true, rows: [] })), recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn(async () => ({ ok: true, meetings: [], exceptions: [] })) }))
vi.mock('@/lib/data/issues', () => ({ getIssuesForDashboard: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/data/agentHub', () => ({ getAgentHub: vi.fn(async () => ({})) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: PID, name: 'Acme' }]) }))
vi.mock('@/app/actions/preferences', () => ({ getWbsCollapse: vi.fn(async () => null), getUiPrefs: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => null) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('@/components/app/ProjectPageShell', () => ({
  ProjectPageShell: ({ pinned, children }: { pinned?: ReactNode; children: ReactNode }) => <>{pinned}{children}</>,
}))
vi.mock('@/components/dashboard/DashboardView', () => ({ DashboardView: mocks.DashboardView }))
vi.mock('@/components/wbs/WbsRealtimeRefresh', () => ({ WbsRealtimeRefresh: () => null }))
vi.mock('@/components/wbs/WbsGanttSheet', () => ({ WbsGanttSheet: mocks.WbsGanttSheet }))
vi.mock('@/components/agent-hub/AgentHubView', () => ({ AgentHubView: mocks.AgentHubView }))

import Dashboard from '@/app/(app)/p/[projectId]/dashboard/page'
import WbsPage from '@/app/(app)/p/[projectId]/wbs/page'
import ProjectAgentsPage from '@/app/(app)/p/[projectId]/agents/page'

const params = Promise.resolve({ projectId: PID })
const html = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as ReactElement)
const pages = [
  { name: 'dashboard', view: mocks.DashboardView, render: () => html(Dashboard({ params })) },
  { name: 'wbs', view: mocks.WbsGanttSheet, render: () => html(WbsPage({ params, searchParams: Promise.resolve({}) })) },
  { name: 'agents', view: mocks.AgentHubView, render: () => html(ProjectAgentsPage({ params })) },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const actor = makeMemberActor(PID)
  mocks.getActorViewState.mockResolvedValue({ actor, degraded: false })
  mocks.getActorForView.mockResolvedValue(actor)
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'Task'], 'core.milestone_keywords': ['출시'] }))
})

describe.each(pages)('$name 페이지 — 설정 조회 실패', ({ view, render }) => {
  it('오류 상태를 그리고 본체 뷰는 부르지 않는다(기본값으로 그리지 않는다)', async () => {
    mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 행이 없습니다: p1'))
    const out = await render()
    expect(out).toContain(LOAD_FAILED)
    expect(out).toContain('data-config-load-error')
    // DB·해석기 원문은 화면에 그리지 않는다(I-2) — 로그에만
    expect(out).not.toContain('프로젝트 설정 행이 없습니다')
    expect(out).toContain(CONFIG_MESSAGES.CONFIG_UNAVAILABLE)
    expect(view).not.toHaveBeenCalled()
  })
  it('정상이면 오류 상태 없이 본체를 그린다', async () => {
    const out = await render()
    expect(out).not.toContain(LOAD_FAILED)
    expect(view).toHaveBeenCalled()
  })
})

describe.each(pages.filter((p) => p.name !== 'dashboard'))('$name 페이지 — 단계 이름 손상', ({ view, render }) => {
  it('문구에 키 이름이 들고 본체는 그리지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': 42 }))
    const out = await render()
    expect(out).toContain(LOAD_FAILED)
    expect(out).toContain('core.level_labels')
    expect(view).not.toHaveBeenCalled()
  })
})

describe('단계 이름·깊이는 해석기 값으로 넘긴다', () => {
  it('WBS 는 라벨·깊이(=라벨 수)·키워드를 그대로 받는다', async () => {
    await pages[1].render()
    expect(mocks.WbsGanttSheet.mock.calls.at(-1)![0]).toMatchObject({ levelLabels: ['Phase', 'Task'], maxDepth: 2, milestoneKeywords: ['출시'] })
  })
  it('대시보드는 단계 이름 손상과 무관하다 — 키워드만 쓴다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': 42, 'core.milestone_keywords': ['출시'] }))
    const out = await pages[0].render()
    expect(out).not.toContain(LOAD_FAILED)
    expect(mocks.DashboardView.mock.calls.at(-1)![0]).toMatchObject({ milestoneKeywords: ['출시'] })
  })
})

describe('마일스톤 키워드 손상 — 마커만 비우고 사유를 띄운다(다른 카드·간트는 그린다)', () => {
  it.each([pages[0], pages[1]])('$name', async ({ view, render }) => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['P'], 'core.milestone_keywords': 42 }))
    const out = await render()
    expect(out).toContain('core.milestone_keywords')
    expect(view).toHaveBeenCalled()
    expect(view.mock.calls.at(-1)![0]).toMatchObject({ milestoneKeywords: [] })
  })
})
