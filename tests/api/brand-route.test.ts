import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const h = vi.hoisted(() => ({ actor: vi.fn(), client: vi.fn(), config: vi.fn(), download: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: h.actor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.client }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.config }))
import { GET } from '@/app/api/brand/[workspaceId]/[slot]/route'

const WID = '00000000-0000-4000-8000-00000000bb01'
const PATH = `ws/${WID}/branding/mark-0123456789abcdef.png`
const call = (workspaceId = WID, slot = 'mark') => GET(new Request('http://local/api/brand'), { params: Promise.resolve({ workspaceId, slot }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.actor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WID, 'member']]) }))
  h.download.mockResolvedValue({ data: new Blob([Uint8Array.from([137, 80, 78, 71])]), error: null })
  h.client.mockResolvedValue({ storage: { from: () => ({ download: h.download }) } })
  h.config.mockResolvedValue({ keys: { 'branding.logo': { status: 'set', value: { full: null, full_dark: null, mark: PATH } } } })
})

describe('GET /api/brand/[workspaceId]/[slot]', () => {
  it('소속 멤버에게 현재 슬롯만 이미지로 전달하고 스니핑을 막는다', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'")
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(h.download).toHaveBeenCalledWith(PATH)
  })
  it('비소속·잘못된 슬롯은 설정이나 스토리지를 읽지 않고 404', async () => {
    h.actor.mockResolvedValue(makeActor())
    expect((await call()).status).toBe(404)
    expect(h.config).not.toHaveBeenCalled()
    expect((await call(WID, 'other')).status).toBe(404)
  })
  it('플랫폼 관리자는 통과하지만 경로가 다른 워크스페이스를 가리키면 404', async () => {
    h.actor.mockResolvedValue(makeSuperuser())
    h.config.mockResolvedValue({ keys: { 'branding.logo': { status: 'set', value: { full: null, full_dark: null, mark: PATH.replace(WID, '00000000-0000-4000-8000-00000000bb02') } } } })
    expect((await call()).status).toBe(404)
    expect(h.download).not.toHaveBeenCalled()
  })
  it('권한 조회 장애는 404로 위장하지 않는다', async () => {
    h.actor.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await call()).status).toBe(503)
  })
})
