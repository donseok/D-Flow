// requireModulePage(스펙 §4.2 1·2행, D11) — 꺼지면 notFound(). scope null 은 세션 유일 워크스페이스(requireSessionModule).
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ requireModule: vi.fn(), requireSessionModule: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }) }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: m.requireModule, requireSessionModule: m.requireSessionModule }))
vi.mock('next/navigation', () => ({ notFound: m.notFound }))
import { requireModulePage } from '@/lib/modules/pageGate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

beforeEach(() => { vi.clearAllMocks(); m.requireModule.mockResolvedValue({ ok: true }); m.requireSessionModule.mockResolvedValue({ ok: true }) })
describe('requireModulePage', () => {
  it('켜지면 아무 일도 하지 않는다', async () => {
    await expect(requireModulePage({ projectId: 'p' }, 'issues')).resolves.toBeUndefined()
    expect(m.requireModule).toHaveBeenCalledWith({ projectId: 'p' }, 'issues')
  })
  it('꺼지면 notFound()', async () => {
    m.requireModule.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(requireModulePage({ projectId: 'p' }, 'issues')).rejects.toThrow('NEXT_NOT_FOUND')
  })
  it('scope null 은 세션 유일 워크스페이스 판정', async () => {
    m.requireSessionModule.mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(requireModulePage(null, 'meetings')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(m.requireSessionModule).toHaveBeenCalledWith(null, 'meetings')
    expect(m.requireModule).not.toHaveBeenCalled()
  })
})
