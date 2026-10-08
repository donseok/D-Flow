// /api/issue-analysis 가 제품 기본 양식으로 끝까지 도는지(정본 §4.8) — 양식 로드·스캔·카탈로그·엔진은 실물이고, 세션·DB 만 대역이다.
// 저장된 분석 실행(영역·이슈·원인·개선기회)이 표지 → 영역별 종합 → 이슈 목록 → 원인 분석 → 개선기회 장에 실린다.
import { TEST_AREAS, TEST_SEVERITY_CODES } from '../fixtures/issue-areas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'
import { buildIssueAnalysisInputSnapshot, buildIssueAnalysisReport } from '@/lib/report/issues/model'
import { makeMemberActor } from '../fixtures/actor'
import { SENTINELS_BY_SP, findSentinels, zipTextParts } from '../fixtures/legacy-sentinels'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

const mocks = vi.hoisted(() => ({
  requireProjectMember: vi.fn(),
  loadSavedIssueAnalysisRun: vi.fn(),
  getProjectConfig: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectMember: mocks.requireProjectMember }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => '작성자 갑') }))
vi.mock('@/lib/data/issueAnalysis', () => ({ loadSavedIssueAnalysisRun: mocks.loadSavedIssueAnalysisRun }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
import { GET } from '@/app/api/issue-analysis/route'

const [AREA_A, AREA_B] = TEST_AREAS

function issue(n: number, areaId: string, over: Partial<IssueAnalysisIssueInput> = {}): IssueAnalysisIssueInput {
  return {
    codeAreaId: null,
    id: `issue-${n}`,
    issueNo: n,
    projectId: 'project-1',
    title: `검토 지연 ${n}`,
    body: `승인 요청 ${n}건이 제때 전달되지 않는다.`,
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
    areaId,
    code: `ISS-${String(n).padStart(3, '0')}`,
    subProcess: '승인',
    ownerDepartment: `운영 ${n}팀`,
    relatedSystems: ['결재 시스템'],
    sourceType: 'interview',
    sourceDetail: '담당자 면담',
    ...over,
  }
}

/** withCauses=false 는 원인 분석 필드가 없던 옛 v1 저장 실행 — 개선기회는 그때도 필수였다(저장 실행 파서 계약) */
function savedRun(withCauses: boolean) {
  const issues = [issue(1, AREA_A.id), issue(2, AREA_A.id), issue(3, AREA_B.id)]
  const snapshot = buildIssueAnalysisInputSnapshot('project-1', issues, [], TEST_AREAS, TEST_SEVERITY_CODES)
  const report = buildIssueAnalysisReport(
    snapshot,
    {
      [AREA_A.code]: [{ title: '승인 흐름 일원화', description: '요청과 알림을 한 화면에서 처리한다.', issueIds: ['issue-1', 'issue-2'] }],
      [AREA_B.code]: [{ title: '인수인계 표준화', description: '담당 변경 절차를 정한다.', issueIds: ['issue-3'] }],
    },
    '2026-07-31T00:00:00Z',
    withCauses ? {
      [AREA_A.code]: [
        { issueId: 'issue-1', causes: [{ category: 'process', directCause: '승인 경로가 문서에만 있다.', rootCause: '책임자를 정한 규정이 없다.' }] },
        { issueId: 'issue-2', causes: [{ category: 'it', directCause: '알림이 꺼져 있다.', rootCause: null }] },
      ],
      [AREA_B.code]: [{ issueId: 'issue-3', causes: [{ category: 'organization', directCause: '담당이 자주 바뀐다.', rootCause: '인수인계 절차가 없다.' }] }],
    } : undefined,
  )
  return { areas: TEST_AREAS, runId: 'run-1', projectId: 'project-1', projectName: 'Acme 프로젝트', report }
}

const request = () => new NextRequest('http://localhost/api/issue-analysis?projectId=project-1&runId=run-1')
const slideText = async (bytes: Uint8Array) =>
  (await zipTextParts(bytes)).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p.name))
    .map((p) => [...p.text.matchAll(/<a:t\b[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('\n')).join('\n')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: makeMemberActor('project-1', ['T1'], { userId: 'user-1' }) })
  mocks.getProjectConfig.mockResolvedValue(makeProjectConfig())
  mocks.loadSavedIssueAnalysisRun.mockResolvedValue(savedRun(true))
})

