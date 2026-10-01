import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getSession: vi.fn(), getActor: vi.fn(), createServerClient: vi.fn(), ops: [] as unknown[][] }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: h.getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { saveUiPrefs } from '@/app/actions/preferences'
import { POST } from '@/app/api/prefs/route'
import { makeActor } from '../fixtures/actor'

const WS = '00000000-0000-0000-7e57-000000001652'
const WS_X = '00000000-0000-0000-7e57-000000001651'
/** 표마다 maybeSingle 결과·upsert 기록. readFail 이면 선행 조회 오류, writeFail 이면 upsert 오류 */
function db(existing: Record<string, unknown>, opts: { readFail?: string; writeFail?: string } = {}) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        maybeSingle: async () => (opts.readFail === table ? { data: null, error: { message: 'down' } } : { data: existing[table] ? { prefs: existing[table] } : null, error: null }),
        upsert: async (row: Record<string, unknown>, o: unknown) => {
          h.ops.push([table, row.prefs, row.workspace_id ?? null, o])
          return { error: opts.writeFail === table ? { message: 'write down' } : null }
        },
      }
      return q
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks(); h.ops.length = 0
  h.getSession.mockResolvedValue({ id: 'u1' })
  h.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WS, 'member']]) }))
})

describe('saveUiPrefs — 계정 키는 account_preferences, 워크스페이스 키는 그 워크스페이스 행(D9)', () => {
  it('계정 키 병합 upsert', async () => {
    h.createServerClient.mockResolvedValue(db({ account_preferences: { locale: 'en' } }))
    expect(await saveUiPrefs({ theme: 'dark' })).toEqual({ ok: true })
    expect(h.ops).toEqual([['account_preferences', { locale: 'en', theme: 'dark' }, null, { onConflict: 'user_id' }]])
  })
  it('워크스페이스 키는 본문의 workspaceId 행에만(쿠키를 읽지 않는다 — Review Focus 4)', async () => {
    h.createServerClient.mockResolvedValue(db({ user_preferences: { notifRead: { p: ['n'] } } }))
    expect(await saveUiPrefs({ startPage: 'my_work' }, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops).toEqual([['user_preferences', { notifRead: { p: ['n'] }, startPage: 'my_work' }, WS, { onConflict: 'user_id,workspace_id' }]])
  })
  it('대문자로 온 같은 워크스페이스 id 는 소문자로 맞춰 소속을 본다 — 남의 행이 아니라 같은 행', async () => {
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ startPage: 'home' }, { workspaceId: WS.toUpperCase() })).toEqual({ ok: true })
    expect(h.ops.map((o) => o[2])).toEqual([WS])
  })
  it('workspaceId 가 없거나 비소속이면 워크스페이스 키를 버리고 로그, 계정 키는 저장', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ theme: 'light', startPage: 'home' })).toEqual({ ok: false })
    expect(await saveUiPrefs({ startPage: 'home' }, { workspaceId: WS_X })).toEqual({ ok: false })
    expect(h.ops.map((o) => o[0])).toEqual(['account_preferences'])
    expect(err).toHaveBeenCalledTimes(2); err.mockRestore()
  })
  it('선행 조회 실패면 그 표의 저장을 중단한다(원칙 ②)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}, { readFail: 'account_preferences' }))
    expect(await saveUiPrefs({ theme: 'dark' })).toEqual({ ok: false })
    expect(h.ops).toEqual([]); err.mockRestore()
  })
  it('은퇴 키(heroCollapsed·lastProjectId)는 로그 없이 버린다 — 옛 셸이 계속 보낸다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ lastProjectId: 'p', heroCollapsed: true } as never)).toEqual({ ok: true })
    expect(h.ops).toEqual([]); expect(err).not.toHaveBeenCalled(); err.mockRestore()
  })
  it('권한 조회 실패면 워크스페이스 키를 버린다(fail-closed)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getActor.mockRejectedValue(new Error('down'))
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ favoriteProjectIds: [WS_X] }, { workspaceId: WS })).toEqual({ ok: false })
    expect(h.ops).toEqual([]); err.mockRestore()
  })
  it('형식 밖 워크스페이스 값·모르는 키는 버리고 로그 — 거대 배열은 상한으로 자른다(split)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    const many = Array.from({ length: 500 }, (_, i) => `00000000-0000-0000-7e57-${String(i).padStart(12, '0')}`)
    expect(await saveUiPrefs({ startPage: 'evil', favoriteProjectIds: many, ...({ isSuperuser: true } as object) } as never, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops).toHaveLength(1)
    expect((h.ops[0][1] as { favoriteProjectIds: string[] }).favoriteProjectIds).toHaveLength(20)
    expect(h.ops[0][1]).not.toHaveProperty('startPage')
    expect(h.ops[0][1]).not.toHaveProperty('isSuperuser')
    expect(err).toHaveBeenCalledWith(expect.stringContaining('모르는 키'), 'startPage,isSuperuser'); err.mockRestore()
  })
})

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new NextRequest('http://localhost/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))

describe('/api/prefs — 거부 응답은 하나(W10 — 존재 오라클 금지)', () => {
  it('없음·형식 밖·비소속·권한 조회 실패·비로그인·저장 실패가 같은 상태·같은 본문이다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cases: Array<[string, () => void, unknown]> = [
      ['workspaceId 없음', () => {}, { prefs: { startPage: 'home' } }],
      ['형식 밖', () => {}, { prefs: { startPage: 'home' }, workspaceId: 'acme' }],
      ['비소속(있을 법한 id)', () => {}, { prefs: { startPage: 'home' }, workspaceId: WS_X }],
      ['비소속(없는 id)', () => {}, { prefs: { startPage: 'home' }, workspaceId: '00000000-0000-0000-0000-000000000000' }],
      ['권한 조회 실패', () => { h.getActor.mockRejectedValueOnce(new Error('down')) }, { prefs: { startPage: 'home' }, workspaceId: WS }],
      ['비로그인', () => { h.getSession.mockResolvedValueOnce(null) }, { prefs: { startPage: 'home' }, workspaceId: WS }],
      ['저장 실패', () => { h.createServerClient.mockResolvedValueOnce(db({}, { writeFail: 'user_preferences' })) }, { prefs: { startPage: 'home' }, workspaceId: WS }],
    ]
    const seen = new Set<string>()
    for (const [label, arrange, body] of cases) {
      h.createServerClient.mockResolvedValue(db({}))
      arrange()
      const res = await post(body)
      seen.add(`${res.status} ${await res.text()}`)
      expect(res.status, label).toBe(403)
    }
    expect([...seen]).toEqual(['403 {"ok":false,"error":"설정을 저장하지 못했습니다"}'])
    err.mockRestore()
  })
  it('쿠키의 워크스페이스를 쓰지 않는다 — 본문에 workspaceId 가 없으면 소속 쿠키가 있어도 워크스페이스 행을 쓰지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    const res = await post({ prefs: { favoriteProjectIds: [WS] } }, { cookie: 'dflow-ws=acme' })
    expect(res.status).toBe(403)
    expect(h.ops).toEqual([]); err.mockRestore()
  })
  it('허용된 쓰기·은퇴 키만 담긴 요청은 200 ok', async () => {
    h.createServerClient.mockResolvedValue(db({}))
    expect((await post({ prefs: { theme: 'dark' } })).status).toBe(200)
    expect((await post({ prefs: { startPage: 'home' }, workspaceId: WS })).status).toBe(200)
    expect((await post({ prefs: { lastProjectId: 'p', heroCollapsed: true } })).status).toBe(200)
    expect(h.ops.map((o) => o[0])).toEqual(['account_preferences', 'user_preferences'])
  })
  it('본문이 JSON 이 아니거나 객체가 아니면 400(prefs 배열은 무시)', async () => {
    const bad = await POST(new NextRequest('http://localhost/api/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))
    expect(bad.status).toBe(400)
    expect((await post(null)).status).toBe(400)
    h.createServerClient.mockResolvedValue(db({}))
    expect((await post({ prefs: ['theme'] })).status).toBe(200)
    expect(h.ops).toEqual([])
  })
})
