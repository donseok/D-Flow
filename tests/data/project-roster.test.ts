import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { getProjectMembers, getProjectRoster, ERR_ROSTER_LOAD } from '@/lib/data/members'
import { ROSTER_SELECT } from '@/lib/data/memberSelect'

type Result = { data: unknown; error: { message: string } | null }

function client(result: Result) {
  const calls: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order']) q[m] = vi.fn((...args: unknown[]) => { calls.push([m, args]); return q })
  q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  mocks.createServerClient.mockResolvedValue({ from: vi.fn(() => q) })
  return calls
}

const ROW = {
  id: 'm1', project_id: 'p1', person_id: 'pe1', access_role: null, role_label: null, title: null, active: true, sort_order: 0,
  created_at: '2026-09-01T00:00:00Z', people: { display_name: 'bob', email: null, user_id: null, kind: 'external', active: true },
  project_member_teams: [],
}

beforeEach(() => vi.clearAllMocks())

describe('getProjectRoster — 조회 실패를 빈 명단으로 위장하지 않는다(3원칙 ①)', () => {
  it('정상 — ROSTER_SELECT 로 읽어 RosterMember 로 편다', async () => {
    const calls = client({ data: [ROW], error: null })
    const res = await getProjectRoster('p1')
    expect(res).toMatchObject({ ok: true, rows: [{ id: 'm1', name: 'bob', kind: 'external' }] })
    expect(calls[0]).toEqual(['select', [ROSTER_SELECT]])
  })
  it('실패 — 오류 결과 + 로그', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ data: null, error: { message: 'boom' } })
    expect(await getProjectRoster('p1')).toEqual({ ok: false, error: ERR_ROSTER_LOAD })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('getProjectMembers 는 기존 계약(실패 = 로그 후 빈 배열)을 유지한다 — 곁가지 소비처용', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ data: null, error: { message: 'boom' } })
    expect(await getProjectMembers('p2')).toEqual([])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
