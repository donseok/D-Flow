import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ listMyWorkspaces: vi.fn(), cookie: undefined as string | undefined }))
vi.mock('@/lib/workspace/list', () => ({ listMyWorkspaces: h.listMyWorkspaces }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'dflow-ws' && h.cookie !== undefined ? { name: n, value: h.cookie } : undefined) }) }))

import { WS_COOKIE, pickCurrentWorkspace, readCurrentWorkspace } from '@/lib/workspace/current'

const rows = [
  { id: 'a', slug: 'acme', name: 'Acme', role: 'member' as const, joinedAt: '2026-01-01' },
  { id: 'b', slug: 'beta', name: 'Beta', role: 'admin' as const, joinedAt: '2026-02-01' },
]

describe('pickCurrentWorkspace — 쿠키는 힌트, 소속을 다시 본다(D3)', () => {
  it('쿠키 슬러그가 소속이면 그것', () => {
    expect(pickCurrentWorkspace(rows, 'beta')).toEqual({ id: 'b', slug: 'beta', name: 'Beta' })
  })
  it('쿠키가 없거나·탈퇴·위조·형식 밖이면 첫 소속(Review Focus 2)', () => {
    for (const c of [undefined, '', 'gone', 'Beta', 'beta;path=/', ' beta', 'beta\n', '../acme', 'a'.repeat(70)]) {
      expect(pickCurrentWorkspace(rows, c), String(c)).toEqual({ id: 'a', slug: 'acme', name: 'Acme' })
    }
  })
  it('형식 가드 — 소속 목록에 형식 밖 슬러그가 있어도(가짜 행) 형식 밖 쿠키로는 고르지 않는다(SLUG_RE 줄을 지우면 빨강)', () => {
    const odd = [...rows, { id: 'x', slug: 'Beta;x', name: 'Odd', role: 'member' as const, joinedAt: '2026-03-01' }]
    expect(pickCurrentWorkspace(odd, 'Beta;x')).toEqual({ id: 'a', slug: 'acme', name: 'Acme' })
  })
  it('소속 0 이면 null — 쿠키가 있어도', () => {
    expect(pickCurrentWorkspace([], 'acme')).toBeNull()
  })
  it('쿠키 이름은 dflow-ws', () => { expect(WS_COOKIE).toBe('dflow-ws') })
})

describe('readCurrentWorkspace — 소속 조회 실패를 전파한다(첫 소속·null 로 위장하지 않는다)', () => {
  beforeEach(() => { vi.clearAllMocks(); h.cookie = undefined })
  it('목록 실패면 { ok:false, error } — 리졸버가 "소속 없음" 화면을 그리지 않게', async () => {
    h.listMyWorkspaces.mockResolvedValue({ ok: false, error: 'down' })
    h.cookie = 'beta'
    await expect(readCurrentWorkspace()).resolves.toEqual({ ok: false, error: 'down' })
  })
  it('정상이면 쿠키(소속)를 반영, 쿠키 없으면 첫 소속, 소속 0 이면 ws: null', async () => {
    h.listMyWorkspaces.mockResolvedValue({ ok: true, rows })
    h.cookie = 'beta'
    await expect(readCurrentWorkspace()).resolves.toEqual({ ok: true, ws: { id: 'b', slug: 'beta', name: 'Beta' } })
    h.cookie = undefined
    await expect(readCurrentWorkspace()).resolves.toEqual({ ok: true, ws: { id: 'a', slug: 'acme', name: 'Acme' } })
    h.listMyWorkspaces.mockResolvedValue({ ok: true, rows: [] })
    await expect(readCurrentWorkspace()).resolves.toEqual({ ok: true, ws: null })
  })
})
