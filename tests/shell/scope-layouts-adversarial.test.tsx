// 적대적 탐색 고정(U2b-3) — 레이아웃 404(비소속·없는 슬러그·형식 밖)·플랫폼 관리자 비소속 보기·(global) 쿠키 워크스페이스.
// 해석 모듈(resolve·list·current)은 진짜를 쓰고 DB(RLS 결과)·쿠키만 흉내 낸다 — 판정이 mock 안으로 숨지 않게. 모두 fail-closed(3원칙 ③).
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Ref = { id: string; slug: string; name: string }
const h = vi.hoisted(() => ({
  ws: [] as Ref[],                                          // 세션 클라이언트에 보이는 workspaces 행(RLS 뒤)
  members: [] as { role: 'admin' | 'member'; at: string; ws: Ref }[],
  uid: 'u1' as string | null,
  wsError: null as string | null, memberError: null as string | null,
  wsQueries: [] as string[],
  cookie: undefined as string | undefined,
  getActorViewState: vi.fn(),
  loadShell: vi.fn(), minimalShell: vi.fn(),
  shellProps: vi.fn(), shellScope: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

function fakeClient() {
  return {
    auth: { getClaims: async () => ({ data: h.uid ? { claims: { sub: h.uid } } : null, error: null }) },
    from(table: string) {
      if (table === 'workspaces') {
        let col = '', val: unknown
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => { col = c; val = v; return q },
          maybeSingle: async () => {
            h.wsQueries.push(`${col}=${String(val)}`)
            if (h.wsError) return { data: null, error: { message: h.wsError } }
            return { data: h.ws.find((w) => (w as Record<string, unknown>)[col] === val) ?? null, error: null }
          },
        }
        return q
      }
      if (table === 'workspace_members') {
        const result = () => (h.memberError ? { data: null, error: { message: h.memberError } }
          : { data: h.members.map((m) => ({ role: m.role, created_at: m.at, workspace_id: m.ws.id, workspaces: m.ws })), error: null })
        const q = { select: () => q, eq: () => q, order: () => q, then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok) }
        return q
      }
      throw new Error(`예상 밖 표: ${table}`)
    },
  }
}
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => fakeClient() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: (n: string) => (n === 'dflow-ws' && h.cookie !== undefined ? { name: n, value: h.cookie } : undefined) }) }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
// GG1 — 프로젝트 레이아웃·페이지가 명단 밖 비공개 숨김 집합을 읽는다(이 파일은 비공개를 다루지 않는다 — 빈 집합)
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/auth', () => ({ getDisplayName: async () => 'alice' }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('@/lib/teams/source', () => ({ workspaceTeams: async () => [], projectTeams: async () => [] }))
vi.mock('@/lib/shell/loadShell', () => ({ loadShell: h.loadShell, minimalShell: h.minimalShell }))
vi.mock('next/navigation', () => ({ notFound: h.notFound, unstable_rethrow: () => {} }))
vi.mock('@/components/app/AppShell', () => ({ AppShell: (p: { children: React.ReactNode }) => { h.shellProps(p); return <div data-shell>{p.children}</div> } }))
vi.mock('@/components/app/ShellScope', () => ({ ShellScope: (p: unknown) => { h.shellScope(p); return null } }))

import WorkspaceLayout from '@/app/(app)/w/[slug]/layout'
import ProjectLayout from '@/app/(app)/p/[projectId]/layout'
import GlobalLayout from '@/app/(app)/(global)/layout'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const A: Ref = { id: '00000000-0000-0000-7e57-000000001751', slug: 'acme', name: 'Acme' }
const B: Ref = { id: '00000000-0000-0000-7e57-000000001752', slug: 'bravo', name: 'Bravo' }
const C: Ref = { id: '00000000-0000-0000-7e57-000000001753', slug: 'charlie', name: 'Charlie' }   // 남의 워크스페이스
const PA = '00000000-0000-0000-7e57-000000001754', PC = '00000000-0000-0000-7e57-000000001755'

