// core 페이지의 관문(판정 P2, Review Focus 3) — 진짜 관문을 걸고 설정 조회를 실패시킨다. core 화면(대시보드·WBS)은 관문이 설정을 읽지 않아
// Phase A 의 '설정을 불러오지 못했습니다' 상태를 그대로 그린다(404 가 덮지 않는다). 비core 화면(에이전트 허브)은 같은 실패에서 닫힌다(fail-closed) —
// 이 대조가 진짜 관문이 걸렸다는 증거다(전역 mock 이면 허브도 오류 상태를 그린다: tests/ui/config-load-error-pages.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'
import { ConfigUnavailableError } from '@/lib/settings/errors'

const PID = '00000000-0000-0000-7e57-000000001422'
const LOAD_FAILED = '설정을 불러오지 못해 이 화면을 그릴 수 없습니다'

const mocks = vi.hoisted(() => ({
  getProjectConfig: vi.fn(),
  getActorViewState: vi.fn(),
  getActorForView: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/settings/projectConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings/projectConfig')>()),
  getProjectConfig: mocks.getProjectConfig,
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState, getActorForView: mocks.getActorForView }))
// 진짜 관문은 catch 에서 unstable_rethrow 를 부른다 — 원본을 두고 notFound·redirect 만 바꾼다
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: mocks.notFound,
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))
vi.mock('next/server', () => ({ after: vi.fn() }))
vi.mock('@/lib/data/wbs', () => ({
  getComputedWbs: vi.fn(async () => ({ items: [], dependencies: [], unresolvedDepends: {}, holidays: [], today: '2026-09-29' })),
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
vi.mock('@/components/dashboard/DashboardView', () => ({ DashboardView: () => null }))
vi.mock('@/components/wbs/WbsRealtimeRefresh', () => ({ WbsRealtimeRefresh: () => null }))
vi.mock('@/components/wbs/WbsGanttSheet', () => ({ WbsGanttSheet: () => null }))
vi.mock('@/components/agent-hub/AgentHubView', () => ({ AgentHubView: () => null }))

import Dashboard from '@/app/(app)/p/[projectId]/dashboard/page'
import WbsPage from '@/app/(app)/p/[projectId]/wbs/page'
import ProjectAgentsPage from '@/app/(app)/p/[projectId]/agents/page'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
const actual = await vi.importActual<typeof import('@/lib/modules/gate')>('@/lib/modules/gate')

const params = Promise.resolve({ projectId: PID })
const html = async (el: Promise<unknown>) => renderToStaticMarkup((await el) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const actor = makeMemberActor(PID)
  mocks.getActorViewState.mockResolvedValue({ actor, degraded: false })
  mocks.getActorForView.mockResolvedValue(actor)
  vi.mocked(requireModule).mockImplementation(actual.requireModule)   // 전역 통과 mock 대신 진짜 판정
  mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 행이 없습니다'))
})
// 관문 mock 값을 바꾸는 파일 — 뒤 파일로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('core 페이지 — 설정 조회가 실패해도 관문이 404 로 덮지 않는다(P2)', () => {
  it.each([
    ['dashboard', 'dashboard', () => html(Dashboard({ params }))],
    ['wbs', 'wbs', () => html(WbsPage({ params, searchParams: Promise.resolve({}) }))],
  ] as const)('%s — Phase A 의 오류 상태를 그리고, 설정은 페이지 로더만 한 번 읽는다', async (_n, mod, render) => {
    const out = await render()
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, mod)
    expect(mocks.notFound).not.toHaveBeenCalled()
    expect(out).toContain(LOAD_FAILED)
    expect(mocks.getProjectConfig).toHaveBeenCalledTimes(1)          // 관문은 읽지 않았다 — 한 번은 loadProjectConfigForPage
  })
  it('대조: 비core(에이전트 허브)는 같은 실패에서 닫힌다 — 로그 뒤 404, 허브 로더는 돌지 않는다', async () => {
    await expect(html(ProjectAgentsPage({ params }))).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents')
    expect(vi.mocked(console.error).mock.calls.some((c) => c[0] === '[requireModule]')).toBe(true)
    const { getAgentHub } = await import('@/lib/data/agentHub')
    expect(getAgentHub).not.toHaveBeenCalled()
  })
})
