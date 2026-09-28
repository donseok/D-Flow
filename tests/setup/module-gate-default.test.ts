// 전역 기본 mock(D10) — 이 파일은 자기 mock 이 없다. 셋업이 관문을 통과시키고, reset 뒤에도 통과로 돌아가며, mockResolvedValueOnce 로 거부를 줄 수 있다.
import { describe, expect, it, vi } from 'vitest'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

describe('tests/setup/module-gate.ts', () => {
  it('다섯 함수가 mock 이고 기본은 통과다', async () => {
    for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) expect(vi.isMockFunction(f)).toBe(true)
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: true })
    expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: true })
    expect(await moduleState({ projectId: 'p' }, 'chatbot')).toBe('on')
    expect(await projectsWithModule(['a', 'b', 'a'], 'agents')).toEqual(['a', 'b'])
    expect(await workspacesWithModule(['w'], 'minutes_integration')).toEqual(['w'])
  })
  it('vi.resetAllMocks() 뒤에도 기본 구현으로 돌아간다', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: 'x' })
    vi.resetAllMocks()
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: true })
  })
  it('mockResolvedValueOnce 로 한 번만 거부를 준다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: 'off' })
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: false, error: 'off' })
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: true })
  })
})
