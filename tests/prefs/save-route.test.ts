import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getSession: vi.fn(), getActor: vi.fn(), createServerClient: vi.fn(), ops: [] as unknown[][], eqs: {} as Record<string, unknown[][]> }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: h.getActor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { saveUiPrefs } from '@/app/actions/preferences'
import { POST } from '@/app/api/prefs/route'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WS = '00000000-0000-0000-7e57-000000001652'
const WS_X = '00000000-0000-0000-7e57-000000001651'
/** 표마다 maybeSingle 결과·upsert 기록·선행 조회의 .eq 인자 기록(Y1). readFail 이면 선행 조회 오류, writeFail 이면 upsert 오류 */
function db(existing: Record<string, unknown>, opts: { readFail?: string; writeFail?: string } = {}) {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: (...a: unknown[]) => { (h.eqs[table] ??= []).push(a); return q },
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
  vi.clearAllMocks(); h.ops.length = 0; h.eqs = {}
  h.getSession.mockResolvedValue({ id: 'u1' })
  h.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WS, 'member']]) }))
})

describe('saveUiPrefs — 계정 키는 account_preferences, 워크스페이스 키는 그 워크스페이스 행(D9)', () => {
  it('계정 키 병합 upsert', async () => {
    h.createServerClient.mockResolvedValue(db({ account_preferences: { locale: 'en' } }))
    expect(await saveUiPrefs({ theme: 'dark' })).toEqual({ ok: true })
    expect(h.ops).toEqual([['account_preferences', { locale: 'en', theme: 'dark' }, null, { onConflict: 'user_id' }]])
    expect(h.eqs).toEqual({ account_preferences: [['user_id', 'u1']] })
  })
  it('워크스페이스 키는 본문의 workspaceId 행에만(쿠키를 읽지 않는다 — Review Focus 4)', async () => {
    h.createServerClient.mockResolvedValue(db({ user_preferences: { notifRead: { p: ['n'] } } }))
    expect(await saveUiPrefs({ startPage: 'my_work' }, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops).toEqual([['user_preferences', { notifRead: { p: ['n'] }, startPage: 'my_work' }, WS, { onConflict: 'user_id,workspace_id' }]])
    // 병합 원천(선행 조회)도 그 워크스페이스 행으로 좁힌다 — 빠지면 다른 워크스페이스 행을 읽어 이 행에 병합한다(Y1)
    expect(h.eqs).toEqual({ user_preferences: [['user_id', 'u1'], ['workspace_id', WS]] })
  })
  it('대문자로 온 같은 워크스페이스 id 는 소문자로 맞춰 소속을 본다 — 남의 행이 아니라 같은 행', async () => {
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ startPage: 'home' }, { workspaceId: WS.toUpperCase() })).toEqual({ ok: true })
    expect(h.ops.map((o) => o[2])).toEqual([WS])
    expect(h.eqs.user_preferences).toEqual([['user_id', 'u1'], ['workspace_id', WS]])
  })
  it('workspaceId 가 없거나 비소속이면 같은 요청의 계정 키도 쓰지 않는다 — 전부 아니면 전무(Y4)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ theme: 'light', startPage: 'home' })).toEqual({ ok: false })
    expect(await saveUiPrefs({ theme: 'light', startPage: 'home' }, { workspaceId: WS_X })).toEqual({ ok: false })
    expect(await saveUiPrefs({ startPage: 'home' }, { workspaceId: WS_X })).toEqual({ ok: false })
    expect(h.ops).toEqual([]); expect(h.eqs).toEqual({})
    expect(err).toHaveBeenCalledTimes(3); err.mockRestore()
  })
  it('섞인 요청이 통과하면 둘 다 저장한다', async () => {
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ theme: 'light', startPage: 'home' }, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops.map((o) => o[0])).toEqual(['account_preferences', 'user_preferences'])
  })
  it('notifRead 는 이 경로로 받지 않는다 — 쓰기 주체는 markAllNotificationsRead 하나(Y4)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ notifRead: { p: Array.from({ length: 10_000 }, (_, i) => `n${i}`) } }, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops).toEqual([])
    expect(err).toHaveBeenCalledWith(expect.stringContaining('모르는 키'), 'notifRead'); err.mockRestore()
  })
  it('계정 키 값 검사 — 형식 밖 값은 그 키만 버린다(크기 상한 포함, Y4)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    const bad = {
      theme: 'purple', locale: 'fr', sidebarCollapsed: 'yes', minuteFontSize: 99, wbsGanttScale: Number.NaN, minutesView: 'grid',
      dashSections: Array.from({ length: 51 }, (_, i) => `s${i}`), notif: { a: 'on' },
    }
    expect(await saveUiPrefs({ ...bad, wbsOutline: true, minutesExplorerLayout: 'list' } as never)).toEqual({ ok: true })
    expect(h.ops).toEqual([['account_preferences', { wbsOutline: true, minutesExplorerLayout: 'list' }, null, { onConflict: 'user_id' }]])
    err.mockRestore()
  })
  it('모르는 키 로그는 개수와 앞 다섯(길이 절단)만 — 키 수만 개 요청이 거대 로그를 남기지 않는다(Y4)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    const keys = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}${'x'.repeat(100)}`, 1]))
    expect(await saveUiPrefs(keys as never)).toEqual({ ok: true })
    expect(err).toHaveBeenCalledTimes(1)
    const [msg, list] = err.mock.calls[0] as [string, string]
    expect(msg).toContain('(5000개)')
    expect(list.split(',').length).toBe(6); expect(list.length).toBeLessThan(5 * 41 + 3)
    err.mockRestore()
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
  it('content-type 이 application/json 이 아니면 본문을 읽지 않고 415(Y5 — text/plain 폼 CSRF)', async () => {
    h.createServerClient.mockResolvedValue(db({}))
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp']) {
      const res = await POST(new NextRequest('http://localhost/api/prefs', { method: 'POST', headers: { 'content-type': ct }, body: JSON.stringify({ prefs: { theme: 'dark' } }) }))
      expect(res.status, ct).toBe(415)
    }
    expect((await post({ prefs: { theme: 'dark' } }, { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200)
    expect(h.ops.map((o) => o[0])).toEqual(['account_preferences'])
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

// U2b-2 권한 리뷰 Y1 — 최근 방문은 클라이언트가 목록을 만들어 덮지 않는다. 방문한 프로젝트 id(visits)만 보내고 서버가 선행 조회한 행에 앞으로 넣는다.
// 조회 실패(모름)를 빈 목록으로 받아 10개를 1개로 덮는 길, 디바운스 창 안 연속 이동이 서로 지우는 길이 함께 닫힌다.
describe('saveUiPrefs — 방문 기록(visits, Y1)', () => {
  const PA = '00000000-0000-0000-7e57-000000001791', PB = '00000000-0000-0000-7e57-000000001792', PX = '00000000-0000-0000-7e57-000000001793'
  const PO = '00000000-0000-0000-7e57-000000001794'   // 다른 워크스페이스의 프로젝트
  const actor = () => makeActor({ workspaceRoles: new Map([[WS, 'member'], [WS_X, 'member']]), projectWorkspace: new Map([[PA, WS], [PB, WS], [PO, WS_X]]), projectRoles: new Map([[PA, 'member'], [PB, 'member'], [PO, 'member']]) })
  beforeEach(() => { h.getActor.mockResolvedValue(actor()) })
  it('서버 행의 최근 방문 앞에 차례로 넣는다(마지막 방문이 맨 앞, 기존 항목 유지)', async () => {
    h.createServerClient.mockResolvedValue(db({ user_preferences: { recentProjects: [{ id: PX, at: '2026-09-01T00:00:00.000Z' }], startPage: 'home' } }))
    expect(await saveUiPrefs({}, { workspaceId: WS, visits: [PA, PB] })).toEqual({ ok: true })
    const saved = h.ops[0][1] as { recentProjects: { id: string }[]; startPage: string }
    expect(saved.recentProjects.map((r) => r.id)).toEqual([PB, PA, PX]); expect(saved.startPage).toBe('home')
  })
  it('선행 조회 실패면 쓰지 않는다 — 모름으로 서버 목록을 덮지 않는다(원칙 ②)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}, { readFail: 'user_preferences' }))
    expect(await saveUiPrefs({}, { workspaceId: WS, visits: [PA] })).toEqual({ ok: false })
    expect(h.ops).toEqual([]); err.mockRestore()
  })
  it('그 워크스페이스에서 볼 수 없는 프로젝트(다른 워크스페이스·모르는 id·형식 밖)는 버린다(로그)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({}, { workspaceId: WS, visits: [PO, '00000000-0000-0000-0000-00000000dead', 'x', PA] as string[] })).toEqual({ ok: true })
    expect((h.ops[0][1] as { recentProjects: { id: string }[] }).recentProjects.map((r) => r.id)).toEqual([PA])
    expect(err).toHaveBeenCalled(); err.mockRestore()
  })
  it('남은 방문이 없으면 쓰지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({}, { workspaceId: WS, visits: [PO] })).toEqual({ ok: true })
    expect(h.ops).toEqual([]); err.mockRestore()
  })
  it('비소속 워크스페이스면 거부(같은 거부 응답)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WS, 'member']]), projectWorkspace: new Map([[PO, WS_X]]) }))
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({}, { workspaceId: WS_X, visits: [PO] })).toEqual({ ok: false })
    expect(h.ops).toEqual([]); err.mockRestore()
  })
  it('같은 요청의 즐겨찾기 패치와 한 번의 병합으로 쓴다(두 요청 경합 없음)', async () => {
    h.createServerClient.mockResolvedValue(db({ user_preferences: { favoriteProjectIds: [PX] } }))
    expect(await saveUiPrefs({ favoriteProjectIds: [PA] }, { workspaceId: WS, visits: [PB] })).toEqual({ ok: true })
    expect(h.ops).toHaveLength(1)
    expect(h.ops[0][1]).toEqual({ favoriteProjectIds: [PA], recentProjects: [expect.objectContaining({ id: PB })] })
  })
  it('AA6 — 플랫폼 관리자의 비소속 워크스페이스에는 방문·워크스페이스 키를 쓰지 않는다(승계가 아니라 실제 소속만, 같은 거부 응답)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getActor.mockResolvedValue(makeSuperuser({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[PA, WS], [PO, WS_X]]) }))
    h.createServerClient.mockResolvedValue(db({}))
    expect(await saveUiPrefs({ startPage: 'home' }, { workspaceId: WS_X, visits: [PO] })).toEqual({ ok: false })
    expect(h.ops).toEqual([])
    expect(await saveUiPrefs({}, { workspaceId: WS, visits: [PA] })).toEqual({ ok: true })        // 실제 소속이면 그대로 쓴다
    expect(h.ops.map((o) => o[0])).toEqual(['user_preferences']); err.mockRestore()
  })
  it('AA7 — prefs.recentProjects 는 클라이언트 쓰기 키가 아니다(쓰기 주체는 visits 하나) — 행을 바꾸지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.createServerClient.mockResolvedValue(db({ user_preferences: { recentProjects: [{ id: PX, at: '2026-09-01T00:00:00.000Z' }] } }))
    expect(await saveUiPrefs({ recentProjects: [{ id: PO, at: '2999-01-01T00:00:00.000Z' }] }, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops).toEqual([])
    expect((await post({ workspaceId: WS, prefs: { recentProjects: [{ id: PO, at: '2999-01-01T00:00:00.000Z' }] } })).status).toBe(200)
    expect(h.ops).toEqual([])
    // 즐겨찾기와 섞여 와도 recentProjects 만 빠진다
    expect(await saveUiPrefs({ favoriteProjectIds: [PA], recentProjects: [{ id: PO, at: '2999-01-01T00:00:00.000Z' }] }, { workspaceId: WS })).toEqual({ ok: true })
    expect(h.ops[0][1]).toEqual({ recentProjects: [{ id: PX, at: '2026-09-01T00:00:00.000Z' }], favoriteProjectIds: [PA] }); err.mockRestore()
  })
  it('/api/prefs — prefs 없이 visits 만 담은 본문도 받는다', async () => {
    h.createServerClient.mockResolvedValue(db({}))
    expect((await post({ workspaceId: WS, visits: [PA] })).status).toBe(200)
    expect(h.ops.map((o) => o[0])).toEqual(['user_preferences'])
  })
})