const ws = (slug: string) => WorkspaceLayout({ children: <p>본문</p>, params: Promise.resolve({ slug }) })
const proj = (projectId: string) => ProjectLayout({ children: <p>본문</p>, params: Promise.resolve({ projectId }) })
const glob = () => GlobalLayout({ children: <p>본문</p> })
const memberOfAB = () => makeActor({ workspaceRoles: new Map([[A.id, 'member'], [B.id, 'admin']]), projectWorkspace: new Map([[PA, A.id]]), projectRoles: new Map([[PA, 'member']]) })

beforeEach(() => {
  vi.clearAllMocks()
  h.uid = 'u1'; h.wsError = null; h.memberError = null; h.wsQueries = []; h.cookie = undefined
  h.ws = [A, B]                                                  // 멤버에게 RLS 가 보여 주는 행 — C 는 보이지 않는다
  h.members = [{ role: 'member', at: '2026-01-01', ws: A }, { role: 'admin', at: '2026-02-01', ws: B }]
  h.getActorViewState.mockResolvedValue({ actor: memberOfAB(), degraded: false })
  h.loadShell.mockImplementation(async (i: Record<string, unknown>) => ({ fromLoadShell: true, ...i, projects: [], recent: [] }))
  h.minimalShell.mockImplementation((i: Record<string, unknown>) => ({ minimal: true, ...i }))
})

describe('/w/[slug] 레이아웃 404 — 형식 밖·없는 슬러그·비소속', () => {
  it.each(['Acme', 'ACME', 'acme%2Fx', '%61cme', 'acme/', 'acme/x', 'a', '-acme', 'acme;x', ' acme', '', '..'])('형식 밖 슬러그 %j → 조회 없이 404', async (slug) => {
    await expect(ws(slug)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.wsQueries).toEqual([])                              // 소문자화·디코드해 남의 워크스페이스를 찾지 않는다
    expect(h.loadShell).not.toHaveBeenCalled(); expect(h.shellProps).not.toHaveBeenCalled()
  })
  it('형식은 맞지만 없는 슬러그 → 404(셸 조회 없음)', async () => {
    await expect(ws('ghost')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.wsQueries).toEqual(['slug=ghost']); expect(h.loadShell).not.toHaveBeenCalled()
  })
  it('비소속 워크스페이스(RLS 0행) → 404 — 있는 슬러그라도 없는 것과 같다(존재 은닉)', async () => {
    await expect(ws('charlie')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.loadShell).not.toHaveBeenCalled()
  })
  it('행이 보이더라도 actor 의 역할이 없으면 404 — 레이아웃도 소속을 다시 본다(RLS 하나에 기대지 않는다)', async () => {
    h.ws = [A, B, C]
    await expect(ws('charlie')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.loadShell).not.toHaveBeenCalled(); expect(h.shellScope).not.toHaveBeenCalled()
  })
  it('슬러그 조회 오류는 404 가 아니라 오류 경계(장애를 없는 워크스페이스로 위장하지 않는다)', async () => {
    h.wsError = 'connection refused'
    await expect(ws('acme')).rejects.toThrow(/조회하지 못했습니다/); expect(h.notFound).not.toHaveBeenCalled()
  })
  it('소속 목록 오류도 오류 경계(404·빈 전환기로 위장하지 않는다)', async () => {
    h.memberError = 'down'
    await expect(ws('acme')).rejects.toThrow(/소속 목록/); expect(h.notFound).not.toHaveBeenCalled(); expect(h.loadShell).not.toHaveBeenCalled()
  })
  it('비로그인(actor null·열화 아님) → 404', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    await expect(ws('acme')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('소속이면 셸 — 플랫폼 관리자로 보는 중이 아니고 게시 저장소에 쓴다', async () => {
    renderToString(await ws('acme'))
    expect(h.loadShell).toHaveBeenCalledWith(expect.objectContaining({ scope: 'workspace', ws: A, viewingAsPlatformAdmin: false }))
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: A, projectId: null, persist: true }))
  })
  it('열화(actor null)면 404 없이 actor null 로 셸(caps 는 loadShell 이 전부 false)', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    renderToString(await ws('acme'))
    expect(h.loadShell).toHaveBeenCalledWith(expect.objectContaining({ actor: null, degraded: true, viewingAsPlatformAdmin: false }))
  })
})

