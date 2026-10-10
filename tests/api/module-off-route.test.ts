// 꺼진 모듈 화면의 안내 판정(BUG-22) — 404 화면이 자기 주소를 묻는다. off:true 는 "그 범위를 볼 수 있는 사람 + 실제로 꺼짐" 일 때만이고,
// 그 밖(비로그인·열화·다른 워크스페이스·숨김 프로젝트·비소속·켜진 모듈·판독 실패·모듈 밖 주소)은 전부 같은 { off: false } 다 — 존재 오라클이 아니다.
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getActorViewState: vi.fn(), effectiveModules: vi.fn(), getHiddenProjectIds: vi.fn(), resolveWorkspaceBySlug: vi.fn(), workspaceRefById: vi.fn(),
}))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: h.getHiddenProjectIds }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: h.effectiveModules }))
vi.mock('@/lib/workspace/resolve', () => ({ resolveWorkspaceBySlug: h.resolveWorkspaceBySlug, workspaceRefById: h.workspaceRefById }))

import { GET } from '@/app/api/nav/module-off/route'
import { hiddenIds, makeActor, makeAdminActor, makeMemberActor, WS } from '../fixtures/actor'

const P = '00000000-0000-0000-7e57-0000000016f5', OTHER = '00000000-0000-0000-7e57-0000000016f8'
const CORE = ['dashboard', 'wbs', 'members', 'settings']
const get = async (path: string) => {
  const res = await GET(new NextRequest(new URL(`/api/nav/module-off?path=${encodeURIComponent(path)}`, 'http://127.0.0.1:3201')))
  return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control') }
}
const NO = { off: false }
/** 워크스페이스 층·프로젝트 층의 유효 모듈 */
const modules = (workspace: string[], project: string[]) =>
  h.effectiveModules.mockImplementation(async (scope: { projectId?: string }) => new Set([...CORE, ...(scope.projectId ? project : workspace)]))

beforeEach(() => {
  vi.clearAllMocks()
  h.getActorViewState.mockResolvedValue({ actor: makeMemberActor(P), degraded: false })
  h.getHiddenProjectIds.mockResolvedValue(hiddenIds())
  h.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: WS, slug: 'default', name: '기본' } })
  h.resolveWorkspaceBySlug.mockResolvedValue({ ok: true, ws: { id: WS, slug: 'default', name: '기본' } })
  modules(['issues', 'minutes'], [])
})

describe('/api/nav/module-off — 프로젝트 화면', () => {
  it('프로젝트에서 끈 모듈 → off(project). 멤버에게는 설정 링크가 없다', async () => {
    expect(await get(`/p/${P}/issues`)).toEqual({ status: 200, cache: 'no-store', body: { off: true, layer: 'project', module: 'issues', settingsHref: null } })
  })
  it('프로젝트 관리자에게는 프로젝트 설정의 모듈 구획 링크', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeAdminActor(P), degraded: false })
    expect((await get(`/p/${P}/issues?view=board`)).body).toEqual({ off: true, layer: 'project', module: 'issues', settingsHref: `/p/${P}/settings#project-modules` })
  })
  it('워크스페이스가 허용하지 않은 모듈 → off(workspace). 워크스페이스 관리자에게만 워크스페이스 설정 링크', async () => {
    modules([], [])
    expect((await get(`/p/${P}/issues`)).body).toEqual({ off: true, layer: 'workspace', module: 'issues', settingsHref: null })
    h.getActorViewState.mockResolvedValue({ actor: makeMemberActor(P, [], { workspaceRoles: new Map([[WS, 'admin']]) }), degraded: false })
    expect((await get(`/p/${P}/issues`)).body.settingsHref).toBe('/w/default/settings#workspace-modules')
  })
  it('켜진 모듈의 404(없는 하위 주소 등)는 안내하지 않는다', async () => {
    modules(['issues'], ['issues'])
    expect((await get(`/p/${P}/issues/nope`)).body).toEqual(NO)
  })
  it('core 모듈·모듈 밖 주소는 묻지도 않는다(권한 조회 없음)', async () => {
    expect((await get(`/p/${P}/dashboard`)).body).toEqual(NO)
    expect((await get(`/p/${P}`)).body).toEqual(NO)
    expect((await get('/account')).body).toEqual(NO)
    expect(h.effectiveModules).toHaveBeenCalledTimes(2)   // dashboard 한 번(두 층) — 나머지 둘은 경로에서 끝난다
  })
})

describe('/api/nav/module-off — 정보 노출: 볼 수 없는 범위는 평범한 404 와 같은 답', () => {
  it('다른 워크스페이스·없는 프로젝트', async () => {
    expect((await get(`/p/${OTHER}/issues`)).body).toEqual(NO)
    expect(h.effectiveModules).not.toHaveBeenCalled()
  })
  it('명단 밖 비공개(숨김) 프로젝트', async () => {
    h.getHiddenProjectIds.mockResolvedValue(hiddenIds(P))
    expect((await get(`/p/${P}/issues`)).body).toEqual(NO)
    expect(h.effectiveModules).not.toHaveBeenCalled()
  })
  it('비로그인·권한 조회 열화', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    expect((await get(`/p/${P}/issues`)).body).toEqual(NO)
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    expect((await get(`/p/${P}/issues`)).body).toEqual(NO)
  })
  it('비소속 워크스페이스의 화면', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map() }), degraded: false })
    modules([], [])
    expect((await get('/w/default/minutes')).body).toEqual(NO)
    expect(h.effectiveModules).not.toHaveBeenCalled()
  })
  it('판독 실패는 "꺼짐"으로 단정하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.effectiveModules.mockRejectedValue(new Error('설정을 읽지 못했다'))
    expect((await get(`/p/${P}/issues`)).body).toEqual(NO)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('형식 밖 요청은 400', async () => {
    expect((await get('p/x')).status).toBe(400)
  })
})

describe('/api/nav/module-off — 워크스페이스 화면', () => {
  it('소속 워크스페이스에서 꺼진 모듈 → off(workspace)', async () => {
    modules([], [])
    expect((await get('/w/default/minutes/abc')).body).toEqual({ off: true, layer: 'workspace', module: 'minutes', settingsHref: null })
  })
  it('켜져 있으면 안내하지 않는다(없는 회의록 id 등)', async () => {
    expect((await get('/w/default/minutes/abc')).body).toEqual(NO)
  })
})