describe('GET /api/issue-analysis — 제품 기본 양식', () => {
  it('저장 실행의 영역·이슈·원인·개선기회가 기본 양식에 실려 내려온다', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Form-Template')).toBe('default')
    expect(response.headers.get('content-type')).toContain('presentationml.presentation')
    expect(decodeURIComponent(response.headers.get('content-disposition') ?? '')).toContain('Acme_프로젝트_이슈분석서_2026-07-31.pptx')
    expect(mocks.loadSavedIssueAnalysisRun).toHaveBeenCalledWith('project-1', 'run-1')   // 기본 양식은 저장 실행을 요구한다

    const bytes = new Uint8Array(await response.arrayBuffer())
    const text = await slideText(bytes)
    expect(text).toContain('Acme 프로젝트 · 이슈 분석')
    expect(text).toContain('영역 2개 · 전체 3건')
    expect(text).toContain('작성 작성자 갑')
    for (const area of [AREA_A, AREA_B]) {
      expect(text, area.name).toContain(`${area.code} ${area.name}`)
      expect(text).toContain(`${area.code} ${area.name} · 이슈 목록`)
    }
    for (const code of ['ISS-001', 'ISS-002', 'ISS-003']) expect(text).toContain(`${code} · 원인 분석`)
    for (const value of [
      '승인 요청 3건이 제때 전달되지 않는다.', '운영 1팀', '결재 시스템',
      '승인 경로가 문서에만 있다.', '책임자를 정한 규정이 없다.', '알림이 꺼져 있다.', '추가 확인 필요', '인수인계 절차가 없다.',
      '개선기회 1 · 승인 흐름 일원화', '요청과 알림을 한 화면에서 처리한다.', '연결 이슈 ISS-001', '연결 이슈 ISS-002', '연결 이슈 ISS-003',
    ]) expect(text, value).toContain(value)
    expect(text).not.toContain('{{')
    expect((await zipTextParts(bytes)).flatMap((p) => findSentinels(p.text, SENTINELS_BY_SP.SP6))).toEqual([])
  })

  it('원인 분석이 없는 옛 저장 실행도 200 이다 — 원인 표는 머리 행만 남고 나머지 장은 그대로다', async () => {
    mocks.loadSavedIssueAnalysisRun.mockResolvedValue(savedRun(false))
    const response = await GET(request())
    expect(response.status).toBe(200)
    const text = await slideText(new Uint8Array(await response.arrayBuffer()))
    expect(text).toContain('ISS-003 · 원인 분석')
    expect(text).toContain('원인 분류')
    expect(text).not.toContain('승인 경로가 문서에만 있다.')
    expect(text).toContain('개선기회 1 · 인수인계 표준화')
    expect(text).not.toContain('{{')
  })

  it('저장된 실행이 없으면 404 — 빈 분석서를 만들어 주지 않는다', async () => {
    mocks.loadSavedIssueAnalysisRun.mockResolvedValue(null)
    const response = await GET(request())
    expect(response.status).toBe(404)
  })

  it('양식 설정이 손상이면 422 CONFIG_INVALID + 키 — 기본 양식으로 대체하지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'forms.issue_analysis_pptx': { template_id: 7 } }))
    const response = await GET(request())
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'CONFIG_INVALID', key: 'forms.issue_analysis_pptx' })
    expect(mocks.loadSavedIssueAnalysisRun).not.toHaveBeenCalled()
  })
})
