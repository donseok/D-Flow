import { actionAreaId } from '../fixtures/issue-areas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type TableResult = { data: unknown[] | null; error: { message: string } | null }

const state = vi.hoisted(() => ({
  results: {} as Record<string, TableResult>,
  filters: [] as Array<[table: string, column: string, value: unknown]>,
}))

function thenableQuery(table: string, result: TableResult) {
  const query: Record<string, unknown> = {}
  query.select = vi.fn(() => query)
  query.eq = vi.fn((column: string, value: unknown) => {
    state.filters.push([table, column, value])
    return query
  })
  query.order = vi.fn(() => query)
  query.then = (
    resolve: (value: TableResult) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return query
}

const createServerClient = vi.hoisted(() => vi.fn(async () => ({
  from: (table: string) => thenableQuery(table, state.results[table]),
})))

vi.mock('@/lib/supabase/server', () => ({ createServerClient }))

import { loadIssueAnalysisIssues } from '@/lib/data/issueAnalysis'

const issueRow = {
  id: 'issue-1',
  issue_no: 3,
  project_id: 'project-1',
  title: '기준정보 중복',
  body: '본문',
  status: 'resolved',
  severity: 'medium',
  start_date: null,
  due_date: '2026-08-01',
  resolution_note: '완료',
  resolved_at: '2026-07-30T00:00:00Z',
  created_by: 'user-1',
  created_by_name: '테스터',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-30T00:00:00Z',
  area_id: actionAreaId('00'),
  mega_seq: 2,
  code: 'PI-I-00-02',
  major_id: 'major-1',
  sub_process: '자재 등록',
  owner_department: '기준정보팀',
  related_systems: ['ERP', 'MES'],
  source_type: 'minutes',
  source_detail: '',
}

beforeEach(() => {
  createServerClient.mockClear()
  state.filters = []
  state.results = {
    issues: { data: [issueRow], error: null },
    issue_assignees: {
      data: [{ issue_id: 'issue-1', member_id: 'member-1' }],
      error: null,
    },
    issue_links: {
      data: [{
        id: 'link-1',
        issue_id: 'issue-1',
        project_id: 'project-1',
        minute_id: 'minute-1',
        minute_version_id: 'version-1',
        minute_version_no: 2,
        minute_title_snapshot: 'PI 회의',
        minute_date_snapshot: '2026-07-20',
        body_hash: 'body-hash',
        block_index: 1,
        block_hash: 'block-hash',
        excerpt_snapshot: '회의록 근거',
        source_kind: 'manual',
        source_key: null,
        created_at: '2026-07-20T00:00:00Z',
      }],
      error: null,
    },
    issue_major_processes: {
      data: [{ id: 'major-1', area_id: actionAreaId('00'), major_seq: 1, name: '자재관리' }],
      error: null,
    },
  }
})

describe('loadIssueAnalysisIssues', () => {
  it('이슈·담당자·불변 회의록 스냅샷을 하나의 분석 입력으로 결합한다', async () => {
    const { issues } = await loadIssueAnalysisIssues('project-1')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      id: 'issue-1',
      code: 'PI-I-00-02',
      areaId: actionAreaId('00'),
      majorId: 'major-1',
      majorSeq: 1,
      majorName: '자재관리',
      status: 'resolved',
      assigneeMemberIds: ['member-1'],
      relatedSystems: ['ERP', 'MES'],
      sourceType: 'minutes',
    })
    expect(issues[0].minuteSources[0]).toMatchObject({
      id: 'link-1',
      minuteTitle: 'PI 회의',
      excerpt: '회의록 근거',
    })
  })

  it('Major 기준정보를 mega·seq 순으로 함께 반환한다', async () => {
    state.results.issue_major_processes = {
      data: [
        { id: 'm2', area_id: actionAreaId('02'), major_seq: 2, name: '수출관리' },
        { id: 'm1', area_id: actionAreaId('02'), major_seq: 1, name: '주문관리' },
        { id: 'major-1', area_id: actionAreaId('00'), major_seq: 1, name: '자재관리' },
      ],
      error: null,
    }
    const { majors } = await loadIssueAnalysisIssues('project-1')
    expect(majors.map(major => major.id)).toEqual(['major-1', 'm1', 'm2'])
    expect(majors[1]).toEqual({
      id: 'm1', areaId: actionAreaId('02'), majorSeq: 1, name: '주문관리',
    })
  })

  it('잘못된 영역 id의 Major 행이 오면 throw한다', async () => {
    state.results.issue_major_processes = {
      data: [{ id: 'm9', area_id: 'not-a-uuid', major_seq: 1, name: '유령 프로세스' }],
      error: null,
    }
    await expect(loadIssueAnalysisIssues('project-1')).rejects.toThrow('Major')
  })

  it('Mega 범위가 있으면 프로젝트 조건과 함께 issues 쿼리에 강제한다', async () => {
    await loadIssueAnalysisIssues('project-1', '00')
    expect(state.filters).toContainEqual(['issues', 'project_id', 'project-1'])
    expect(state.filters).toContainEqual(['issues', 'area_id', '00'])
  })

  it('전체 범위는 issues 쿼리에 Mega 조건을 추가하지 않는다', async () => {
    await loadIssueAnalysisIssues('project-1')
    expect(state.filters.some(([table, column]) => (
      table === 'issues' && column === 'area_id'
    ))).toBe(false)
  })

  it.each(['issues', 'issue_assignees', 'issue_links', 'issue_major_processes'])(
    '%s 조회 하나라도 실패하면 부분 결과 대신 throw한다',
    async table => {
      state.results[table] = { data: null, error: { message: `${table} down` } }
      await expect(loadIssueAnalysisIssues('project-1')).rejects.toThrow('조회 실패')
    },
  )
})
