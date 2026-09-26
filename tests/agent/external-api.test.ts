import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('agent externalApi 게이트', () => {
  const OLD = { ...process.env }
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { process.env = { ...OLD } })

  async function load() { return await import('@/lib/agent/externalApi') }
  function req(auth?: string) {
    return new Request('http://localhost/api/v1/agent/work', {
      headers: auth ? { Authorization: auth } : {},
    })
  }

  it('env 미설정이면 닫힘(fail-closed) — 404', async () => {
    delete process.env.AGENT_API_ENABLED
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(false)
    const res = m.gateAgentApi(req('Bearer x'))
    expect(res?.status).toBe(404)
  })
  it('ENABLED=true 면 SECRET 없어도 API 는 열림 — 레거시 분기만 닫힘(계약 v2.0)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    delete process.env.AGENT_API_SECRET
    const m = await load()
    expect(m.agentApiEnabled()).toBe(true)
    expect(m.gateAgentApi(req('Bearer anything'))?.status).toBe(401)
  })
  it('시크릿 불일치 401, 일치 통과(null)', async () => {
    process.env.AGENT_API_ENABLED = 'true'
    process.env.AGENT_API_SECRET = 's3cret'
    const m = await load()
    expect(m.gateAgentApi(req('Bearer wrong'))?.status).toBe(401)
    expect(m.gateAgentApi(req())?.status).toBe(401)
    expect(m.gateAgentApi(req('Bearer s3cret'))).toBeNull()
  })
})

// 역할 판정(isAgentProjectMember·isAgentProjectAdmin·agentMemberRole)은 SP2 결정 8 로 actorFromUser(buildActor) + roleIn 이 됐다 —
// tests/agent/external-api-roles.test.ts 가 스냅샷을 주입해 본다. 조립(4축 필터)은 buildActor 테스트 몫이다.
