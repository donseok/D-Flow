import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { generateAgentToken } from '@/lib/agent/token'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import type { ProjectRole } from '@/lib/domain/authz'
import { makeActor, makeMemberActor, WS } from '../fixtures/actor'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), actorFromUser: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// 프로젝트 없는 감시자의 워크스페이스 해석(0006) — 소속은 fixture 로 준다.
vi.mock('@/lib/authz', () => ({ actorFromUser: mocks.actorFromUser }))

import { POST } from '@/app/api/v1/agent/watch/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }
const PAT = generateAgentToken()
const RUNNER = {
  id: 'r-1', kind: 'user_pat', owner_user_id: 'u-1', token_prefix: PAT.prefix, token_hash: PAT.hash,
  project_id: null as string | null, scopes: ['work:claim'], enabled: true, revoked_at: null, expires_at: '2099-01-01T00:00:00Z',
}

function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.upsert = (payload: unknown, opts: unknown) => { (calls[`${table}:upsert`] ??= []).push([payload, opts]); return b }
      b.delete = () => { (calls[`${table}:delete`] ??= []).push(true); return b }
      b.update = () => b
      for (const k of ['eq', 'lt', 'in', 'limit', 'order', 'not']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { id: 'u-1', email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest('http://l/api/v1/agent/watch', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
const runnerQueues = (runner = RUNNER) => ({ agent_runners: [{ data: runner }, { data: null }], agent_watchers: [{ data: null }, { data: null }] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = 'legacy-secret'
  vi.clearAllMocks()
  // 기본: WS 한 곳 소속 + P1(WS) 명단 member — 프로젝트 없는 감시자도 그 워크스페이스에 역할이 있어야 한다(T13-2·F13)
  mocks.actorFromUser.mockResolvedValue(makeMemberActor(P1, [], { userId: 'u-1' }))
})
// 모듈 거부 케이스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('POST /agent/watch', () => {
  it('200 — (user_id, agent) 로 upsert 하고 expires_at = last_seen_at + 70분', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until: '18:00' })
    expect(res.status).toBe(200)
    const body = await res.json()
    const [payload, opts] = calls['agent_watchers:upsert'][0] as [Record<string, unknown>, Record<string, unknown>]
    expect(payload).toMatchObject({ user_id: 'u-1', agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', project_id: null, workspace_id: WS })
    expect(opts).toEqual({ onConflict: 'user_id,agent' })
    expect(Date.parse(body.expires_at) - Date.parse(payload.last_seen_at as string)).toBe(WATCHER_TTL_MS)
  })
  it('오래된 행(7일)을 같은 호출에서 지운다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    await post({ agent: 'hong/mbp/lead' })
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('stop: true — 행을 지우고 stopped 로 답한다(upsert 없음)', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead', stop: true })
    expect((await res.json())).toEqual({ ok: true, stopped: true })
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(calls['agent_watchers:delete']).toHaveLength(1)
  })
  it('프로젝트 한정 PAT 는 project_id 를 강제하고, 다른 값이면 403 forbidden_role', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeMemberActor(P1, [], { userId: 'u-1' }))
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }), calls)
    const ok = await post({ agent: 'a' })
    expect(ok.status).toBe(200)
    // 프로젝트가 있으면 워크스페이스는 트리거가 채운다(null) — 스냅샷은 프로젝트 판정에만 쓴다.
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: P1, workspace_id: null })
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }))
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(403)
  })
  // 감시자는 그 워크스페이스의 모든 허브·좌석표에 '떠 있는 팀장'으로 보이는 쓰기다 — 조회 전용에게 주지 않는다(판정 T13-2).
  // 프로젝트 분기만 isProjectMember 를 보고, 프로젝트 없는 분기는 역할을 보지 않았다(SP2 최종 리뷰 AUTHZ-6).
  it('프로젝트 없는 감시자 — 그 워크스페이스에 역할이 없는 멤버(조회 전용)는 404, upsert 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1' }))   // WS member, 명단 권한 없음
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead' })
    expect(res.status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('프로젝트 없는 감시자 — 워크스페이스 관리자는 명단 없이도 200', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1', workspaceRoles: new Map([[WS, 'admin']]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead' })).status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: null, workspace_id: WS })
  })
  it('프로젝트 없는 감시자인데 소속 워크스페이스가 하나가 아니면 400 project_required — upsert 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1', workspaceRoles: new Map([[WS, 'member'], ['ws-2', 'member']]) }))
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'a' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('project_required')
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('400 — agent 없음 / project_id 형식 오류 / slots 음수', async () => {
    useAdmin(runnerQueues()); expect((await post({})).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', project_id: 'nope' })).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', slots: -1 })).status).toBe(400)
  })
  it('레거시 시크릿 → 400 identity_required (PAT 전용)', async () => {
    useAdmin(runnerQueues())
    const res = await post({ agent: 'a' }, 'legacy-secret')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin(runnerQueues({ ...RUNNER, scopes: ['work:read'] }))
    expect((await post({ agent: 'a' })).status).toBe(403)
  })
})

