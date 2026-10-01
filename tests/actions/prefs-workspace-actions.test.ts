import { describe, it, expect, vi, beforeEach } from 'vitest'

// 개인 설정 쓰기 경로(SP3b D9) — 계정 키는 account_preferences 자기 행, 알림 읽음(워크스페이스 키)은 그 프로젝트의 워크스페이스 행.
// 옛 동작(첫 소속 행 하나에 몰아 쓰기 — prefsWorkspaceId)은 없어졌다: 이 파일의 옛 케이스 "키 워크스페이스 행에 병합 upsert" 는
// 계정 행 케이스로, "소속 워크스페이스 없음·조회 실패" 는 알림 읽음의 "소속 밖 프로젝트·권한 조회 실패" 로 옮겼다.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getActor: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: mocks.getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn() }))

import { saveUiPrefs } from '@/app/actions/preferences'
import { markAllNotificationsRead } from '@/app/actions/notifications'
import { makeActor } from '../fixtures/actor'

type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + upsert 인자 기록. */
function client(queues: Record<string, Resp[]>) {
  const upserts: Array<[string, unknown, unknown]> = []
  const eqs: Record<string, unknown[][]> = {}
  const tables: string[] = []
  const c = {
    upserts, eqs, tables,
    from: vi.fn((table: string) => {
      tables.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'order', 'limit']) b[k] = () => b
      b.eq = (...args: unknown[]) => { (eqs[table] ??= []).push(args); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.upsert = async (row: unknown, opts: unknown) => { upserts.push([table, row, opts]); return { error: null } }
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
  mocks.getActor.mockResolvedValue(makeActor({ projectWorkspace: new Map([['p1', 'ws-1']]) }))
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('saveUiPrefs — 계정 키', () => {
  it('account_preferences 자기 행에 병합 upsert — onConflict user_id, 소속 조회 없음', async () => {
    const c = client({ account_preferences: [{ data: { prefs: { locale: 'ko' } } }] })
    expect(await saveUiPrefs({ theme: 'dark' })).toEqual({ ok: true })
    expect(c.eqs.account_preferences).toEqual([['user_id', 'u1']])
    expect(c.upserts).toHaveLength(1)
    const [table, row, opts] = c.upserts[0]
    expect(table).toBe('account_preferences')
    expect(row).toMatchObject({ user_id: 'u1', prefs: { locale: 'ko', theme: 'dark' } })
    expect(row).not.toHaveProperty('workspace_id')
    expect(opts).toEqual({ onConflict: 'user_id' })
    expect(c.tables).not.toContain('workspace_members')
    expect(c.tables).not.toContain('user_preferences')
  })
  it('선행 조회 실패면 저장 중단 — upsert 미도달, ok:false', async () => {
    const c = client({ account_preferences: [{ error: { message: 'ap boom' } }] })
    expect(await saveUiPrefs({ theme: 'dark' })).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('선행 조회 실패'), 'ap boom')
  })
})

describe('markAllNotificationsRead — 그 프로젝트의 워크스페이스 행(D9)', () => {
  it('actor 의 프로젝트 워크스페이스 행에 병합 upsert — onConflict (user_id, workspace_id), 첫 소속 조회 없음', async () => {
    const c = client({ user_preferences: [{ data: { prefs: { startPage: 'home' } } }] })
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: true })
    expect(c.eqs.user_preferences).toEqual([['user_id', 'u1'], ['workspace_id', 'ws-1']])
    const [, row, opts] = c.upserts[0]
    expect(row).toMatchObject({ user_id: 'u1', workspace_id: 'ws-1', prefs: { startPage: 'home', notifRead: { p1: ['n1'] } } })
    expect(opts).toEqual({ onConflict: 'user_id,workspace_id' })
    expect(c.tables).not.toContain('workspace_members')
  })
  it('소속 워크스페이스의 프로젝트가 아니면(없는 프로젝트와 같은 응답) ok:false — upsert 미도달', async () => {
    const c = client({})
    expect(await markAllNotificationsRead('p-other', ['n1'])).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
  })
  it('권한 조회 실패(throw)면 ok:false — upsert 미도달', async () => {
    mocks.getActor.mockRejectedValue(new Error('actor boom'))
    const c = client({})
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
  })
  it('병합 선행 조회 실패면 ok:false — 다른 설정을 덮어쓰지 않는다', async () => {
    const c = client({ user_preferences: [{ error: { message: 'prefs boom' } }] })
    expect(await markAllNotificationsRead('p1', ['n1'])).toEqual({ ok: false })
    expect(c.upserts).toHaveLength(0)
  })
})
