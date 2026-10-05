import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const OLD = { ...process.env }
beforeEach(() => { process.env.AGENT_API_ENABLED = 'true'; vi.clearAllMocks() })
afterEach(() => { process.env = { ...OLD } })

function mockSession(user: { id: string } | null) {
  mocks.createServerClient.mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user }, error: null })) },
  })
}
function mockAdmin(insertResult: { data?: unknown; error?: { message: string } | null }, memberships = [{ workspace_id: '11111111-1111-4111-8111-111111111111' }]) {
  const inserted: unknown[] = []
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'update', 'order', 'is', 'limit']) b[k] = () => b
  b.insert = (row: unknown) => { inserted.push(row); return b }
  b.maybeSingle = async () => ({ data: insertResult.data ?? null, error: insertResult.error ?? null })
  b.then = (r: (v: unknown) => unknown) =>
    Promise.resolve({ data: insertResult.data ?? null, error: insertResult.error ?? null }).then(r)
  mocks.createAdminClient.mockReturnValue({ from: (table: string) => {
    if (table === 'workspace_members') {
      const ws: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'limit']) ws[k] = () => ws
      ws.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: memberships, error: null }).then(r)
      return ws
    }
    return b
  } })
  return inserted
}

describe('createAgentToken', () => {
  it('발급 성공 — 평문은 응답 1회, DB 행에는 hash 만', async () => {
    mockSession({ id: 'u-1' })
    const inserted = mockAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'laptop', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.token).toMatch(/^dflow_pat_/)
    const row = inserted[0] as Record<string, unknown>
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain((r as { token: string }).token)
  })
  it('AGENT_API_ENABLED 미설정이면 발급 거부', async () => {
    delete process.env.AGENT_API_ENABLED
    mockSession({ id: 'u-1' })
    mockAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('work:claim 발급 — 신규 토큰에 work:report 를 얹지 않는다(2026-08-25 스코프 폐지)', async () => {
    mockSession({ id: 'u-1' })
    const inserted = mockAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({
      name: 'x', projectId: null, scopes: ['work:read', 'work:claim'], expiresDays: 90,
    })
    expect(r.ok).toBe(true)
    const row = inserted[0] as Record<string, unknown>
    expect(row.scopes).toEqual(['work:read', 'work:claim'])
  })
  it('폐지된 work:report 는 발급 거부 — 완료 보고 권한은 work:claim 에 흡수됐다', async () => {
    mockSession({ id: 'u-1' })
    mockAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({
      name: 'x', projectId: null, scopes: ['work:read', 'work:claim', 'work:report'], expiresDays: 90,
    })
    expect(r.ok).toBe(false)
  })
  it('알 수 없는 스코프는 거부', async () => {
    mockSession({ id: 'u-1' })
    mockAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read', 'admin:all'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('비로그인 거부', async () => {
    mockSession(null)
    mockAdmin({})
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const r = await createAgentToken({ name: 'x', projectId: null, scopes: ['work:read'], expiresDays: 90 })
    expect(r.ok).toBe(false)
  })
  it('워크스페이스 소속 0개·여러 개이면 임의 발급하지 않는다', async () => {
    mockSession({ id: 'u-1' })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    for (const memberships of [[], [{ workspace_id: 'ws-a' }, { workspace_id: 'ws-b' }]]) {
      const inserted = mockAdmin({ data: [{ id: 'r-1' }] }, memberships)
      expect((await createAgentToken({ name: 'x', projectIds: null, scopes: ['work:read'], expiresDays: 30 })).ok).toBe(false)
      expect(inserted).toEqual([])
    }
  })
  it('빈 프로젝트 범위와 소수 만료일은 발급 전에 거절한다', async () => {
    mockSession({ id: 'u-1' })
    const inserted = mockAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    for (const overrides of [{ projectIds: [] }, { expiresDays: 1.5 }]) {
      expect((await createAgentToken({ name: 'x', projectIds: null, scopes: ['work:read'], expiresDays: 30, ...overrides })).ok).toBe(false)
    }
    expect(inserted).toEqual([])
  })
  it('선택한 프로젝트 범위와 스코프의 중복을 제거해 저장한다', async () => {
    mockSession({ id: 'u-1' })
    const inserted = mockAdmin({ data: [{ id: 'r-1' }] })
    const { createAgentToken } = await import('@/app/actions/agentTokens')
    const p = '22222222-2222-4222-8222-222222222222'
    expect((await createAgentToken({ name: 'x', projectIds: [p, p], scopes: ['work:read', 'work:read'], expiresDays: 30 })).ok).toBe(true)
    expect(inserted[0]).toMatchObject({ kind: 'agent_runner', workspace_id: '11111111-1111-4111-8111-111111111111', project_ids: [p], default_project_id: p, scopes: ['work:read'] })
  })

})
