import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// 라우트 배선만 본다 — 데이터 페치·보고서 빌더는 mock. 명단·공지·회의 조회 실패가 '없는 데이터' 로 위장되지 않고 503 이 되는지
// (에러 처리 3원칙 ①), 성공이면 명단 행이 그대로 모델에 들어가는지, 프로젝트 판정이 다른 조회보다 먼저인지 확인한다.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getComputedWbs: vi.fn(),
  getProjectRoster: vi.fn(),
  getAttendanceRecords: vi.fn(),
  getProjectMeetingData: vi.fn(),
  getAnnouncements: vi.fn(),
  listProjectsWithState: vi.fn(),
  getWeeklySheet: vi.fn(),
  getProjectConfig: vi.fn(),
  buildWeeklyReportModel: vi.fn(),
  buildReportWorkbook: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster }))
vi.mock('@/lib/data/attendance', () => ({ getAttendanceRecords: mocks.getAttendanceRecords }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: mocks.getProjectMeetingData }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: mocks.getAnnouncements }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: mocks.listProjectsWithState }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
// 주차 계산(report/week → fmtUTC)은 실제 것을 쓴다 — source=sheet 분기가 탄다.
vi.mock('@/lib/report/weekly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report/weekly')>()),
  buildWeeklyReportModel: mocks.buildWeeklyReportModel,
}))
vi.mock('@/lib/report/excel', () => ({ buildReportWorkbook: mocks.buildReportWorkbook }))
vi.mock('@/lib/report/narrative', () => ({ buildWeeklyNarrative: vi.fn() }))
vi.mock('@/lib/report/templateFill', () => ({ fillWeeklyTemplate: vi.fn(), fillSheetTemplate: vi.fn() }))
vi.mock('@/lib/data/weeklySheet', () => ({ getWeeklySheet: mocks.getWeeklySheet }))
vi.mock('@/lib/ai/projectFacts', () => ({ loadProjectFacts: vi.fn() }))
vi.mock('@/lib/ai/brief', () => ({ briefFactsHash: vi.fn(), buildBriefFacts: vi.fn() }))
vi.mock('@/lib/data/aiBriefs', () => ({ getAiBrief: vi.fn() }))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync: vi.fn(() => []) }))

import { GET } from '@/app/api/report/route'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'
const req = (pid = PROJECT_ID) => new NextRequest(`http://localhost/api/report?projectId=${pid}&format=xlsx`)
const sheetReq = (pid = PROJECT_ID) =>
  new NextRequest(`http://localhost/api/report?projectId=${pid}&format=pptx&source=sheet&week=2026-09-21`)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ userId: 'u1' })
  mocks.getComputedWbs.mockResolvedValue({ items: [], today: '2026-09-26' })
  mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [] })
  mocks.getAttendanceRecords.mockResolvedValue([])
  mocks.getProjectMeetingData.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
  mocks.getAnnouncements.mockResolvedValue({ ok: true, rows: [] })
  mocks.listProjectsWithState.mockResolvedValue({ projects: [{ id: PROJECT_ID, name: 'Acme' }], degraded: false })
  mocks.getWeeklySheet.mockResolvedValue(null)
  mocks.getProjectConfig.mockResolvedValue({ levelLabels: ['Phase', 'Task', 'Activity'] })
  mocks.buildWeeklyReportModel.mockReturnValue({ meta: { weekTag: '9월4주차' } })
  mocks.buildReportWorkbook.mockResolvedValue(new ArrayBuffer(1))
})
afterEach(() => vi.restoreAllMocks())

