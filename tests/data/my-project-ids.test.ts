import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import { getMyProjectIds } from '@/lib/data/members'

type Result = { data: unknown; error: { message: string } | null }

function client(result: Result, user: { id: string; email?: string } | null = { id: 'u1', email: 'alice@example.com' }) {
  const calls: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in']) q[m] = vi.fn((...args: unknown[]) => { calls.push([m, args]); return q })
  q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  const from = vi.fn(() => q)
  mocks.createServerClient.mockResolvedValue({ from, auth: { getUser: async () => ({ data: { user } }) } })
  return { from, calls }
}

beforeEach(() => vi.clearAllMocks())

describe('getMyProjectIds — 계정 연결 정본(people.user_id) 한 조회', () => {
  it('활성 명단 행의 프로젝트 id 를 중복 없이 — 이메일 폴백 조회는 하지 않는다', async () => {
    const { from, calls } = client({ data: [{ project_id: 'p1' }, { project_id: 'p2' }, { project_id: 'p1' }], error: null })

    expect(await getMyProjectIds()).toEqual(['p1', 'p2'])
    expect(from).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      ['select', ['project_id, people!inner(user_id)']],
      ['eq', ['people.user_id', 'u1']],
      ['eq', ['active', true]],
    ])
  })

  it('조회 실패는 null — 소속 없음([])과 구분한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ data: null, error: { message: 'boom' } })
    expect(await getMyProjectIds()).toBe(null)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('비로그인은 null', async () => {
    const { from } = client({ data: [], error: null }, null)
    expect(await getMyProjectIds()).toBe(null)
    expect(from).not.toHaveBeenCalled()
  })
})
