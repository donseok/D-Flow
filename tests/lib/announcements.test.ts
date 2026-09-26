import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 공지 조회 실패를 '공지 0건'으로 돌려주면 대시보드·공지 화면·보고서·헤더 티커가 공지가 없는 것처럼 보인다 —
// 로더는 실패를 결과로 돌려준다(members.ts 의 getProjectRoster 관례).
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { ERR_ANNOUNCEMENTS_LOAD, getAnnouncements, getTopAnnouncements } from '@/lib/data/announcements'

type Reply = { data: unknown[] | null; error: { message: string } | null }

/** PostgREST 체인 스텁 — 마지막 await 에서 reply 를 돌려준다(issues-dashboard-loader.test.ts 관례). */
function makeSb(reply: Reply) {
  const calls = { tables: [] as string[], eq: [] as [string, unknown][], limit: null as number | null }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (k: string, v: unknown) => { calls.eq.push([k, v]); return chain }
  chain.or = () => chain
  chain.order = () => chain
  chain.limit = (n: number) => { calls.limit = n; return chain }
  chain.then = (res: unknown, rej: unknown) => Promise.resolve(reply).then(res as never, rej as never)
  const sb = { from: (t: string) => { calls.tables.push(t); return chain } }
  vi.mocked(createServerClient).mockResolvedValue(sb as never)
  return calls
}

const row = {
  id: 'a1', project_id: 'p1', title: '킥오프 안내', body: null, category: 'important', is_pinned: true,
  publish_from: null, publish_to: '2026-10-31', milestone_date: '2026-10-01',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T00:00:00Z',
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.mocked(createServerClient).mockReset()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errSpy.mockRestore())

describe('getAnnouncements — 실패를 결과로 돌려준다', () => {
  it('성공은 { ok: true, rows } — 결측 body 는 빈 문자열', async () => {
    const calls = makeSb({ data: [row], error: null })
    expect(await getAnnouncements('p1')).toEqual({
      ok: true,
      rows: [{
        id: 'a1', projectId: 'p1', title: '킥오프 안내', body: '', category: 'important', isPinned: true,
        publishFrom: null, publishTo: '2026-10-31', milestoneDate: '2026-10-01',
        createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z',
      }],
    })
    expect(calls.tables).toEqual(['announcements'])
    expect(calls.eq).toEqual([['project_id', 'p1']])
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('조회 실패는 로그 후 { ok: false, error: ERR_ANNOUNCEMENTS_LOAD }', async () => {
    makeSb({ data: null, error: { message: 'boom' } })
    expect(ERR_ANNOUNCEMENTS_LOAD).toBe('공지를 불러오지 못했습니다.')
    expect(await getAnnouncements('p1')).toEqual({ ok: false, error: '공지를 불러오지 못했습니다.' })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0].join(' ')).toContain('boom')
  })
})

describe('getTopAnnouncements — 실패를 결과로 돌려준다', () => {
  it('성공은 { ok: true, rows } — 표시 컬럼만, limit 은 DB 에서', async () => {
    const calls = makeSb({ data: [{ id: 'a1', title: '킥오프 안내', category: 'event', is_pinned: null }], error: null })
    expect(await getTopAnnouncements('p1', 3)).toEqual({
      ok: true,
      rows: [{ id: 'a1', title: '킥오프 안내', category: 'event', isPinned: false }],
    })
    expect(calls.limit).toBe(3)
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('조회 실패는 로그 후 { ok: false, error: ERR_ANNOUNCEMENTS_LOAD }', async () => {
    makeSb({ data: null, error: { message: 'boom' } })
    expect(await getTopAnnouncements('p1')).toEqual({ ok: false, error: '공지를 불러오지 못했습니다.' })
    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0].join(' ')).toContain('boom')
  })
})