describe('GET /api/report — 명단 조회', () => {
  it('명단 조회 실패 → 503 + 로그, 보고서를 만들지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })

    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '명단을 불러오지 못했습니다.' })
    expect(err).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID))
    expect(mocks.buildWeeklyReportModel).not.toHaveBeenCalled()
    expect(mocks.buildReportWorkbook).not.toHaveBeenCalled()
  })

  it('명단 조회 성공 → 명단 행을 그대로 모델에 넘기고 200', async () => {
    const rows = [{ id: 'm1', name: 'alice' }]
    mocks.getProjectRoster.mockResolvedValue({ ok: true, rows })

    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(mocks.getProjectRoster).toHaveBeenCalledWith(PROJECT_ID)
    expect(mocks.buildWeeklyReportModel.mock.calls[0][3]).toMatchObject({ members: rows })
  })
})

describe('GET /api/report — 프로젝트 판정은 다른 조회보다 먼저', () => {
  const dataLoaders = () => [mocks.getComputedWbs, mocks.getProjectRoster, mocks.getAnnouncements, mocks.getProjectMeetingData]

  it('(a) 목록에 없는 프로젝트 → 404 이고 데이터 조회를 시작하지 않는다', async () => {
    const res = await GET(req(OTHER_ID))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: '프로젝트를 찾을 수 없습니다.' })
    for (const fn of dataLoaders()) expect(fn).not.toHaveBeenCalled()
  })

  it('(b) 목록 조회 실패(degraded) + 목록에 없음 → 500 — 조회 실패를 없는 프로젝트(404)로 위장하지 않는다', async () => {
    mocks.listProjectsWithState.mockResolvedValue({ projects: [], degraded: true })
    const res = await GET(req())
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: '프로젝트 목록을 확인할 수 없습니다.' })
    for (const fn of dataLoaders()) expect(fn).not.toHaveBeenCalled()
  })

  it('(c) source=sheet 도 같은 판정을 먼저 한다 — 없으면 404, degraded 면 500, 시트는 읽지 않는다', async () => {
    const notFound = await GET(sheetReq(OTHER_ID))
    expect(notFound.status).toBe(404)
    expect(await notFound.json()).toEqual({ error: '프로젝트를 찾을 수 없습니다.' })

    mocks.listProjectsWithState.mockResolvedValue({ projects: [], degraded: true })
    const degraded = await GET(sheetReq())
    expect(degraded.status).toBe(500)
    expect(await degraded.json()).toEqual({ error: '프로젝트 목록을 확인할 수 없습니다.' })
    expect(mocks.getWeeklySheet).not.toHaveBeenCalled()
  })

  it('(c) source=sheet 정상 판정 뒤에만 시트를 읽는다', async () => {
    const res = await GET(sheetReq())
    expect(res.status).toBe(400) // 시트 없음 — 판정은 통과했다
    expect(mocks.getWeeklySheet).toHaveBeenCalledWith(PROJECT_ID, '2026-09-21')
  })
})

describe('GET /api/report — 공지·회의 조회 실패', () => {
  it('(d) 공지 조회 실패 → 503 + 로그, 보고서를 만들지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getAnnouncements.mockResolvedValue({ ok: false, error: '공지를 불러오지 못했습니다.' })
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '공지를 불러오지 못했습니다.' })
    expect(err).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID))
    expect(mocks.buildWeeklyReportModel).not.toHaveBeenCalled()
  })

  it('(e) 회의 조회 실패 → 503 + 로그, 보고서를 만들지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProjectMeetingData.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '회의 일정을 불러오지 못했습니다.' })
    expect(err).toHaveBeenCalledWith(expect.stringContaining(PROJECT_ID))
    expect(mocks.buildWeeklyReportModel).not.toHaveBeenCalled()
  })

  it('정상이면 공지 행·회의를 그대로 모델에 넘긴다', async () => {
    const rows = [{ id: 'a1', title: '공지' }]
    const meetings = [{ id: 'm1' }]
    mocks.getAnnouncements.mockResolvedValue({ ok: true, rows })
    mocks.getProjectMeetingData.mockResolvedValue({ ok: true, meetings, exceptions: [] })
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(mocks.buildWeeklyReportModel.mock.calls[0][3]).toMatchObject({ announcements: rows, meetings, meetingExceptions: [] })
  })
})
