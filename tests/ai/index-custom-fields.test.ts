import { beforeEach, describe, expect, it, vi } from 'vitest'

const configMock = vi.hoisted(() => ({
  defs: {
    wbs: [] as unknown[],
    issue: [] as unknown[],
    weekly: [] as unknown[],
  },
}))

vi.mock('@/lib/settings/projectConfig', () => ({
  getProjectConfig: vi.fn(async (projectId: string) => ({
    projectId,
    workspaceId: 'ws-1',
    revision: 1,
    keys: {
      'fields.wbs_item': { status: 'set', value: configMock.defs.wbs },
      'fields.issue': { status: 'set', value: configMock.defs.issue },
      'fields.weekly_row': { status: 'set', value: configMock.defs.weekly },
    },
  })),
}))

import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const WBS_ID = '22222222-2222-4222-8222-222222222222'
const ISSUE_ID = '33333333-3333-4333-8333-333333333333'
const REPORT_ID = '44444444-4444-4444-8444-444444444444'

type Response = { data: unknown; error: unknown }

function builder(response: Response) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) b[m] = vi.fn(() => b)
  b.maybeSingle = vi.fn(async () => response)
  b.then = (resolve: (v: Response) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(response).then(resolve, reject)
  return b
}

function mockClient(tableMap: Record<string, Response>) {
  const builders: Record<string, ReturnType<typeof builder>> = {}
  for (const [table, res] of Object.entries(tableMap)) {
    builders[table] = builder(res)
  }
  const from = vi.fn((table: string) => {
    if (builders[table]) return builders[table]
    return builder({ data: null, error: null })
  })
  return { client: { from, rpc: vi.fn() } as never, builders }
}

beforeEach(() => {
  configMock.defs.wbs = []
  configMock.defs.issue = []
  configMock.defs.weekly = []
})

