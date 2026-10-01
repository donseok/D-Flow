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
  loadProjectFacts: vi.fn(),
  fillWeeklyTemplate: vi.fn(),
  fillSheetTemplate: vi.fn(),
  getProjectConfig: vi.fn(),
  buildWeeklyReportModel: vi.fn(),
  buildReportWorkbook: vi.fn(),
  loadDisplayBranding: vi.fn(),
  projectTeams: vi.fn(async () => []),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster }))
vi.mock('@/lib/data/attendance', () => ({ getAttendanceRecords: mocks.getAttendanceRecords }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: mocks.getProjectMeetingData }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: mocks.getAnnouncements }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: mocks.listProjectsWithState }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
// 주차 계산(report/week → fmtUTC)은 실제 것을 쓴다 — source=sheet 분기가 탄다.
vi.mock('@/lib/report/weekly', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report/weekly')>()),
  buildWeeklyReportModel: mocks.buildWeeklyReportModel,
}))
vi.mock('@/lib/report/excel', () => ({ buildReportWorkbook: mocks.buildReportWorkbook }))
vi.mock('@/lib/settings/displayBranding', () => ({ loadDisplayBranding: mocks.loadDisplayBranding }))
vi.mock('@/lib/report/narrative', () => ({ buildWeeklyNarrative: vi.fn() }))
vi.mock('@/lib/report/templateFill', () => ({ fillWeeklyTemplate: mocks.fillWeeklyTemplate, fillSheetTemplate: mocks.fillSheetTemplate }))
vi.mock('@/lib/data/weeklySheet', () => ({ getWeeklySheet: mocks.getWeeklySheet }))
vi.mock('@/lib/ai/projectFacts', () => ({ loadProjectFacts: mocks.loadProjectFacts }))
vi.mock('@/lib/ai/brief', () => ({ briefFactsHash: vi.fn(), buildBriefFacts: vi.fn() }))
vi.mock('@/lib/data/aiBriefs', () => ({ getAiBrief: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: mocks.projectTeams }))

import { GET } from '@/app/api/report/route'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

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
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['Phase', 'Task', 'Activity'] }))
  mocks.buildWeeklyReportModel.mockReturnValue({ meta: { weekTag: '9월4주차' } })
  mocks.buildReportWorkbook.mockResolvedValue(new ArrayBuffer(1))
  mocks.loadDisplayBranding.mockResolvedValue({ productName: '한빛 플로우', mailFromName: '한빛 플로우' })
})
afterEach(() => vi.restoreAllMocks())
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

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

describe('GET /api/report — 프로젝트 설정', () => {
  it('엑셀 작성자는 프로젝트 워크스페이스 제품명을 쓴다', async () => {
    expect((await GET(req())).status).toBe(200)
    expect(mocks.loadDisplayBranding).toHaveBeenCalledWith('ws-test')
    expect(mocks.buildReportWorkbook).toHaveBeenCalledWith(expect.anything(), '한빛 플로우')
  })
  it('설정 조회 실패 → 503(전체 500 이 아니다), 보고서를 만들지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: db down'))
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
    expect(mocks.buildWeeklyReportModel).not.toHaveBeenCalled()
  })
  it('팀 원천 실패는 503 고정 문구 — 보고서를 빈 팀 축으로 만들지 않는다(SP4 A2)', async () => {
    mocks.projectTeams.mockRejectedValueOnce(new Error('relation "teams" boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(req())
    expect(res.status).toBe(503)
    expect(await res.text()).not.toContain('boom')
    expect(mocks.buildWeeklyReportModel).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('단계 이름이 손상이면 그 키의 오류(422) — 기본 라벨로 만들지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': 42 }))
    const res = await GET(req())
    expect(res.status).toBe(422)
    expect(mocks.buildWeeklyReportModel).not.toHaveBeenCalled()
  })
  it('단계 이름을 모델에 넘긴다', async () => {
    await GET(req())
    expect(mocks.buildWeeklyReportModel.mock.calls[0][3]).toMatchObject({ levelLabels: ['Phase', 'Task', 'Activity'] })
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

describe('GET /api/report — AI 코멘트 슬라이드(ai=1) 근거 조회 실패', () => {
  const aiReq = () => new NextRequest(`http://localhost/api/report?projectId=${PROJECT_ID}&format=pptx&ai=1`)

  it('근거 로더가 던지면(이력·회의 조회 실패, 팀 캐시 미로드) 로그 후 503 + 사유 — 맨 500 으로 새지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = new Error('[projectFacts] 진척 이력을 불러오지 못했습니다.')
    mocks.loadProjectFacts.mockRejectedValue(boom)
    const res = await GET(aiReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'AI 브리핑 근거를 불러오지 못했습니다.' })
    expect(err).toHaveBeenCalledWith('[report] AI 브리핑 근거 조회 실패:', { projectId: PROJECT_ID }, boom)
    expect(mocks.fillWeeklyTemplate).not.toHaveBeenCalled()
  })
})

