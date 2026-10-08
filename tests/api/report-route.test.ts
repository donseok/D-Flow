import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR_DENIED, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { FormRenderError } from '@/lib/report/engine/types'
import { weeklyReference } from '@/lib/report/forms/reference'
import { defaultFormSetting } from '@/lib/settings/defs/forms'
import type { ConfigArea } from '@/lib/settings/projectConfig'
import type { WeeklyReportModel } from '@/lib/report/weekly'
import { makeMemberActor } from '../fixtures/actor'
import { monProjectValues } from '../helpers/calendarFixture'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const h = vi.hoisted(() => {
  class FormTemplateLoadError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FormTemplateLoadError'
    }
  }
  return {
    render: vi.fn(),
    scan: vi.fn(),
    loadTemplate: vi.fn(),
    loadProject: vi.fn(),
    getProjectConfig: vi.fn(),
    requireProjectMember: vi.fn(),
    getComputedWbs: vi.fn(),
    getProjectRoster: vi.fn(),
    getAttendanceRecords: vi.fn(),
    getProjectMeetingData: vi.fn(),
    getAnnouncements: vi.fn(),
    getWeeklySheet: vi.fn(),
    projectTeams: vi.fn(),
    loadProjectFacts: vi.fn(),
    getAiBrief: vi.fn(),
    buildWeeklyReportModel: vi.fn(),
    FormTemplateLoadError,
  }
})

vi.mock('@/lib/authz', () => ({ requireProjectMember: h.requireProjectMember }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: h.getComputedWbs }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: h.getProjectRoster }))
vi.mock('@/lib/data/attendance', () => ({ getAttendanceRecords: h.getAttendanceRecords }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: h.getProjectMeetingData }))
vi.mock('@/lib/data/announcements', () => ({ getAnnouncements: h.getAnnouncements }))
vi.mock('@/lib/data/weeklySheet', () => ({ getWeeklySheet: h.getWeeklySheet }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: h.projectTeams }))
vi.mock('@/lib/report/forms/loadTemplate', () => ({
  loadFormTemplate: h.loadTemplate,
  FormTemplateLoadError: h.FormTemplateLoadError,
}))
vi.mock('@/lib/report/forms/project', () => ({ loadReportProject: h.loadProject }))
vi.mock('@/lib/report/engine', () => ({ engineFor: () => ({ render: h.render }) }))
vi.mock('@/lib/report/engine/scan', () => ({ scanFormTemplate: h.scan }))
vi.mock('@/lib/ai/projectFacts', () => ({ loadProjectFacts: h.loadProjectFacts }))
vi.mock('@/lib/data/aiBriefs', () => ({ getAiBrief: h.getAiBrief }))
vi.mock('@/lib/report/weekly', () => ({ buildWeeklyReportModel: h.buildWeeklyReportModel }))
vi.mock('@/lib/report/narrative', () => ({
  buildWeeklyNarrative: () => ({ prev: [], curr: [], issues: [], events: [] }),
}))

import { GET } from '@/app/api/report/route'

