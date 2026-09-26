import { describe, it, expect, vi, beforeEach } from 'vitest'

// 선호값 쓰기 경로(0006) — 키 워크스페이스를 못 정하면 어느 행에 쓸지 모르므로 쓰지 않는다(쓰기 전 선행 조회 실패는 중단).
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn() }))

import { saveUiPrefs } from '@/app/actions/preferences'
import { markAllNotificationsRead } from '@/app/actions/notifications'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + upsert 인자 기록. */
function client(queues: Record<string, Resp[]>) {
  const upserts: Array<[unknown, unknown]> = []
  const eqs: Record<string, unknown[][]> = {}
  const c = {
    upserts, eqs,
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } } })) },
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'order', 'limit']) b[k] = () => b
      b.eq = (...args: unknown[]) => { (eqs[table] ??= []).push(args); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.upsert = async (row: unknown, opts: unknown) => { upserts.push([row, opts]); return { error: null } }
      return b
    }),
  }
  mocks.createServerClient.mockResolvedValue(c)
  return c
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getSession.mockResolvedValue({ id: 'u1' })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('saveUiPrefs', () => {
  it('키 워크스페이스 행에 병합 upsert — onConflict 는 새 PK (user_id, workspace_id)', async () => {
    const c = client({
      workspace_members: [{ data: { workspace_id: 'ws-1' } }],
      user_preferences: [{ data: { prefs: { lang: 'ko' } } }],
    })
    await saveUiPrefs({ theme: 'dark' } as never)
    expect(c.eqs.user_preferences).toEqual([['user_id', 'u1'], ['workspace_id', 'ws-1']])
    expect(c.upserts).toHaveLength(1)
    const [row, opts] = c.upserts[0]
    expect(row).toMatchObject({ user_id: 'u1', workspace_id: 'ws-1', prefs: { lang: 'ko', theme: 'dark' } })
    expect(opts).toEqual({ onConflict: 'user_id,workspace_id' })
  })
  it('소속 워크스페이스가 없으면 저장 중단 — upsert 미도달', async () => {
    const c = client({ workspace_members: [{ data: null }] })
    await saveUiPrefs({ theme: 'dark' } as never)
    expect(c.upserts).toHaveLength(0)
    expect(errSpy).toHaveBeenCalled()
  })
  it('키 워크스페이스 조회 실패(throw)면 저장 중단 — upsert 미도달', async () => {
    const c = client({ workspace_members: [{ error: { message: 'wm boom' } }] })
    await saveUiPrefs({ theme: 'dark' } as never)
    expect(c.upserts).toHaveLength(0)
    expect(errSpy).toHaveBeenCalledWith('[saveUiPrefs] 저장 중단:', expect.stringContaining('wm boom'))
  })
})

describe('markAllNotificationsRead', () => {
  it('키 워크스페이스 행에 병합 upsert — onConflict 는 새 PK (user_id, workspace_id)', async () => {
    const c = client({
      workspace_members: [{ data: { workspace_id: 'ws-1' } }],
      user_preferences: [{ data: { prefs: { theme: 'light' } } }],
    })
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: true })
    const [row, opts] = c.upserts[0]
    expect(row).toMatchObject({ user_id: 'u1', workspace_id: 'ws-1', prefs: { theme: 'light', notifRead: { p1: ['n1'] } } })
    expect(opts).toEqual({ onConflict: 'user_id,workspace_id' })
  })
  it('소속 워크스페이스가 없으면 ok:false — upsert 미도달', async () => {
    const c = client({ workspace_members: [{ data: null }] })
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
  })
  it('키 워크스페이스 조회 실패(throw)면 ok:false — upsert 미도달', async () => {
    const c = client({ workspace_members: [{ error: { message: 'wm boom' } }] })
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
  })
  it('병합 선행 조회 실패면 ok:false — 다른 설정을 덮어쓰지 않는다', async () => {
    const c = client({
      workspace_members: [{ data: { workspace_id: 'ws-1' } }],
      user_preferences: [{ error: { message: 'prefs boom' } }],
    })
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
  })
})