// P4 — weekly 관문은 주간업무 시트 갈래(source=sheet)만(BRANCH_GATE). 기본 갈래는 WBS 화면 보고서 모달이 부르는 core 기능이다.
describe('GET /api/report — weekly 관문은 시트 갈래만(과제 20, P4)', () => {
  it('source=sheet 는 weekly 가 꺼지면 404 이고 시트를 읽지 않는다 — 프로젝트 판정 뒤', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await GET(sheetReq())
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PROJECT_ID }, 'weekly')
    expect(mocks.listProjectsWithState).toHaveBeenCalled()
    expect(mocks.getWeeklySheet).not.toHaveBeenCalled()
  })
  it('source=sheet 의 없는 프로젝트는 모듈 판정 전에 404 — 존재 판정이 먼저다', async () => {
    expect((await GET(sheetReq(OTHER_ID))).status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('기본 갈래(WBS 화면의 현황 보고서 — core)는 weekly 관문을 부르지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    expect((await GET(req())).status).toBe(200)
    expect(requireModule).not.toHaveBeenCalled()
    expect(requireSessionModule).not.toHaveBeenCalled()
  })
})

describe('GET /api/report — 시트 갈래(source=sheet) 의 영역 기준(스펙 §4.1.4)', () => {
  const area = (id: string, name: string, sortOrder: number, active = true) =>
    ({ id, kind: 'weekly_section' as const, code: id.toUpperCase(), name, sortOrder, active, teams: [] })
  const AREAS = [area('a-exp', '실험', 1), area('a-ops', '운영', 2), area('a-old', '구 영역', 0, false)]
  const withAreas = () => makeProjectConfig({ 'core.level_labels': ['Phase'] }, { areas: { weekly_section: AREAS, issue_area: [] } })
  const sheetRow = (id: string, areaId: string, thisContent = '') =>
    ({ id, reportId: 'rep', areaId, thisContent, thisIssue: '', nextContent: '', nextIssue: '' })
  const sheetOf = (rows: ReturnType<typeof sheetRow>[]) =>
    ({ report: { id: 'rep', projectId: PROJECT_ID, weekStart: '2026-09-21', title: '' }, rows })

  it('설정 조회 실패 → 503 이고 시트를 읽지 않으며 PPT 를 만들지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: db down'))
    const res = await GET(sheetReq())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
    expect(err.mock.calls.some(c => c.some(x => String(x).includes('db down')))).toBe(true)   // 원인은 로그로만
    expect(mocks.getWeeklySheet).not.toHaveBeenCalled()
    expect(mocks.fillSheetTemplate).not.toHaveBeenCalled()
  })

  it('페이지는 보이는 영역 순 — 내용 없는 비활성 영역은 빠지고, 페이지 머리는 영역 이름', async () => {
    mocks.getProjectConfig.mockResolvedValue(withAreas())
    mocks.getWeeklySheet.mockResolvedValue(sheetOf([sheetRow('r-ops', 'a-ops', '운영 실적'), sheetRow('r-old', 'a-old'), sheetRow('r-exp', 'a-exp')]))
    mocks.fillSheetTemplate.mockResolvedValue(Buffer.from('pptx'))
    const res = await GET(sheetReq())
    expect(res.status).toBe(200)
    const sections = mocks.fillSheetTemplate.mock.calls[0][0] as { areaId: string; section: string }[]
    expect(sections.map(s => [s.areaId, s.section])).toEqual([['a-exp', '실험'], ['a-ops', '운영']])
  })

  it('네 칸이 모두 비면(공백뿐 포함) 400 — 지금 문구 그대로, PPT 를 만들지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(withAreas())
    mocks.getWeeklySheet.mockResolvedValue(sheetOf([sheetRow('r-exp', 'a-exp', '   \n  '), sheetRow('r-ops', 'a-ops')]))
    const res = await GET(sheetReq())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: '해당 주차에 작성된 내용이 없습니다' })
    expect(mocks.fillSheetTemplate).not.toHaveBeenCalled()
  })

  it('시트 갈래는 WBS 모델·명단·회의·공지를 읽지 않는다 — 시트 하나만 읽는다(쓰기 0)', async () => {
    mocks.getProjectConfig.mockResolvedValue(withAreas())
    mocks.getWeeklySheet.mockResolvedValue(sheetOf([sheetRow('r-exp', 'a-exp', '실적')]))
    mocks.fillSheetTemplate.mockResolvedValue(Buffer.from('pptx'))
    expect((await GET(sheetReq())).status).toBe(200)
    for (const fn of [mocks.getComputedWbs, mocks.getProjectRoster, mocks.getProjectMeetingData, mocks.getAnnouncements]) {
      expect(fn).not.toHaveBeenCalled()
    }
    expect(mocks.getWeeklySheet).toHaveBeenCalledTimes(1)
  })
})
