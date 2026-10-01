// 가져오기 읽기 액션 둘(스펙 §4.4·§6.1). getImportReceipt — 본인 영수증을 그 프로젝트로 거른다(Q14: 같은 명령 id 의 다른 프로젝트
// 영수증은 receipt: null — 그렇지 않으면 P 화면이 Q 의 결과를 이 프로젝트의 실행으로 보인다). getWbsBackup — replace 사전 백업(D50)을
// 끝까지 읽는다(쪽 크기를 줄인 가짜 — 서버 상한이 쪽보다 작아도 빠지지 않는다). 읽기 실패·잘림은 ok:false 고정 문구, 원문은 로그로만(§4.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ guard: vi.fn(), server: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.guard }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.server }))

import { getImportReceipt } from '@/app/actions/importReceipts'
import { getWbsBackup } from '@/app/actions/importBackup'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'

const P = '00000000-0000-0000-7e57-0000000018a1'
const Q = '00000000-0000-0000-7e57-0000000018a2'
const K = '00000000-0000-0000-7e57-0000000018a3'
const ME = '00000000-0000-0000-7e57-0000000018a4'
const OTHER = '00000000-0000-0000-7e57-0000000018a5'
const ERR_RECEIPT = '실행 기록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_BACKUP = '지금 WBS 를 백업하지 못했습니다. 잠시 후 다시 시도하세요.'

type ReceiptRow = { actor: string; command_id: string; kind: string; project_id: string; result: unknown; created_at: string }
const receipt = (over: Partial<ReceiptRow> = {}): ReceiptRow => ({
  actor: ME, command_id: K, kind: 'wbs_import', project_id: P, created_at: '2026-10-01T01:02:03.000Z',
  result: { status: 'applied', mode: 'replace', count: 12, command_id: K }, ...over,
})

/** command_receipts 흉내 — RLS(command_receipts_own_read: actor = 세션 사용자) 뒤에 걸린 eq 를 모두 적용해 0·1행을 낸다
 *  (PK 가 (actor, command_id, kind) 라 maybeSingle 이 맞다). 걸린 표·열·필터를 기록한다 */
function receiptsClient(rows: ReceiptRow[], opts: { error?: string } = {}) {
  const filters: Array<[string, unknown]> = []
  const tables: string[] = []
  const selects: string[] = []
  const client = {
    from: (table: string) => {
      tables.push(table)
      const b: Record<string, unknown> = {}
      b.select = (cols: string) => { selects.push(cols); return b }
      b.eq = (col: string, v: unknown) => { filters.push([col, v]); return b }
      b.maybeSingle = async () => {
        if (opts.error) return { data: null, error: { message: opts.error, code: '42501' } }
        const visible = rows.filter((r) => r.actor === ME)
        const hit = visible.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v))
        if (hit.length > 1) return { data: null, error: { message: 'multiple rows returned', code: 'PGRST116' } }
        return { data: hit[0] ? { command_id: hit[0].command_id, result: hit[0].result, created_at: hit[0].created_at } : null, error: null }
      }
      return b
    },
  }
  return { client, filters, tables, selects }
}

/** wbs_items 쪽 읽기 흉내 — id 키셋(gt·order·limit)을 실제로 적용하고 한 응답을 maxRows(서버 상한)에서 자르며 count 는 총합(count: 'exact').
 *  호출을 기록한다(사전 백업도 가져오기 라우트의 교체 직전 백업과 같은 id 키셋 — A1-1 K2: offset 은 쪽 사이 삽입에서 중복·누락) */
