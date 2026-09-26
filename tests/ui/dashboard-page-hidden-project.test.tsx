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
}))
vi.mock('@/lib/authz', () => ({
  getActorViewState: vi.fn(async () => mocks.state),
  getActorForView: vi.fn(async () => mocks.state.actor),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [], today: '2026-09-26' })) }))
vi.mock('@/lib/data/snapshots', () => ({ getSnapshots: vi.fn(async () => []), recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: vi.fn(async () => []) }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn(async () => ({ meetings: [], exceptions: [] })) }))
vi.mock('@/lib/data/issues', () => ({ getIssuesForDashboard: vi.fn(async () => []) }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: vi.fn(async () => ({ milestoneKeywords: [] })) }))
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
  })
})
