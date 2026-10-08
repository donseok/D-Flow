import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { loadDependsInfo } from '@/lib/agent/depends'
import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, ownerLookup } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_REF = 'MES/TSK-01-00'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4).
const RUNNER = agentCredential({ scopes: ['work:read', 'work:claim'] })
const PAT = { token: RUNNER.token }
const LEGACY_SECRET = 'legacy-secret'
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
const TARGET_ITEM = {
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: null, category: null, domain: null,
  priority: null, model: null, tags: null, depends: [DEP_REF], prd_ref: null, entry_point: null,
  acceptance: [], spec: null, assignee_member_id: null, planned_start: null, planned_end: null,
}
const ctx = { params: Promise.resolve({ id: O1 }) }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => ({ data: { ok: true, order_status: 'claimed', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }, error: null })),
    auth: {
      admin: {
        getUserById: vi.fn(ownerLookup()),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
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
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('claim 선행 게이트', () => {
  it('선행 stage=im → 통과(CAS 진행)', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [
        { data: ORDER }, // 주문 로드
        { data: null }, // 선행의 approved 주문 없음
        { data: [{ id: O1 }] }, // CAS 성공
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] },
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.depends_evidence).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: null, head_sha: null, order_approved: false, actual_pct: null, reached: true }])
  })

  it('선행 stage=ip → 403 dependency_not_met + unmet 배열', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [
        { data: ORDER },
        { data: null },
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip' }] },
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('dependency_not_met')
    expect(body.unmet).toEqual([{ external_ref: DEP_REF, stage: 'ip' }])
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  // 옛 케이스 '레거시 경로 + 선행 stage=ip → 403 dependency_not_met(동일 게이트 적용)' 의 후신 — 시크릿 경로가 삭제돼 게이트로 가는 길은
  // 위 토큰 경로 하나다. 옛 시크릿 Bearer 는 게이트에 닿기 전에 401 이고 주문·항목을 읽지 않는다.
  it('옛 시크릿 Bearer(env 에 AGENT_API_SECRET 설정) + body user_email → 401 — 선행 게이트·전이에 닿지 않는다', async () => {
    const admin = useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: null }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] },
      ],
    })
    const res = await claimPOST(
      post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }, LEGACY_SECRET),
      ctx,
    )
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('선행 ref 가 프로젝트에 없음 → 미충족(403) — fail-closed', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }], // depends 조회에서 ref 미발견 → 추가 주문 조회 없음
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [] }, // 프로젝트에 해당 external_ref 없음
      ],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('dependency_not_met')
    expect(body.unmet).toEqual([{ external_ref: DEP_REF, stage: null }])
  })

  it('depends 빈 배열·null → 게이트 없이 통과', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [{ data: { ...TARGET_ITEM, depends: null } }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)

    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [{ data: { ...TARGET_ITEM, depends: [] } }],
    })
    const res2 = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res2.status).toBe(200)
  })
})

// 승인이 반쪽으로 끝난 선행(approved 인데 stage 미전이)이 후속을 영구히 막던 교착 —
// 자동 루프가 스스로 못 푸는 조건이었다(리허설에서 3회 재발).
describe('선행 게이트 — approved 주문을 도달로 인정', () => {
  it("선행 stage='ip' 인데 approved 주문 있음 → claim 통과", async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [
        { data: ORDER },                    // 대상 주문
        { data: { id: 'ao-approved' } },    // loadDependsInfo 의 선행 approved 주문 조회
        { data: [{ id: O1 }] },             // claim CAS
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [
        { data: TARGET_ITEM },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip' }] },
      ],
      agent_work_reports: [{ data: { evidence: {} } }],
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).not.toBe(403)
  })
})

describe('depends_evidence', () => {
  it('선행의 최근 approved 주문 completion evidence 에서 branch·head_sha 추출, 없으면 null', async () => {
    const HEAD_SHA = 'a'.repeat(40)
    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }],
      agent_work_orders: [{ data: { id: 'ao-1' } }],
      agent_work_reports: [{ data: { evidence: { branch: 'main', head_sha: HEAD_SHA } } }],
    })
    const result1 = await loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] })
    expect(result1).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: 'main', head_sha: HEAD_SHA, order_approved: true, actual_pct: null, reached: true }])

    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }],
      agent_work_orders: [{ data: null }], // approved 주문 없음
    })
    const result2 = await loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] })
    expect(result2).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: null, head_sha: null, order_approved: false, actual_pct: null, reached: true }])
  })
})

describe('loadDependsInfo — reached(계약 v2.3, 스펙 2026-09-15 §3.7)', () => {
  it('stage 가 null 이어도 실적 100 이면 reached — 위임하지 않은 사람 Task', async () => {
    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: null, actual_pct: 100 }] }],
      agent_work_orders: [{ data: null }],
    })
    const [d] = await loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] })
    expect(d).toMatchObject({ stage: null, actual_pct: 100, order_approved: false, reached: true })
  })
  it('stage ip·실적 30·미승인이면 reached:false, 프로젝트에 없는 ref 도 false', async () => {
    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip', actual_pct: 30 }] }],
      agent_work_orders: [{ data: null }],
    })
    const res = await loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF, 'MES/GONE'] })
    expect(res.map(d => d.reached)).toEqual([false, false])
    expect(res[1]).toMatchObject({ external_ref: 'MES/GONE', actual_pct: null, reached: false })
  })
})

// 조회 실패를 "데이터 없음"으로 위장하지 않는다(에러 처리 3원칙 ①). 같은 함수의 items 조회는
// 이미 던지는데 주문·보고 조회만 error 를 버려서, 조회가 깨진 것과 선행이 미승인인 것이
// 똑같이 order_approved:false·head_sha:null 로 나왔다 — 실제 추적이 여기서 헤맸다.
describe('loadDependsInfo — 조회 실패 위장 금지', () => {
  it('선행 주문 조회가 실패하면 던진다', async () => {
    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }],
      agent_work_orders: [{ data: null, error: { message: 'order boom' } }],
    })
    await expect(loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] }))
      .rejects.toThrow('order boom')
  })

  it('선행 완료 보고 조회가 실패하면 던진다', async () => {
    useAdmin({
      wbs_items: [{ data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }],
      agent_work_orders: [{ data: { id: 'ao-1' } }],
      agent_work_reports: [{ data: null, error: { message: 'report boom' } }],
    })
    await expect(loadDependsInfo(mocks.createAdminClient(), { projectId: P1, depends: [DEP_REF] }))
      .rejects.toThrow('report boom')
  })
})
