import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { findCarryOverSource, hasCarryOverSource, getWeeklySheet } from '@/lib/data/weeklySheet'

type DbRow = {
  id: string
  report_id: string
  area_id: string
  this_content: string
  this_issue: string
  next_content: string
  next_issue: string
}

type DbReport = { id: string; project_id: string; week_start: string; title: string | null }

// 합성 영역 id(단위 테스트 구간 18b0~18bf — weekly-create 와 같은 값)
const A_EXP = '00000000-0000-0000-7e57-0000000018b1'
const A_DATA = '00000000-0000-0000-7e57-0000000018b2'

function row(reportId: string, areaId: string, thisContent = ''): DbRow {
  return {
    id: `row-${reportId}-${areaId}`,
    report_id: reportId,
    area_id: areaId,
    this_content: thisContent,
    this_issue: '',
    next_content: `${areaId} 차주계획`,
    next_issue: '',
  }
}

/**
 * 이월 축(weekly_reports 단일 쿼리 + 임베드) 흉내.
 * '가장 최근 이전 주차 하나'를 실제 DB 와 같은 규칙(week_start < before, 최신 우선, 1건)으로 고르고,
 * select 문자열에 따라 count 임베드 또는 전체 행 임베드를 돌려준다.
 * lt/eq 는 실제 코드가 쓰는 컬럼만 허용한다 — lte 로 바뀌는 등의 시맨틱 드리프트는 즉시 실패한다.
 */
function stubCarryClient(state: { reports: DbReport[]; rowsByReport: Record<string, DbRow[]>; failWith?: string }) {
  const selects: string[] = []
  const orders: unknown[][] = []
  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'weekly_reports') throw new Error(`unexpected table: ${table}`)
      const filters: { projectId?: string; before?: string } = {}
      let sel = ''
      const q: Record<string, unknown> = {}
      q.select = vi.fn((s: string) => { sel = s; selects.push(s); return q })
      q.eq = vi.fn((col: string, v: string) => {
        if (col !== 'project_id') throw new Error(`unexpected eq column: ${col}`)
        filters.projectId = v
        return q
      })
      q.lt = vi.fn((col: string, v: string) => {
        if (col !== 'week_start') throw new Error(`unexpected lt column: ${col}`)
        filters.before = v
        return q
      })
      q.order = vi.fn((...a: unknown[]) => { orders.push(a); return q })
      q.limit = vi.fn(() => q)
      q.maybeSingle = vi.fn(async () => {
        if (state.failWith) return { data: null, error: { message: state.failWith } }
        const latest = state.reports
          .filter(r => r.project_id === filters.projectId && r.week_start < (filters.before ?? ''))
          .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))[0]
        if (!latest) return { data: null, error: null }
        const rows = state.rowsByReport[latest.id] ?? []
        const embed = sel.includes('weekly_report_rows(count)')
          ? [{ count: rows.length }]
          : [...rows]
        return { data: { ...latest, weekly_report_rows: embed }, error: null }
      })
      return q
    }),
  }
  mocks.createServerClient.mockResolvedValue(client as never)
  return { selects, orders }
}

/** 소비처(weekly/page.tsx)의 이월 제안 판정 원식 — 이 판정과 hasCarryOverSource 가 항상 일치해야 한다. */
async function legacyJudgment(projectId: string, before: string): Promise<boolean> {
  const src = await findCarryOverSource(projectId, before)
  return !!src && src.rows.length > 0
}

beforeEach(() => {
  mocks.createServerClient.mockReset()
})

