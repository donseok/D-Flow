import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'
import { POST as releasePOST } from '@/app/api/v1/agent/work/[id]/release/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_OWNER } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }
/** 전이 RPC 기본 응답 — 항목 없는 주문의 성공(단계·실적 건너뜀), 부수효과 없음. 케이스마다 queues.rpc 로 덮는다. */
const RPC_OK = { ok: true, order_status: 'claimed', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: 'no_item' }

// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자(CRED_OWNER)가 요청의 신원.
const RUNNER = agentCredential({ scopes: [] })
const PAT = { token: RUNNER.token }
const LEGACY_SECRET = 'legacy-secret'
const CLAIM_SCOPES = RUNNER.with({ scopes: ['work:read', 'work:claim'] })
const REPORT_SCOPES = RUNNER.with({ scopes: ['work:read', 'work:claim', 'work:report'] })
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: null }
// P2 한정 PAT — 주문은 P1 소속. 멤버십 조회까지 가지 않고 주문 로드 직후 404 여야 한다(C1).
const CLAIM_SCOPES_P2 = CLAIM_SCOPES.with({ project_ids: [P2] })
const REPORT_SCOPES_P2 = REPORT_SCOPES.with({ project_ids: [P2] })
const ctx = { params: Promise.resolve({ id: O1 }) }

function useAdmin(queues: Record<string, Resp[]>) {
  const captured: unknown[] = []
  const rpcCalls: Array<Record<string, unknown>> = []
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'insert', 'delete', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.update = (p: unknown) => { captured.push(p); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      rpcCalls.push(args)
      const resp = (queues.rpc ?? []).shift() ?? { data: RPC_OK }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({ data: { user: { id, email: 'dev@example.com' } }, error: null })),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, captured, rpcCalls }
}
const post = (url: string, body: unknown, bearer: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
})

