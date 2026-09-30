import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getActorViewState: vi.fn(), createServerClient: vi.fn(), getWorkspaceConfig: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.getWorkspaceConfig }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))

import WorkspaceLayout, { generateMetadata } from '@/app/(app)/w/[slug]/layout'
import { workspacePageAccess } from '@/lib/settings/workspacePageAccess'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WID = '00000000-0000-4000-8000-00000000bb01'
const access = (slug = 'alpha') => workspacePageAccess(slug)

beforeEach(() => {
  vi.clearAllMocks()
  h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WID, 'admin']]) }), degraded: false })
  h.createServerClient.mockResolvedValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: WID, slug: 'alpha', name: 'Alpha' }, error: null }) }) }) }) })
  h.getWorkspaceConfig.mockResolvedValue({ keys: { 'branding.product_name': { status: 'set', value: 'Acme' } } })
})

describe('/w/[slug] 레이아웃', () => {
  it('소속 관리자는 열고 제품명 메타데이터를 쓴다', async () => {
    await expect(WorkspaceLayout({ children: 'content', params: Promise.resolve({ slug: 'alpha' }) })).resolves.toBe('content')
    expect(await generateMetadata({ params: Promise.resolve({ slug: 'alpha' }) })).toEqual({ title: 'Alpha 설정 | Acme' })
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
