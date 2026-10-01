// getMinuteFavorites(workspaceId) — 내 즐겨찾기 가운데 그 워크스페이스 회의록의 것만(UI-2a 최종 수정 FA3).
// 예전에는 내 행 전부를 돌려줘 회의록 모듈이 꺼진 다른 워크스페이스의 회의록 id 가 섞였다(모듈 관문은 그 모듈의 행을 돌려주지 않는다).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), selects: [] as string[], eqs: [] as unknown[][], reply: { data: [] as unknown[] | null, error: null as { message: string } | null } }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))

import { getMinuteFavorites } from '@/lib/data/minutes'

const W = '00000000-0000-0000-7e57-00000000167e'
beforeEach(() => {
  h.selects.length = 0; h.eqs.length = 0
  h.reply = { data: [], error: null }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.createServerClient.mockResolvedValue({
    from: (t: string) => {
      expect(t).toBe('minute_favorites')
      const q: Record<string, unknown> = {}
      q.select = (s: string) => { h.selects.push(s); return q }
      q.eq = (...a: unknown[]) => { h.eqs.push(a); return q }
      q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(h.reply).then(res, rej)
      return q
    },
  })
})

describe('getMinuteFavorites(workspaceId)', () => {
  it('회의록 임베드를 inner 로 걸고 minutes.workspace_id 로 거른다', async () => {
    h.reply = { data: [{ minute_id: 'm1' }, { minute_id: 'm2' }], error: null }
    expect(await getMinuteFavorites(W)).toEqual(['m1', 'm2'])
    expect(h.selects).toEqual(['minute_id, minutes!inner(workspace_id)'])
    expect(h.eqs).toContainEqual(['minutes.workspace_id', W])
  })
  it('조회 실패는 null(즐겨찾기 없음으로 위장하지 않는다) + 로그', async () => {
    h.reply = { data: null, error: { message: 'boom' } }
    expect(await getMinuteFavorites(W)).toBeNull()
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes('getMinuteFavorites'))).toBe(true)
  })
})
