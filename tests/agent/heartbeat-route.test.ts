import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST } from '@/app/api/v1/agent/work/[id]/heartbeat/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_OWNER, ownerLookup } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }
// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자(CRED_OWNER)가 요청의 신원.
const RUNNER = agentCredential({ scopes: ['work:claim'] })
const PAT = { token: RUNNER.token }
const LEGACY_SECRET = 'legacy-secret'
const ORDER = { id: O1, project_id: P1, status: 'claimed', claimed_by: 'pat-r-1', claimed_by_user_id: CRED_OWNER as string | null, wbs_item_id: null }

/** 큐 순서(work-routes-pat.test.ts 상세 조회와 같다): integration_credentials(조회, last_used) → 주문 → 권한 4축 → project_members(명단 권한) → 주문 update */
function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.update = (payload: unknown) => { (calls[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (calls[`${table}:insert`] ??= []).push(payload); return b }
      for (const k of ['eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (body: unknown, bearer = PAT.token) =>
  POST(new NextRequest(`http://l/api/v1/agent/work/${O1}/heartbeat`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: O1 }) })
const okQueues = (order = ORDER) => ({
  integration_credentials: RUNNER.queue(),
  agent_work_orders: [{ data: order }, { data: [{ id: O1 }] }],
  ...credAxes([P1]),
  project_members: [roster(rosterRow(P1, 'member'))],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
})

describe('POST /agent/work/[id]/heartbeat', () => {
  it('200 — 열 4개를 touch 하고 보고 행은 만들지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'build' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.last_heartbeat_at).toBe('string')
    const upd = calls.agent_work_orders?.[0] as Record<string, unknown>
    expect(upd.heartbeat_agent).toBe('hong/mbp/w1')
    expect(upd.heartbeat_phase).toBe('build')
    expect(upd.heartbeat_note).toBeNull()
    expect(upd.last_heartbeat_at).toBe(body.last_heartbeat_at)
    expect(upd.updated_at).toBe(body.last_heartbeat_at)
    // 워커가 되살아나면 사람이 건 재개 요청(0099)은 같은 update 에서 해소된다.
    expect(upd.resume_requested_at).toBeNull()
    expect(upd.resume_requested_by).toBeNull()
    expect(upd.resume_requested_host).toBeNull()
    expect(calls['agent_work_reports:insert']).toBeUndefined()
  })
  it('blocked 는 note 를 저장하고, phase 생략은 phase·note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '어느 DB 를 쓸까요?' })
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_note).toBe('어느 DB 를 쓸까요?')
    const calls2: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls2)
    await post({ agent: 'hong/mbp/w1' })
    const upd = calls2.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBeNull(); expect(upd.heartbeat_note).toBeNull()
  })
  it('blocked + 공백뿐인 note 는 heartbeat_note 를 null 로 둔다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    const res = await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '   ' })
    expect(res.status).toBe(200)
    const upd = calls.agent_work_orders[0] as Record<string, unknown>
    expect(upd.heartbeat_phase).toBe('blocked')
    expect(upd.heartbeat_note).toBeNull()
  })
  it('400 — agent 없음 / 모르는 phase / note 500자 초과', async () => {
    useAdmin(okQueues()); expect((await post({ phase: 'build' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'lunch' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', phase: 'blocked', note: 'x'.repeat(501) })).status).toBe(400)
  })
  it('model(0100) — 실리면 heartbeat_model 을 덮어쓰고, 생략하면 열을 건드리지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls)
    expect((await post({ agent: 'hong/mbp/w1', phase: 'verify', model: ' haiku ' })).status).toBe(200)
    expect((calls.agent_work_orders[0] as Record<string, unknown>).heartbeat_model).toBe('haiku')
    const calls2: Record<string, unknown[]> = {}
    useAdmin(okQueues(), calls2)
    await post({ agent: 'hong/mbp/w1', phase: 'blocked', note: '질문' })
    expect(calls2.agent_work_orders[0] as Record<string, unknown>).not.toHaveProperty('heartbeat_model')
  })
  it('400 — 모델 이름 형식이 아니면 거부한다', async () => {
    useAdmin(okQueues()); expect((await post({ agent: 'a', model: 'x'.repeat(65) })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', model: 'opus 4' })).status).toBe(400)
    useAdmin(okQueues()); expect((await post({ agent: 'a', model: 42 })).status).toBe(400)
  })
  it('409 — claimed 가 아니면 touch 하지 않는다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, status: 'reported' }), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(409)
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('409 cancelled — 사람이 중단한 주문이면 code=cancelled 로 워커를 세운다(touch 없음)', async () => {
    const calls: Record<string, unknown[]> = {}
    // 중단은 점유 흔적(claimed_by*)을 지운다 — 소유 판정보다 상태 판정이 먼저여야 403 이 아니라 409 cancelled 가 간다.
    useAdmin(okQueues({ ...ORDER, status: 'cancelled', claimed_by: null, claimed_by_user_id: null } as unknown as typeof ORDER), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('cancelled')
    expect(body.error).toBe('작업이 중단되었습니다.')
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('409 conflict — cancelled 가 아닌 다른 상태 불일치는 지금처럼 conflict', async () => {
    useAdmin(okQueues({ ...ORDER, status: 'reported' }))
    expect((await (await post({ agent: 'a', phase: 'build' })).json()).code).toBe('conflict')
  })
  it('403 not_claim_owner — 다른 사용자가 점유한 주문', async () => {
    useAdmin(okQueues({ ...ORDER, claimed_by_user_id: 'u-9' }))
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })
  it('409 conflict — CAS 0행(경합으로 상태가 바뀜)', async () => {
    useAdmin({ ...okQueues(), agent_work_orders: [{ data: ORDER }, { data: [] }] })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(409)
  })
  it('403 insufficient_scope — work:read 만 있는 PAT', async () => {
    useAdmin({ ...okQueues(), integration_credentials: RUNNER.with({ scopes: ['work:read'] }).queue() })
    expect((await post({ agent: 'a', phase: 'build' })).status).toBe(403)
  })
  it('401 — 옛 시크릿 값 Bearer(env 에 AGENT_API_SECRET 설정, body user_email 포함)는 touch 하지 못한다', async () => {
    const calls: Record<string, unknown[]> = {}
    const admin = useAdmin(okQueues(), calls)
    const res = await post({ agent: 'a', phase: 'build', user_email: 'dev@example.com' }, LEGACY_SECRET)
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalled()
    expect(calls.agent_work_orders).toBeUndefined()
  })
  it('403 not_claim_owner — 점유자 계정이 없는 옛 점유(claimed_by_user_id null)는 라벨이 같아도 touch 하지 못한다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin(okQueues({ ...ORDER, claimed_by: 'a', claimed_by_user_id: null }), calls)
    const res = await post({ agent: 'a', phase: 'build' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(calls.agent_work_orders).toBeUndefined()
  })
})
