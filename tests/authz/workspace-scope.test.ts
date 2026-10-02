import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveWorkspaceBySlug: vi.fn(), getActorViewState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/workspace/resolve', () => ({ resolveWorkspaceBySlug: h.resolveWorkspaceBySlug }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))

import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-000000001601', slug: 'acme', name: 'Acme' }
beforeEach(() => {
  vi.clearAllMocks()
  h.resolveWorkspaceBySlug.mockResolvedValue({ ok: true, ws: WS })
})

describe('loadWorkspaceScope — /w/[slug]/** 페이지의 첫 await(E19)', () => {
  it('소속이면 역할과 함께 통과', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WS.id, 'admin']]) }), degraded: false })
    await expect(loadWorkspaceScope('acme')).resolves.toMatchObject({ ws: WS, degraded: false, role: 'admin' })
  })
  it('플랫폼 관리자는 소속이 아니어도 superuser 로 통과', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map() }), degraded: false })
    await expect(loadWorkspaceScope('acme')).resolves.toMatchObject({ role: 'superuser' })
  })
  it('미존재·비소속(RLS 0행)은 404', async () => {
    h.resolveWorkspaceBySlug.mockResolvedValue({ ok: false, kind: 'missing' })
    h.getActorViewState.mockResolvedValue({ actor: makeActor(), degraded: false })
    await expect(loadWorkspaceScope('nope')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('행은 보이는데(플랫폼 관리자 아님) 역할이 없으면 404 — RLS 가 열려 있어도 페이지가 닫는다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map() }), degraded: false })
    await expect(loadWorkspaceScope('acme')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('슬러그 조회 오류는 404 가 아니라 throw(오류 경계)', async () => {
    h.resolveWorkspaceBySlug.mockResolvedValue({ ok: false, kind: 'unavailable', error: 'down' })
    h.getActorViewState.mockResolvedValue({ actor: makeActor(), degraded: false })
    await expect(loadWorkspaceScope('acme')).rejects.toThrow('워크스페이스를 조회하지 못했습니다')
    expect(h.notFound).not.toHaveBeenCalled()
  })
  it('권한 조회 실패(열화)는 404 가 아니고 actor null 로 돌려준다 — 페이지는 service_role 로더를 부르지 않는다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    await expect(loadWorkspaceScope('acme')).resolves.toEqual({ ws: WS, actor: null, degraded: true, role: null })
  })
  it('비로그인(열화 아님, actor null)은 404', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    await expect(loadWorkspaceScope('acme')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
