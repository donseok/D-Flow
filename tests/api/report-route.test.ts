import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// 라우트 배선만 본다 — 데이터 페치·보고서 빌더는 mock. 명단 조회 실패가 '멤버 없는 보고서' 로 위장되지 않고 503 이 되는지
// (에러 처리 3원칙 ①), 성공이면 명단 행이 그대로 모델에 들어가는지 확인한다.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getComputedWbs: vi.fn(),
  getProjectRoster: vi.fn(),
  getAttendanceRecords: vi.fn(),
  getProjectMeetingData: vi.fn(),
  getAnnouncements: vi.fn(),
  listProjects: vi.fn(),
  getProjectConfig: vi.fn(),
  buildWeeklyReportModel: vi.fn(),
  buildReportWorkbook: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
// getProjectMembers 는 실물 계약(실패 = 빈 배열)대로 둔다 — 라우트가 옛 경로로 돌아가면 실패 케이스가 200 으로 드러난다.
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster, getProjectMembers: vi.fn(async () => []) }))
vi.mock('@/lib/data/attendance', () => ({ getAttendanceRecords: mocks.getAttendanceRecords }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: mocks.getProjectMeetingData }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: mocks.getAnnouncements }))
vi.mock('@/app/actions/project', () => ({ listProjects: mocks.listProjects }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/report/weekly', () => ({ buildWeeklyReportModel: mocks.buildWeeklyReportModel }))
vi.mock('@/lib/report/excel', () => ({ buildReportWorkbook: mocks.buildReportWorkbook }))
vi.mock('@/lib/report/narrative', () => ({ buildWeeklyNarrative: vi.fn() }))
vi.mock('@/lib/report/templateFill', () => ({ fillWeeklyTemplate: vi.fn(), fillSheetTemplate: vi.fn() }))
vi.mock('@/lib/data/weeklySheet', () => ({ getWeeklySheet: vi.fn() }))
vi.mock('@/lib/ai/projectFacts', () => ({ loadProjectFacts: vi.fn() }))
vi.mock('@/lib/ai/brief', () => ({ briefFactsHash: vi.fn(), buildBriefFacts: vi.fn() }))
vi.mock('@/lib/data/aiBriefs', () => ({ getAiBrief: vi.fn() }))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync: vi.fn(() => []) }))

import { GET } from '@/app/api/report/route'

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
const req = () => new NextRequest(`http://localhost/api/report?projectId=${PROJECT_ID}&format=xlsx`)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ userId: 'u1' })
  mocks.getComputedWbs.mockResolvedValue({ items: [], today: '2026-09-26' })
  mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [] })
  mocks.getAttendanceRecords.mockResolvedValue([])
  mocks.getProjectMeetingData.mockResolvedValue({ meetings: [], exceptions: [] })
  mocks.getAnnouncements.mockResolvedValue([])
  mocks.listProjects.mockResolvedValue([{ id: PROJECT_ID, name: 'Acme' }])
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
