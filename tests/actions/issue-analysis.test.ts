vi.mock('@/lib/issues/context', async () => ({ loadIssueEntryContext: async () => ({ ok: true, value: (await import('../fixtures/issue-areas')).TEST_ENTRY_CONTEXT }) }))
import { TEST_AREAS } from '../fixtures/issue-areas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  loadIssueAnalysisIssues: vi.fn(),
  ensureIssueAnalysis: vi.fn(),
  getProjectConfig: vi.fn(),
}))

vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/data/issueAnalysis', () => ({
  loadIssueAnalysisIssues: mocks.loadIssueAnalysisIssues,
}))
vi.mock('@/lib/ai/issue-analysis', () => ({
  ensureIssueAnalysis: mocks.ensureIssueAnalysis,
}))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))

import { ensureIssueAnalysisAction } from '@/app/actions/issueAnalysis'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { requireModule } from '@/lib/modules/gate'
import { defaultFormSetting } from '@/lib/settings/defs/forms'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const READY_MAJOR = {
  id: 'major-1',
  areaId: '00' as const,
  majorSeq: 1,
  name: '기준정보 표준화',
}
const SALES_MAJOR = {
  id: 'major-2',
  areaId: '02' as const,
  majorSeq: 1,
  name: '주문관리',
}

const readyIssue = (over: Partial<IssueAnalysisIssueInput> = {}): IssueAnalysisIssueInput => ({
    codeAreaId: null,
  id: '550e8400-e29b-41d4-a716-446655440000',
  issueNo: 1,
  code: 'PI-I-00-01',
  projectId: 'project-1',
  areaId: '00',

  majorId: 'major-1',
  majorSeq: 1,
  majorName: '기준정보 표준화',
  title: '기준정보 중복',
  body: '자재 코드가 중복 등록된다.',
  status: 'open',
  severity: 'high',
  assigneeMemberIds: [],
  startDate: null,
  dueDate: null,
  subProcess: '자재 등록',
  ownerDepartment: '기준정보팀',
  relatedSystems: ['ERP'],
  sourceType: 'interview',
  sourceDetail: '현업 인터뷰',
  minuteSources: [],
  resolutionNote: '',
  resolvedAt: null,
  createdBy: 'user-1',
  createdByName: '테스터',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-30T00:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({
    ok: true,
    actor: { userId: 'user-1' },
  })
  mocks.loadIssueAnalysisIssues.mockResolvedValue({
    issues: [readyIssue()],
    majors: [READY_MAJOR],
  })
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig())
})

