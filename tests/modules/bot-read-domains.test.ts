// 봇이 직접 다루는 읽기 도메인(라우터 V2_READ_DOMAINS)은 모듈 레지스트리의 botDomains 에서 파생한다(개정 §4.8 '도메인').
// 파생이 조용히 넓어지거나 좁아지지 않게 세 원천(레지스트리·읽기 capability·플래너 도구 카탈로그)의 일치를 고정한다.
import { describe, expect, it } from 'vitest'
import { V2_READ_DOMAINS } from '@/lib/ai/chat/router'
import { PLANNER_TOOL_CATALOG } from '@/lib/ai/chat/planner'
import { BOT_READ_CAPABILITIES } from '@/lib/ai/tools/types'
import { MODULES } from '@/lib/modules/registry'

const moduleDomains = MODULES.flatMap((m) => [...m.botDomains])
const toolDomains = BOT_READ_CAPABILITIES.map((c) => c.split(':')[0])

describe('봇 읽기 도메인 — 레지스트리 파생', () => {
  it('읽기 도메인 = 모듈의 botDomains ∩ 읽기 도구가 있는 도메인 (중복 없음)', () => {
    expect(new Set(V2_READ_DOMAINS).size).toBe(V2_READ_DOMAINS.length)
    expect([...V2_READ_DOMAINS].sort()).toEqual(moduleDomains.filter((d) => toolDomains.includes(d)).sort())
  })

  it('지금 값은 열한 도메인이다 — 모듈·도구를 더하거나 빼면 이 목록이 함께 바뀐다', () => {
    expect([...V2_READ_DOMAINS].sort()).toEqual([
      'announcements', 'attendance', 'dashboard', 'kanban', 'meetings', 'members', 'minutes', 'settings', 'wbs', 'weekly', 'wiki',
    ])
  })

  it('읽기 도구의 도메인은 전부 어떤 모듈의 것이다 — 모듈 없는 도구는 관문(gateChatTools)이 판정할 수 없다', () => {
    expect(toolDomains.filter((d) => !(moduleDomains as string[]).includes(d))).toEqual([])
  })

  it('도구가 없는 모듈 도메인(issues)은 읽기 도메인에 들지 않는다', () => {
    expect(moduleDomains).toContain('issues')
    expect(V2_READ_DOMAINS).not.toContain('issues')
  })

  it('플래너 도구 카탈로그의 도메인은 전부 읽기 도메인이고, 읽기 도메인마다 도구가 하나 이상 있다', () => {
    const planned = new Set(Object.values(PLANNER_TOOL_CATALOG).map((spec) => spec.domain))
    expect([...planned].sort()).toEqual([...V2_READ_DOMAINS].sort())
  })
})
