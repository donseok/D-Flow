import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { generateCredentialToken } from '@/lib/agent/token'
import { requireModule } from '@/lib/modules/gate'
import type { Actor } from '@/lib/domain/authz'

const h = vi.hoisted(() => ({ admin: vi.fn(), actor: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.admin }))
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: h.actor }))
import { resolveAgentPrincipal } from '@/lib/agent/externalApi'
import { GET as workGET } from '@/app/api/v1/agent/work/route'
import { POST as watchPOST } from '@/app/api/v1/agent/watch/route'
import { accessibleProjectIds } from '@/lib/agent/mineShared'

const W1 = '10000000-0000-4000-8000-000000000001'
const W2 = '10000000-0000-4000-8000-000000000002'
const P1 = '20000000-0000-4000-8000-000000000001'
const P2 = '20000000-0000-4000-8000-000000000002'
const P3 = '20000000-0000-4000-8000-000000000003'
const U = '30000000-0000-4000-8000-000000000001'
const ID = '40000000-0000-4000-8000-000000000001'
const token = generateCredentialToken('agent_runner')
const base = {
  id: ID, workspace_id: W1, kind: 'agent_runner', name: 'scoped', token_prefix: token.prefix, token_hash: token.hash,
  scopes: ['work:read', 'work:claim'], project_ids: [P1, P3], default_project_id: null, default_team_id: null,
  team_map: {}, owner_user_id: U, enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z', workspaces: { archived_at: null },
}
const actor: Actor = {
  userId: U, isSuperuser: true, workspaceRoles: new Map([[W1, 'member'], [W2, 'admin']]),
  projectWorkspace: new Map([[P1, W1], [P2, W2], [P3, W1]]),
  projectRoles: new Map([[P1, 'member'], [P2, 'admin'], [P3, 'member']]), memberIds: new Map(), rosterTeams: new Map(),
}