describe('PAT 쓰기 루프', () => {
  it('PAT claim 성공 → claimed_by_user_id 서버 유도 기록 (body 값 아님)', async () => {
    const { rpcCalls } = useAdmin({
      integration_credentials: CLAIM_SCOPES.queue(), // 조회, last_seen
      agent_work_orders: [{ data: ORDER }], // 로드(점유는 전이 RPC 가 한다)
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [{ data: null }], // 배정 확인(무배정) — Task 15 이후에도 이 큐가 유효
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'claude-pc1', claimed_by_user_id: 'attacker' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const claim = rpcCalls.find(a => a.p_event === 'claim')!
    expect(claim.p_agent_user_id).toBe(CRED_OWNER) // principal 유도값 — body 의 'attacker' 무시
  })

  it('PAT + body user_email 불일치 → 400 identity_mismatch', async () => {
    useAdmin({ integration_credentials: CLAIM_SCOPES.queue() })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a', user_email: 'other@example.com' }, PAT.token), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_mismatch')
  })

  it('PAT 가 레거시 점유(claimed_by_user_id=null) 주문 report → 403 not_claim_owner', async () => {
    useAdmin({
      integration_credentials: REPORT_SCOPES.queue(),
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'legacy-cli', claimed_by_user_id: null } }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_claim_owner')
  })

  it('PAT + work:claim 스코프 없음 → 403 insufficient_scope', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(), // scopes: [] — work:claim 없음
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('insufficient_scope')
  })

  // work:report 폐지(2026-08-25) 이전에 발급된 토큰은 claim 없이 report 만 들고 있을 수 있다.
  // 판정부가 이를 work:claim 과 동등하게 받아주지 않으면 그 토큰이 그날로 끊긴다.
  it('옛 토큰(work:report 만) → work:claim 요구를 충족한다', async () => {
    useAdmin({
      integration_credentials: RUNNER.with({ scopes: ['work:read', 'work:report'] }).queue(),
      agent_work_orders: [{ data: { ...ORDER, status: 'ready' } }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).not.toBe(403)
  })

  // 옛 케이스 '레거시가 PAT 점유 주문 report → 403 not_claim_owner' 의 후신 — 시크릿 principal 은 소유 판정에 닿기 전에 401 이다.
  it('옛 시크릿 Bearer 로 PAT 점유 주문 report → 401 — 주문·보고 표에 닿지 않는다', async () => {
    const { admin } = useAdmin({
      integration_credentials: REPORT_SCOPES.queue(),
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'x', claimed_by_user_id: CRED_OWNER } }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', user_email: 'dev@example.com', kind: 'progress', percent: 10, summary: 's' }, LEGACY_SECRET), ctx)
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('PAT 본인 점유 report(progress) → 200, 실적 무변경(applied_to_wbs:false — 계약 v2.3)', async () => {
    useAdmin({
      integration_credentials: REPORT_SCOPES.queue(),
      agent_work_orders: [
        { data: { ...ORDER, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: CRED_OWNER, wbs_item_id: W1 } }, // 로드
        { data: [{ id: O1 }] }, // updated_at 갱신(progress)
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_reports: [{ data: [{ id: 'r-1' }] }], // 보고 insert
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.applied_to_wbs).toBe(false)
  })

  it('completion + evidence 형식 위반(head_sha 39자) → 400', async () => {
    useAdmin({ integration_credentials: REPORT_SCOPES.queue() })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, {
      agent: 'a', kind: 'completion', percent: 100, summary: 's', evidence: { head_sha: 'a'.repeat(39) },
    }, PAT.token), ctx)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('validation_failed')
  })

  it('PAT release — 타 사용자 점유 403, 본인 점유 200', async () => {
    const { admin: admin1 } = useAdmin({
      integration_credentials: CLAIM_SCOPES.queue(),
      agent_work_orders: [{ data: { ...ORDER, status: 'claimed', claimed_by: 'x', claimed_by_user_id: 'u-2' } }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    void admin1
    const res1 = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, { agent: 'a' }, PAT.token), ctx)
    expect(res1.status).toBe(403)
    expect((await res1.json()).code).toBe('not_claim_owner')

    const { rpcCalls } = useAdmin({
      integration_credentials: CLAIM_SCOPES.queue(),
      agent_work_orders: [
        { data: { ...ORDER, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: CRED_OWNER } },
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const res2 = await releasePOST(post(`http://l/api/v1/agent/work/${O1}/release`, { agent: 'a' }, PAT.token), ctx)
    expect(res2.status).toBe(200)
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'release', p_order_id: O1, p_agent_user_id: CRED_OWNER, p_agent: null })])
  })

  it('C1: 프로젝트 한정(P2) PAT 로 "멤버인" 타 프로젝트(P1) 주문 claim → 404(존재 은닉)', async () => {
    // 멤버십 큐(platform_admins/workspace_members/projects/project_members)를 채워둔다 — patProjectAllowed 가 없다면
    // 이 멤버십 판정까지 통과해 200이 나온다(회귀 시 이 테스트가 실패로 그것을 잡는다).
    useAdmin({
      integration_credentials: CLAIM_SCOPES_P2.queue(), // 조회, last_seen
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드(P1), CAS
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [{ data: null }], // 배정 확인(무배정)
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(404)
  })

  it('C1: 프로젝트 한정(P2) PAT 로 "멤버인" 타 프로젝트(P1) 주문 report → 404(존재 은닉)', async () => {
    useAdmin({
      integration_credentials: REPORT_SCOPES_P2.queue(),
      agent_work_orders: [
        { data: { ...ORDER, status: 'claimed', claimed_by: 'pat-r1', claimed_by_user_id: CRED_OWNER } }, // 로드
        { data: [{ id: O1 }] }, // updated_at 갱신(progress)
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, { agent: 'a', kind: 'progress', percent: 10, summary: 's' }, PAT.token), ctx)
    expect(res.status).toBe(404)
  })
})