describe('POST /agent/watch — 재개 요청 전달(0099)', () => {
  const ORDER = {
    id: '44444444-4444-4444-8444-444444444441', project_id: P1, wbs_item_id: 'item-1',
    claimed_by: 'claude-agent-host-1', resume_requested_at: '2026-09-18T00:00:00.000Z', resume_requested_host: 'agent-host-1',
  }

  it('내 신원이 점유한 멈춤 작업의 요청을 TSK 코드와 함께 싣는다', async () => {
    useAdmin({
      ...runnerQueues(),
      agent_work_orders: [{ data: [ORDER] }],
      wbs_items: [{ data: [{ id: 'item-1', code: 'TSK-04-02', name: '주문 상세' }] }],
    })
    const res = await post({ agent: 'hong/mbp/lead' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.resume_requests).toEqual([{
      order_id: ORDER.id, id8: '44444444', project_id: P1, wbs_item_id: 'item-1',
      code: 'TSK-04-02', name: '주문 상세', host: 'agent-host-1',
      claimed_by: 'claude-agent-host-1', requested_at: ORDER.resume_requested_at,
    }])
    expect(body.resume_requests_error).toBeUndefined()
  })

  it('agents 가 꺼진 프로젝트의 재개 요청은 싣지 않는다 — 목록형(과제 18, 스펙 §4.2)', async () => {
    const OTHER = { ...ORDER, id: '44444444-4444-4444-8444-444444444442', project_id: P2, wbs_item_id: null }
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [ORDER, OTHER] }], wbs_items: [{ data: [{ id: 'item-1', code: 'TSK-04-02', name: '주문 상세' }] }] })
    vi.mocked(projectsWithModule).mockResolvedValueOnce([P1])
    const body = await (await post({ agent: 'hong/mbp/lead' })).json()
    expect(body.resume_requests.map((r: { order_id: string }) => r.order_id)).toEqual([ORDER.id])
    expect(projectsWithModule).toHaveBeenCalledWith([P1, P2], 'agents', { client: expect.anything() })
  })

  it('요청이 없으면 빈 배열이다 — 항목 조회를 부르지 않는다', async () => {
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [] }] })
    const body = await (await post({ agent: 'a' })).json()
    expect(body.resume_requests).toEqual([])
  })

  it('조회에 실패하면 빈 배열로 위장하지 않고 null 과 사유를 준다(에러 3원칙)', async () => {
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: null, error: { message: 'boom' } }] })
    const res = await post({ agent: 'a' })
    expect(res.status).toBe(200) // 존재 신호 자체는 기록됐다 — 팀장의 하트비트를 500 으로 끊지 않는다
    const body = await res.json()
    expect(body.resume_requests).toBeNull()
    expect(body.resume_requests_error).toBe('재개 요청 조회에 실패했습니다.')
  })
})

describe('POST /agent/watch — 감시 프로젝트는 PAT 소유자가 볼 수 있어야 한다(SP2 Task 13)', () => {
  it('프로젝트 한정이 아닌 PAT 가 다른 워크스페이스 project_id 를 대면 404 — upsert 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(), calls)   // 기본 스냅샷은 아는 프로젝트가 없다
    const res = await post({ agent: 'a', project_id: P2 })
    expect(res.status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('프로젝트 한정 PAT 라도 소유자 스냅샷에 없는 프로젝트면 404(발급 때 워크스페이스를 확인하지 않는다)', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1' }))   // P1 을 모른다
    useAdmin(runnerQueues({ ...RUNNER, project_id: P1 }), calls)
    expect((await post({ agent: 'a' })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('같은 워크스페이스라도 명단 권한이 없는 조회 전용이면 404 — 감시자는 허브·좌석표에 보이는 쓰기다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: 'u-1', projectWorkspace: new Map([[P2, WS]]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('명단 member 면 upsert 한다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.actorFromUser.mockResolvedValue(makeMemberActor(P2, [], { userId: 'u-1', projectRoles: new Map<string, ProjectRole>([[P2, 'member']]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: P2 })
  })
  it('소유자 권한 조회 실패는 500 — 판정 없이 쓰지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.actorFromUser.mockRejectedValue(new Error('db down'))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(500)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    spy.mockRestore()
  })
  it('stop 은 자기 행만 지우므로 프로젝트 판정 없이 처리한다', async () => {
    useAdmin(runnerQueues())
    expect((await post({ agent: 'a', project_id: P2, stop: true })).status).toBe(200)
    expect(mocks.actorFromUser).not.toHaveBeenCalled()
  })
  it('agents 가 꺼지면 404 이고 upsert 하지 않는다. stop 은 관문 앞이라 정리는 된다(과제 18, P19)', async () => {
    const calls: Record<string, unknown[]> = {}
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead' })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead', stop: true })).status).toBe(200)
  })
})
