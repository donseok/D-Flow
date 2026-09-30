import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ getSession: vi.fn(), getProjectConfig: vi.fn(), loadDisplayBranding: vi.fn(), build: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/settings/displayBranding', () => ({ loadDisplayBranding: h.loadDisplayBranding }))
vi.mock('@/lib/excel/template', () => ({ buildWbsTemplateWorkbook: h.build }))

import { GET } from '@/app/api/import/template/route'

const PID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const call = (qs = '') => GET(new Request(`http://localhost/api/import/template${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  h.getSession.mockResolvedValue({ user: { id: 'u1' } })
  h.getProjectConfig.mockResolvedValue({ workspaceId: 'ws-1' })
  h.loadDisplayBranding.mockResolvedValue({ productName: 'Acme', mailFromName: 'Acme' })
  h.build.mockReturnValue(new Uint8Array([1]))
})

describe('GET /api/import/template', () => {
  it('세션이 없으면 401 이고 아무것도 조회하지 않는다', async () => {
    h.getSession.mockResolvedValue(null)
    expect((await call(`?projectId=${PID}`)).status).toBe(401)
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })
  it('uuid 프로젝트는 워크스페이스 제품명으로 양식을 만든다', async () => {
    expect((await call(`?projectId=${PID}`)).status).toBe(200)
    expect(h.build).toHaveBeenCalledWith('Acme')
  })
  it('uuid 가 아닌 projectId 는 설정 조회에 닿지 않고 기본 양식을 낸다', async () => {
    expect((await call('?projectId=not-a-uuid')).status).toBe(200)
    expect(h.getProjectConfig).not.toHaveBeenCalled()
    expect(h.build).toHaveBeenCalledWith(undefined)
  })
  it('설정 조회가 실패해도 기본 양식을 내고 로그를 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getProjectConfig.mockRejectedValue(new Error('db down'))
    expect((await call(`?projectId=${PID}`)).status).toBe(200)
    expect(h.build).toHaveBeenCalledWith(undefined)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})
