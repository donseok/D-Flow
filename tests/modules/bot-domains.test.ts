import { describe, expect, it } from 'vitest'
import { BOT_READ_CAPABILITIES } from '@/lib/ai/tools/types'
import { createDefaultChatToolRegistry } from '@/lib/ai/chat/default-registry'
import { moduleOfCapability } from '@/lib/ai/chat/tool-modules'
import { MODULES, moduleDef } from '@/lib/modules/registry'

const NO_TOOL_YET: Record<string, string> = { issues: '봇에 이슈 도구와 issues:read 가 아직 없다' }

describe('봇 도구와 모듈의 대응', () => {
  it('capability 의 도메인은 정확히 한 모듈에 속한다', () => {
    for (const capability of BOT_READ_CAPABILITIES) {
      const moduleId = moduleOfCapability(capability)
      expect((moduleDef(moduleId).botDomains as readonly string[]).includes(capability.split(':')[0]), capability).toBe(true)
    }
  })

  it('기본 레지스트리의 모든 도구는 알려진 capability 를 쓴다', () => {
    const registry = createDefaultChatToolRegistry({ from: () => { throw new Error('I/O 금지') } } as never)
    expect(registry.names().length).toBeGreaterThan(0)
    for (const name of registry.names()) {
      expect(BOT_READ_CAPABILITIES as readonly string[], name).toContain(registry.get(name)!.requiredCapability)
    }
  })

  it('도구가 아직 없는 도메인은 목록에 적힌 것뿐이다', () => {
    const covered = new Set(BOT_READ_CAPABILITIES.map((capability) => capability.split(':')[0]))
    const missing = MODULES.flatMap((module) => module.botDomains).filter((domain) => !covered.has(domain))
    expect(missing.sort()).toEqual(Object.keys(NO_TOOL_YET).sort())
  })
})
