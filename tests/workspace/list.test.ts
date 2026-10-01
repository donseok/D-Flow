import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), getSession: vi.fn(), orders: [] as string[] }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))

import { listMyWorkspaces } from '@/lib/workspace/list'

const A = '00000000-0000-0000-7e57-000000001601'
const B = '00000000-0000-0000-7e57-000000001602'
function db(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: () => chain, eq: () => chain,
    order: (c: string) => { h.orders.push(c); return chain },
    then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r),
  }
  return { from: () => chain }
}
beforeEach(() => { vi.clearAllMocks(); h.orders.length = 0; h.getSession.mockResolvedValue({ id: 'u1' }) })

describe('listMyWorkspaces', () => {
  it('소속 행만, 가입 순(created_at → workspace_id) — 첫 행이 가장 먼저 가입한 소속', async () => {
    h.createServerClient.mockResolvedValue(db({ data: [
      { role: 'member', created_at: '2026-01-01T00:00:00Z', workspaces: { id: A, slug: 'acme', name: 'Acme' } },
      { role: 'admin', created_at: '2026-02-01T00:00:00Z', workspaces: { id: B, slug: 'beta', name: 'Beta' } },
    ], error: null }))
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: true, rows: [
      { id: A, slug: 'acme', name: 'Acme', role: 'member', joinedAt: '2026-01-01T00:00:00Z' },
      { id: B, slug: 'beta', name: 'Beta', role: 'admin', joinedAt: '2026-02-01T00:00:00Z' },
    ] })
    expect(h.orders).toEqual(['created_at', 'workspace_id'])
  })
  it('비로그인은 빈 목록, 조회 오류는 ok:false(빈 목록으로 위장하지 않는다)', async () => {
    h.getSession.mockResolvedValue(null)
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: true, rows: [] })
    h.getSession.mockResolvedValue({ id: 'u2' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({ data: null, error: { message: 'down' } }))
    await expect(listMyWorkspaces()).resolves.toEqual({ ok: false, error: 'down' })
    err.mockRestore()
  })
})
