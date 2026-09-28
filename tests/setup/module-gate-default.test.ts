// 전역 기본 mock(D10) — 이 파일은 자기 mock 이 없다. 셋업이 관문을 통과시키고, reset 뒤에도 통과로 돌아가며, mockResolvedValueOnce 로 거부를 줄 수 있다.
import { describe, expect, it, vi } from 'vitest'
import { hasLLM } from '@/lib/ai/provider'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

/** 셋업이 거는 기본값 — 첫 케이스와 reset 복귀 케이스가 같은 기대값을 본다. aiAvailable 은 (이 파일에서는 mock 되지 않은) hasLLM() 을 따른다 */
async function expectDefaults() {
  expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: true })
  expect(await requireSessionModule(null, 'minutes')).toEqual({ ok: true })
  expect(await moduleState({ projectId: 'p' }, 'chatbot')).toBe('on')
  expect(await projectsWithModule(['a', 'b', 'a'], 'agents')).toEqual(['a', 'b'])
  expect(await workspacesWithModule(['w', 'w'], 'minutes_integration')).toEqual(['w'])
  expect(await aiAvailable({ projectId: 'p' }, { module: 'weekly' })).toBe(hasLLM())
}

describe('tests/setup/module-gate.ts', () => {
  it('다섯 함수가 mock 이고 기본은 통과다', async () => {
    for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule, aiAvailable]) expect(vi.isMockFunction(f)).toBe(true)
    await expectDefaults()
  })
  it('vi.resetAllMocks() 뒤에도 셋업의 모든 함수가 기본 구현으로 돌아간다(과제 8 의 aiAvailable 포함)', async () => {
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: 'x' })
    vi.mocked(requireSessionModule).mockResolvedValue({ ok: false, error: 'x' })
    vi.mocked(moduleState).mockResolvedValue('off')
    vi.mocked(projectsWithModule).mockResolvedValue([])
    vi.mocked(workspacesWithModule).mockResolvedValue([])
    vi.mocked(aiAvailable).mockRejectedValue(new Error('polluted'))
    vi.resetAllMocks()
    await expectDefaults()
  })
  it('mockResolvedValueOnce 로 한 번만 거부를 준다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: 'off' })
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: false, error: 'off' })
    expect(await requireModule({ projectId: 'p' }, 'issues')).toEqual({ ok: true })
  })
})
