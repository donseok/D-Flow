// 이력 읽기(history.ts) — 쪽 나눔(id 내림차순, 커서 before), 명령 결과 찾기(자기 명령만), 재기준용 changedKeysSince.
import { describe, expect, it } from 'vitest'
import { HISTORY_PAGE, changedKeysSince, findCommandOutcome, latestKeyChange, listHistory } from '@/lib/settings/history'

function fake(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const q: { table?: string; filters: string[]; order?: string; limit?: number } = { filters: [] }
  const b: Record<string, unknown> = {}
  b.from = (t: string) => { q.table = t; return b }
  b.select = () => b
  b.eq = (c: string, v: unknown) => { q.filters.push(`${c}=${v}`); return b }
  b.gt = (c: string, v: unknown) => { q.filters.push(`${c}>${v}`); return b }
  b.lt = (c: string, v: unknown) => { q.filters.push(`${c}<${v}`); return b }
  b.order = (c: string, o: { ascending: boolean }) => { q.order = `${c}:${o.ascending ? 'asc' : 'desc'}`; return b }
  b.limit = (n: number) => { q.limit = n; return b }
  b.then = (res: (x: unknown) => void) => res({ data: error ? null : rows, error })
  return { client: b as never, q }
}
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id, revision: id, key: 'core.extra_axis_label', old_value: null, new_value: 'x', source: 'edit', copied_from: null,
  command_id: `cmd-${id}`, changed_by: 'u1', changed_at: '2026-09-28T00:00:00Z', ...over,
})

describe('listHistory', () => {
  it('프로젝트 이력 표를 id 내림차순으로 limit+1 읽고 다음 커서를 낸다', async () => {
    const rows = Array.from({ length: HISTORY_PAGE + 1 }, (_, i) => row(100 - i))
    const { client, q } = fake(rows)
    const r = await listHistory(client, { projectId: 'p1' })
    expect(q.table).toBe('project_settings_history'); expect(q.filters).toEqual(['project_id=p1']); expect(q.order).toBe('id:desc'); expect(q.limit).toBe(HISTORY_PAGE + 1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.rows).toHaveLength(HISTORY_PAGE)
      expect(r.rows[0]).toEqual({ id: 100, revision: 100, key: 'core.extra_axis_label', oldValue: null, newValue: 'x', source: 'edit', commandId: 'cmd-100', changedBy: 'u1', changedAt: '2026-09-28T00:00:00Z', copiedFrom: null })
      expect(r.nextBefore).toBe(81)
    }
  })
  it('before 커서와 워크스페이스 표, 마지막 쪽은 nextBefore null. limit 은 1~100 으로 자른다', async () => {
    const { client, q } = fake([row(5), row(4)])
    const r = await listHistory(client, { workspaceId: 'w1' }, { before: 6, limit: 500 })
    expect(q.table).toBe('workspace_settings_history'); expect(q.filters).toEqual(['workspace_id=w1', 'id<6']); expect(q.limit).toBe(101)
    expect(r).toMatchObject({ ok: true })                          // 좁히기 전에 — ok:false 면 아래 단언이 조용히 건너뛰어진다(FM-5)
    if (r.ok) expect(r.nextBefore).toBeNull()
  })
  it('조회 실패는 ok:false — 빈 목록으로 위장하지 않는다', async () => {
    expect(await listHistory(fake([], { message: 'down' }).client, { projectId: 'p1' })).toEqual({ ok: false, error: expect.stringContaining('down') })
  })
})

describe('findCommandOutcome·changedKeysSince', () => {
  it('자기(changed_by) 명령의 행이 있으면 applied 와 revision, 없으면 unknown', async () => {
    const a = fake([row(7, { command_id: 'c1' })])
    expect(await findCommandOutcome(a.client, { projectId: 'p1' }, 'c1', 'u1')).toEqual({ ok: true, outcome: { status: 'applied', revision: 7 } })
    expect(a.q.filters).toEqual(['project_id=p1', 'command_id=c1', 'changed_by=u1'])
    expect(await findCommandOutcome(fake([]).client, { projectId: 'p1' }, 'c1', 'u1')).toEqual({ ok: true, outcome: { status: 'unknown' } })
    expect((await findCommandOutcome(fake([], { message: 'x' }).client, { projectId: 'p1' }, 'c1', 'u1')).ok).toBe(false)
  })
  it('changedKeysSince 는 revision 이 큰 행들의 키 집합', async () => {
    const a = fake([row(9, { key: 'a.b' }), row(8, { key: 'c.d' }), row(7, { key: 'a.b' })])
    expect(await changedKeysSince(a.client, { workspaceId: 'w1' }, 6)).toEqual({ ok: true, keys: ['a.b', 'c.d'], truncated: false })
    expect(a.q.filters).toEqual(['workspace_id=w1', 'revision>6'])
  })
  it('changedKeysSince — 한도만큼 돌아오면 truncated(PostgREST max_rows 도 같은 수에서 자른다 — FN-4)', async () => {
    const full = fake(Array.from({ length: 1000 }, (_, i) => row(2000 - i, { key: 'a.b' })))
    expect(await changedKeysSince(full.client, { projectId: 'p1' }, 1)).toEqual({ ok: true, keys: ['a.b'], truncated: true })
    expect(full.q.limit).toBe(1000)
    const under = fake(Array.from({ length: 999 }, (_, i) => row(2000 - i, { key: 'a.b' })))
    expect(await changedKeysSince(under.client, { projectId: 'p1' }, 1)).toEqual({ ok: true, keys: ['a.b'], truncated: false })
  })
})

describe('latestKeyChange — 한 키의 최신 변경 시각(SP4 D48 — Excel 표기의 날짜)', () => {
  const fake = (rows: Array<Record<string, unknown>>, error: { message: string } | null = null) => {
    const calls: Array<[string, unknown[]]> = []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = (...a: unknown[]) => { calls.push([m, a]); return q }
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : rows, error }).then(res)
    return { client: { from: (t: string) => { calls.push(['from', [t]]); return q } }, calls }
  }
  it('그 프로젝트·그 키의 가장 최근 changed_at — 이력 표를 id 내림차순 1행', async () => {
    const { client, calls } = fake([{ changed_at: '2026-09-30T03:00:00Z' }])
    expect(await latestKeyChange(client as never, { projectId: 'p1' }, 'wbs.excel_profile')).toEqual({ ok: true, changedAt: '2026-09-30T03:00:00Z' })
    expect(calls).toEqual(expect.arrayContaining([
      ['from', ['project_settings_history']], ['eq', ['project_id', 'p1']], ['eq', ['key', 'wbs.excel_profile']],
      ['order', ['id', { ascending: false }]], ['limit', [1]],
    ]))
  })
  it('이력이 없으면 changedAt null(저장 양식은 있는데 이력이 없는 옛 데이터), 조회 오류는 ok:false', async () => {
    expect(await latestKeyChange(fake([]).client as never, { projectId: 'p1' }, 'wbs.excel_profile')).toEqual({ ok: true, changedAt: null })
    expect((await latestKeyChange(fake([], { message: 'boom' }).client as never, { projectId: 'p1' }, 'wbs.excel_profile')).ok).toBe(false)
  })
})