const TPL = '11111111-1111-4111-8111-111111111111'

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/report?${query}`)
}

function ph(path: string) {
  return { token: `{{${path}}}`, kind: 'value' as const, path, scope: [] as string[], location: {}, mergedRuns: false }
}

function area(code: string): ConfigArea {
  return { id: code, kind: 'weekly_section', code, name: code, sortOrder: 0, active: true, teams: [] }
}

function stubModel(today: string): WeeklyReportModel {
  return {
    meta: {
      projectName: 'Acme', description: null, generatedAt: 't', today,
      isoYear: 1999, isoWeek: 1, weekTag: 'tag', weekLabel: 'label',
      weekRange: 'r', nextWeekRange: 'n', weekStart: '2026-09-28', weekEnd: '2026-10-04',
      weekDays: ['2026-09-28'], weekDayLabels: ['월'],
      nextWeekStart: '2026-10-05', nextWeekDays: [], nextWeekDayLabels: [],
      prevWeekStart: '2026-09-21', prevWeekDays: [], prevWeekRange: 'p',
      totalLeaves: 0, phaseCount: 0, topLevelLabel: 'Phase',
    },
    kpi: {
      planned: 0, actual: 0, variance: 0, total: 0, done: 0, inProgress: 0, notStarted: 0, delayed: 0,
      doneThisWeek: 0, doneRatio: 0, inProgressRatio: 0, delayedRatio: 0,
    },
    phases: [], planActual: [], workload: [], issues: [], wbs: [], dev: [], devOwnerSummary: '',
    attendance: { thisWeek: [], nextWeek: [] },
    meetings: { thisWeek: [], nextWeek: [], total: 0 },
    announcements: { prevWeek: [], thisWeek: [] },
  } as unknown as WeeklyReportModel
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireModule).mockReset()
  vi.mocked(requireModule).mockResolvedValue({ ok: true })
  h.requireProjectMember.mockResolvedValue({ ok: true, actor: makeMemberActor('p1') })
  h.getProjectConfig.mockResolvedValue(makeProjectConfig())
  h.loadProject.mockResolvedValue({ name: 'Acme', description: null, start_date: null, end_date: null })
  h.loadTemplate.mockResolvedValue({ bytes: new Uint8Array([1]), source: 'default' })
  h.render.mockResolvedValue(new Uint8Array([9]))
  h.scan.mockResolvedValue({ placeholders: [ph('slide.page')], issues: [] })
  h.getComputedWbs.mockResolvedValue({ today: '2026-10-07', items: [], calendar: { timezone: 'Asia/Seoul' } })
  h.getProjectRoster.mockResolvedValue({ ok: true, rows: [] })
  h.getAttendanceRecords.mockResolvedValue([])
  h.getProjectMeetingData.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
  h.getAnnouncements.mockResolvedValue({ ok: true, rows: [] })
  h.getWeeklySheet.mockResolvedValue({ rows: [] })
  h.projectTeams.mockResolvedValue([])
  h.loadProjectFacts.mockResolvedValue(null)
  h.getAiBrief.mockResolvedValue(null)
  h.buildWeeklyReportModel.mockImplementation((_items: unknown, _project: unknown, today: string) => stubModel(today))
})

afterEach(() => {
  for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset()
})

describe('GET /api/report (정본 §4.8)', () => {
  it('주간 모듈이 꺼지면 양식을 읽기 전에 404', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await GET(req('projectId=p1&format=pptx'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: ERR_MODULE_DISABLED })
    expect(h.loadTemplate).not.toHaveBeenCalled()
  })

  it('멤버가 아니면 모듈 관문보다 먼저 거절한다', async () => {
    h.requireProjectMember.mockResolvedValue({ ok: false, error: ERR_DENIED })
    const res = await GET(req('projectId=p1&format=pptx'))
    expect(res.status).toBe(403)
    expect(requireModule).not.toHaveBeenCalled()
  })

  it('source=sheet 는 무시하고 기본 양식 헤더를 붙인다', async () => {
    const res = await GET(req('projectId=p1&format=pptx&source=sheet'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Form-Template')).toBe('default')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(h.loadTemplate).toHaveBeenCalledWith('p1', 'weekly_report_pptx', null)
    expect(h.getWeeklySheet).not.toHaveBeenCalled()
    expect(h.buildWeeklyReportModel).not.toHaveBeenCalled()
  })

  it('활성 양식이면 X-Form-Template 은 custom', async () => {
    h.getProjectConfig.mockResolvedValue(makeProjectConfig({
      'forms.weekly_report_xlsx': { ...defaultFormSetting('weekly_report_xlsx'), template_id: TPL },
    }))
    h.loadTemplate.mockResolvedValue({ bytes: new Uint8Array([2]), source: 'custom' })
    const res = await GET(req('projectId=p1&format=xlsx'))
    expect(res.status).toBe(200)
    expect(res.headers.get('X-Form-Template')).toBe('custom')
    expect(h.loadTemplate).toHaveBeenCalledWith('p1', 'weekly_report_xlsx', TPL)
  })

  it('활성 양식을 못 읽으면 500 이고 렌더하지 않는다', async () => {
    h.getProjectConfig.mockResolvedValue(makeProjectConfig({
      'forms.weekly_report_pptx': { ...defaultFormSetting('weekly_report_pptx'), template_id: TPL },
    }))
    h.loadTemplate.mockRejectedValue(new h.FormTemplateLoadError('양식 파일을 읽지 못했습니다.'))
    const res = await GET(req('projectId=p1&format=pptx'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: '양식 파일을 읽지 못했습니다.' })
    expect(h.render).not.toHaveBeenCalled()
  })

  it('week 형식이 틀리면 sections 가 없어도 400', async () => {
    const res = await GET(req('projectId=p1&format=pptx&week=2026-13-40'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'week(YYYY-MM-DD)가 필요합니다' })
    expect(h.loadProject).not.toHaveBeenCalled()
  })

  // 화면의 요약 PPT·엑셀 버튼은 week 없이 부른다 — 예전엔 400 이라 기본 양식(sections 자리표시자)으로는 받아지지 않았다
  it('sections 가 있는데 week 가 없으면 프로젝트 달력의 이번 주 시트로 만든다(200)', async () => {
    h.scan.mockResolvedValue({ placeholders: [ph('sections.name')], issues: [] })
    const cfg = makeProjectConfig({ ...monProjectValues }, { areas: { weekly_section: [area('a')], issue_area: [] } })
    h.getProjectConfig.mockResolvedValue(cfg)
    const ref = weeklyReference(cfg.calendar!, '2026-10-07', null)
    const res = await GET(req('projectId=p1&format=pptx'))
    expect(res.status).toBe(200)
    expect(ref.weekStart).toBe('2026-10-05')
    expect(h.getWeeklySheet).toHaveBeenCalledWith('p1', ref.weekStart)
  })

  it('sections 인데 영역이 하나도 없으면 409 설정 필요', async () => {
    h.scan.mockResolvedValue({ placeholders: [ph('sections.name')], issues: [] })
    const res = await GET(req('projectId=p1&format=pptx&week=2026-10-05'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: '설정 필요' })
    expect(h.getWeeklySheet).not.toHaveBeenCalled()
  })

  it('지난 week 는 표시 요일 끝으로 모델과 시트를 맞춘다', async () => {
    h.scan.mockResolvedValue({ placeholders: [ph('report.title'), ph('sections.name')], issues: [] })
    const cfg = makeProjectConfig({ ...monProjectValues, 'core.level_labels': ['Phase', 'Task'] }, { areas: { weekly_section: [area('a')], issue_area: [] } })
    h.getProjectConfig.mockResolvedValue(cfg)
    const ref = weeklyReference(cfg.calendar!, '2026-10-07', '2026-09-30')
    const res = await GET(req('projectId=p1&format=pptx&week=2026-09-30'))
    expect(res.status).toBe(200)
    expect(ref.weekStart).toBe('2026-09-28')
    expect(ref.today).toBe('2026-10-02')
    expect(h.getWeeklySheet).toHaveBeenCalledWith('p1', ref.weekStart)
    expect(h.buildWeeklyReportModel.mock.calls[0][2]).toBe(ref.today)
  })

  it('ai=1 이어도 ai_comment 토큰이 없으면 브리핑을 보지 않는다', async () => {
    const res = await GET(req('projectId=p1&format=pptx&ai=1'))
    expect(res.status).toBe(200)
    expect(h.loadProjectFacts).not.toHaveBeenCalled()
  })

  it('ai_comment 토큰과 ai=1 인데 브리핑이 없으면 409', async () => {
    h.scan.mockResolvedValue({ placeholders: [ph('ai_comment.headline')], issues: [] })
    const res = await GET(req('projectId=p1&format=pptx&ai=1'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'AI 브리핑이 없거나 최신이 아닙니다. 리포트 화면의 AI 브리핑 생성 버튼으로 먼저 생성하세요.' })
    expect(h.render).not.toHaveBeenCalled()
  })

  it('렌더 오류는 422 와 위치·토큰', async () => {
    h.render.mockRejectedValue(new FormRenderError('MISSING_PATH', { slide: 2 }, 'report.nope', '없는 경로'))
    const res = await GET(req('projectId=p1&format=pptx'))
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'MISSING_PATH', location: 'slide 2', token: 'report.nope', error: '없는 경로' })
  })

  it('명단이 없으면 503 이고 렌더하지 않는다', async () => {
    h.scan.mockResolvedValue({ placeholders: [ph('report.title')], issues: [] })
    h.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    const res = await GET(req('projectId=p1&format=pptx'))
    expect(res.status).toBe(503)
    expect(h.render).not.toHaveBeenCalled()
    expect(h.buildWeeklyReportModel).not.toHaveBeenCalled()
  })
})