describe('플랫폼 관리자 비소속 보기', () => {
  it('/w/<비소속> — 셸을 그리되 칩(viewingAsPlatformAdmin)을 달고 전환기 목록에 넣지 않으며, 쿠키·최근 방문을 쓰지 않는다', async () => {
    h.ws = [A, B, C]; h.members = [{ role: 'admin', at: '2026-01-01', ws: A }]
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map([[A.id, 'admin']]) }), degraded: false })
    renderToString(await ws('charlie'))
    const i = h.loadShell.mock.calls[0][0]
    expect(i.viewingAsPlatformAdmin).toBe(true)
    expect(i.workspaces.map((r: Ref) => r.id)).toEqual([A.id])
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: C, persist: false }))
  })
  it('AA6 — 권한 조회가 열화돼도(actor null) 비소속 워크스페이스면 칩과 비기록이 유지된다(실제 소속 목록 기준)', async () => {
    h.ws = [A, B, C]; h.members = [{ role: 'admin', at: '2026-01-01', ws: A }]   // RLS 가 플랫폼 관리자에게 C 를 보여 준다
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    renderToString(await ws('charlie'))
    expect(h.loadShell.mock.calls[0][0].viewingAsPlatformAdmin).toBe(true)
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: C, persist: false }))
  })
  it('플랫폼 관리자라도 없는 슬러그·형식 밖은 404', async () => {
    h.ws = [A, B, C]
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map() }), degraded: false })
    await expect(ws('ghost')).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(ws('Charlie')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('플랫폼 관리자가 소속인 워크스페이스는 칩 없음', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map([[A.id, 'member'], [B.id, 'admin']]) }), degraded: false })
    renderToString(await ws('bravo'))
    expect(h.loadShell.mock.calls[0][0].viewingAsPlatformAdmin).toBe(false)
  })
  it('/p/<비소속 워크스페이스의 프로젝트> — 칩, 쿠키·최근 방문 쓰기 없음', async () => {
    h.ws = [A, B, C]; h.members = [{ role: 'admin', at: '2026-01-01', ws: A }]
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map([[A.id, 'admin']]), projectWorkspace: new Map([[PA, A.id], [PC, C.id]]) }), degraded: false })
    renderToString(await proj(PC))
    expect(h.loadShell).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project', ws: C, projectId: PC, viewingAsPlatformAdmin: true }))
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: C, projectId: PC, persist: false }))
  })
  it('/p/<없는 pid> — 플랫폼 관리자도 404, 워크스페이스·셸 조회 없음', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ projectWorkspace: new Map([[PA, A.id]]) }), degraded: false })
    await expect(proj(PC)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.wsQueries).toEqual([]); expect(h.loadShell).not.toHaveBeenCalled()
  })
})

describe('/p/[projectId] 레이아웃 — 숨김·열화', () => {
  it('타 워크스페이스·미존재 프로젝트는 404 — 셸 데이터(목록·브랜드)를 싣지 않는다', async () => {
    await expect(proj(PC)).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.wsQueries).toEqual([]); expect(h.loadShell).not.toHaveBeenCalled(); expect(h.minimalShell).not.toHaveBeenCalled()
  })
  it('열화면 404 없이 최소 셸 — 워크스페이스 조회·셸 조회를 하지 않는다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    renderToString(await proj(PA))
    expect(h.minimalShell).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project', projectId: PA, degraded: true }))
    expect(h.loadShell).not.toHaveBeenCalled(); expect(h.wsQueries).toEqual([]); expect(h.shellScope).not.toHaveBeenCalled()
  })
  it('프로젝트의 워크스페이스 행이 안 보이면(missing) 최소 셸 — 남의 이름·내비를 싣지 않는다', async () => {
    h.ws = [B]
    renderToString(await proj(PA))
    expect(h.minimalShell).toHaveBeenCalled(); expect(h.loadShell).not.toHaveBeenCalled()
  })
  it('워크스페이스 조회 오류는 오류 경계', async () => {
    h.wsError = 'down'
    await expect(proj(PA)).rejects.toThrow(/조회하지 못했습니다/); expect(h.notFound).not.toHaveBeenCalled()
  })
  it('소속 멤버는 셸 — 칩 없음·게시 저장소에 쓴다', async () => {
    renderToString(await proj(PA))
    expect(h.loadShell).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project', ws: A, projectId: PA, viewingAsPlatformAdmin: false }))
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: A, projectId: PA, persist: true }))
  })
})

