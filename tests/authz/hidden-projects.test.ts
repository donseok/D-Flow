// 비공개 프로젝트 숨김 집합(getHiddenProjectIds) — 정본 규칙은 포털(portal.ts visibleProjectIds)과 같다(UI-2a 최종 수정 FA1):
// 명단 밖이면 숨기고, 조회가 실패하면 막는다(fail-closed). 예전에는 실패하면 빈 집합(= 전부 보임)으로 진행해 열림이었다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), getActorForView: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/authz/index', () => ({ getActorForView: h.getActorForView }))
vi.mock('@/lib/authz', () => ({ getActorForView: h.getActorForView }))

import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { makeActor, WS } from '../fixtures/actor'

const PRIV_A = 'p-priv-a', PRIV_B = 'p-priv-b'
const client = (reply: { data: unknown[] | null; error: { message: string } | null }) => ({
  from: () => ({ select: () => ({ eq: async () => reply }) }),
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
})
