import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { createServerClient } from '@/lib/supabase/server'
import { ERR_ISSUES_LOAD, getIssuesForDashboard } from '@/lib/data/issues'

type Reply = { data: unknown[] | null; error: { message: string } | null }

/** PostgREST 체인 스텁 — 마지막 await 에서 reply 를 돌려준다. 어떤 테이블·필터를 탔는지 기록한다. */
function makeSb(reply: Reply) {
  const calls = { tables: [] as string[], eq: [] as [string, unknown][], select: '' }
  const chain: Record<string, unknown> = {}
  chain.select = (cols: string) => { calls.select = cols; return chain }
  chain.eq = (k: string, v: unknown) => { calls.eq.push([k, v]); return chain }
  chain.order = () => chain
  chain.then = (res: unknown, rej: unknown) => Promise.resolve(reply).then(res as never, rej as never)
  const sb = { from: (t: string) => { calls.tables.push(t); return chain } }
  vi.mocked(createServerClient).mockResolvedValue(sb as never)
  return calls
}

const row = {
  id: 'i1', issue_no: 7, pi_issue_code: 'PI-03-002', mega_code: '03', title: '부적합 판정 코드 통합',
  status: 'resolved', severity: 'medium', due_date: '2026-08-08', resolved_at: '2026-08-05T02:00:00+00:00',
  created_at: '2026-07-02T00:00:00+00:00',
}

describe('getIssuesForDashboard — 대시보드 전용 1쿼리 슬라이스', () => {
  beforeEach(() => vi.mocked(createServerClient).mockReset())

  it('issues 테이블 한 번만, project_id 로 걸러 읽는다', async () => {
    const calls = makeSb({ data: [], error: null })
    await getIssuesForDashboard('p1')
    expect(calls.tables).toEqual(['issues'])
    expect(calls.eq).toEqual([['project_id', 'p1']])
  })

  it('행을 DashboardIssue 로 옮긴다 — 결측은 null, issue_no 는 숫자', async () => {
    makeSb({ data: [row, { ...row, id: 'i2', issue_no: '8', pi_issue_code: null, mega_code: null, due_date: null, resolved_at: null }], error: null })
    const res = await getIssuesForDashboard('p1')
    if (!res.ok) throw new Error('성공이어야 한다')
    const list = res.rows
    expect(list[0]).toEqual({
      id: 'i1', issueNo: 7, piIssueCode: 'PI-03-002', megaCode: '03', title: '부적합 판정 코드 통합',
      status: 'resolved', severity: 'medium', dueDate: '2026-08-08', resolvedAt: '2026-08-05T02:00:00+00:00',
      createdAt: '2026-07-02T00:00:00+00:00',
    })
    expect(list[1]).toMatchObject({ issueNo: 8, piIssueCode: null, megaCode: null, dueDate: null, resolvedAt: null })
  })

  it('조회 실패는 로그를 남기고 결과로 돌려준다 — 0건으로 위장하지 않는다(표시=로깅)', async () => {
    makeSb({ data: null, error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(ERR_ISSUES_LOAD).toBe('이슈를 불러오지 못했습니다.')
    expect(await getIssuesForDashboard('p1')).toEqual({ ok: false, error: '이슈를 불러오지 못했습니다.' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0].join(' ')).toContain('boom')
    spy.mockRestore()
  })
})
