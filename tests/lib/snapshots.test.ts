import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 진척 스냅샷 조회 실패를 '이력 0건'으로 돌려주면 buildTrend 가 (축 시작,0)→(오늘,실적) 추세선을 합성해
// 정상 차트처럼 보인다 — 로더는 실패를 결과로 돌려주고, 화면이 이력 실패를 알고 추세선을 그리지 않는다.
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: async () => [] }))

import { createServerClient } from '@/lib/supabase/server'
import { ERR_SNAPSHOTS_LOAD, getSnapshots } from '@/lib/data/snapshots'

type Reply = { data: unknown[] | null; error: { message: string } | null }

/** PostgREST 체인 스텁 — 마지막 await 에서 reply 를 돌려준다(issues-dashboard-loader.test.ts 관례). */
function makeSb(reply: Reply) {
  const calls = { tables: [] as string[], eq: [] as [string, unknown][] }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (k: string, v: unknown) => { calls.eq.push([k, v]); return chain }
  chain.order = () => chain
  chain.gt = () => chain
  chain.limit = () => chain
  chain.then = (res: unknown, rej: unknown) =>
    Promise.resolve({ ...reply, count: Array.isArray(reply.data) ? reply.data.length : null }).then(res as never, rej as never)
  const sb = { from: (t: string) => { calls.tables.push(t); return chain } }
  vi.mocked(createServerClient).mockResolvedValue(sb as never)
  return calls
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.mocked(createServerClient).mockReset()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

describe('getSnapshots — 실패를 결과로 돌려준다', () => {
  it('성공은 { ok: true, rows } — numeric 문자열은 숫자로', async () => {
    const calls = makeSb({ data: [{ snap_date: '2026-09-20', actual_pct: '12.5', planned_pct: 20 }], error: null })
    expect(await getSnapshots('p1')).toEqual({ ok: true, rows: [{ date: '2026-09-20', actual: 12.5, planned: 20 }] })
    expect(calls.tables).toEqual(['wbs_progress_snapshots'])
    expect(calls.eq).toEqual([['project_id', 'p1']])
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('조회 실패는 로그 후 { ok: false, error: ERR_SNAPSHOTS_LOAD } — 이력 0건으로 위장하지 않는다', async () => {
    makeSb({ data: null, error: { message: 'boom' } })
    expect(ERR_SNAPSHOTS_LOAD).toBe('진척 이력을 불러오지 못했습니다.')
    expect(await getSnapshots('p1')).toEqual({ ok: false, error: '진척 이력을 불러오지 못했습니다.' })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0].join(' ')).toContain('boom')
  })
})
