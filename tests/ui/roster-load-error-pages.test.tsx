import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'

// 명단이 곁가지인 화면(담당자·참석자 선택, 이름 표시)의 조회 실패 — 빈 명단(0명)으로 그리지 않고
// 사유를 화면에 띄우고 로그를 남긴다(에러 처리 3원칙 ①). 본문(WBS·이슈·회의 등)은 막지 않는다.
const ERR = '명단을 불러오지 못했습니다.'
const ALICE = { id: 'm1', name: 'alice', teams: [] }
const PID = 'p1'

const mocks = vi.hoisted(() => {
  // 뷰는 받은 props 만 기록하는 스텁 — 페이지가 넘긴 명단·사유를 검사한다.
  const view = () => vi.fn<(props: Record<string, unknown>) => null>(() => null)
  return {
    getProjectRoster: vi.fn(),
    getActorForView: vi.fn(),
    WbsGanttSheet: view(),
    AgentHubView: view(),
    AttendanceView: view(),
    MeetingsView: view(),
    IssuesView: view(),
    MinuteViewer: view(),
  }
})

vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster, getMyProjectIds: vi.fn(async () => []) }))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/data/wbs', () => ({
  getComputedWbs: vi.fn(async () => ({ items: [], dependencies: [], unresolvedDepends: {}, holidays: [], today: '2026-09-26' })),
}))
vi.mock('@/lib/data/projectConfig', () => ({
  getProjectConfig: vi.fn(async () => ({ levelLabels: [], maxDepth: null, milestoneKeywords: [] })),
}))
vi.mock('@/lib/data/agentHub', () => ({ getAgentHub: vi.fn(async () => ({})) }))
vi.mock('@/lib/data/attendance', () => ({ getAttendanceRecords: vi.fn(async () => []) }))
vi.mock('@/lib/data/meetings', () => ({
  getProjectMeetingData: vi.fn(async () => ({ ok: true, meetings: [], exceptions: [] })),
  resolveMemberIds: vi.fn(async () => []),
}))
vi.mock('@/lib/data/issues', () => ({ getIssues: vi.fn(async () => []), getMinuteLinkedIssues: vi.fn(async () => []) }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: vi.fn(async () => ({
    minute: { id: 'min-1', title: 't', projectId: PID, meetingProjectId: null, folderId: null, createdBy: 'u1', archivedAt: null },
    files: [],
  })),
  getMinuteAnnotations: vi.fn(async () => ({ highlights: [], insights: [] })),
  getMinuteVersions: vi.fn(async () => []),
  getMinuteWikiImpact: vi.fn(async () => null),
  getMinuteVersionBody: vi.fn(async () => null),
  getMinuteFolderPath: vi.fn(async () => null),
}))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: PID, name: 'Acme' }]) }))
vi.mock('@/app/actions/preferences', () => ({ getWbsCollapse: vi.fn(async () => null), getUiPrefs: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => null) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('@/components/app/ProjectPageShell', () => ({
  ProjectPageShell: ({ pinned, children }: { pinned?: ReactNode; children: ReactNode }) => <>{pinned}{children}</>,
}))
vi.mock('@/components/wbs/WbsGanttSheet', () => ({ WbsGanttSheet: mocks.WbsGanttSheet }))
vi.mock('@/components/agent-hub/AgentHubView', () => ({ AgentHubView: mocks.AgentHubView }))
vi.mock('@/components/attendance/AttendanceView', () => ({ AttendanceView: mocks.AttendanceView }))
vi.mock('@/components/meetings/MeetingsView', () => ({ MeetingsView: mocks.MeetingsView }))
vi.mock('@/components/issues/IssuesView', () => ({ IssuesView: mocks.IssuesView }))
vi.mock('@/components/minutes/MinuteViewer', () => ({ MinuteViewer: mocks.MinuteViewer }))

import WbsPage from '@/app/(app)/p/[projectId]/wbs/page'
import AttendancePage from '@/app/(app)/p/[projectId]/attendance/page'
import MeetingsPage from '@/app/(app)/p/[projectId]/meetings/page'
import IssuesPage from '@/app/(app)/p/[projectId]/issues/page'
import ProjectAgentsPage from '@/app/(app)/p/[projectId]/agents/page'
import MinuteDetailPage from '@/app/(app)/minutes/[id]/page'

const params = Promise.resolve({ projectId: PID })
const lastProps = (view: typeof mocks.WbsGanttSheet) => view.mock.calls.at(-1)![0]

// 셸을 쓰는 네 화면 — 사유는 셸의 고정 머리(pinned)에 뜬다(간트처럼 꽉 찬 본문을 밀어내지 않고, 컴팩트에서도 남는다).
const shellPages = [
  { name: 'wbs', view: mocks.WbsGanttSheet, render: () => WbsPage({ params, searchParams: Promise.resolve({}) }) },
  { name: 'attendance', view: mocks.AttendanceView, render: () => AttendancePage({ params }) },
  { name: 'meetings', view: mocks.MeetingsView, render: () => MeetingsPage({ params }) },
  { name: 'issues', view: mocks.IssuesView, render: () => IssuesPage({ params }) },
]

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getActorForView.mockResolvedValue(makeMemberActor(PID))
})
afterEach(() => errSpy.mockRestore())

