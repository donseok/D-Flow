// 저장 규칙 세 갈래(개정 §2.7.3)와 modules.enabled 검사(개정 §2.7.2) — validateConfig·createProject 복사가 같은 함수를 쓴다.
import { describe, expect, it } from 'vitest'
import { checkEnabledModules, intersectEnabledWithAllowed, moduleKeyRule } from '@/lib/modules/saveRule'

const allowed = new Set(['kanban', 'meetings', 'minutes', 'wiki'] as const)

describe('moduleKeyRule', () => {
  it('core 는 always, 허용됐는데 프로젝트에서 꺼진 것은 prepared, 허용 밖은 not_allowed', () => {
    expect(moduleKeyRule({ module: 'settings', allowed, enabled: new Set() })).toBe('always')
    expect(moduleKeyRule({ module: 'wbs', allowed: new Set(), enabled: null })).toBe('always')
    expect(moduleKeyRule({ module: 'kanban', allowed, enabled: new Set(['kanban'] as const) })).toBe('always')
    expect(moduleKeyRule({ module: 'kanban', allowed, enabled: new Set() })).toBe('prepared')
    expect(moduleKeyRule({ module: 'minutes', allowed, enabled: null })).toBe('always')       // 워크스페이스 층 — enabled 없음
    expect(moduleKeyRule({ module: 'issues', allowed, enabled: new Set(['issues'] as const) })).toBe('not_allowed')
    expect(moduleKeyRule({ module: 'portfolio', allowed, enabled: null })).toBe('not_allowed')
  })
})

describe('checkEnabledModules', () => {
  const A = ['kanban', 'meetings', 'agents', 'wiki']
  it('PROJECT_TOGGLABLE 밖 원소 거부, 중복 거부', () => {
    expect(checkEnabledModules({ next: ['minutes'] as never, prev: [], allowed: A as never }).ok).toBe(false)
    expect(checkEnabledModules({ next: ['wbs'] as never, prev: [], allowed: A as never }).ok).toBe(false)
    expect(checkEnabledModules({ next: ['kanban', 'kanban'], prev: [], allowed: A as never }).ok).toBe(false)
  })
  it('새로 추가된 id 만 allowed 에 있어야 한다 — 이미 저장된 잔여는 통과', () => {
    expect(checkEnabledModules({ next: ['kanban', 'issues'], prev: ['issues'], allowed: A as never })).toEqual({ ok: true, value: ['kanban', 'issues'] })
    const r = checkEnabledModules({ next: ['kanban', 'issues'], prev: [], allowed: A as never })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/issues/)
    expect(checkEnabledModules({ next: ['issues'], prev: null, allowed: A as never }).ok).toBe(false)   // prev null = 생성(전부 새 id)
  })
  it('requires 닫힘 — enabled ∩ allowed 안에서 본다. core 가 먼저 합쳐져 kanban→wbs 는 늘 충족', () => {
    expect(checkEnabledModules({ next: ['kanban'], prev: [], allowed: A as never })).toEqual({ ok: true, value: ['kanban'] })
    const r = checkEnabledModules({ next: ['wiki'], prev: [], allowed: ['wiki'] as never })       // minutes 가 allowed 에 없다
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/wiki.*minutes/)
    expect(checkEnabledModules({ next: ['wiki'], prev: [], allowed: ['wiki', 'minutes'] as never })).toEqual({ ok: true, value: ['wiki'] })
    // 허용 밖 잔여(issues)는 교집합에서 빠지므로 닫힘 검사에 끼지 않는다
    expect(checkEnabledModules({ next: ['issues', 'kanban'], prev: ['issues'], allowed: ['kanban'] as never }).ok).toBe(true)
  })
  it('intersectEnabledWithAllowed 는 순서를 지키고 allowed 밖을 뺀다(복사 경로)', () => {
    expect(intersectEnabledWithAllowed(['wiki', 'kanban', 'issues'] as never, ['kanban', 'wiki'] as never)).toEqual(['wiki', 'kanban'])
  })
})