function mockAdmin(row: unknown = base, options: { error?: unknown; resume?: unknown[] } = {}) {
  const calls: Array<{ table: string; op: string; args: unknown[] }> = []
  const from = vi.fn((table: string) => {
    let updating = false
    const b: Record<string, unknown> = {}
    for (const op of ['select', 'eq', 'in', 'not', 'order', 'range', 'limit', 'delete', 'lt', 'upsert', 'update']) {
      b[op] = (...args: unknown[]) => { calls.push({ table, op, args }); if (op === 'update') updating = true; return b }
    }
    const result = () => ({
      data: updating ? null : table === 'integration_credentials' ? row : table === 'agent_runners' ? { enabled: true } : table === 'agent_work_orders' ? options.resume ?? [] : [],
      error: table === 'integration_credentials' ? options.error ?? null : null,
      count: 0,
    })
    b.maybeSingle = async () => result()
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return b
  })
  const admin = { from, auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: U, email: 'dev@example.com' } }, error: null })) } } }
  h.admin.mockReturnValue(admin)
  return { admin, from, calls }
}
const get = (project: string) => new NextRequest(`http://localhost/api/v1/agent/work?project_id=${project}`, { headers: { authorization: `Bearer ${token.token}` } })
const watch = (body: unknown) => new NextRequest('http://localhost/api/v1/agent/watch', { method: 'POST', headers: { authorization: `Bearer ${token.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.stubEnv('AGENT_API_ENABLED', 'true')
  vi.stubEnv('AGENT_API_SECRET', 'legacy-secret') // 설정돼 있어도 인증에 쓰이지 않는다(SP7 §5.1.4)
  h.actor.mockReset().mockResolvedValue(actor)
  vi.mocked(requireModule).mockReset().mockResolvedValue({ ok: true })
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('existing agent API with SP7 scoped credentials', () => {
  it('새 자격증명은 실제 작업 목록 라우트에서 동작하며 옛 저장소를 읽지 않는다', async () => {
    const mock = mockAdmin()
    const result = await workGET(get(P1))
    expect(result.status).toBe(200)
    expect(mock.from).not.toHaveBeenCalledWith('agent_runners')
    expect(mock.from).not.toHaveBeenCalledWith('agent_projects')
    expect(h.actor).toHaveBeenCalledWith(mock.admin, U)
  })

  it('같은 계정/플랫폼 관리자라도 타 WS 또는 토큰 범위 밖 프로젝트는 404', async () => {
    for (const [row, project] of [[base, P2], [{ ...base, project_ids: [P3] }, P1]] as const) {
      const mock = mockAdmin(row)
      expect((await workGET(get(project))).status).toBe(404)
      expect(mock.from).not.toHaveBeenCalledWith('agent_work_orders')
    }
    mockAdmin({ ...base, project_ids: null })
    expect((await workGET(get(P2))).status).toBe(404) // null은 이 WS의 전체이지 플랫폼 전체가 아니다.
  })

  it('현재 소속/명단 회수와 모듈 비활성화도 같은 API에서 거절한다', async () => {
    mockAdmin()
    h.actor.mockResolvedValue({ ...actor, workspaceRoles: new Map([[W2, 'admin']]) })
    expect((await workGET(get(P1))).status).toBe(404)
    h.actor.mockResolvedValue({ ...actor, projectRoles: new Map() })
    expect((await workGET(get(P1))).status).toBe(404)
    h.actor.mockResolvedValue(actor)
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: 'disabled' })
    expect((await workGET(get(P1))).status).toBe(404)
  })

  it('새 저장소의 회수/손상/장애를 옛 활성 토큰으로 우회하지 않는다', async () => {
    for (const row of [{ ...base, enabled: false }, { ...base, revoked_at: '2026-10-05' }, { ...base, token_hash: 'f'.repeat(64) }]) {
      const mock = mockAdmin(row)
      expect((await resolveAgentPrincipal(get(P1), mock.admin as never) as NextResponse).status).toBe(401)
      expect(mock.from).not.toHaveBeenCalledWith('agent_runners')
    }
    const mock = mockAdmin(base, { error: { message: 'storage unavailable' } })
    expect((await resolveAgentPrincipal(get(P1), mock.admin as never) as NextResponse).status).toBe(401)
    expect(mock.from).not.toHaveBeenCalledWith('agent_runners')
  })

  it('mine 후보 목록은 현재 역할과 토큰 WS/프로젝트 범위의 교집합이다', async () => {
    const mock = mockAdmin({ ...base, project_ids: [P1, P2] })
    const principal = await resolveAgentPrincipal(get(P1), mock.admin as never)
    expect(principal).not.toBeInstanceOf(NextResponse)
    expect(await accessibleProjectIds(mock.admin as never, principal as never)).toEqual([P1])
    expect(mock.from).not.toHaveBeenCalledWith('agent_projects')
  })

  it('watch는 토큰 WS를 쓰고 재개 조회/정리/중지까지 그 WS로 한정한다', async () => {
    const foreign = { id: ID, project_id: P2, wbs_item_id: ID, claimed_by: 'agent', resume_requested_at: '2026-10-05T00:00:00Z', resume_requested_host: 'host' }
    const mock = mockAdmin(base, { resume: [foreign] })
    const response = await watchPOST(watch({ agent: 'watcher' }))
    expect(response.status).toBe(200)
    expect((await response.json()).resume_requests).toEqual([])
    expect(mock.calls).toContainEqual({ table: 'agent_work_orders', op: 'eq', args: ['projects.workspace_id', W1] })
    expect(mock.calls).toContainEqual({ table: 'agent_work_orders', op: 'in', args: ['project_id', [P1, P3]] })
    expect(mock.from).not.toHaveBeenCalledWith('wbs_items') // 범위 밖 행은 라벨도 조회하지 않는다.
    expect(mock.calls.filter(c => c.table === 'agent_watchers' && c.op === 'upsert')[0].args[0]).toMatchObject({ workspace_id: W1 })
    const stop = mockAdmin()
    expect((await watchPOST(watch({ agent: 'watcher', stop: true }))).status).toBe(200)
    expect(stop.calls).toContainEqual({ table: 'agent_watchers', op: 'eq', args: ['workspace_id', W1] })
  })
})
