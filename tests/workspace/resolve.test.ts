import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), calls: [] as unknown[][] }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { SLUG_RE, resolveWorkspaceBySlug, workspaceRefById } from '@/lib/workspace/resolve'

const WID = '00000000-0000-0000-7e57-000000001601'
function db(result: { data: unknown; error: { message: string } | null }) {
  return {
    from: (t: string) => ({ select: (c: string) => ({ eq: (k: string, v: string) => { h.calls.push([t, c, k, v]); return { maybeSingle: async () => result } } }) }),
  }
}
beforeEach(() => { vi.clearAllMocks(); h.calls.length = 0 })

describe('resolveWorkspaceBySlug', () => {
  it('소속(RLS 가 보이는) 슬러그는 ok — 세션 클라이언트로 workspaces 한 행', async () => {
    h.createServerClient.mockResolvedValue(db({ data: { id: WID, slug: 'acme', name: 'Acme' }, error: null }))
    await expect(resolveWorkspaceBySlug('acme')).resolves.toEqual({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    expect(h.calls).toEqual([['workspaces', 'id, slug, name', 'slug', 'acme']])
  })
  it('0행(비소속·미존재)은 missing — 존재를 드러내지 않는다', async () => {
    h.createServerClient.mockResolvedValue(db({ data: null, error: null }))
    await expect(resolveWorkspaceBySlug('other')).resolves.toEqual({ ok: false, kind: 'missing' })
  })
  it('조회 오류는 unavailable 이고 404(missing)로 위장하지 않는다 — 로그를 남긴다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({ data: null, error: { message: 'db down' } }))
    await expect(resolveWorkspaceBySlug('acme')).resolves.toEqual({ ok: false, kind: 'unavailable', error: 'db down' })
    expect(err).toHaveBeenCalled(); err.mockRestore()
  })
  it('비틀린 슬러그는 조회 없이 missing — 소문자화·디코드하지 않는다(Review Focus 1)', async () => {
    for (const s of ['Acme', 'acme/', 'acme%2Fx', '%61cme', 'a', '-acme', 'acme_x', 'a'.repeat(64), '', ' acme']) {
      await expect(resolveWorkspaceBySlug(s), s).resolves.toEqual({ ok: false, kind: 'missing' })
    }
    expect(h.createServerClient).not.toHaveBeenCalled()
  })
  it('SLUG_RE 는 0003 check 와 같은 식이다', () => {
    expect(SLUG_RE.source).toBe('^[a-z0-9][a-z0-9-]{1,62}$')
  })
})

describe('workspaceRefById', () => {
  it('uuid 가 아니면 조회 없이 missing, 맞으면 id 로 한 행', async () => {
    await expect(workspaceRefById('not-a-uuid')).resolves.toEqual({ ok: false, kind: 'missing' })
    expect(h.createServerClient).not.toHaveBeenCalled()
    h.createServerClient.mockResolvedValue(db({ data: { id: WID, slug: 'acme', name: 'Acme' }, error: null }))
    await expect(workspaceRefById(WID)).resolves.toEqual({ ok: true, ws: { id: WID, slug: 'acme', name: 'Acme' } })
    expect(h.calls).toEqual([['workspaces', 'id, slug, name', 'id', WID]])
  })
})
