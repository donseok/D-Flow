import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_ID, CRED_OWNER, ownerLookup } from '../fixtures/credentials'

// 쓰기 라우트의 신원은 자격증명(integration_credentials 의 agent_runner 행) 소유자다(SP7 §5.1.4 — 배포 전역 시크릿과
// body user_email 신원·라벨 소유 판정은 삭제됐다). 점유 소유는 claimed_by_user_id(토큰 소유자) 하나로 판정한다.
const LEGACY_SECRET = 'test-agent-secret'
const CRED = agentCredential()
// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }
/** 전이 RPC 기본 응답 — 항목 없는 주문의 성공(단계·실적 건너뜀), 부수효과 없음. */
const RPC_OK = { ok: true, order_status: 'claimed', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: 'no_item' }

/** 큐에 integration_credentials 가 없으면 유효한 자격증명(CRED)으로 인증된다 — 조회 → last_used_at 갱신 두 응답. */
function useAdmin(queues: Record<string, Resp[]>, calls: Record<string, unknown[]> = {}) {
  queues = { integration_credentials: CRED.queue(), ...queues }
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.update = (payload: unknown) => { (calls[`${table}:update`] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => {
      const resp = (queues.rpc ?? []).shift() ?? { data: RPC_OK }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const post = (url: string, body: unknown, bearer: string = CRED.token) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null }
const BODY = { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }
const ctx = { params: Promise.resolve({ id: O1 }) }
const member = () => ({
  ...credAxes([P1]),
  project_members: [roster(rosterRow(P1, 'member'))],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
})

describe('POST claim', () => {
  it('ready 주문 점유 성공 — 전이 RPC 한 번, 점유자 라벨·계정은 서버가 넘긴다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], ...member() })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'claim', p_order_id: O1, p_agent: 'claude-cli-dev1', p_agent_user_id: CRED_OWNER, p_actor: CRED_OWNER,
    }))
  })
  it('옛 시크릿 값 Bearer 는 401 — env 에 AGENT_API_SECRET 이 있고 body user_email 이 멤버여도 점유하지 못한다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], ...member() })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY, LEGACY_SECRET), ctx)
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('CAS 경합 — RPC conflict 면 409 + 현재 상태', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }],
      ...member(),
      rpc: [{ data: { ok: false, conflict: true, order_status: 'claimed' } }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).status).toBe('claimed')
  })
  it('전이 RPC 오류 → 500', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({ agent_work_orders: [{ data: ORDER }], ...member(), rpc: [{ error: { message: 'db down' } }] })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })
  it('멤버 아님 403', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: ORDER }],
      ...credAxes([P1]),
      project_members: [{ data: [] }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  // 옛 케이스 'agent 이름 형식 위반 400' 의 후신 — 그 400 은 레거시 파서(parseAgentActor)의 것이었다. 토큰 경로는 형식에 안 맞는
  // 라벨을 받지 않고 서버 라벨(pat-<자격증명 id 8자>)로 대체한다(계약 v2.0) — 잘못된 값이 그대로 저장되지 않는 것은 같다.
  it('agent 이름 형식 위반 — body 값을 싣지 않고 서버 라벨(pat-<id8>)로 대체한다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], ...member() })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { ...BODY, agent: '공백 있음' }), ctx)
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'claim', p_agent: `pat-${CRED_ID.slice(0, 8)}`, p_agent_user_id: CRED_OWNER,
    }))
  })
  it('body user_email 이 토큰 소유자와 다르면 400 identity_mismatch — 사칭 신호를 조용히 무시하지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], ...member() })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { ...BODY, user_email: 'other@example.com' }), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_mismatch')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('경로 id UUID 형식 아니면 400', async () => {
    useAdmin({})
    const res = await claimPOST(post('http://l/api/v1/agent/work/not-uuid/claim', BODY), { params: Promise.resolve({ id: 'not-uuid' }) })
    expect(res.status).toBe(400)
  })
})

describe('POST release', () => {
  it('본인 점유만 반납 가능 — 타인 점유 403', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'other-cli', claimed_by_user_id: 'u-other' } }], ...member() })
    const res = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, BODY), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  // 옛 케이스 '본인 점유 반납(레거시 라벨 일치 조건) 200' 의 후신 둘 — 라벨 일치로 소유를 주장하는 길은 시크릿 principal 과 함께 사라졌다.
  it('점유자 계정이 없는 옛 점유(claimed_by_user_id null)는 라벨이 같아도 반납할 수 없다 — 403 not_claim_owner', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'claude-cli-dev1', claimed_by_user_id: null } }],
      ...member(),
    })
    const res = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, BODY), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('본인 점유 반납 → 전이 RPC release(점유자 계정 일치 조건) 200', async () => {
    const admin = useAdmin({
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'claude-cli-dev1', claimed_by_user_id: CRED_OWNER } }],
      ...member(),
      rpc: [{ data: { ...RPC_OK, order_status: 'ready' } }],
    })
    const res = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, BODY), ctx)
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'release', p_order_id: O1, p_agent: null, p_agent_user_id: CRED_OWNER,
    }))
  })
  it('반납 경합 — RPC conflict 면 409', async () => {
    useAdmin({
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'claude-cli-dev1', claimed_by_user_id: CRED_OWNER } }],
      ...member(),
      rpc: [{ data: { ok: false, conflict: true, order_status: 'ready' } }],
    })
    const res = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, BODY), ctx)
    expect(res.status).toBe(409)
  })
})

describe('claim — 새 점유자에게 옛 재개 요청을 물려주지 않는다(0099)', () => {
  it('전이가 성공하면 재개 표식 세 열을 비운다', async () => {
    const calls: Record<string, unknown[]> = {}
    useAdmin({ agent_work_orders: [{ data: ORDER }], ...member() }, calls)
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, BODY), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(200)
    expect(calls['agent_work_orders:update']).toEqual([
      { resume_requested_at: null, resume_requested_by: null, resume_requested_host: null },
    ])
  })
})
