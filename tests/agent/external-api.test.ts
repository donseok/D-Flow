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

/**
 * 판정부 스텁 — 표마다 응답 하나, 체인 호출(select·eq·limit)을 기록해 필터를 단언한다.
 * 폐기 표(memberships·project_roles)를 읽으면 기록에 남아 테스트가 잡는다.
 */
type Resp = { data?: unknown; error?: { message: string } | null }
function admin(tables: Record<string, Resp>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = []
  return {
    calls,
    tablesRead: () => calls.map(c => c.table),
    opsOf: (table: string) => calls.find(c => c.table === table)?.ops ?? [],
    from: (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> }
      calls.push(rec)
      const r = tables[table] ?? { data: null, error: null }
      const out = { data: r.data ?? null, error: r.error ?? null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit']) b[k] = (...a: unknown[]) => { rec.ops.push([k, a]); return b }
      b.maybeSingle = async () => out
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(out).then(res)
      return b
    },
  }
}
const PLATFORM = (uid: string): Resp => ({ data: { user_id: uid } })
const ROSTER = (access_role: 'admin' | 'member' | null): Resp => ({ data: [{ access_role, people: { user_id: 'u', active: true } }] })
const NO_ROW: Resp = { data: [] }

describe('isAgentProjectMember — 새 축(platform_admins · 활성 명단 행) · fail-closed', () => {
  it('플랫폼 관리자는 명단 없이 통과', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const a = admin({ platform_admins: PLATFORM('u'), project_members: NO_ROW })
    expect(await isAgentProjectMember(a as never, 'u', 'p')).toBe(true)
  })
  it('남의 행·빈 객체는 플랫폼 관리자가 아니다(응답 모양이 아니라 내용으로 판정)', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin({ platform_admins: PLATFORM('other'), project_members: NO_ROW }) as never, 'u', 'p')).toBe(false)
    expect(await isAgentProjectMember(admin({ platform_admins: { data: {} }, project_members: NO_ROW }) as never, 'u', 'p')).toBe(false)
  })
  it('명단 권한 admin·member 는 통과, 권한 없는 명단 행(조회 전용)·행 없음은 거절', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectMember(admin({ project_members: ROSTER('member') }) as never, 'u', 'p')).toBe(true)
    expect(await isAgentProjectMember(admin({ project_members: ROSTER('admin') }) as never, 'u', 'p')).toBe(true)
    expect(await isAgentProjectMember(admin({ project_members: ROSTER(null) }) as never, 'u', 'p')).toBe(false)
    expect(await isAgentProjectMember(admin({ project_members: NO_ROW }) as never, 'u', 'p')).toBe(false)
  })
  it('명단 조회는 활성 행·활성 인물·people.user_id 로 거른다(!inner 조인) — 폐기 표는 읽지 않는다', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const a = admin({ project_members: ROSTER('member') })
    await isAgentProjectMember(a as never, 'u', 'p')
    expect(a.tablesRead()).toEqual(['platform_admins', 'project_members'])
    const ops = a.opsOf('project_members')
    expect(String(ops.find(([k]) => k === 'select')?.[1][0])).toContain('people!inner(user_id, active)')
    expect(ops).toEqual(expect.arrayContaining([
      ['eq', ['project_id', 'p']], ['eq', ['active', true]],
      ['eq', ['people.user_id', 'u']], ['eq', ['people.active', true]],
    ]))
    expect(a.opsOf('platform_admins')).toEqual(expect.arrayContaining([['eq', ['user_id', 'u']]]))
  })
  it('워크스페이스 관리자 승계는 하지 않는다(SP7 actorFromCredential 로 통합) — workspace_members 를 읽지 않는다', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const a = admin({ workspace_members: { data: [{ workspace_id: 'w', role: 'admin' }] }, project_members: NO_ROW })
    expect(await isAgentProjectMember(a as never, 'u', 'p')).toBe(false)
    expect(a.tablesRead()).not.toContain('workspace_members')
  })
  it('조회 실패는 거절(fail-closed)', async () => {
    const { isAgentProjectMember } = await import('@/lib/agent/externalApi')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await isAgentProjectMember(admin({ platform_admins: { error: { message: 'db down' } }, project_members: ROSTER('member') }) as never, 'u', 'p')).toBe(false)
    expect(await isAgentProjectMember(admin({ project_members: { error: { message: 'db down' } } }) as never, 'u', 'p')).toBe(false)
    err.mockRestore()
  })
})

describe('isAgentProjectAdmin — 관리자 이상, 조회 실패는 throw', () => {
  it('명단 admin·플랫폼 관리자 통과, member·조회 전용·행 없음은 false', async () => {
    const { isAgentProjectAdmin } = await import('@/lib/agent/externalApi')
    expect(await isAgentProjectAdmin(admin({ project_members: ROSTER('admin') }) as never, 'u', 'p')).toBe(true)
    expect(await isAgentProjectAdmin(admin({ platform_admins: PLATFORM('u'), project_members: NO_ROW }) as never, 'u', 'p')).toBe(true)
    expect(await isAgentProjectAdmin(admin({ project_members: ROSTER('member') }) as never, 'u', 'p')).toBe(false)
    expect(await isAgentProjectAdmin(admin({ project_members: ROSTER(null) }) as never, 'u', 'p')).toBe(false)
    expect(await isAgentProjectAdmin(admin({ project_members: NO_ROW }) as never, 'u', 'p')).toBe(false)
  })
  it('어느 축이든 조회 실패는 throw — 403 으로 둔갑시키지 않는다', async () => {
    const { isAgentProjectAdmin } = await import('@/lib/agent/externalApi')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(isAgentProjectAdmin(admin({ platform_admins: { error: { message: 'down' } } }) as never, 'u', 'p')).rejects.toThrow()
    await expect(isAgentProjectAdmin(admin({ project_members: { error: { message: 'down' } } }) as never, 'u', 'p')).rejects.toThrow()
    err.mockRestore()
  })
})

describe('agentMemberRole — superuser|admin|member|null', () => {
  it('플랫폼 관리자 → superuser, 명단 권한 그대로, 권한 없는 행·행 없음 → null', async () => {
    const { agentMemberRole } = await import('@/lib/agent/externalApi')
    expect(await agentMemberRole(admin({ platform_admins: PLATFORM('u') }) as never, 'u', 'p')).toBe('superuser')
    expect(await agentMemberRole(admin({ project_members: ROSTER('admin') }) as never, 'u', 'p')).toBe('admin')
    expect(await agentMemberRole(admin({ project_members: ROSTER('member') }) as never, 'u', 'p')).toBe('member')
    expect(await agentMemberRole(admin({ project_members: ROSTER(null) }) as never, 'u', 'p')).toBeNull()
    expect(await agentMemberRole(admin({ project_members: NO_ROW }) as never, 'u', 'p')).toBeNull()
  })
  it('조회 실패는 null(fail-closed)', async () => {
    const { agentMemberRole } = await import('@/lib/agent/externalApi')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await agentMemberRole(admin({ platform_admins: { error: { message: 'down' } } }) as never, 'u', 'p')).toBeNull()
    expect(await agentMemberRole(admin({ project_members: { error: { message: 'down' } } }) as never, 'u', 'p')).toBeNull()
    err.mockRestore()
  })
})
