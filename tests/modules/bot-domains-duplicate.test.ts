// `moduleOfCapability` 의 throw 는 **도메인이 0개일 때와 2개일 때** 두 경우를 함께 본다.
// bot-domains.test.ts 는 실제 레지스트리(정확히 한 모듈) 아래서 "throw 에 도달하지 않는다" 의 전제만 고정하므로,
// 2모듈 상황은 여기서 레지스트리를 겹쳐 만든다. 한 모듈이 두 개로 늘면 `matches.length !== 1` 이 조용히 첫 모듈을
// 돌려주고, 그 프로젝트의 도구가 **엉뚱한 모듈의 게이트**로 판정된다 — 도구 필터 전체가 그 모듈 기준으로 움직인다.
import { describe, expect, it, vi } from 'vitest'
import { moduleOfCapability } from '@/lib/ai/chat/tool-modules'
import { MODULES, type ModuleDef } from '@/lib/modules/registry'

vi.mock('@/lib/modules/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/modules/registry')>()
  const twin = { ...actual.MODULES.find((m) => m.id === 'weekly')!, id: 'weekly_twin' } as unknown as ModuleDef
  return { ...actual, MODULES: [...actual.MODULES, twin] }
})

describe('moduleOfCapability — 매핑이 깨졌을 때', () => {
  it('도메인이 0개면 throw 한다', () => {
    expect(() => moduleOfCapability('nope:read' as never)).toThrow(/모듈이/)
  })

  it('도메인이 2개면 throw 한다 — 조용히 첫 모듈을 돌려주지 않는다', () => {
    expect(MODULES.filter((m) => m.botDomains.includes('weekly'))).toHaveLength(2)
    expect(() => moduleOfCapability('weekly:read')).toThrow(/모듈이/)
  })
})