describe('hasCarryOverSource — 판정 시맨틱 보존 (findCarryOverSource 기반 원판정과 등가)', () => {
  it('이전 문서가 없으면 둘 다 false', async () => {
    const state = { reports: [], rowsByReport: {} }
    stubCarryClient(state)
    const legacy = await legacyJudgment('p1', '2026-08-17')
    stubCarryClient(state)
    const light = await hasCarryOverSource('p1', '2026-08-17')
    expect(legacy).toBe(false)
    expect(light).toBe(legacy)
  })

  it('가장 최근 이전 문서에 행이 있으면 둘 다 true', async () => {
    const state = {
      reports: [
        { id: 'r-old', project_id: 'p1', week_start: '2026-08-03', title: null },
        { id: 'r-new', project_id: 'p1', week_start: '2026-08-10', title: '지난 주' },
      ],
      rowsByReport: {
        'r-old': [row('r-old', A_EXP)],
        'r-new': [row('r-new', A_EXP), row('r-new', A_DATA)],
      },
    }
    stubCarryClient(state)
    const legacy = await legacyJudgment('p1', '2026-08-17')
    stubCarryClient(state)
    const light = await hasCarryOverSource('p1', '2026-08-17')
    expect(legacy).toBe(true)
    expect(light).toBe(legacy)
  })

  it('가장 최근 이전 문서가 0행이면, 더 오래된 문서에 행이 있어도 둘 다 false(EXISTS-any 로 바꾸면 안 됨)', async () => {
    const state = {
      reports: [
        { id: 'r-old', project_id: 'p1', week_start: '2026-08-03', title: null },
        { id: 'r-empty', project_id: 'p1', week_start: '2026-08-10', title: null },
      ],
      rowsByReport: {
        'r-old': [row('r-old', A_EXP), row('r-old', A_DATA)],
        'r-empty': [],
      },
    }
    stubCarryClient(state)
    const legacy = await legacyJudgment('p1', '2026-08-17')
    stubCarryClient(state)
    const light = await hasCarryOverSource('p1', '2026-08-17')
    expect(legacy).toBe(false)
    expect(light).toBe(legacy)
  })

  it('해당 주 자신(week_start == before)은 원본이 아니다 — lt 경계 보존', async () => {
    const state = {
      reports: [{ id: 'r-same', project_id: 'p1', week_start: '2026-08-17', title: null }],
      rowsByReport: { 'r-same': [row('r-same', A_EXP)] },
    }
    stubCarryClient(state)
    const legacy = await legacyJudgment('p1', '2026-08-17')
    stubCarryClient(state)
    const light = await hasCarryOverSource('p1', '2026-08-17')
    expect(legacy).toBe(false)
    expect(light).toBe(legacy)
  })

  it('다른 프로젝트의 문서는 원본이 아니다', async () => {
    const state = {
      reports: [{ id: 'r-other', project_id: 'p2', week_start: '2026-08-10', title: null }],
      rowsByReport: { 'r-other': [row('r-other', A_EXP)] },
    }
    stubCarryClient(state)
    const legacy = await legacyJudgment('p1', '2026-08-17')
    stubCarryClient(state)
    const light = await hasCarryOverSource('p1', '2026-08-17')
    expect(legacy).toBe(false)
    expect(light).toBe(legacy)
  })

  it('조회 실패는 false 로 위장하지 않고 throw 한다(원판정과 동일한 실패 시맨틱)', async () => {
    stubCarryClient({ reports: [], rowsByReport: {}, failWith: 'boom' })
    await expect(hasCarryOverSource('p1', '2026-08-17')).rejects.toThrow('boom')
    stubCarryClient({ reports: [], rowsByReport: {}, failWith: 'boom' })
    await expect(findCarryOverSource('p1', '2026-08-17')).rejects.toThrow('boom')
  })

  it('판정 쿼리는 셀 내용 컬럼을 전혀 싣지 않는다(count 임베드만) — 페이로드 제거 증명', async () => {
    const { selects } = stubCarryClient({
      reports: [{ id: 'r1', project_id: 'p1', week_start: '2026-08-10', title: null }],
      rowsByReport: { r1: [row('r1', A_EXP, 'ㅁ'.repeat(1000))] },
    })
    await hasCarryOverSource('p1', '2026-08-17')
    expect(selects).toHaveLength(1)
    expect(selects[0]).toContain('weekly_report_rows(count)')
    for (const col of ['this_content', 'this_issue', 'next_content', 'next_issue']) {
      expect(selects[0]).not.toContain(col)
    }
  })
})