describe('(global) 레이아웃 — 쿠키 워크스페이스', () => {
  it('쿠키가 소속 워크스페이스면 그 워크스페이스의 셸', async () => {
    h.cookie = 'bravo'
    renderToString(await glob())
    expect(h.loadShell).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global', ws: B, viewingAsPlatformAdmin: false }))
  })
  it.each([
    ['위조 — 존재하는 남의 워크스페이스', 'charlie'], ['탈퇴·없는 슬러그', 'ghost'], ['대문자', 'BRAVO'], ['세미콜론', 'bravo; path=/'],
    ['공백', ' bravo'], ['인코딩', '%62ravo'], ['빈 값', ''],
  ])('쿠키 %s(%j) → 첫 소속으로 조용히(남의 이름을 싣지 않는다)', async (_label, cookie) => {
    h.ws = [A, B, C]; h.cookie = cookie
    renderToString(await glob())
    expect(h.loadShell.mock.calls[0][0].ws).toEqual(A)
  })
  it('플랫폼 관리자도 쿠키로 비소속 워크스페이스를 고를 수 없다 — 첫 소속', async () => {
    h.ws = [A, B, C]; h.cookie = 'charlie'
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map([[A.id, 'member'], [B.id, 'admin']]) }), degraded: false })
    renderToString(await glob())
    expect(h.loadShell.mock.calls[0][0]).toEqual(expect.objectContaining({ ws: A, viewingAsPlatformAdmin: false }))
  })
  it('소속 0 이면 내비 없는 최소 셸(계정 메뉴만) — 셸 조회 없음', async () => {
    h.members = []; h.cookie = 'acme'
    renderToString(await glob())
    expect(h.minimalShell).toHaveBeenCalledWith(expect.objectContaining({ scope: 'global', workspaces: [] })); expect(h.loadShell).not.toHaveBeenCalled()
  })
  it('소속 목록 오류는 오류 경계(소속 0 으로 위장하지 않는다)', async () => {
    h.memberError = 'down'
    await expect(glob()).rejects.toThrow(); expect(h.minimalShell).not.toHaveBeenCalled(); expect(h.loadShell).not.toHaveBeenCalled()
  })
  // U2b-5 리뷰 수정 CC4 — (global) 이 범위를 게시하지 않으면 프로젝트 없는 AI 질문이 400, 사용 기록이 공백이었다.
  // 소속을 다시 본 쿠키 워크스페이스를 게시하되 persist=false 라 쿠키·방문은 쓰지 않는다(D3 — 쓰는 곳은 범위 레이아웃 하나)
  it('(global) 은 검증된 쿠키 워크스페이스를 게시한다 — 쿠키·방문은 쓰지 않는다(persist=false, D3)', async () => {
    h.cookie = 'bravo'
    renderToString(await glob())
    expect(h.shellScope).toHaveBeenCalledTimes(1)
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: B, projectId: null, persist: false }))
  })
  it('(global) 위조 쿠키는 첫 소속을 게시한다 — 남의 워크스페이스를 범위로 싣지 않는다', async () => {
    h.ws = [A, B, C]; h.cookie = 'charlie'
    renderToString(await glob())
    expect(h.shellScope).toHaveBeenCalledWith(expect.objectContaining({ workspace: A, persist: false }))
  })
  it('(global) 소속 0 이면 게시하지 않는다 — 범위 없음(AI 진입점은 클라이언트가 닫는다)', async () => {
    h.members = []; h.cookie = 'acme'
    renderToString(await glob())
    expect(h.shellScope).not.toHaveBeenCalled()
  })
})
