import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeActor, makeMemberActor } from '../fixtures/actor'

// 대시보드는 DashboardView(서버 컴포넌트)가 service_role 팀 캐시(teamsForProjectSync)로 팀별 진척을 그린다.
// 레이아웃의 notFound 는 병렬 렌더되는 이 페이지를 멈추지 않으므로, 숨은 프로젝트에서는 페이지가 스스로 404 로 끊어
// 뷰를 그리지 않는다(스냅샷 기록 after() 도 걸지 않는다) — members 와 같은 결함 계열(SP2 T15 리뷰).
const mocks = vi.hoisted(() => ({
  state: { actor: null as unknown, degraded: false },
  DashboardView: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  after: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  getSnapshots: vi.fn(async (): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> => ({ ok: true, rows: [] })),
  getIssuesForDashboard: vi.fn(async (): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> => ({ ok: true, rows: [] })),
  getAnnouncements: vi.fn(async (): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> => ({ ok: true, rows: [] })),
  getProjectMeetingData: vi.fn(async (): Promise<{ ok: true; meetings: unknown[]; exceptions: unknown[] } | { ok: false; error: string }> =>
    ({ ok: true, meetings: [], exceptions: [] })),
}))
vi.mock('@/lib/authz', () => ({
  getActorViewState: vi.fn(async () => mocks.state),
  getActorForView: vi.fn(async () => mocks.state.actor),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [], calendar: (await import('../helpers/calendarFixture')).calUtcSun, today: '2026-09-26' })) }))
vi.mock('@/lib/data/snapshots', () => ({ getSnapshots: mocks.getSnapshots, recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: mocks.getAnnouncements }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: mocks.getProjectMeetingData }))
vi.mock('@/lib/data/issues', () => ({ getIssuesForDashboard: mocks.getIssuesForDashboard }))
vi.mock('@/lib/settings/projectConfig', async () => {
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  return { getProjectConfig: vi.fn(async () => makeProjectConfig({ 'core.level_labels': ['P'], 'core.milestone_keywords': [] })) }
})
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => []) }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => null) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({})) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/dashboard/DashboardView', () => ({ DashboardView: mocks.DashboardView }))
vi.mock('@/components/wbs/WbsRealtimeRefresh', () => ({ WbsRealtimeRefresh: () => null }))

import Dashboard from '@/app/(app)/p/[projectId]/dashboard/page'

const render = async () =>
  renderToStaticMarkup((await Dashboard({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)

beforeEach(() => vi.clearAllMocks())

describe('dashboard 페이지 — 숨은 프로젝트', () => {
  it('타 워크스페이스·미존재: 404 이고 뷰(팀 캐시)를 그리지 않으며 스냅샷 기록도 걸지 않는다', async () => {
    mocks.state = { actor: makeActor(), degraded: false }
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.DashboardView).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })
  it('권한 조회 실패(degraded)는 404 가 아니다 — 레이아웃과 같은 규칙', async () => {
    mocks.state = { actor: null, degraded: true }
    await render()
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.DashboardView).toHaveBeenCalled()
  })
  it('명단 멤버는 그대로 그린다', async () => {
    mocks.state = { actor: makeMemberActor('p1'), degraded: false }
    await render()
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(mocks.DashboardView).toHaveBeenCalled()
    expect(mocks.after).toHaveBeenCalled()
    expect(mocks.DashboardView.mock.calls[0][0]).toMatchObject({
      issues: [], snapshots: [], historyFailed: false, announcements: [], meetings: [], meetingExceptions: [],
    })
  })
})

describe('dashboard 페이지 — 조회 실패를 뷰에 구분해 넘긴다', () => {
  it('이슈 실패는 issues=null, 진척 이력 실패는 historyFailed=true(빈 이력)', async () => {
    mocks.state = { actor: makeMemberActor('p1'), degraded: false }
    mocks.getIssuesForDashboard.mockResolvedValueOnce({ ok: false, error: '이슈를 불러오지 못했습니다.' })
    mocks.getSnapshots.mockResolvedValueOnce({ ok: false, error: '진척 이력을 불러오지 못했습니다.' })
    await render()
    expect(mocks.DashboardView.mock.calls[0][0]).toMatchObject({ issues: null, snapshots: [], historyFailed: true })
  })
  it('공지·회의 실패는 announcements=null, meetings=null(예외는 빈 목록)', async () => {
    mocks.state = { actor: makeMemberActor('p1'), degraded: false }
    mocks.getAnnouncements.mockResolvedValueOnce({ ok: false, error: '공지를 불러오지 못했습니다.' })
    mocks.getProjectMeetingData.mockResolvedValueOnce({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    await render()
    expect(mocks.DashboardView.mock.calls[0][0]).toMatchObject({ announcements: null, meetings: null, meetingExceptions: [] })
  })
})