function wbsClient(rows: Array<Record<string, unknown>>, opts: { maxRows?: number; count?: number; error?: string } = {}) {
  const calls = {
    tables: [] as string[], selects: [] as unknown[][], eqs: [] as Array<[string, unknown]>,
    orders: [] as string[], gts: [] as Array<[string, unknown]>, limits: [] as number[],
  }
  const client = {
    from: (table: string) => {
      calls.tables.push(table)
      let after: string | null = null
      let limit = Number.MAX_SAFE_INTEGER
      const b: Record<string, unknown> = {}
      b.select = (...a: unknown[]) => { calls.selects.push(a); return b }
      b.eq = (col: string, v: unknown) => { calls.eqs.push([col, v]); return b }
      b.gt = (col: string, v: unknown) => { calls.gts.push([col, v]); after = String(v); return b }
      b.order = (col: string) => { calls.orders.push(col); return b }
      b.limit = (n: number) => { limit = n; calls.limits.push(n); return b }
      b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (opts.error) return Promise.resolve({ data: null, error: { message: opts.error }, count: null }).then(res, rej)
        const hit = [...rows].sort((x, y) => (String(x.id) < String(y.id) ? -1 : 1)).filter((r) => after === null || String(r.id) > after)
        return Promise.resolve({ data: hit.slice(0, Math.min(limit, opts.maxRows ?? 1000)), error: null, count: opts.count ?? rows.length }).then(res, rej)
      }
      return b
    },
  }
  return { client, calls }
}
const item = (i: number) => ({ id: `w-${String(i).padStart(2, '0')}`, project_id: P, parent_id: null, name: `항목 ${i}` })

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ ok: true, actor: { userId: ME, isSuperuser: false } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks() })   // spyOn 만 되돌린다 — h 의 vi.fn 은 다음 beforeEach 가 다시 채운다

describe('getImportReceipt — 본인 영수증을 그 프로젝트로(Q14)', () => {
  it('그 프로젝트·명령 id 의 요약을 돌려준다 — 행위자·kind·프로젝트로 거른 세션 읽기', async () => {
    const s = receiptsClient([receipt()])
    h.server.mockResolvedValue(s.client)
    expect(await getImportReceipt(P, K)).toEqual({
      ok: true, receipt: { commandId: K, mode: 'replace', count: 12, createdAt: '2026-10-01T01:02:03.000Z' },
    })
    expect(h.guard).toHaveBeenCalledWith(P)
    expect(s.tables).toEqual(['command_receipts'])
    expect(s.selects).toEqual(['command_id, result, created_at'])
    expect(s.filters).toEqual(expect.arrayContaining([['actor', ME], ['command_id', K], ['kind', 'wbs_import'], ['project_id', P]]))
  })

  it('같은 명령 id 의 영수증이 다른 프로젝트 것이면 receipt: null — P 화면이 Q 의 실행을 보이지 않는다', async () => {
    h.server.mockResolvedValue(receiptsClient([receipt({ project_id: Q })]).client)
    expect(await getImportReceipt(P, K)).toEqual({ ok: true, receipt: null })
  })

  it('다른 사람의 같은 명령 id 영수증은 내 실행이 아니다 — receipt: null', async () => {
    h.server.mockResolvedValue(receiptsClient([receipt({ actor: OTHER })]).client)
    expect(await getImportReceipt(P, K)).toEqual({ ok: true, receipt: null })
  })

  it('가드가 거부하면 그 사유를 그대로 돌려주고 아무것도 읽지 않는다', async () => {
    h.guard.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await getImportReceipt(P, K)).toEqual({ ok: false, error: ERR_DENIED })
    h.guard.mockResolvedValue({ ok: false, error: ERR_MISSING })
    expect(await getImportReceipt(P, K)).toEqual({ ok: false, error: ERR_MISSING })
    expect(h.server).not.toHaveBeenCalled()
  })

  it('uuid 가 아닌 프로젝트·명령 id 는 가드 전에 거부한다', async () => {
    const cases: Array<[unknown, unknown]> = [['p1', K], [P, 'not-a-uuid'], [P, ''], [undefined, K], [P, null]]
    for (const [p, k] of cases) {
      expect(await getImportReceipt(p as string, k as string), `${String(p)}/${String(k)}`).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    }
    expect(h.guard).not.toHaveBeenCalled()
  })

  it('조회 오류는 고정 문구 — 원문은 로그로만, "영수증 없음"으로 위장하지 않는다', async () => {
    h.server.mockResolvedValue(receiptsClient([receipt()], { error: 'permission denied for table command_receipts' }).client)
    const r = await getImportReceipt(P, K)
    expect(r).toEqual({ ok: false, error: ERR_RECEIPT })
    expect(JSON.stringify(r)).not.toContain('permission denied')
    expect(console.error).toHaveBeenCalledWith(`[import-receipt] ${ERR_RECEIPT}`, expect.anything())
  })

  it('저장 결과의 모양이 어긋나면(모드·건수) 읽기 실패다 — 틀린 요약을 보이지 않는다', async () => {
    const bad = [{ status: 'applied', mode: 'merge', count: 3 }, { status: 'applied', mode: 'append', count: '3' },
      { status: 'applied', mode: 'append', count: -1 }, { status: 'applied', mode: 'append', count: 1.5 }, null]
    for (const result of bad) {
      h.server.mockResolvedValue(receiptsClient([receipt({ result })]).client)
      expect(await getImportReceipt(P, K), JSON.stringify(result)).toEqual({ ok: false, error: ERR_RECEIPT })
    }
  })
})

