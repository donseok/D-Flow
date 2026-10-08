import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('agent externalApi 게이트', () => {
  const OLD = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...OLD } })

  async function load() { return await import('@/lib/agent/externalApi') }

  it('env 미설정이면 닫힘(fail-closed)', async () => {
    delete process.env.AGENT_API_ENABLED
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(false)
  })
  it("킬스위치는 AGENT_API_ENABLED 하나다 — 'true' 문자열만 참이고, 옛 시크릿(AGENT_API_SECRET) 유무는 열림·닫힘에 관여하지 않는다(SP7 §5.1.4)", async () => {
    for (const secret of [undefined, 's3cret']) {
      if (secret === undefined) delete process.env.AGENT_API_SECRET
      else process.env.AGENT_API_SECRET = secret
      process.env.AGENT_API_ENABLED = 'true'
      expect((await load()).agentApiEnabled()).toBe(true)
      for (const off of ['false', '1', 'TRUE', '']) {
        process.env.AGENT_API_ENABLED = off
        expect((await load()).agentApiEnabled()).toBe(false)
      }
    }
  })
  // (삭제) gateAgentApi 3건('env 미설정 404'·'ENABLED=true 면 SECRET 없어도 401'·'시크릿 불일치 401, 일치 통과') — 시크릿 전용 선두 게이트
  // gateAgentApi 가 삭제됐다(src 에 호출부가 없던 레거시 가드). 404·401 과 "시크릿 일치는 통과가 아니다" 는 리졸버 케이스
  // (tests/agent/resolve-principal.test.ts 의 킬스위치·①)가 본다.
  it('시크릿 전용 가드(gateAgentApi)는 더 이상 export 되지 않는다', async () => {
    expect(Object.keys(await load())).not.toContain('gateAgentApi')
  })
})

// 역할 판정(isAgentProjectMember·isAgentProjectAdmin·agentMemberRole)은 actorFromCredential(buildActor 를 자격증명 범위로 좁힘) + roleIn 이다 —
// tests/agent/external-api-roles.test.ts 가 스냅샷을 주입해 본다. 조립(4축 필터)은 buildActor 테스트 몫이다.
