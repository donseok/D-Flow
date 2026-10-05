import { describe, expect, it } from 'vitest'
import type { IssueAnalysisIssueInput } from '@/lib/report/issues/model'
import { buildIssueAnalysisInputSnapshot, buildIssueAnalysisReport } from '@/lib/report/issues/model'
import { buildIssueAnalysisCatalog } from '@/lib/report/catalog/issueAnalysisBuild'
import { defaultVocab } from '@/lib/settings/vocab'
import { TEST_AREAS, TEST_SEVERITY_CODES } from '../../fixtures/issue-areas'

function issue(over: Partial<IssueAnalysisIssueInput> = {}): IssueAnalysisIssueInput {
  return {
    codeAreaId: null,
    id: 'issue-1',
    issueNo: 1,
    projectId: 'project-1',
    title: '기준정보 중복',
    body: '현황\n문제',
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
    ...over,
  }
}

function catalogFrom(issues: IssueAnalysisIssueInput[], areas = TEST_AREAS, generatedAt = '2026-07-30T15:00:00.000Z') {
  const snapshot = buildIssueAnalysisInputSnapshot('project-1', issues, [], areas, TEST_SEVERITY_CODES)
  const opportunities: Record<string, { title: string; description: string; issueIds: string[] }[]> = {}
  const causes: Record<string, { issueId: string; causes: { category: string; directCause: string; rootCause: string | null }[] }[]> = {}
  for (const row of issues) {
    const area = areas.find((item) => item.id === row.areaId)
    if (!area) continue
    opportunities[area.code] = [{ title: '단일화', description: '중복을 막는다.', issueIds: [row.id] }]
    causes[area.code] = [{
      issueId: row.id,
      causes: [{ category: 'process', directCause: '절차가 없다.', rootCause: null }],
    }]
  }
  const report = buildIssueAnalysisReport(snapshot, opportunities, generatedAt, causes)
  const sources = defaultVocab('issues.sources').map((row) =>
    row.code === 'interview' ? { ...row, label: '현장 인터뷰' } : row)
  return buildIssueAnalysisCatalog({
    report,
    areas,
    projectName: 'Acme',
    authorName: '홍길동',
    authorTeam: 'PI',
    timeZone: 'Asia/Seoul',
    severities: defaultVocab('issues.severities'),
    sources,
    causeCategories: defaultVocab('issues.cause_categories'),
    issueStatuses: defaultVocab('workflow.issue_statuses'),
  })
}

