// getWeeklySheet 는 읽기만 한다(스펙 §4.1.2, W16) — 옛 지연 백필(ensureStandardRows)의 세 경우가 이제는 쓰기 0 이다.
// 문서를 먼저 읽고(project_id·week_start) 행은 그 문서(report_id)·그 프로젝트(project_id)로 거른다 — 임베드·정렬 없음.
// 보이는 행·순서는 호출부(페이지·보고 라우트)가 영역으로 정한다(visibleRows, D32).
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { findWeeklyReportId, getWeeklySheet } from '@/lib/data/weeklySheet'

type DbReport = { id: string; project_id: string; week_start: string; title: string | null }
type DbRow = {
  id: string; report_id: string; area_id: string
  this_content: string; this_issue: string; next_content: string; next_issue: string
}
type Call = { table: string; select: string | null; eq: [string, unknown][]; ordered: number }

const REPORT: DbReport = { id: 'rep-1', project_id: 'p1', week_start: '2026-09-21', title: null }
const dbRow = (id: string, areaId: string, thisContent = ''): DbRow => ({
  id, report_id: REPORT.id, area_id: areaId, this_content: thisContent, this_issue: '', next_content: '', next_issue: '',
})

/** 두 표의 쿼리를 기록하는 가짜 — 쓰기 메서드는 부르면 센다(읽기 경로의 쓰기 0 을 증명한다). */
function stub(opts: { report: DbReport | null; rows?: DbRow[]; reportError?: string; rowsError?: string }) {
  const calls: Call[] = []
  const writes = vi.fn()
  const build = (table: string) => {
    const call: Call = { table, select: null, eq: [], ordered: 0 }
    calls.push(call)
    const q: Record<string, unknown> = {}
    q.select = vi.fn((s: string) => { call.select = s; return q })
    q.eq = vi.fn((col: string, v: unknown) => { call.eq.push([col, v]); return q })
    q.order = vi.fn(() => { call.ordered += 1; return q })
    for (const m of ['insert', 'upsert', 'update', 'delete']) q[m] = vi.fn(() => { writes(table, m); return q })
    q.maybeSingle = vi.fn(async () => (opts.reportError
      ? { data: null, error: { message: opts.reportError } } : { data: opts.report, error: null }))
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(opts.rowsError
      ? { data: null, error: { message: opts.rowsError } } : { data: opts.rows ?? [], error: null }).then(resolve, reject)
    return q
  }
  mocks.createServerClient.mockResolvedValue({ from: vi.fn(build) } as never)
  return { calls, writes }
}

describe('getWeeklySheet — 읽기만 한다(W16)', () => {
  it('활성 영역 하나의 행이 없어도 백필하지 않는다 — 받은 행 그대로, 쓰기 0', async () => {
    const { writes } = stub({ report: REPORT, rows: [dbRow('r-exp', 'a-exp', '실험 내용'), dbRow('r-ops', 'a-ops')] })
    const sheet = await getWeeklySheet('p1', '2026-09-21')
    expect(writes).not.toHaveBeenCalled()
    expect(sheet?.rows.map(r => r.id)).toEqual(['r-exp', 'r-ops'])
  })

  it('행이 0개인 문서도 그대로 돌려준다 — 안내는 화면 몫([RF4]), 쓰기 0', async () => {
    const { writes } = stub({ report: REPORT, rows: [] })
    expect(await getWeeklySheet('p1', '2026-09-21')).toEqual({
      report: { id: 'rep-1', projectId: 'p1', weekStart: '2026-09-21', title: '' }, rows: [],
    })
    expect(writes).not.toHaveBeenCalled()
  })

  it('비활성·모르는 영역의 행도 걸러 내지 않는다 — 보이는 행은 호출부가 정한다(visibleRows), 쓰기 0', async () => {
    const { writes } = stub({ report: REPORT, rows: [dbRow('r-old', 'a-old'), dbRow('r-x', 'a-unknown', '남은 내용')] })
    const sheet = await getWeeklySheet('p1', '2026-09-21')
    expect(sheet?.rows.map(r => [r.id, r.areaId])).toEqual([['r-old', 'a-old'], ['r-x', 'a-unknown']])
    expect(writes).not.toHaveBeenCalled()
  })

  it('행은 영역 행 모양으로 옮긴다(section·module·sortOrder 없음)', async () => {
    stub({ report: REPORT, rows: [{ ...dbRow('r-exp', 'a-exp', '금주'), this_issue: '이슈', next_content: '차주', next_issue: '행사' }] })
    const sheet = await getWeeklySheet('p1', '2026-09-21')
    expect(sheet?.rows).toEqual([{
      id: 'r-exp', reportId: 'rep-1', areaId: 'a-exp',
      thisContent: '금주', thisIssue: '이슈', nextContent: '차주', nextIssue: '행사',
      custom: null,
    }])
  })
})

describe('getWeeklySheet — 쿼리 모양(스펙 §4.1.2·Q35·W21)', () => {
  it('문서를 먼저 프로젝트·주차로, 행은 그 문서·그 프로젝트로 — 임베드·지운 열·정렬 없음', async () => {
    const { calls } = stub({ report: REPORT, rows: [] })
    await getWeeklySheet('p1', '2026-09-21')
    expect(calls.map(c => c.table)).toEqual(['weekly_reports', 'weekly_report_rows'])
    expect(calls[0].eq).toEqual([['project_id', 'p1'], ['week_start', '2026-09-21']])
    expect(calls[1].select).toBe('id, report_id, area_id, this_content, this_issue, next_content, next_issue, custom')
    expect(calls[1].select).not.toMatch(/!inner|weekly_reports\(|\bsection\b|\bmodule\b|sort_order/)
    expect(calls[1].eq).toEqual([['report_id', 'rep-1'], ['project_id', 'p1']])
    expect(calls[1].ordered).toBe(0)
  })

  it('문서가 없으면 null 이고 행을 읽지 않는다', async () => {
    const { calls } = stub({ report: null, rows: [dbRow('r', 'a')] })
    expect(await getWeeklySheet('p1', '2026-09-21')).toBeNull()
    expect(calls.map(c => c.table)).toEqual(['weekly_reports'])
  })
})

describe('findWeeklyReportId — 이월 판정 앞의 존재 확인(A1-4 리뷰 P7)', () => {
  it('그 프로젝트·그 주의 문서 id, 없으면 null — 읽기만 한다', async () => {
    const { calls, writes } = stub({ report: REPORT })
    expect(await findWeeklyReportId('p1', '2026-09-21')).toBe('rep-1')
    expect(calls).toEqual([{ table: 'weekly_reports', select: 'id', eq: [['project_id', 'p1'], ['week_start', '2026-09-21']], ordered: 0 }])
    stub({ report: null })
    expect(await findWeeklyReportId('p1', '2026-09-21')).toBeNull()
    expect(writes).not.toHaveBeenCalled()
  })

  it('조회 실패는 throw — 없음으로 위장하지 않는다', async () => {
    stub({ report: null, reportError: 'permission denied' })
    await expect(findWeeklyReportId('p1', '2026-09-21')).rejects.toThrow('permission denied')
  })
})
