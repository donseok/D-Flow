// 비공개 프로젝트 숨김 집합(getHiddenProjectIds) — 정본 규칙은 포털(portal.ts visibleProjectIds)과 같다(UI-2a 최종 수정 FA1):
// 명단 밖이면 숨기고, 조회가 실패하면 막는다(fail-closed). 예전에는 실패하면 빈 집합(= 전부 보임)으로 진행해 열림이었다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), getActorForView: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/authz/index', () => ({ getActorForView: h.getActorForView }))
vi.mock('@/lib/authz', () => ({ getActorForView: h.getActorForView }))

import { getHiddenProjectIds, HiddenProjectsUnavailableError } from '@/lib/authz/visibility'
import { makeActor, WS } from '../fixtures/actor'

const PRIV_A = 'p-priv-a', PRIV_B = 'p-priv-b'
// PostgREST 흉내 — 한 응답은 MAX_ROWS 에서 오류 없이 잘린다(supabase/config.toml max_rows). count: 'exact' 를 걸면 count 를 싣는다.
// 어느 단계에서 await 해도 응답한다(쪽 나눔 없이 .eq() 를 바로 기다리는 꼴도 잘린 첫 묶음을 받는다 — HH1 의 옛 동작).
const MAX_ROWS = 1000
const client = (reply: { data: unknown[] | null; error: { message: string } | null }, opts: { count?: number } = {}) => ({
  from: () => {
    let from = 0, to = Number.MAX_SAFE_INTEGER, withCount = false
    const q = {
      select: (_c: string, o?: { count?: string }) => { withCount = o?.count === 'exact'; return q },
      eq: () => q,
      order: () => q,
      range: (f: number, t: number) => { from = f; to = t; return q },
      then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
        const rows = reply.data?.slice(from, Math.min(to + 1, from + MAX_ROWS)) ?? null
        const count = withCount ? (opts.count ?? reply.data?.length ?? null) : null
        return Promise.resolve(reply.error ? { data: null, error: reply.error, count: null } : { data: rows, error: null, count }).then(ok, ko)
      },
    }
    return q
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.getActorForView.mockResolvedValue(makeActor({ projectWorkspace: new Map([[PRIV_A, WS], [PRIV_B, WS]]), projectRoles: new Map([[PRIV_A, 'member']]) }))
})

describe('getHiddenProjectIds', () => {
  it('비공개 프로젝트 중 명단 밖인 것만 숨긴다', async () => {
    h.createServerClient.mockResolvedValue(client({ data: [{ id: PRIV_A, is_private: true }, { id: PRIV_B, is_private: true }], error: null }))
    expect([...(await getHiddenProjectIds())]).toEqual([PRIV_B])
  })
  it('권한 조회가 열화(actor null)면 비공개는 전부 숨긴다', async () => {
    h.getActorForView.mockResolvedValue(null)
    h.createServerClient.mockResolvedValue(client({ data: [{ id: PRIV_A, is_private: true }], error: null }))
    expect([...(await getHiddenProjectIds())]).toEqual([PRIV_A])
  })
  it('조회가 실패하면 빈 집합(=전부 보임)으로 진행하지 않는다 — 던지고 로그를 남긴다(fail-closed)', async () => {
    h.createServerClient.mockResolvedValue(client({ data: null, error: { message: 'boom' } }))
    await expect(getHiddenProjectIds()).rejects.toThrow()
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes('getHiddenProjectIds'))).toBe(true)
  })
  // HH1(GG 재리뷰 P3-1) — 한 응답은 max_rows(1000)에서 잘린다. 잘린 첫 묶음만 집합에 넣으면 나머지 비공개가 명단 밖 사람에게 열린다(fail-open)
  it('비공개가 max_rows 를 넘어도 끝까지 읽는다 — 1,001번째 비공개도 숨긴다', async () => {
    h.getActorForView.mockResolvedValue(makeActor())
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: `p-priv-${String(i).padStart(4, '0')}`, is_private: true }))
    h.createServerClient.mockResolvedValue(client({ data: rows, error: null }))
    const hidden = await getHiddenProjectIds()
    expect(hidden.size).toBe(1001)
    expect(hidden.has('p-priv-1000')).toBe(true)
  })
  it('다 읽은 행 수가 count 와 어긋나면(잘림·읽는 중 변경) 판정 실패로 던지고 로그를 남긴다', async () => {
    h.createServerClient.mockResolvedValue(client({ data: [{ id: PRIV_A, is_private: true }, { id: PRIV_B, is_private: true }], error: null }, { count: 3 }))
    await expect(getHiddenProjectIds()).rejects.toBeInstanceOf(HiddenProjectsUnavailableError)
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes('getHiddenProjectIds'))).toBe(true)
  })
  it('쪽 읽기 중 Next 제어 신호(동적 사용)는 판정 실패로 바꾸지 않고 그대로 던진다', async () => {
    const signal = Object.assign(new Error('signal'), { digest: 'DYNAMIC_SERVER_USAGE' })
    h.createServerClient.mockResolvedValue({ from: () => { throw signal } })
    await expect(getHiddenProjectIds()).rejects.toBe(signal)
  })
})