describe('AI 색인 본문 사용자 정의 필드 반영', () => {
  describe('WBS 항목 (loadWbsItem)', () => {
    it('활성 및 검색 가능 필드만 레이블과 형식화된 값으로 본문에 포함한다', async () => {
      const customDefs = [
        {
          key: 'stage',
          label: '단계',
          description: '',
          type: 'select',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 1,
          options: [
            { code: 'dev', label: '개발단계', sort: 1, active: true },
            { code: 'test', label: '시험단계', sort: 2, active: true },
          ],
        },
        {
          key: 'count',
          label: '수량',
          description: '',
          type: 'number',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 2,
          limits: { unit: '개', decimals: 0 },
        },
        {
          key: 'hidden_memo',
          label: '내부메모',
          description: '',
          type: 'text',
          required: false,
          editable_by: 'member',
          show_in_list: false,
          searchable: false, // searchable: false -> 제외
          active: true,
          sort: 3,
        },
        {
          key: 'old_field',
          label: '과거필드',
          description: '',
          type: 'text',
          required: false,
          editable_by: 'member',
          show_in_list: false,
          searchable: true,
          active: false, // active: false -> 제외
          sort: 4,
        },
      ]

      configMock.defs.wbs = customDefs

      const { client } = mockClient({
        wbs_items: {
          data: {
            id: WBS_ID,
            project_id: PROJECT,
            code: 'WBS-100',
            name: '화면 설계',
            biz: '공통',
            deliverable: 'UI 설계서',
            planned_start: '2026-10-01',
            planned_end: '2026-10-15',
            actual_pct: 50,
            updated_at: '2026-10-05T00:00:00Z',
            item_owners: [],
            custom: {
              stage: 'dev',
              count: 10,
              hidden_memo: '극비내용',
              old_field: '과거값',
            },
          },
          error: null,
        },
      })

      const load = createSupabaseIndexContentLoader(client)
      const res = await load({
        entityType: 'wbs_item',
        entityId: WBS_ID,
        projectId: PROJECT,
        domain: 'wbs',
        operation: 'upsert',
      } as never)

      expect(res.ok).toBe(true)
      if (!res.ok || !res.data) throw new Error('스냅샷 생성 실패')
      const [doc] = res.data.documents
      expect(doc.content).toContain('단계: 개발단계')
      expect(doc.content).toContain('수량: 10 개')
      expect(doc.content).not.toContain('내부메모')
      expect(doc.content).not.toContain('극비내용')
      expect(doc.content).not.toContain('과거필드')
      expect(doc.content).not.toContain('과거값')
    })

    it('사용자 정의 값이 바뀌면 contentHash가 달라진다', async () => {
      const customDefs = [
        {
          key: 'vendor',
          label: '협력업체',
          description: '',
          type: 'text',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 1,
        },
      ]

      configMock.defs.wbs = customDefs

      const makeClientWithVendor = (vendorName: string) =>
        mockClient({
          wbs_items: {
            data: {
              id: WBS_ID,
              project_id: PROJECT,
              code: 'WBS-101',
              name: '서버 구축',
              biz: null,
              deliverable: null,
              planned_start: null,
              planned_end: null,
              actual_pct: null,
              updated_at: '2026-10-05T00:00:00Z',
              item_owners: [],
              custom: { vendor: vendorName },
            },
            error: null,
          },
        }).client

      const res1 = await createSupabaseIndexContentLoader(makeClientWithVendor('업체A'))({
        entityType: 'wbs_item',
        entityId: WBS_ID,
        projectId: PROJECT,
        domain: 'wbs',
        operation: 'upsert',
      } as never)
      const res2 = await createSupabaseIndexContentLoader(makeClientWithVendor('업체B'))({
        entityType: 'wbs_item',
        entityId: WBS_ID,
        projectId: PROJECT,
        domain: 'wbs',
        operation: 'upsert',
      } as never)

      expect(res1.ok && res2.ok).toBe(true)
      if (!res1.ok || !res1.data || !res2.ok || !res2.data) throw new Error('스냅샷 실패')
      expect(res1.data.documents[0].contentHash).not.toBe(res2.data.documents[0].contentHash)
    })
  })

  describe('이슈 (loadIssue)', () => {
    it('이슈의 사용자 정의 필드 값이 색인 마크다운 본문에 포함된다', async () => {
      const customDefs = [
        {
          key: 'impact_area',
          label: '영향 범위',
          description: '',
          type: 'text',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 1,
        },
        {
          key: 'root_cause',
          label: '근본 원인',
          description: '',
          type: 'multiselect',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 2,
          options: [
            { code: 'net', label: '네트워크', sort: 1, active: true },
            { code: 'db', label: '데이터베이스', sort: 2, active: true },
          ],
        },
      ]

      configMock.defs.issue = customDefs

      const { client } = mockClient({
        issues: {
          data: {
            id: ISSUE_ID,
            project_id: PROJECT,
            code: 'ISS-007',
            title: '결제 모듈 지연',
            body: '타임아웃 발생',
            status: 'in_progress',
            severity: 'critical',
            owner_department: '개발1팀',
            sub_process: '결제',
            resolution_note: '조치 중',
            due_date: '2026-10-10',
            related_systems: ['PG사'],
            created_at: '2026-10-01T00:00:00Z',
            updated_at: '2026-10-05T00:00:00Z',
            custom: {
              impact_area: '전체 결제창',
              root_cause: ['net', 'db'],
            },
          },
          error: null,
        },
      })

      const load = createSupabaseIndexContentLoader(client)
      const res = await load({
        entityType: 'issue',
        entityId: ISSUE_ID,
        projectId: PROJECT,
        domain: 'issues',
        operation: 'upsert',
      } as never)

      expect(res.ok).toBe(true)
      if (!res.ok || !res.data) throw new Error('스냅샷 실패')
      const [doc] = res.data.documents
      expect(doc.content).toContain('영향 범위: 전체 결제창')
      expect(doc.content).toContain('근본 원인: 네트워크, 데이터베이스')
    })
  })

  describe('주간보고 (loadWeeklyReport)', () => {
    it('주간보고 행의 사용자 정의 필드 값이 영역 섹션 아래에 포함된다', async () => {
      const customDefs = [
        {
          key: 'target_met',
          label: '목표 달성',
          description: '',
          type: 'boolean',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 1,
        },
      ]

      configMock.defs.weekly = customDefs

      const { client } = mockClient({
        weekly_reports: {
          data: {
            id: REPORT_ID,
            project_id: PROJECT,
            week_start: '2026-10-05',
            title: '10월 1주 주간보고',
            updated_at: '2026-10-05T00:00:00Z',
          },
          error: null,
        },
        weekly_report_rows: {
          data: [
            {
              area_id: 'area-dev',
              this_content: 'API 개발 완료',
              this_issue: '',
              next_content: '통합 테스트',
              next_issue: '',
              updated_at: '2026-10-05T01:00:00Z',
              custom: { target_met: true },
            },
          ],
          error: null,
        },
        project_areas: {
          data: [
            { id: 'area-dev', code: 'DEV', name: '개발본부', sort_order: 1, active: true },
          ],
          error: null,
        },
      })

      const load = createSupabaseIndexContentLoader(client)
      const res = await load({
        entityType: 'weekly_report',
        entityId: REPORT_ID,
        projectId: PROJECT,
        domain: 'weekly',
        operation: 'upsert',
      } as never)

      expect(res.ok).toBe(true)
      if (!res.ok || !res.data) throw new Error('스냅샷 실패')
      const content = res.data.documents.map(d => d.content).join('\n')
      expect(content).toContain('## 개발본부')
      expect(content).toContain('금주 업무: API 개발 완료')
      expect(content).toContain('목표 달성: 예')
    })

    it('본문 텍스트가 없고 사용자 정의 값만 있는 행도 색인에서 누락되지 않는다', async () => {
      const customDefs = [
        {
          key: 'status_flag',
          label: '진행 신호',
          description: '',
          type: 'text',
          required: false,
          editable_by: 'member',
          show_in_list: true,
          searchable: true,
          active: true,
          sort: 1,
        },
      ]

      configMock.defs.weekly = customDefs

      const { client } = mockClient({
        weekly_reports: {
          data: {
            id: REPORT_ID,
            project_id: PROJECT,
            week_start: '2026-10-05',
            title: '10월 1주 주간보고',
            updated_at: '2026-10-05T00:00:00Z',
          },
          error: null,
        },
        weekly_report_rows: {
          data: [
            {
              area_id: 'area-dev',
              this_content: '',
              this_issue: '',
              next_content: '',
              next_issue: '',
              updated_at: '2026-10-05T01:00:00Z',
              custom: { status_flag: '정상진행' },
            },
          ],
          error: null,
        },
        project_areas: {
          data: [
            { id: 'area-dev', code: 'DEV', name: '개발본부', sort_order: 1, active: true },
          ],
          error: null,
        },
      })

      const load = createSupabaseIndexContentLoader(client)
      const res = await load({
        entityType: 'weekly_report',
        entityId: REPORT_ID,
        projectId: PROJECT,
        domain: 'weekly',
        operation: 'upsert',
      } as never)

      expect(res.ok).toBe(true)
      if (!res.ok || !res.data) throw new Error('스냅샷 실패')
      const content = res.data.documents.map(d => d.content).join('\n')
      expect(content).toContain('## 개발본부')
      expect(content).toContain('진행 신호: 정상진행')
    })
  })
})
