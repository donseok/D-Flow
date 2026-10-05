import { TEST_AREAS, TEST_SEVERITY_CODES } from '../fixtures/issue-areas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'
import { makeMemberActor } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ConfigKeyError, ConfigUnavailableError, CONFIG_MESSAGES } from '@/lib/settings/errors'
import { FormRenderError } from '@/lib/report/engine/types'
import { defaultFormSetting } from '@/lib/settings/defs/forms'
import {
  buildIssueAnalysisInputSnapshot,
  buildIssueAnalysisReport,
} from '@/lib/report/issues/model'

const mocks = vi.hoisted(() => {
  class FormTemplateLoadError extends Error {
    constructor(message: string) {
      super(message)
      this.name = 'FormTemplateLoadError'
    }
  }
  return {
    requireProjectMember: vi.fn(),
    getDisplayName: vi.fn(),
    loadSavedIssueAnalysisRun: vi.fn(),
    getDiagnostic: vi.fn(),
    renderIssueAnalysisPpt: vi.fn(),
    getProjectConfig: vi.fn(),
    render: vi.fn(),
    scan: vi.fn(),
    loadTemplate: vi.fn(),
    FormTemplateLoadError,
  }
})

vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/auth', () => ({
  getDisplayName: mocks.getDisplayName,
}))
vi.mock('@/lib/data/issueAnalysis', () => ({
  loadSavedIssueAnalysisRun: mocks.loadSavedIssueAnalysisRun,
}))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/report/issues/export', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/report/issues/export')>()
  return {
    ...actual,
    getIssueAnalysisPptExportDiagnostic: mocks.getDiagnostic,
    renderIssueAnalysisPpt: mocks.renderIssueAnalysisPpt,
  }
})
vi.mock('@/lib/report/forms/loadTemplate', () => ({
  loadFormTemplate: mocks.loadTemplate,
  FormTemplateLoadError: mocks.FormTemplateLoadError,
}))
vi.mock('@/lib/report/engine', () => ({ engineFor: () => ({ render: mocks.render }) }))
vi.mock('@/lib/report/engine/scan', () => ({ scanFormTemplate: mocks.scan }))
import { GET } from '@/app/api/issue-analysis/route'

