import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { projectsWithModule } from '@/lib/modules/gate'
import { agentCredential, CRED_OWNER, CRED_WS, ownerLookup } from '../fixtures/credentials'
import { makeActor } from '../fixtures/actor'
import type { ProjectRole } from '@/lib/domain/authz'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), buildActor: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: mocks.buildActor }))

import { POST } from '@/app/api/v1/agent/lead/lease/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const P3 = '33333333-3333-4333-8333-333333333333'
const H = '0123abcd-0000-4000-8000-00000000abcd:12345'
const EXPIRES = '2026-10-23T00:03:00Z'
const RUNNER = agentCredential({ scopes: ['work:claim'] })
type Resp = { data?: unknown; error?: { message: string } | null }
const actor = (pids = [P1, P2, P3], workspaceId = CRED_WS) => makeActor({
  userId: CRED_OWNER, workspaceRoles: new Map([[workspaceId, 'member']]),
  projectWorkspace: new Map(pids.map(p => [p, workspaceId])),
  projectRoles: new Map<string, ProjectRole>(pids.map(p => [p, 'member'])),
})
function useAdmin(queues: Record<string, Resp[]> = {}, runner = RUNNER) {
  const responses: Record<string, Resp[]> = { integration_credentials: runner.queue(), ...queues }
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (responses[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'not', 'update']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async (fn: string) => {
      const resp = (responses[`rpc:${fn}`] ?? []).shift() ?? { data: null, error: null }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, token: string | null = RUNNER.token) => POST(new NextRequest('http://l/api/v1/agent/lead/lease', {
  method: 'POST', headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))
const acquire = (extra: Record<string, unknown> = {}) => ({ op: 'acquire', projects: [P1], holder: H, host: 'mbp', agent: 'hong/mbp/lead', ...extra })
const refs = (...pids: string[]) => pids.map(project_id => ({ project_id, generation: 4 }))

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  vi.clearAllMocks()
  mocks.buildActor.mockResolvedValue(actor())
})
afterEach(() => { vi.mocked(projectsWithModule).mockReset() })

describe('POST /agent/lead/lease — D-Flow 계약 2.5', () => {
  it('잘못된 JSON 은 400 이고 인증·DB 를 부르지 않는다', async () => {
    const res = await POST(new NextRequest('http://l/api/v1/agent/lead/lease', { method: 'POST', body: '{' }))
    expect(res.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it.each([{ op: 'steal', holder: H }, acquire({ holder: 'bad' })])('형식 오류 %j → 400', async body => {
    expect((await post(body)).status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('토큰 없음 → 401', async () => {
    const admin = useAdmin()
    expect((await post(acquire(), null)).status).toBe(401)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('work:read 만 있는 PAT → 403 insufficient_scope', async () => {
    const admin = useAdmin({}, RUNNER.with({ scopes: ['work:read'] }))
    const res = await post(acquire())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('insufficient_scope')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it.each(['acquire', 'renew', 'release'])('%s — 자격증명 범위 밖 → 404, RPC 없음', async op => {
    const admin = useAdmin({}, RUNNER.with({ project_ids: [P2] }))
    const body = op === 'acquire' ? acquire() : { op, holder: H, leases: refs(P1) }
    expect((await post(body)).status).toBe(404)
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(mocks.buildActor).not.toHaveBeenCalled()
  })
  it('acquire — 멤버가 아닌 프로젝트가 하나라도 있으면 404, 전체 RPC 없음', async () => {
    mocks.buildActor.mockResolvedValue(actor([P1]))
    const admin = useAdmin()
    expect((await post(acquire({ projects: [P1, P2] }))).status).toBe(404)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('acquire — 다른 워크스페이스 멤버십은 자격증명 스냅샷에서 사라져 404', async () => {
    mocks.buildActor.mockResolvedValue(actor([P1], 'other-workspace'))
    const admin = useAdmin()
    expect((await post(acquire())).status).toBe(404)
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('acquire — agents 꺼짐 → 404, RPC 없음', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([])
    const admin = useAdmin()
    expect((await post(acquire())).status).toBe(404)
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(projectsWithModule).toHaveBeenCalledExactlyOnceWith([P1], 'agents', { client: admin, workspaceId: CRED_WS })
  })
  it('acquire — 사용자·holder·takeover 를 RPC 에 넘기고 generation 을 돌려준다', async () => {
    const admin = useAdmin({ 'rpc:lead_lease_acquire': [{ data: [{ project_id: P1, ok: true, generation: 4, expires_at: EXPIRES }] }] })
    const res = await post(acquire({ takeover: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, leases: [{ project_id: P1, generation: 4, expires_at: EXPIRES }] })
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith('lead_lease_acquire', {
      p_user: CRED_OWNER, p_projects: [P1], p_holder: H, p_host: 'mbp', p_agent: 'hong/mbp/lead', p_takeover: true,
    })
    expect(mocks.buildActor).toHaveBeenCalledTimes(1)
  })
  it('acquire — 다른 holder 가 쥐면 409 lead_lease_held + held', async () => {
    useAdmin({ 'rpc:lead_lease_acquire': [{ data: [{ project_id: P1, ok: false, generation: 2, host: 'other', agent: 'hong/other/lead', expires_at: EXPIRES }] }] })
    const res = await post(acquire())
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'lead_lease_held', held: [{ project_id: P1, host: 'other', agent: 'hong/other/lead', expires_at: EXPIRES }] })
  })
  it('renew — DB 가 잃은 lease 와 가장 이른 만료 시각을 돌려준다(heavy 는 무시)', async () => {
    useAdmin({ 'rpc:lead_lease_renew': [{ data: [
      { project_id: P1, ok: true, expires_at: EXPIRES },
      { project_id: P2, ok: false, expires_at: null },
      { project_id: P3, ok: true, expires_at: '2026-10-23T00:02:00Z' },
    ] }] })
    const res = await post({ op: 'renew', holder: H, leases: refs(P1, P2, P3), heavy: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, expires_at: '2026-10-23T00:02:00Z', lost: [P2] })
  })
  it.each(['membership', 'module'])('renew — %s 에서 빠진 프로젝트는 RPC 에 싣지 않고 lost', async reason => {
    if (reason === 'membership') mocks.buildActor.mockResolvedValue(actor([P1]))
    else vi.mocked(projectsWithModule).mockResolvedValueOnce([P1])
    const admin = useAdmin({ 'rpc:lead_lease_renew': [{ data: [{ project_id: P1, ok: true, expires_at: EXPIRES }] }] })
    const res = await post({ op: 'renew', holder: H, leases: refs(P1, P2) })
    expect(await res.json()).toEqual({ ok: true, expires_at: EXPIRES, lost: [P2] })
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith('lead_lease_renew', { p_user: CRED_OWNER, p_holder: H, p_leases: refs(P1) })
  })
  it('renew — 전부 빠지면 RPC 없이 expires_at:null 과 lost', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([])
    const admin = useAdmin()
    expect(await (await post({ op: 'renew', holder: H, leases: refs(P1, P2) })).json()).toEqual({ ok: true, expires_at: null, lost: [P1, P2] })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('release — 멤버십·모듈 관문을 호출하지 않고 자기 lease 를 정리한다', async () => {
    mocks.buildActor.mockRejectedValue(new Error('must not read actor'))
    vi.mocked(projectsWithModule).mockResolvedValue([])
    const admin = useAdmin({ 'rpc:lead_lease_release': [{ data: 1 }] })
    const res = await post({ op: 'release', holder: H, leases: refs(P1) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, released: 1 })
    expect(admin.rpc).toHaveBeenCalledExactlyOnceWith('lead_lease_release', { p_user: CRED_OWNER, p_holder: H, p_leases: refs(P1) })
    expect(projectsWithModule).not.toHaveBeenCalled()
    expect(mocks.buildActor).not.toHaveBeenCalled()
  })
  it.each(['acquire', 'renew', 'release'])('%s — RPC 오류 → 500, 로그', async op => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      useAdmin({ [`rpc:lead_lease_${op}`]: [{ error: { message: 'boom' } }] })
      const res = await post(op === 'acquire' ? acquire() : { op, holder: H, leases: refs(P1) })
      expect(res.status).toBe(500)
      expect(spy).toHaveBeenCalledWith(`[agent-api] lease ${op} 실패:`, 'boom')
    } finally { spy.mockRestore() }
  })
  it('권한 스냅샷 조회 실패 → 500, RPC 없음', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.buildActor.mockRejectedValue(new Error('db down'))
      const admin = useAdmin()
      expect((await post(acquire())).status).toBe(500)
      expect(admin.rpc).not.toHaveBeenCalled()
      expect(spy).toHaveBeenCalled()
    } finally { spy.mockRestore() }
  })
})
