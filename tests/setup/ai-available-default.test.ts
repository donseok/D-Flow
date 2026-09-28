// 전역 기본 mock — aiAvailable 은 (mock 된) hasLLM() 을 그대로 돌려준다. 호출부 테스트 8파일이 hasLLM 만 mock 해도 그대로 돈다.
import { describe, expect, it, vi } from 'vitest'
const llm = vi.hoisted(() => ({ hasLLM: vi.fn(() => true) }))
vi.mock('@/lib/ai/provider', () => ({ hasLLM: llm.hasLLM }))
import { aiAvailable } from '@/lib/modules/aiAvailable'

describe('tests/setup/module-gate.ts — aiAvailable', () => {
  it('mock 이고 hasLLM 을 따른다', async () => {
    expect(vi.isMockFunction(aiAvailable)).toBe(true)
    expect(await aiAvailable({ projectId: 'p' }, { module: 'weekly' })).toBe(true)
    llm.hasLLM.mockReturnValue(false)
    expect(await aiAvailable({ projectId: 'p' }, { module: 'weekly' })).toBe(false)
  })
})
