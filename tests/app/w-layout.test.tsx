import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getActorViewState: vi.fn(), createServerClient: vi.fn(), getWorkspaceConfig: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.getWorkspaceConfig }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))

import WorkspaceLayout, { generateMetadata } from '@/app/(app)/w/[slug]/layout'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'
import { WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WID = '00000000-0000-4000-8000-00000000bb01'
const access = (slug = 'alpha') => workspacePageAccess(slug)
const config = (values: Record<string, unknown>) => ({
  workspaceId: WID, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [],
  keys: resolveKeys({ scope: 'workspace', id: WID, values, defs: WORKSPACE_SETTINGS, env: { NODE_ENV: 'test' } }).keys,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'admin']]) }), degraded: false })
  h.createServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: WID, slug: 'alpha', name: 'Alpha' }, error: null }) }) }) }) })
  h.getWorkspaceConfig.mockResolvedValue(config({ 'branding.product_name': 'Acme' }))
})

describe('/w/[slug] 레이아웃', () => {
  it('소속 관리자는 열고 제품명 메타데이터를 쓴다', async () => {
    await expect(WorkspaceLayout({ children: 'content', params: Promise.resolve({ slug: 'alpha' }) })).resolves.toBe('content')
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'alpha' }) })).toEqual({ title: 'Alpha 설정 | Acme' })
  })

  it('마크가 저장돼 있으면 아이콘을 읽기 라우트로 내고, 없으면 루트 아이콘을 덮지 않는다', async () => {
    const mark = `ws/${WID}/branding/mark-0123456789abcdef.png`
    h.getWorkspaceConfig.mockResolvedValue(config({ 'branding.product_name': 'Acme', 'branding.logo': { full: null, full_dark: null, mark } }))
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'alpha' }) })).toEqual({ title: 'Alpha 설정 | Acme', icons: { icon: `/api/brand/${WID}/mark` } })
    h.getWorkspaceConfig.mockResolvedValue(config({ 'branding.product_name': 'Acme' }))
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'alpha' }) })).not.toHaveProperty('icons')
  })

  it('설정 조회가 실패해도 제목은 기본 제품명으로 나오고 로그를 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getWorkspaceConfig.mockRejectedValue(new Error('db down'))
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'alpha' }) })).toEqual({ title: 'Alpha 설정 | D-Flow' })
    expect(error).toHaveBeenCalledWith('[workspace settings] 브랜딩 판독 실패:', expect.any(Error))
    error.mockRestore()
  })

  it('플랫폼 관리자는 해당 워크스페이스 명단 없이도 통과한다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map() }), degraded: false })
    expect((await access('beta')).isAdmin).toBe(true)
  })

  it('다른 워크스페이스·미존재 슬러그는 404', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map() }), degraded: false })
    await expect(access('foreign')).rejects.toThrow('NEXT_NOT_FOUND')
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'admin']]) }), degraded: false })
    h.createServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) })
    await expect(access('missing')).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('권한·DB 조회 실패는 404 로 숨기지 않는다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    await expect(access('degraded')).rejects.toThrow('권한을 확인하지 못했습니다')
    expect(h.notFound).not.toHaveBeenCalled()
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'admin']]) }), degraded: false })
    h.createServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'db down' } }) }) }) }) })
    await expect(access('db-error')).rejects.toThrow('조회하지 못했습니다')
  })
})