describe('buildIssueAnalysisCatalog (정본 §4.5.2)', () => {
  it('이슈가 있는 영역만 sort_order 로 싣고, 라벨은 설정값이다', () => {
    const areas = TEST_AREAS.map((area) => area.id === '00'
      ? { ...area, name: '바꾼이름', sortOrder: 5 }
      : area.id === '01'
        ? { ...area, sortOrder: 0 }
        : area)
    const catalog = catalogFrom([
      issue(),
      issue({ id: 'issue-2', issueNo: 2, areaId: '01', code: 'PI-I-01-01', title: '손익' }),
    ], areas)
    expect(catalog.summary).toMatchObject({
      project_name: 'Acme',
      author_name: '홍길동',
      author_team: 'PI',
      generated_at: '2026-07-30T15:00:00.000Z',
      date_label: '26.07.31',
      issue_count: 2,
      area_count: 2,
    })
    expect(catalog.areas.map((area) => area.code)).toEqual(['01', '00'])
    expect(catalog.areas[1].name).toBe('바꾼이름')
    const row = catalog.areas[1].issues[0]
    expect(row.body).toBe('현황\n문제')
    expect(row).not.toHaveProperty('area_code')
    expect(row.status).toBe('open')
    expect(row.status_code).toBe('open')
    expect(row.status_label).toBe('열림')
    expect(row.custom).toEqual({})
    expect(row.severity_label).toBe('높음')
    expect(row.source_lines[0]).toBe('현장 인터뷰')
    expect(row.causes[0]).toEqual({
      category: 'process',
      category_label: 'P · 프로세스',
      direct_cause: '절차가 없다.',
      root_cause: '추가 확인 필요',
    })
    expect(catalog.areas[1].summary.severity_counts).toEqual([
      { code: 'high', label: '높음', count: 1 },
      { code: 'medium', label: '보통', count: 0 },
      { code: 'low', label: '낮음', count: 0 },
    ])
    expect(catalog.issues[0]).toMatchObject({ area_code: '01', area_name: '손익관리' })
    expect(catalog.opportunities[0]).toMatchObject({ no: 1, area_code: '01', issues: [{ code: 'PI-I-01-01', title: '손익' }] })
  })

  it('회의록 원천 줄은 제품 고정 문구다', () => {
    const reportIssue = buildIssueAnalysisReport(
      buildIssueAnalysisInputSnapshot('project-1', [issue({ sourceType: null, sourceDetail: '' })], [], TEST_AREAS, TEST_SEVERITY_CODES),
      {},
      '2026-07-31T00:00:00.000Z',
    )
    reportIssue.areas.find((area) => area.areaId === '00')!.issues[0].source.minutes.push({
      id: 'm1',
      minuteId: 'min',
      minuteVersionId: 'mv',
      minuteVersionNo: 1,
      minuteTitle: '주간회의',
      minuteDate: '2026-07-01',
      excerpt: '',
      kind: 'manual',
    })
    const built = buildIssueAnalysisCatalog({
      report: reportIssue,
      areas: TEST_AREAS,
      projectName: 'Acme',
      authorName: '홍길동',
      authorTeam: '',
      timeZone: 'Asia/Seoul',
      severities: defaultVocab('issues.severities'),
      sources: defaultVocab('issues.sources'),
      causeCategories: defaultVocab('issues.cause_categories'),
      issueStatuses: defaultVocab('workflow.issue_statuses'),
    })
    expect(built.areas[0].issues[0].source_lines).toEqual(['회의록 · 2026-07-01 주간회의'])
  })

  it('비활성 심각도 라벨은 조회하고, 집계 목록에는 활성만 싣는다', () => {
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue({ severity: 'legacy' })], [], TEST_AREAS, TEST_SEVERITY_CODES)
    const report = buildIssueAnalysisReport(snapshot, {}, '2026-07-31T00:00:00.000Z')
    const severities = [
      ...defaultVocab('issues.severities'),
      { code: 'legacy', label: '구심각', rank: 9, color: 'neutral' as const, active: false },
    ]
    const catalog = buildIssueAnalysisCatalog({
      report,
      areas: TEST_AREAS,
      projectName: 'Acme',
      authorName: '작성자',
      authorTeam: '',
      timeZone: 'Asia/Seoul',
      severities,
      sources: defaultVocab('issues.sources'),
      causeCategories: defaultVocab('issues.cause_categories'),
      issueStatuses: defaultVocab('workflow.issue_statuses'),
    })
    expect(catalog.areas[0].issues[0].severity_label).toBe('구심각')
    expect(catalog.areas[0].summary.severity_counts.map((row) => row.code)).toEqual(['high', 'medium', 'low'])
  })

  it('설정에 없는 심각도는 throw 한다', () => {
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue()], [], TEST_AREAS, TEST_SEVERITY_CODES)
    const report = buildIssueAnalysisReport(snapshot, {}, '2026-07-31T00:00:00.000Z')
    report.areas.find((area) => area.areaId === '00')!.issues[0].severity = 'nope'
    expect(() => buildIssueAnalysisCatalog({
      report,
      areas: TEST_AREAS,
      projectName: 'Acme',
      authorName: '작성자',
      authorTeam: '',
      timeZone: 'Asia/Seoul',
      severities: defaultVocab('issues.severities'),
      sources: defaultVocab('issues.sources'),
      causeCategories: defaultVocab('issues.cause_categories'),
      issueStatuses: defaultVocab('workflow.issue_statuses'),
    })).toThrow(/심각도/)
  })

  it('표시 상태 라벨이 비어 있으면 기본 4범주 i18n 을 쓴다', () => {
    const statuses = defaultVocab('workflow.issue_statuses').map((row) =>
      row.code === 'open' ? { ...row, label: '' } : row)
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue()], [], TEST_AREAS, TEST_SEVERITY_CODES)
    const report = buildIssueAnalysisReport(snapshot, {}, '2026-07-31T00:00:00.000Z')
    const catalog = buildIssueAnalysisCatalog({
      report,
      areas: TEST_AREAS,
      projectName: 'Acme',
      authorName: '작성자',
      authorTeam: '',
      timeZone: 'Asia/Seoul',
      severities: defaultVocab('issues.severities'),
      sources: defaultVocab('issues.sources'),
      causeCategories: defaultVocab('issues.cause_categories'),
      issueStatuses: statuses,
    })
    expect(catalog.areas[0].issues[0].status_label).toBe('열림')
  })

  it('개선기회 연결 이슈가 5건을 넘으면 throw 한다', () => {
    const snapshot = buildIssueAnalysisInputSnapshot('project-1', [issue()], [], TEST_AREAS, TEST_SEVERITY_CODES)
    const report = buildIssueAnalysisReport(snapshot, {
      '00': [{ title: '많음', description: '초과', issueIds: ['issue-1', 'issue-1', 'issue-1', 'issue-1', 'issue-1', 'issue-1'] }],
    }, '2026-07-31T00:00:00.000Z')
    expect(() => buildIssueAnalysisCatalog({
      report,
      areas: TEST_AREAS,
      projectName: 'Acme',
      authorName: '작성자',
      authorTeam: '',
      timeZone: 'Asia/Seoul',
      severities: defaultVocab('issues.severities'),
      sources: defaultVocab('issues.sources'),
      causeCategories: defaultVocab('issues.cause_categories'),
      issueStatuses: defaultVocab('workflow.issue_statuses'),
    })).toThrow(/최대 5/)
  })
})