const TPL = '11111111-1111-4111-8111-111111111111'

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/issue-analysis${query}`)
}

function ph(path: string) {
  return { token: `{{${path}}}`, kind: 'value' as const, path, scope: [] as string[], location: {}, mergedRuns: false }
}

function issue(): IssueAnalysisIssueInput {
  return {
    codeAreaId: null,
    id: 'issue-1',
    issueNo: 1,
    projectId: 'project-1',
    title: '기준정보 중복',
    body: '동일 자재가 여러 코드로 관리된다.',
    status: 'open',
    severity: 'high',
    assigneeMemberIds: [],
    startDate: null,
    dueDate: null,
    minuteSources: [],
    resolutionNote: '',
    resolvedAt: null,
    createdBy: 'user-1',
    createdByName: '테스터',
    createdAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-07-30T00:00:00Z',
    areaId: '00',
    code: 'PI-I-00-01',
    subProcess: '자재 등록',
    ownerDepartment: '기준정보팀',
    relatedSystems: ['ERP'],
    sourceType: 'interview',
    sourceDetail: '기준정보팀 인터뷰',
  }
}

function report() {
  const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue()], [], TEST_AREAS, TEST_SEVERITY_CODES)
  return buildIssueAnalysisReport(snapshot, {
    '00': [{
      title: '기준정보 단일화',
      description: '중복 등록을 통제한다.',
      issueIds: ['issue-1'],
    }],
  }, '2026-07-31T00:00:00Z', {
    '00': [{
      issueId: 'issue-1',
      causes: [{
        category: 'process',
        directCause: '자재 등록 전에 중복 여부를 확인하는 표준 절차가 없다.',
        rootCause: '기준정보 정책의 관리 책임과 정기 검토 체계가 정의되지 않았다.',
      }],
    }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({
    ok: true,
    actor: makeMemberActor('project-1', ['PI', 'ERP'], {
      userId: 'user-1',
      rosterTeams: new Map([
        ['project-1', { teamIds: ['t-pi', 't-erp'], teamCodes: ['PI', 'ERP'] }],
        ['project-2', { teamIds: ['t-mes'], teamCodes: ['MES'] }],
      ]),
    }),
  })
  mocks.getDisplayName.mockResolvedValue('홍길동')
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig())
  mocks.loadSavedIssueAnalysisRun.mockResolvedValue({
    areas: TEST_AREAS,
    runId: 'run-1',
    projectId: 'project-1',
    projectName: 'Acme 프로젝트',
    report: report(),
  })
  mocks.getDiagnostic.mockReturnValue({
    status: 'unavailable',
    code: 'PPT_RENDERER_UNAVAILABLE',
    message: '배포용 PPT 생성 엔진 선택이 필요합니다.',
  })
  mocks.renderIssueAnalysisPpt.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  mocks.loadTemplate.mockResolvedValue({ bytes: new Uint8Array([1]), source: 'default' })
  mocks.scan.mockResolvedValue({ placeholders: [ph('summary.project_name')], issues: [] })
  mocks.render.mockResolvedValue(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
})

describe('GET /api/issue-analysis', () => {
  it('필수 식별자가 없으면 가드 전에 400으로 거부한다', async () => {
    const response = await GET(request())
    expect(response.status).toBe(400)
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
  })

  it('프로젝트 멤버가 아니면 저장 실행과 렌더러에 접근하지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(403)
    expect(mocks.loadSavedIssueAnalysisRun).not.toHaveBeenCalled()
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.renderIssueAnalysisPpt).not.toHaveBeenCalled()
  })

  it('데이터 루트가 있으면 저장 실행으로 양식을 렌더하고 X-Form-Template 을 붙인다', async () => {
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('presentationml.presentation')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('X-Form-Template')).toBe('default')
    expect(response.headers.get('content-disposition')).toContain('Acme_%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8')
    expect(mocks.loadTemplate).toHaveBeenCalledWith('project-1', 'issue_analysis_pptx', null)
    expect(mocks.loadSavedIssueAnalysisRun).toHaveBeenCalledWith('project-1', 'run-1')
    expect(mocks.getDiagnostic).not.toHaveBeenCalled()
    expect(mocks.renderIssueAnalysisPpt).not.toHaveBeenCalled()
    expect(mocks.render).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        summary: expect.objectContaining({ author_name: '홍길동', author_team: 'PI', project_name: 'Acme 프로젝트' }),
      }),
      {},
      expect.objectContaining({ empty_text: '' }),
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
  })

  it('활성 양식이면 X-Form-Template 은 custom', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({
      'forms.issue_analysis_pptx': { ...defaultFormSetting('issue_analysis_pptx'), template_id: TPL },
    }))
    mocks.loadTemplate.mockResolvedValue({ bytes: new Uint8Array([2]), source: 'custom' })
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Form-Template')).toBe('custom')
    expect(mocks.loadTemplate).toHaveBeenCalledWith('project-1', 'issue_analysis_pptx', TPL)
  })

  it('데이터 루트가 없으면 저장 실행을 읽지 않는다', async () => {
    mocks.scan.mockResolvedValue({ placeholders: [ph('slide.page')], issues: [] })
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(200)
    expect(mocks.loadSavedIssueAnalysisRun).not.toHaveBeenCalled()
    expect(response.headers.get('X-Form-Template')).toBe('default')
  })

  it('저장된 실행이 없으면 404', async () => {
    mocks.loadSavedIssueAnalysisRun.mockResolvedValue(null)
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: '저장된 이슈 분석 실행을 찾을 수 없습니다.' })
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('양식 파일을 못 읽으면 500 이고 렌더하지 않는다', async () => {
    mocks.loadTemplate.mockRejectedValue(new mocks.FormTemplateLoadError('양식 파일을 읽지 못했습니다.'))
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: '양식 파일을 읽지 못했습니다.' })
    expect(mocks.render).not.toHaveBeenCalled()
    expect(mocks.loadSavedIssueAnalysisRun).not.toHaveBeenCalled()
  })

  it('양식 렌더 오류는 422 이고 위치가 없으면 location 을 빼며 unknown location 도 보내지 않는다', async () => {
    mocks.render.mockRejectedValue(new FormRenderError('MISSING_PATH', {}, 'summary.nope', '없는 경로'))
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: '없는 경로', code: 'MISSING_PATH', token: 'summary.nope' })
  })

  it('이 프로젝트 명단 팀이 없으면 작성 팀은 빈 값 — 다른 프로젝트 팀을 빌려오지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({
      ok: true,
      actor: makeMemberActor('project-1', [], { rosterTeams: new Map([['project-2', { teamIds: ['t-mes'], teamCodes: ['MES'] }]]) }),
    })
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(200)
    expect(mocks.render).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ summary: expect.objectContaining({ author_team: '' }) }),
      expect.anything(),
      expect.anything(),
    )
  })

  it('프로젝트 달력이 손상이면 422 CALENDAR_INVALID + 키 — 서울·UTC 로 대체하지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({}, {
      calendar: null,
      calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone'),
    }))
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: `${CONFIG_MESSAGES.CONFIG_INVALID} (calendar.timezone)`, code: 'CALENDAR_INVALID', key: 'calendar.timezone' })
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('프로젝트 설정 조회 실패는 503 고정 문구(원문은 로그)', async () => {
    mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await GET(request('?projectId=project-1&runId=run-1'))
    spy.mockRestore()
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: '프로젝트 설정을 확인할 수 없습니다.' })
  })

  it('custom 루트가 있을 때만 fields.issue 손상을 본다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'fields.issue': 'bad' }))
    const plain = await GET(request('?projectId=project-1&runId=run-1'))
    expect(plain.status).toBe(200)

    mocks.scan.mockResolvedValue({ placeholders: [ph('issues.custom.note')], issues: [] })
    const custom = await GET(request('?projectId=project-1&runId=run-1'))
    expect(custom.status).toBe(422)
    await expect(custom.json()).resolves.toMatchObject({ code: 'CONFIG_INVALID', key: 'fields.issue' })
    expect(mocks.render).toHaveBeenCalledTimes(1)
  })
})