describe('findCarryOverSource — 임베드 1왕복화 이후에도 반환 계약 유지', () => {
  it('전체 셀 내용을 영역 행으로 돌려준다(이월 소비처 계약) — title null 은 빈 문자열, 지운 열을 읽지 않고 순서를 정하지 않는다', async () => {
    const { selects, orders } = stubCarryClient({
      reports: [{ id: 'r1', project_id: 'p1', week_start: '2026-08-10', title: null }],
      rowsByReport: { r1: [row('r1', A_DATA, '데이터 한 일'), row('r1', A_EXP, '실험 한 일')] },
    })
    const src = await findCarryOverSource('p1', '2026-08-17')
    expect(src?.report).toEqual({ id: 'r1', projectId: 'p1', weekStart: '2026-08-10', title: '' })
    expect(selects[0]).toContain('area_id')
    expect(selects[0]).toContain('this_content')
    for (const col of ['section', 'module', 'sort_order']) expect(selects[0]).not.toContain(col)
    expect(orders).toEqual([['week_start', { ascending: false }]])        // 임베드 참조 정렬(sort_order) 없음 — Q35
    expect(src?.rows.map(r => r.areaId)).toEqual([A_DATA, A_EXP])          // 받은 그대로
    expect(src?.rows[1]).toEqual({
      id: `row-r1-${A_EXP}`, reportId: 'r1', areaId: A_EXP,
      thisContent: '실험 한 일', thisIssue: '', nextContent: `${A_EXP} 차주계획`, nextIssue: '',
    })
  })

  it('이전 문서가 없으면 null', async () => {
    stubCarryClient({ reports: [], rowsByReport: {} })
    expect(await findCarryOverSource('p1', '2026-08-17')).toBeNull()
  })
})

/** getWeeklySheet 병렬화(문서·행 동시 조회) 이후의 에러 시맨틱 흉내 — 두 쿼리 결과를 독립 주입한다. */
function stubSheetClient(opts: {
  report: DbReport | null
  reportError?: string
  rows?: DbRow[]
  rowsError?: string
}) {
  const reportQuery: Record<string, unknown> = {}
  reportQuery.select = vi.fn(() => reportQuery)
  reportQuery.eq = vi.fn(() => reportQuery)
  reportQuery.maybeSingle = vi.fn(async () =>
    opts.reportError ? { data: null, error: { message: opts.reportError } } : { data: opts.report, error: null })

  const rowsQuery: Record<string, unknown> = {}
  rowsQuery.eq = vi.fn(() => rowsQuery)
  rowsQuery.order = vi.fn(async () =>
    opts.rowsError ? { data: null, error: { message: opts.rowsError } } : { data: opts.rows ?? [], error: null })
  const rowsTable = { select: vi.fn(() => rowsQuery), insert: vi.fn() }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'weekly_reports') return reportQuery
      if (table === 'weekly_report_rows') return rowsTable
      throw new Error(`unexpected table: ${table}`)
    }),
  }
  mocks.createServerClient.mockResolvedValue(client as never)
  return { insert: rowsTable.insert }
}

describe('getWeeklySheet — 병렬화 이후에도 에러·null 시맨틱 유지', () => {
  it('문서가 있는데 행 조회가 실패하면 throw(행 없음으로 위장 금지)', async () => {
    stubSheetClient({
      report: { id: 'r1', project_id: 'p1', week_start: '2026-08-17', title: '' },
      rowsError: 'rows down',
    })
    await expect(getWeeklySheet('p1', '2026-08-17')).rejects.toThrow('rows down')
  })

  it('문서 조회가 실패하면 throw', async () => {
    stubSheetClient({ report: null, reportError: 'reports down', rows: [] })
    await expect(getWeeklySheet('p1', '2026-08-17')).rejects.toThrow('reports down')
  })

  it('문서가 없으면 행 조회가 실패했어도 null(종전에는 행 조회 자체가 없었다)', async () => {
    const { insert } = stubSheetClient({ report: null, rowsError: 'rows down' })
    expect(await getWeeklySheet('p1', '2026-08-17')).toBeNull()
    expect(insert).not.toHaveBeenCalled()
  })
})
