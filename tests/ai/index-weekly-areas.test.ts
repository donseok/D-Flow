import { describe, expect, it, vi } from 'vitest'
import { createSupabaseIndexContentLoader } from '@/lib/ai/index/content'

// 주간 색인 로더(스펙 §4.1.6) — 행은 영역 id 로 묶이고 머리는 영역 이름이다. 지운 열(section·module·sort_order)을 읽지 않는다.
const PROJECT = '11111111-1111-4111-8111-111111111111'
const REPORT = '22222222-2222-4222-8222-222222222222'
const job = {
  entityType: 'weekly_report', entityId: REPORT, projectId: PROJECT,
  domain: 'weekly', operation: 'upsert' as const,
} as never

type Response = { data: unknown; error: unknown }
function builder(response: Response) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) b[m] = vi.fn(() => b)
  b.maybeSingle = vi.fn(async () => response)
  b.then = (resolve: (v: Response) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(response).then(resolve, reject)
  return b
}
function client(tables: { report: Response; rows: Response; areas: Response }) {
  const built = { report: builder(tables.report), rows: builder(tables.rows), areas: builder(tables.areas) }
  const from = vi.fn((table: string) => {
    if (table === 'weekly_reports') return built.report
    if (table === 'weekly_report_rows') return built.rows
    if (table === 'project_areas') return built.areas
    if (table === 'project_settings') return builder({ data: null, error: null })
    throw new Error(`예상 밖 표: ${table}`)
  })
  return { client: { from, rpc: vi.fn() } as never, built }
}
const REPORT_ROW = { id: REPORT, project_id: PROJECT, week_start: '2026-07-13', title: '', updated_at: '2026-07-17T08:00:00Z' }
const AREAS = [
  { id: 'a-ops', code: 'OPS-A', name: '운영', sort_order: 2, active: true },
  { id: 'a-exp', code: 'EXP', name: '실험', sort_order: 1, active: true },
  { id: 'a-old', code: 'OLD', name: '옛 영역', sort_order: 0, active: false },
]
const row = (areaId: string, thisContent: string, updatedAt = '2026-07-17T09:00:00Z') =>
  ({ area_id: areaId, this_content: thisContent, this_issue: '', next_content: '', next_issue: '', updated_at: updatedAt })

describe('주간 색인 로더 — 영역 이름 머리·시트 순서', () => {
  it('머리는 영역 이름(비활성은 표지), 순서는 영역 순서, 내용 없는 행은 싣지 않는다', async () => {
    const { client: c, built } = client({
      report: { data: REPORT_ROW, error: null },
      rows: { data: [row('a-ops', '운영 점검'), row('a-old', '옛 내용 보존'), row('a-exp', '실험 설계'), row('a-exp', '')], error: null },
      areas: { data: AREAS, error: null },
    })
    const result = await createSupabaseIndexContentLoader(c)(job)
    expect(result.ok).toBe(true)
    if (!result.ok || !result.data) throw new Error('스냅샷이 없다')
    const content = result.data.documents.map(d => d.content).join('\n')
    expect(content.indexOf('## 실험')).toBeGreaterThan(-1)
    expect(content.indexOf('## 실험')).toBeLessThan(content.indexOf('## 운영'))
    expect(content.indexOf('## 운영')).toBeLessThan(content.indexOf('## 옛 영역 (비활성)'))
    expect(content).toContain('금주 업무: 실험 설계')
    const rowSelect = String((built.rows.select as ReturnType<typeof vi.fn>).mock.calls[0][0])
    expect(rowSelect).not.toMatch(/\b(section|module|sort_order)\b/)
    expect(built.areas.eq).toHaveBeenCalledWith('kind', 'weekly_section')
  })

  it('다른 프로젝트의 문서면 내용을 읽기 전에 끊는다', async () => {
    const { client: c, built } = client({
      report: { data: { ...REPORT_ROW, project_id: '99999999-9999-4999-8999-999999999999' }, error: null },
      rows: { data: [], error: null }, areas: { data: [], error: null },
    })
    const result = await createSupabaseIndexContentLoader(c)(job)
    expect(result).toMatchObject({ ok: false, errorCode: 'INDEX_CONTENT_SCOPE_MISMATCH' })
    expect(built.rows.select).not.toHaveBeenCalled()
  })

  it('행·영역 조회 실패는 각자의 오류 코드다 — 빈 문서로 색인하지 않는다', async () => {
    const rowsFail = client({ report: { data: REPORT_ROW, error: null }, rows: { data: null, error: { code: '08006' } }, areas: { data: AREAS, error: null } })
    await expect(createSupabaseIndexContentLoader(rowsFail.client)(job)).resolves.toMatchObject({ ok: false, errorCode: 'WEEKLY_ROWS_READ_FAILED' })
    const areasFail = client({ report: { data: REPORT_ROW, error: null }, rows: { data: [], error: null }, areas: { data: null, error: { code: '08006' } } })
    await expect(createSupabaseIndexContentLoader(areasFail.client)(job)).resolves.toMatchObject({ ok: false, errorCode: 'WEEKLY_AREAS_READ_FAILED' })
  })
})