describe('getWbsBackup — replace 사전 백업을 끝까지(D50)', () => {
  it('서버 상한이 쪽보다 작아도 빠짐없이 — 그 프로젝트의 wbs_items 전부를 id 순으로, 생성 시각과 함께', async () => {
    const rows = Array.from({ length: 23 }, (_, i) => item(i + 1))
    const s = wbsClient(rows, { maxRows: 7 })
    h.server.mockResolvedValue(s.client)
    const r = await getWbsBackup(P)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.backup.rows).toEqual(rows)
    expect(Number.isNaN(Date.parse(r.backup.generatedAt))).toBe(false)
    expect(h.guard).toHaveBeenCalledWith(P)
    expect(new Set(s.calls.tables)).toEqual(new Set(['wbs_items']))
    expect(s.calls.eqs.length).toBeGreaterThan(0)
    expect(s.calls.eqs.every(([c, v]) => c === 'project_id' && v === P)).toBe(true)
    expect(s.calls.selects[0]).toEqual(['*', { count: 'exact' }])
    expect(s.calls.orders).toContain('id')
    expect(s.calls.gts).toEqual([['id', 'w-07'], ['id', 'w-14'], ['id', 'w-21'], ['id', 'w-23']])   // 서버 상한 7 — 빈 쪽까지 키셋으로
  })

  it('읽는 사이 행 수가 바뀌면(count 불일치) 잘린 백업을 주지 않는다 — ok:false 고정 문구, 원문은 로그로만', async () => {
    h.server.mockResolvedValue(wbsClient(Array.from({ length: 5 }, (_, i) => item(i + 1)), { count: 6 }).client)
    const r = await getWbsBackup(P)
    expect(r).toEqual({ ok: false, code: 'BACKUP_UNAVAILABLE', error: ERR_BACKUP })
    expect(JSON.stringify(r)).not.toMatch(/5\/6|끝까지 읽지 못했습니다/)
    expect(console.error).toHaveBeenCalledWith(`[import-backup] ${ERR_BACKUP}`, expect.anything())
  })

  it('조회 오류도 ok:false 고정 문구 — 원문은 응답에 없다', async () => {
    h.server.mockResolvedValue(wbsClient([], { error: 'canceling statement due to statement timeout' }).client)
    const r = await getWbsBackup(P)
    expect(r).toEqual({ ok: false, code: 'BACKUP_UNAVAILABLE', error: ERR_BACKUP })
    expect(JSON.stringify(r)).not.toContain('statement timeout')
  })

  it('빈 트리는 빈 백업이다(실패가 아니다)', async () => {
    h.server.mockResolvedValue(wbsClient([]).client)
    const r = await getWbsBackup(P)
    expect(r.ok).toBe(true)
    expect(r.ok && r.backup.rows).toEqual([])
  })

  it('가드가 거부하면 DENIED 와 가드 문구 — 읽지 않는다', async () => {
    h.guard.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await getWbsBackup(P)).toEqual({ ok: false, code: 'DENIED', error: ERR_DENIED })
    expect(h.server).not.toHaveBeenCalled()
  })

  it('uuid 가 아닌 프로젝트 id 는 가드 전에 거부한다', async () => {
    expect(await getWbsBackup('p1')).toEqual({ ok: false, code: 'INVALID_INPUT', error: '잘못된 요청입니다.' })
    expect(await getWbsBackup(undefined as unknown as string)).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(h.guard).not.toHaveBeenCalled()
  })
})
