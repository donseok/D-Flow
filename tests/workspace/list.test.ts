import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), orders: [] as string[], eqs: [] as unknown[][], selects: [] as string[] }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { listMyWorkspaces } from '@/lib/workspace/list'

const A = '00000000-0000-0000-7e57-000000001601'
const B = '00000000-0000-0000-7e57-000000001602'
type Claims = { data: { claims: { sub?: string } } | null; error: { message: string } | null }
/** 세션 클라이언트 가짜 — getClaims 결과·select/eq/order 인자를 기록한다(.eq 를 버리면 "내 행만"을 고정하지 못한다 — U2a-1 충실도 P1) */
function db(result: { data: unknown; error: { message: string } | null }, claims: Claims = { data: { claims: { sub: 'u1' } }, error: null }) {
  const chain = {
    select: (c: string) => { h.selects.push(c); return chain },
    eq: (...a: unknown[]) => { h.eqs.push(a); return chain },
    order: (c: string) => { h.orders.push(c); return chain },
    then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r),
  }
  const from = vi.fn(() => chain)
  return { from, auth: { getClaims: vi.fn(async () => claims) } }
}
beforeEach(() => { vi.clearAllMocks(); h.orders.length = 0; h.eqs.length = 0; h.selects.length = 0 })

describe('listMyWorkspaces', () => {
  it('소속 행만(user_id = 내 claims sub), 가입 순(created_at → workspace_id) — 첫 행이 가장 먼저 가입한 소속', async () => {
    h.createServerClient.mockResolvedValue(db({ data: [
      { role: 'member', created_at: '2026-01-01T00:00:00Z', workspaces: { id: A, slug: 'acme', name: 'Acme' } },
      { role: 'admin', created_at: '2026-02-01T00:00:00Z', workspaces: { id: B, slug: 'beta', name: 'Beta' } },
    ], error: null }))
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: true, rows: [
      { id: A, slug: 'acme', name: 'Acme', role: 'member', joinedAt: '2026-01-01T00:00:00Z' },
      { id: B, slug: 'beta', name: 'Beta', role: 'admin', joinedAt: '2026-02-01T00:00:00Z' },
    ] })
    expect(h.eqs).toEqual([['user_id', 'u1']])   // 이 줄을 지우면 RLS 아래 동료 행(같은 워크스페이스)·플랫폼 관리자의 전 행이 섞인다
    expect(h.selects).toEqual(['role, created_at, workspace_id, workspaces!inner(id, slug, name)'])
    expect(h.orders).toEqual(['created_at', 'workspace_id'])
  })
  it('임베드가 배열로 와도 첫 원소, 빈 임베드는 건너뛴다', async () => {
    h.createServerClient.mockResolvedValue(db({ data: [
      { role: 'member', created_at: '2026-01-01T00:00:00Z', workspaces: [{ id: A, slug: 'acme', name: 'Acme' }] },
      { role: 'member', created_at: '2026-01-02T00:00:00Z', workspaces: null },
    ], error: null }))
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: true, rows: [
      { id: A, slug: 'acme', name: 'Acme', role: 'member', joinedAt: '2026-01-01T00:00:00Z' },
    ] })
  })
  it('비로그인(claims 없음)은 조회 없이 빈 목록', async () => {
    const c = db({ data: [], error: null }, { data: null, error: null })
    h.createServerClient.mockResolvedValue(c)
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: true, rows: [] })
    expect(c.from).not.toHaveBeenCalled()
  })
  it('인증 조회 오류는 ok:false — "소속 없음"으로 위장하지 않는다(U2a-1 보안 P2), 소속 조회도 하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const c = db({ data: [], error: null }, { data: null, error: { message: 'auth down' } })
    h.createServerClient.mockResolvedValue(c)
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: false, error: 'auth down' })
    expect(c.from).not.toHaveBeenCalled()
    err.mockRestore()
  })
  it('소속 조회 오류는 ok:false(빈 목록으로 위장하지 않는다)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({ data: null, error: { message: 'down' } }))
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: false, error: 'down' })
    err.mockRestore()
  })
})