describe.each(shellPages)('$name 페이지 — 명단 조회 실패', ({ name, view, render }) => {
  it('실패는 사유를 경고로 띄우고 로그를 남긴다 — 본문은 그대로 그린다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: ERR })
    const html = renderToStaticMarkup((await render()) as ReactElement)
    expect(html).toContain('role="alert"')
    expect(html).toContain(ERR)
    expect(view).toHaveBeenCalled()
    expect(lastProps(view).members).toEqual([])
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`\\[${name}\\].*명단 조회 실패.*${PID}`)))
  })
  it('정상은 경고 없이 명단을 넘긴다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [ALICE] })
    const html = renderToStaticMarkup((await render()) as ReactElement)
    expect(html).not.toContain('role="alert"')
    expect(lastProps(view).members).toEqual([ALICE])
    expect(errSpy).not.toHaveBeenCalled()
  })
})

describe('agents 페이지 — 명단 조회 실패', () => {
  it('실패 사유를 허브 WBS 묶음(membersError)으로 넘기고 로그를 남긴다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: ERR })
    renderToStaticMarkup((await ProjectAgentsPage({ params })) as ReactElement)
    const wbs = lastProps(mocks.AgentHubView).wbs as { members: unknown[]; membersError: string | null }
    expect(wbs.members).toEqual([])
    expect(wbs.membersError).toBe(ERR)
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`\\[agents\\].*명단 조회 실패.*${PID}`)))
  })
  it('정상은 membersError=null', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [ALICE] })
    renderToStaticMarkup((await ProjectAgentsPage({ params })) as ReactElement)
    const wbs = lastProps(mocks.AgentHubView).wbs as { members: unknown[]; membersError: string | null }
    expect(wbs.members).toEqual([ALICE])
    expect(wbs.membersError).toBeNull()
  })
})

describe('회의록 상세 — 이슈 담당자 명단 조회 실패', () => {
  const render = async () => renderToStaticMarkup((await MinuteDetailPage({
    params: Promise.resolve({ id: 'min-1' }), searchParams: Promise.resolve({}),
  })) as ReactElement)
  it('실패 사유를 뷰어(issueMembersError)로 넘기고 로그를 남긴다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: ERR })
    await render()
    expect(mocks.getProjectRoster).toHaveBeenCalledWith(PID)
    const props = lastProps(mocks.MinuteViewer)
    expect(props.issueMembers).toEqual([])
    expect(props.issueMembersError).toBe(ERR)
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`\\[minutes\\].*명단 조회 실패.*${PID}`)))
  })
  it('정상은 issueMembersError=null', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [ALICE] })
    await render()
    const props = lastProps(mocks.MinuteViewer)
    expect(props.issueMembers).toEqual([ALICE])
    expect(props.issueMembersError).toBeNull()
    expect(errSpy).not.toHaveBeenCalled()
  })
})
