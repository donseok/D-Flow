// 초대 칸의 사전 안내 — 허용 도메인이 비어 있을 때만, 설정 링크는 워크스페이스 관리자에게만.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }))
const h = vi.hoisted(() => ({ loadInviteDomains: vi.fn(), workspaceRefById: vi.fn(), createServerClient: vi.fn() }))
vi.mock('@/lib/data/inviteDomains', () => ({ loadInviteDomains: h.loadInviteDomains }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: h.workspaceRefById }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))

import { loadInviteDomainNotice } from '@/lib/data/inviteDomainNotice'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const SESSION = { from: vi.fn() }
const WS_ADMIN = makeActor({ userId: 'u-wa', workspaceRoles: new Map([[WS, 'admin']]) })
const PROJECT_ADMIN = makeActor({ userId: 'u-pa', projectWorkspace: new Map([['p1', WS]]), projectRoles: new Map([['p1', 'admin']]) })
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.loadInviteDomains.mockReset(); h.loadInviteDomains.mockResolvedValue({ ok: true, domains: [], source: 'product' })
  h.workspaceRefById.mockReset(); h.workspaceRefById.mockResolvedValue({ ok: true, ws: { id: WS, slug: 'acme', name: 'Acme' } })
  h.createServerClient.mockReset(); h.createServerClient.mockResolvedValue(SESSION)
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { errorSpy.mockRestore() })

describe('loadInviteDomainNotice', () => {
  it('비어 있고 워크스페이스 관리자: 워크스페이스 설정의 초대 절로 가는 링크', async () => {
    expect(await loadInviteDomainNotice(WS_ADMIN, WS)).toEqual({ settingsHref: '/w/acme/settings#workspace-invites' })
    expect(h.loadInviteDomains).toHaveBeenCalledWith(SESSION, WS)   // 발급 액션과 같은 로더, 세션으로 읽는다
  })
  it('플랫폼 관리자도 링크를 받는다(그 워크스페이스를 관리할 수 있다)', async () => {
    expect(await loadInviteDomainNotice(makeSuperuser({ workspaceRoles: new Map() }), WS)).toEqual({ settingsHref: '/w/acme/settings#workspace-invites' })
  })
  it('비어 있지만 워크스페이스 관리자가 아니면(프로젝트 관리자) 링크 없이 — 슬러그도 읽지 않는다', async () => {
    expect(await loadInviteDomainNotice(PROJECT_ADMIN, WS)).toEqual({ settingsHref: null })
    expect(h.workspaceRefById).not.toHaveBeenCalled()
  })
  it.each([
    ['명시로 비운 목록', { ok: true, domains: [], source: 'workspace' }],
    ['미설정(제품 기본값)', { ok: true, domains: [], source: 'product' }],
  ])('%s 도 안내한다 — 쓸 도메인이 0개면 발급은 똑같이 거부된다', async (_n, loaded) => {
    h.loadInviteDomains.mockResolvedValue(loaded)
    expect(await loadInviteDomainNotice(WS_ADMIN, WS)).not.toBeNull()
  })
  it.each([
    ['도메인이 있다', { ok: true, domains: ['example.com'], source: 'workspace' }],
    ['전체 허용(*)', { ok: true, domains: ['*'], source: 'workspace' }],
    ['배포 기본값(env)이 있다', { ok: true, domains: ['example.com'], source: 'env' }],
    ['읽지 못했다(손상·조회 실패)', { ok: false }],
  ])('%s → 안내 없음(null)', async (_n, loaded) => {
    h.loadInviteDomains.mockResolvedValue(loaded)
    expect(await loadInviteDomainNotice(WS_ADMIN, WS)).toBeNull()
  })
  it('행위자·워크스페이스를 모르면 읽지도 않는다', async () => {
    expect(await loadInviteDomainNotice(null, WS)).toBeNull()
    expect(await loadInviteDomainNotice(WS_ADMIN, null)).toBeNull()
    expect(h.loadInviteDomains).not.toHaveBeenCalled()
  })
  it('슬러그를 못 읽으면 링크만 빠진다', async () => {
    h.workspaceRefById.mockResolvedValue({ ok: false, kind: 'missing' })
    expect(await loadInviteDomainNotice(WS_ADMIN, WS)).toEqual({ settingsHref: null })
  })
  it('예외는 명단 화면을 막지 않는다 — null + 로그', async () => {
    h.loadInviteDomains.mockRejectedValue(new Error('boom'))
    expect(await loadInviteDomainNotice(WS_ADMIN, WS)).toBeNull()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
