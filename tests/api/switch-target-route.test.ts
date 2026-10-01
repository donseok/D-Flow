// 프로젝트 전환 대상(D41, 판정 W12) — 숨김·미존재·다른 워크스페이스 대상은 404(존재 은닉), 판독 실패는 degraded 개요, href 는 늘 /p/<대상>/….
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getActorViewState: vi.fn(), effectiveModules: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: h.effectiveModules }))

import { GET } from '@/app/api/nav/switch-target/route'
import { makeActor, makeMemberActor, makeSuperuser } from '../fixtures/actor'

const B = '00000000-0000-0000-7e57-0000000016f5', OTHER = '00000000-0000-0000-7e57-0000000016f8', WS = 'ws-1'
const get = (q: string) => GET(new NextRequest(new URL(`/api/nav/switch-target?${q}`, 'http://127.0.0.1:3201')))
const enc = encodeURIComponent
beforeEach(() => {
  vi.clearAllMocks()
  h.getActorViewState.mockResolvedValue({ actor: makeMemberActor(B, [], { projectWorkspace: new Map([[B, WS]]) }), degraded: false })
  h.effectiveModules.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings']))
})

describe('/api/nav/switch-target', () => {
  it('대상에서 꺼진 모듈 → 개요 + fallbackModule, no-store', async () => {
    const res = await get(`project=${B}&path=${enc('/p/A/issues')}&query=`)
    expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ href: `/p/${B}/dashboard`, fallbackModule: 'issues' })
    expect(h.effectiveModules).toHaveBeenCalledWith({ workspaceId: WS, projectId: B })
  })
  it('켜진 모듈은 같은 모듈 + 보기 쿼리', async () => {
    h.effectiveModules.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings', 'issues']))
    const res = await get(`project=${B}&path=${enc('/p/A/issues')}&query=${enc('?view=board&q=x')}`)
    expect(await res.json()).toEqual({ href: `/p/${B}/issues?view=board`, fallbackModule: null })
  })
  it('숨김·미존재 프로젝트 404, 비로그인 401, 형식 밖 400', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeActor(), degraded: false })
    expect((await get(`project=${B}&path=/p/A/wbs`)).status).toBe(404)
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    expect((await get(`project=${B}&path=/p/A/wbs`)).status).toBe(401)
    h.getActorViewState.mockResolvedValue({ actor: makeActor(), degraded: false })
    expect((await get('project=x&path=/p/A/wbs')).status).toBe(400)
    expect((await get(`project=${B}&path=p/A/wbs`)).status).toBe(400)
    expect((await get(`project=${B}`)).status).toBe(400)
    expect(h.effectiveModules).not.toHaveBeenCalled()
  })
  it('W12 — 다른 워크스페이스 프로젝트(내 소속 밖)는 존재와 무관하게 같은 404, 모듈을 읽지 않는다', async () => {
    const r1 = await get(`project=${OTHER}&path=/p/A/wbs`)
    const r2 = await get(`project=00000000-0000-0000-7e57-0000000016f9&path=/p/A/wbs`)
    expect([r1.status, r2.status]).toEqual([404, 404])
    expect(await r1.json()).toEqual(await r2.json())
    expect(h.effectiveModules).not.toHaveBeenCalled()
  })
  it('플랫폼 관리자 — 있는 프로젝트는 통과, 없는 프로젝트는 404', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ projectWorkspace: new Map([[B, WS]]) }), degraded: false })
    expect((await get(`project=${B}&path=/p/A/wbs`)).status).toBe(200)
    expect((await get(`project=${OTHER}&path=/p/A/wbs`)).status).toBe(404)
  })
  it('path 를 비틀어도 href 는 늘 /p/<대상>/… 안 — 외부 주소·다른 프로젝트로 유도하지 않는다', async () => {
    h.effectiveModules.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings', 'issues']))
    for (const path of ['//evil.example/p/A/issues', '/p/A/../../w/x/issues', '/p/A/%2e%2e/issues', '/w/acme/minutes', '/p/A/javascript:alert(1)']) {
      const body = await (await get(`project=${B}&path=${enc(path)}&query=${enc('?view=board&next=//evil.example')}`)).json() as { href: string }
      expect(body.href.startsWith(`/p/${B}/`), path).toBe(true)
      expect(body.href, path).not.toContain('evil')
    }
  })
  it('대문자 uuid 는 같은 프로젝트로 판정한다', async () => {
    const res = await get(`project=${B.toUpperCase()}&path=/p/A/wbs`)
    expect(res.status).toBe(200)
    expect((await res.json() as { href: string }).href.startsWith(`/p/${B}/`)).toBe(true)
  })
  it('모듈 집합 판독 실패는 사용하지 않는 모듈로 위장하지 않는다 — degraded', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.effectiveModules.mockRejectedValue(new Error('config down'))
    expect(await (await get(`project=${B}&path=/p/A/issues`)).json()).toEqual({ href: `/p/${B}/dashboard`, fallbackModule: null, degraded: true })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('권한 조회 실패(열화)는 숨김 판정을 할 수 없다 — 503 이 아니라 degraded 개요(쓰기 없음, 이동만), 모듈을 읽지 않는다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    expect(await (await get(`project=${B}&path=/p/A/issues`)).json()).toEqual({ href: `/p/${B}/dashboard`, fallbackModule: null, degraded: true })
    expect(h.effectiveModules).not.toHaveBeenCalled()
  })
})
