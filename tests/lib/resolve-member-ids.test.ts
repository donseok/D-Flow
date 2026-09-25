import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))

import { resolveMemberIds } from '@/lib/data/meetings'

type Reply = { data: { id: string }[] | null; error: { message: string } | null }

/** select·eq 호출을 기록하는 최소 supabase 스텁 — 체인 끝(await)에서 reply 를 낸다. */
function stub(reply: Reply) {
  const calls: Array<[string, unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in']) q[m] = (...args: unknown[]) => { calls.push([m, args]); return q }
  q.then = (resolve: (v: Reply) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(reply).then(resolve, reject)
  const from = vi.fn(() => q)
  return { sb: { from } as never, from, calls }
}

const OK = (ids: string[]): Reply => ({ data: ids.map((id) => ({ id })), error: null })

describe('resolveMemberIds — 로그인 계정 ↔ project_members 연결', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  it('people.user_id 한 조회 — 활성 명단 행·활성 인물만(buildActor 와 같은 축), 이메일 폴백은 없다', async () => {
    const { sb, from, calls } = stub(OK(['mA', 'mB']))
    expect(await resolveMemberIds(sb, { id: 'u1' })).toEqual(['mA', 'mB'])
    expect(from).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      ['select', ['id, people!inner(user_id, active)']],
      ['eq', ['people.user_id', 'u1']],
      ['eq', ['active', true]],
      ['eq', ['people.active', true]],
    ])
  })

  it('같은 id 가 두 번 와도 한 번만 낸다', async () => {
    const { sb } = stub(OK(['m1', 'm1']))
    expect(await resolveMemberIds(sb, { id: 'u1' })).toEqual(['m1'])
  })

  it('조회 실패는 빈 배열 + 로그 — 무매칭과 조용히 섞이지 않는다', async () => {
    const { sb } = stub({ data: null, error: { message: 'boom' } })
    expect(await resolveMemberIds(sb, { id: 'u1' })).toEqual([])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('resolveMemberIds'), 'boom')
  })

  it('무매칭이면 빈 배열이고 로그는 남기지 않는다', async () => {
    const { sb } = stub(OK([]))
    expect(await resolveMemberIds(sb, { id: 'u1' })).toEqual([])
    expect(console.error).not.toHaveBeenCalled()
  })
})