describe('ensureIssueAnalysisAction', () => {
  it('프로젝트 멤버 가드가 실패하면 원본/AI에 접근하지 않는다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '권한 없음' })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      error: '권한 없음',
      preflight: null,
    })
    expect(mocks.loadIssueAnalysisIssues).not.toHaveBeenCalled()
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
  })

  it('허용되지 않은 Mega 범위는 원본/AI 조회 전에 거부한다', async () => {
    const result = await ensureIssueAnalysisAction('project-1', '99' as never)
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      error: '잘못된 영역 분석 범위입니다.',
      preflight: null,
    })
    expect(mocks.loadIssueAnalysisIssues).not.toHaveBeenCalled()
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
  })

  it('엄격 로더의 부분 조회 실패를 unavailable로 명시하고 AI를 호출하지 않는다', async () => {
    mocks.loadIssueAnalysisIssues.mockRejectedValue(
      new Error('[issue-analysis] 담당자 조회 실패: database unavailable'),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      preflight: null,
    })
    expect(result.error).toBe('이슈 분석 처리에 실패했습니다. 다시 시도하세요.')
    expect(result.error).not.toContain('담당자 조회 실패')
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('사전 점검 누락을 상세 preflight와 함께 blocked로 반환한다', async () => {
    mocks.loadIssueAnalysisIssues.mockResolvedValue({
      issues: [readyIssue({ areaId: null, code: 'PI-U001', majorId: null, majorSeq: null, majorName: null })],
      majors: [],
    })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'blocked',
      preflight: { totalCount: 1, readyCount: 0, blockedCount: 1 },
    })
    expect(result.preflight?.blockedIssues[0].reasons).toContain(
      '이슈 영역이 지정되지 않았거나 현재 영역 목록에 없습니다.',
    )
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
  })

  it('생성 성공 시 runId/analysis 와 다운로드 가능 판정(기본 양식)을 전달한다', async () => {
    const analysis = {
      schemaVersion: 'issue-analysis.v1',
      projectId: 'project-1',
      issueCount: 1,
      generatedAt: '2026-07-31T00:00:00Z',
      areas: [],
    }
    mocks.ensureIssueAnalysis.mockResolvedValue({
      state: 'generated',
      runId: 'run-1',
      analysis,
      inputHash: 'a'.repeat(64),
      model: 'test-model',
    })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: true,
      state: 'generated',
      runId: 'run-1',
      analysis,
    })
    expect(result.pptExport).toEqual({ status: 'ready', source: 'default' })
    expect(Object.keys(result)).not.toContain('template')   // 옛 양식 파일 진단은 싣지 않는다
    expect(mocks.loadIssueAnalysisIssues).toHaveBeenCalledWith('project-1', undefined)
    expect(mocks.ensureIssueAnalysis).toHaveBeenCalledWith(
      'project-1',
      expect.any(Array),
      [READY_MAJOR],
      'user-1',
      TEST_AREAS,
      { severityCodes: ['high', 'medium', 'low'], analysis: undefined },
    )
  })

  it('선택 Mega만 엄격 로더와 AI 입력 범위로 전달한다', async () => {
    const salesIssue = readyIssue({
      id: '550e8400-e29b-41d4-a716-446655440002',
      areaId: '02',

      code: 'PI-I-02-01',
      title: '주문 승인 지연',
    })
    mocks.loadIssueAnalysisIssues.mockResolvedValue({
      issues: [salesIssue],
      majors: [SALES_MAJOR],
    })
    mocks.ensureIssueAnalysis.mockResolvedValue({
      state: 'unavailable',
      reason: 'llm_missing',
      error: 'LLM 미설정',
      inputHash: 'a'.repeat(64),
    })

    await ensureIssueAnalysisAction('project-1', '02')

    expect(mocks.loadIssueAnalysisIssues).toHaveBeenCalledWith('project-1', '02')
    expect(mocks.ensureIssueAnalysis).toHaveBeenCalledWith(
      'project-1',
      [salesIssue],
      [SALES_MAJOR],
      'user-1',
      TEST_AREAS,
      { severityCodes: ['high', 'medium', 'low'], analysis: undefined },
    )
  })

  it('선택 Mega에 이슈가 없으면 빈 범위로 차단하고 AI를 호출하지 않는다', async () => {
    mocks.loadIssueAnalysisIssues.mockResolvedValue({ issues: [], majors: [] })

    const result = await ensureIssueAnalysisAction('project-1', '07')

    expect(result).toMatchObject({
      ok: false,
      state: 'blocked',
      error: '분석할 이슈가 없습니다.',
      preflight: { totalCount: 0 },
    })
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
  })

  it('로더가 선택 Mega 밖의 행을 반환하면 fail-closed로 중단한다', async () => {
    mocks.loadIssueAnalysisIssues.mockResolvedValue({
      issues: [readyIssue({ areaId: '00' })],
      majors: [READY_MAJOR],
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await ensureIssueAnalysisAction('project-1', '02')

    expect(result).toMatchObject({ ok: false, state: 'unavailable', preflight: null })
    expect(result.error).toBe('이슈 분석 처리에 실패했습니다. 다시 시도하세요.')
    expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('LLM 미설정/생성 실패를 명시적 unavailable로 전달한다', async () => {
    mocks.ensureIssueAnalysis.mockResolvedValue({
      state: 'unavailable',
      reason: 'llm_missing',
      error: 'LLM 설정이 없어 이슈 분석서를 생성할 수 없습니다.',
      inputHash: 'a'.repeat(64),
    })
    const result = await ensureIssueAnalysisAction('project-1')
    expect(result).toMatchObject({
      ok: false,
      state: 'unavailable',
      error: 'LLM 설정이 없어 이슈 분석서를 생성할 수 없습니다.',
      preflight: { readyCount: 1, blockedCount: 0 },
    })
  })

  describe('다운로드 가능 판정(pptExport) — 저장 실행 + 양식 설정 forms.issue_analysis_pptx', () => {
    const generated = () => mocks.ensureIssueAnalysis.mockResolvedValue({
      state: 'ready',
      runId: 'run-1',
      analysis: { schemaVersion: 'issue-analysis.v1', projectId: 'project-1', issueCount: 1, generatedAt: '2026-07-31T00:00:00Z', areas: [] },
      inputHash: 'a'.repeat(64),
      model: 'test-model',
    })

    it('프로젝트가 올린 활성 양식이면 source 는 custom', async () => {
      generated()
      mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({
        'forms.issue_analysis_pptx': { ...defaultFormSetting('issue_analysis_pptx'), template_id: '11111111-1111-4111-8111-111111111111' },
      }))
      expect((await ensureIssueAnalysisAction('project-1')).pptExport).toEqual({ status: 'ready', source: 'custom' })
    })

    it('양식 설정이 손상이면 분석 결과는 주되 다운로드는 닫는다', async () => {
      generated()
      mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'forms.issue_analysis_pptx': { template_id: 7 } }))
      const result = await ensureIssueAnalysisAction('project-1')
      expect(result).toMatchObject({ ok: true, runId: 'run-1' })
      expect(result.pptExport).toEqual({ status: 'unavailable', reason: 'form_setting_invalid' })
    })

    it('설정을 읽지 못하면 모르는 상태로 닫는다(fail-closed) — 원문은 로그', async () => {
      generated()
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('db down'))
      const result = await ensureIssueAnalysisAction('project-1')
      expect(result).toMatchObject({ ok: true, runId: 'run-1' })
      expect(result.pptExport).toEqual({ status: 'unavailable', reason: 'form_setting_unknown' })
      expect(JSON.stringify(result)).not.toContain('db down')
      errorSpy.mockRestore()
    })

    it('저장 실행이 없으면(생성 실패·차단) 판정을 싣지 않고 양식 설정도 읽지 않는다', async () => {
      mocks.ensureIssueAnalysis.mockResolvedValue({ state: 'unavailable', reason: 'llm_missing', error: 'LLM 없음', inputHash: 'a'.repeat(64) })
      const result = await ensureIssueAnalysisAction('project-1')
      expect(result.ok).toBe(false)
      expect(result.pptExport).toBeUndefined()
      expect(mocks.getProjectConfig).not.toHaveBeenCalled()
    })

    it('이슈 분석 모듈이 꺼져 있으면 실행도 판정도 없다', async () => {
      vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
      const result = await ensureIssueAnalysisAction('project-1')
      expect(result).toMatchObject({ ok: false, state: 'unavailable', error: ERR_MODULE_DISABLED })
      expect(result.pptExport).toBeUndefined()
      expect(mocks.ensureIssueAnalysis).not.toHaveBeenCalled()
      expect(mocks.getProjectConfig).not.toHaveBeenCalled()
    })
  })
})
