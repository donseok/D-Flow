import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { WATCHER_TTL_MS } from '@/lib/domain/seatState'
import type { Actor, ProjectRole } from '@/lib/domain/authz'
import { makeActor as baseActor, makeMemberActor as baseMemberActor } from '../fixtures/actor'
import { agentCredential, CRED_OWNER, CRED_WS, ownerLookup } from '../fixtures/credentials'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), buildActor: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// 소유자의 권한 스냅샷은 fixture 로 준다 — 라우트는 이것을 자격증명 범위로 좁혀(actorFromCredential) 판정한다(SP7 §5.1.3).
vi.mock('@/lib/authz/buildActor', () => ({ buildActor: mocks.buildActor }))

import { POST } from '@/app/api/v1/agent/watch/route'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null }
// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자(CRED_OWNER)가 감시자의 신원이고,
// 프로젝트 없는 감시자의 워크스페이스는 자격증명의 워크스페이스다(소속 개수로 추측하지 않는다).
const RUNNER = agentCredential({ scopes: ['work:claim'] })
const PAT = { token: RUNNER.token }
const LEGACY_SECRET = 'legacy-secret'
const WS = CRED_WS
const U = CRED_OWNER
/** 공용 fixture 의 소속 워크스페이스('ws-1')를 자격증명 워크스페이스로 바꾼다 — 좁힌 뒤에도 프로젝트가 남아야 한다. */
const inCredWs = (a: Actor): Actor => ({
  ...a,
  workspaceRoles: new Map([...a.workspaceRoles].map(([w, r]) => [w === 'ws-1' ? WS : w, r])),
  projectWorkspace: new Map([...a.projectWorkspace].map(([p, w]) => [p, w === 'ws-1' ? WS : w])),
})
const makeActor = (over: Partial<Actor> = {}) => inCredWs(baseActor(over))
const makeMemberActor = (pid: string, teams: string[] = [], over: Partial<Actor> = {}) => inCredWs(baseMemberActor(pid, teams, over))

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
    auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest('http://l/api/v1/agent/watch', {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
const runnerQueues = (runner = RUNNER) => ({ integration_credentials: runner.queue(), agent_watchers: [{ data: null }, { data: null }] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
  // 기본: WS 한 곳 소속 + P1(WS) 명단 member — 프로젝트 없는 감시자도 그 워크스페이스에 역할이 있어야 한다(T13-2·F13)
  mocks.buildActor.mockResolvedValue(makeMemberActor(P1, [], { userId: U }))
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
    expect(payload).toMatchObject({ user_id: U, agent: 'hong/mbp/lead', host: 'mbp', slots: 3, busy: 1, until_label: '18:00', project_id: null, workspace_id: WS })
    expect(opts).toEqual({ onConflict: 'workspace_id,user_id,agent' })
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
  // 옛 PAT 저장소(agent_runners.project_id)는 다른 값을 403 forbidden_role 로 답했다. 자격증명의 project_ids 는 범위 밖 프로젝트를
  // 먼저 404(존재 은닉 — 다른 에이전트 라우트와 같은 응답)로 닫는다. 어느 쪽이든 그 프로젝트의 감시자로 쓰지 못한다.
  it('프로젝트 한정 PAT 는 project_id 를 강제하고, 다른 값이면 404(존재 은닉) — upsert 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeMemberActor(P1, [], { userId: U }))
    useAdmin(runnerQueues(RUNNER.with({ project_ids: [P1] })), calls)
    const ok = await post({ agent: 'a' })
    expect(ok.status).toBe(200)
    // 프로젝트가 있으면 워크스페이스는 트리거가 채운다(null) — 스냅샷은 프로젝트 판정에만 쓴다.
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: P1, workspace_id: null })
    const calls2: Record<string, unknown[]> = {}
    useAdmin(runnerQueues(RUNNER.with({ project_ids: [P1] })), calls2)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(404)
    expect(calls2['agent_watchers:upsert']).toBeUndefined()
    expect(mocks.buildActor).toHaveBeenCalledTimes(1) // 첫 호출뿐 — 범위 밖은 스냅샷을 읽기도 전에 닫힌다
  })
  // 감시자는 그 워크스페이스의 모든 허브·좌석표에 '떠 있는 팀장'으로 보이는 쓰기다 — 조회 전용에게 주지 않는다(판정 T13-2).
  // 프로젝트 분기만 isProjectMember 를 보고, 프로젝트 없는 분기는 역할을 보지 않았다(SP2 최종 리뷰 AUTHZ-6).
  it('프로젝트 없는 감시자 — 그 워크스페이스에 역할이 없는 멤버(조회 전용)는 404, upsert 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeActor({ userId: U }))   // WS member, 명단 권한 없음
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'hong/mbp/lead' })
    expect(res.status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('프로젝트 없는 감시자 — 워크스페이스 관리자는 명단 없이도 200', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeActor({ userId: U, workspaceRoles: new Map([[WS, 'admin']]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead' })).status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: null, workspace_id: WS })
  })
  // 옛 케이스 '소속 워크스페이스가 하나가 아니면 400 project_required' 의 후신 — 그 400 은 소속 개수로 워크스페이스를 추측하던
  // 옛 PAT 저장소의 것이었다. 자격증명은 워크스페이스를 스스로 가지므로 소속이 둘이어도 그 워크스페이스에 쓴다(다른 쪽에 쓰지 않는다).
  it('프로젝트 없는 감시자 — 소속 워크스페이스가 둘이어도 자격증명 워크스페이스에 upsert 한다(추측하지 않는다)', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeMemberActor(P1, [], { userId: U, workspaceRoles: new Map([[WS, 'member'], ['ws-2', 'admin']]) }))
    useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'a' })
    expect(res.status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: null, workspace_id: WS })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'agents', { client: expect.anything() })
  })
  it('프로젝트 없는 감시자 — 다른 워크스페이스의 역할만 있으면(자격증명 워크스페이스에는 조회 전용) 404, upsert 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeActor({
      userId: U, workspaceRoles: new Map([[WS, 'member'], ['ws-2', 'admin']]),
      projectWorkspace: new Map([[P2, 'ws-2']]), projectRoles: new Map<string, ProjectRole>([[P2, 'admin']]),
    }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a' })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('400 — agent 없음 / project_id 형식 오류 / slots 음수', async () => {
    useAdmin(runnerQueues()); expect((await post({})).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', project_id: 'nope' })).status).toBe(400)
    useAdmin(runnerQueues()); expect((await post({ agent: 'a', slots: -1 })).status).toBe(400)
  })
  // 옛 케이스 '레거시 시크릿 → 400 identity_required (PAT 전용)' 의 후신 — 시크릿 principal 이 삭제돼 인증 실패다.
  it('옛 시크릿 값 Bearer → 401 — env 에 AGENT_API_SECRET 이 있어도 감시자를 쓰지 못한다', async () => {
    const calls: Record<string, unknown[]> = {}
    const admin = useAdmin(runnerQueues(), calls)
    const res = await post({ agent: 'a' }, LEGACY_SECRET)
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin(runnerQueues(RUNNER.with({ scopes: ['work:read'] })))
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
    // 두 프로젝트 모두 소유자의 멤버 프로젝트다 — 빠지는 이유가 권한이 아니라 모듈임을 보인다.
    mocks.buildActor.mockResolvedValue(makeMemberActor(P1, [], {
      userId: U, projectWorkspace: new Map([[P1, WS], [P2, WS]]), projectRoles: new Map<string, ProjectRole>([[P1, 'member'], [P2, 'member']]),
    }))
    useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [ORDER, OTHER] }], wbs_items: [{ data: [{ id: 'item-1', code: 'TSK-04-02', name: '주문 상세' }] }] })
    vi.mocked(projectsWithModule).mockResolvedValueOnce([P1])
    const body = await (await post({ agent: 'hong/mbp/lead' })).json()
    expect(body.resume_requests.map((r: { order_id: string }) => r.order_id)).toEqual([ORDER.id])
    expect(projectsWithModule).toHaveBeenCalledWith([P1, P2], 'agents', { client: expect.anything() })
  })

  it('요청이 없으면 빈 배열이다 — 항목 조회를 부르지 않는다', async () => {
    const admin = useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [] }] })
    const body = await (await post({ agent: 'a' })).json()
    expect(body.resume_requests).toEqual([])
    expect(admin.from).not.toHaveBeenCalledWith('wbs_items')
  })
  it('소유자가 멤버가 아닌 프로젝트의 재개 요청은 싣지 않는다 — 조회 필터가 새도 스냅샷으로 한 번 더 거른다', async () => {
    const FOREIGN = { ...ORDER, id: '44444444-4444-4444-8444-444444444443', project_id: P2 }
    const admin = useAdmin({ ...runnerQueues(), agent_work_orders: [{ data: [FOREIGN] }] })   // 기본 스냅샷은 P1 만 안다
    const body = await (await post({ agent: 'a' })).json()
    expect(body.resume_requests).toEqual([])
    expect(admin.from).not.toHaveBeenCalledWith('wbs_items')
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
    mocks.buildActor.mockResolvedValue(makeActor({ userId: U }))   // P1 을 모른다
    useAdmin(runnerQueues(RUNNER.with({ project_ids: [P1] })), calls)
    expect((await post({ agent: 'a' })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
  })
  it('같은 워크스페이스라도 명단 권한이 없는 조회 전용이면 404 — 감시자는 허브·좌석표에 보이는 쓰기다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeActor({ userId: U, projectWorkspace: new Map([[P2, WS]]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('명단 member 면 upsert 한다', async () => {
    const calls: Record<string, unknown[]> = {}
    mocks.buildActor.mockResolvedValue(makeMemberActor(P2, [], { userId: U, projectRoles: new Map<string, ProjectRole>([[P2, 'member']]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(200)
    expect((calls['agent_watchers:upsert'][0] as [Record<string, unknown>])[0]).toMatchObject({ project_id: P2 })
  })
  it('소유자 권한 조회 실패는 500 — 판정 없이 쓰지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.buildActor.mockRejectedValue(new Error('db down'))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(500)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    spy.mockRestore()
  })
  it('stop 은 자기 행만 지우므로 프로젝트 판정 없이 처리한다', async () => {
    useAdmin(runnerQueues())
    expect((await post({ agent: 'a', project_id: P2, stop: true })).status).toBe(200)
    expect(mocks.buildActor).not.toHaveBeenCalled()
  })
  it('agents 가 워크스페이스에서 꺼지면 404 이고 upsert 하지 않는다. stop 은 관문 앞이라 정리는 된다(과제 18, P19)', async () => {
    const calls: Record<string, unknown[]> = {}
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead' })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'agents', { client: expect.anything() })
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead', stop: true })).status).toBe(200)
  })
  it('agents 가 프로젝트에서 꺼지면 404 이고 upsert 하지 않는다.', async () => {
    const calls: Record<string, unknown[]> = {}
    vi.mocked(requireModule).mockResolvedValue({ ok: false, error: ERR_MODULE_DISABLED })
    mocks.buildActor.mockResolvedValue(makeMemberActor(P2, [], { userId: U, projectRoles: new Map<string, ProjectRole>([[P2, 'member']]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(404)
    expect(calls['agent_watchers:upsert']).toBeUndefined()
    expect(requireModule).toHaveBeenCalledWith({ projectId: P2 }, 'agents', { client: expect.anything() })
  })
  it('범위 한정 거부 — 프로젝트는 꺼지고 워크스페이스는 켜져 있을 때', async () => {
    const calls: Record<string, unknown[]> = {}
    vi.mocked(requireModule).mockImplementation(async (s) => 'projectId' in s ? { ok: false, error: ERR_MODULE_DISABLED } : { ok: true })
    mocks.buildActor.mockResolvedValue(makeMemberActor(P2, [], { userId: U, projectRoles: new Map<string, ProjectRole>([[P2, 'member']]) }))
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'a', project_id: P2 })).status).toBe(404)
  })
  it('범위 한정 거부 — 프로젝트는 켜지고 워크스페이스는 꺼져 있을 때', async () => {
    const calls: Record<string, unknown[]> = {}
    vi.mocked(requireModule).mockImplementation(async (s) => 'workspaceId' in s ? { ok: false, error: ERR_MODULE_DISABLED } : { ok: true })
    useAdmin(runnerQueues(), calls)
    expect((await post({ agent: 'hong/mbp/lead' })).status).toBe(404)
  })
})
