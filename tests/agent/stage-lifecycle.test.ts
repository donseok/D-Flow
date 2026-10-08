import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 단계 전이 배선. 라우트(claim·완료 보고)는 원자 전이 RPC(apply_workflow_event, 0096)를 한 번 부르고
 * 단계·실적 계산은 DB 가 한다(스펙 2026-09-15 §4) — 여기서는 사건 인자·부수효과(스냅샷)·실패 처리를 본다.
 * 승인·반려 액션도 같은 RPC 를 사건만 바꿔 부른다.
 * 신원은 자격증명(integration_credentials 의 agent_runner 행) 소유자다 — useAdmin 이 기본 자격증명 큐를 싣는다(SP7 §5.1.4).
 */

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
  requireProjectAdmin: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin }))
// 반려는 loadOrderForReview → requireDelegationRight(관리자 또는 담당자 본인)로 판정한다(2026-09-14). 여기선 관리자 통과로 고정.
vi.mock('@/lib/agent/delegation', () => ({
  requireDelegationRight: vi.fn(async () => ({ ok: true, actor: { userId: 'admin-1' }, projectId: '11111111-1111-4111-8111-111111111111', isAdmin: true })),
}))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { POST as reportPOST } from '@/app/api/v1/agent/work/[id]/report/route'
import { approveAgentCompletion, rejectAgentCompletion } from '@/app/actions/agentWork'
import { ERR_TRANSITION_RPC } from '@/lib/agent/workflowEvent'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_OWNER, ownerLookup } from '../fixtures/credentials'

const CRED = agentCredential()
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_REF = 'MES/TSK-01-00'
const R9 = '99999999-9999-4999-8999-999999999999' // 화면이 본 최신 completion 보고
const USER = { id: CRED_OWNER, email: 'dev@example.com' } // 토큰 소유자

type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }
type Captured = { op: 'update' | 'insert'; payload: unknown }
/** 전이 RPC 기본 응답 — 부수효과(스냅샷·도달 알림)가 없는 성공. 케이스마다 queues.rpc 로 덮는다. */
const RPC_OK = { ok: true, order_status: 'claimed', stage: 'ip', actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }

function useAdmin(queues: Record<string, Resp[]>) {
  queues = { integration_credentials: CRED.queue(), ...queues }
  const captured: Record<string, Captured[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'delete', 'eq', 'in', 'order', 'limit', 'contains', 'range']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push({ op: 'update', payload }); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push({ op: 'insert', payload }); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
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
  return { admin, captured }
}

const post = (url: string, body: unknown) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRED.token}` },
  body: JSON.stringify(body),
})
const ctx = { params: Promise.resolve({ id: O1 }) }
const member = () => ({
  ...credAxes([P1]),
  project_members: [roster(rosterRow(P1, 'member'))],
})

const ITEM_ROW = (overrides: Record<string, unknown> = {}) => ({
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: 'as', category: null, domain: null,
  priority: null, model: null, tags: null, depends: [], prd_ref: null, entry_point: null,
  acceptance: [], spec: null, assignee_member_id: null, planned_start: null, planned_end: null,
  ...overrides,
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('claim → 전이 RPC(claim 사건)', () => {
  const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
  const claim = () => claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: USER.email, agent: 'claude-cli' }), ctx)

  it('claim 성공 → 전이 RPC 를 claim 사건으로 한 번 부르고, 주문에 직접 쓰는 것은 재개 표식 정리뿐이다', async () => {
    const { admin, captured } = useAdmin({ agent_work_orders: [{ data: ORDER }], ...member(), wbs_items: [{ data: ITEM_ROW() }] })
    const res = await claim()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'claim', p_order_id: O1, p_agent: 'claude-cli', p_agent_user_id: USER.id, p_actor: USER.id,
    }))
    expect(captured.wbs_items).toBeUndefined()
    // 상태·점유·단계·실적은 여전히 RPC 만 쓴다. 라우트가 직접 쓰는 것은 전이가 아닌
    // 재개 표식(0099)의 정리 한 건뿐이며, 그것도 전이가 성공한 뒤에만 간다.
    expect(captured.agent_work_orders).toEqual([
      { op: 'update', payload: { resume_requested_at: null, resume_requested_by: null, resume_requested_host: null } },
    ])
  })

  it('실적이 바뀐 전이면 진척 스냅샷을 남긴다', async () => {
    useAdmin({
      agent_work_orders: [{ data: ORDER }], ...member(), wbs_items: [{ data: ITEM_ROW() }],
      rpc: [{ data: { ...RPC_OK, actual_pct: 30, stage_changed: true, actual_changed: true } }],
    })
    const res = await claim()
    expect(res.status).toBe(200)
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1, expect.anything())
  })

  it('선행 미충족(403) 이면 전이 RPC 를 부르지 않는다', async () => {
    const { admin } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }], // 로드, 선행의 approved 주문 없음
      ...member(),
      wbs_items: [
        { data: ITEM_ROW({ depends: [DEP_REF] }) },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'ip', actual_pct: 30 }] }, // 선행이 아직 ip·30 — 미충족
      ],
    })
    const res = await claim()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('dependency_not_met')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('선행이 stage 없이 실적 100 이면 충족 — 위임하지 않은 사람 Task(스펙 §3.7)', async () => {
    const { admin } = useAdmin({
      agent_work_orders: [{ data: ORDER }, { data: null }],
      ...member(),
      wbs_items: [
        { data: ITEM_ROW({ depends: [DEP_REF] }) },
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: null, actual_pct: 100 }] },
      ],
    })
    const res = await claim()
    expect(res.status).toBe(200)
    expect(admin.rpc).toHaveBeenCalledTimes(1)
  })

  it('전이 RPC 가 오류면 500 — 점유·단계·실적이 한 트랜잭션이라 반쪽 상태가 남지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({ agent_work_orders: [{ data: ORDER }], ...member(), wbs_items: [{ data: ITEM_ROW() }], rpc: [{ error: { message: 'db down' } }] })
    const res = await claim()
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })
})

describe('completion 보고 → 전이 RPC(report_completion 사건)', () => {
  const CLAIMED = {
    id: O1, project_id: P1, status: 'claimed', claimed_by: 'cli-1', claimed_by_user_id: USER.id, wbs_item_id: W1,
  }
  const reportBody = (kind: 'progress' | 'completion', percent: number) => ({
    user_email: USER.email, agent: 'cli-1', kind, percent, summary: '요약',
    links: [{ url: 'https://github.com/x/pr/1' }],
  })

  it('completion 성공 → report_completion 사건 한 번(점유자 계정 일치 조건 — 라벨은 넘기지 않는다), 항목을 직접 쓰지 않는다', async () => {
    const { admin, captured } = useAdmin({
      agent_work_orders: [{ data: CLAIMED }],
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...member(),
      wbs_items: [{ data: { name: '항목1' } }], // 알림용 이름 조회
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, reportBody('completion', 100)), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reported')
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({
      p_event: 'report_completion', p_order_id: O1, p_agent: null, p_agent_user_id: USER.id, p_actor: USER.id,
    }))
    expect((captured.wbs_items ?? []).filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('progress 보고는 전이 RPC 도, WBS 쓰기도 하지 않는다(계약 v2.3)', async () => {
    const { admin, captured } = useAdmin({
      agent_work_orders: [{ data: CLAIMED }, { data: [{ id: O1 }] }], // 로드, updated_at 갱신
      agent_work_reports: [{ data: [{ id: 'r1' }] }],
      ...member(),
    })
    const res = await reportPOST(post(`http://l/api/v1/agent/work/${O1}/report`, reportBody('progress', 40)), ctx)
    expect(res.status).toBe(200)
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(captured.wbs_items).toBeUndefined()
  })
})

describe('승인·반려 액션 → 전이 RPC(approve·reject 사건)', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

  beforeEach(() => {
    mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  })

  it('승인 → approve 사건 한 번(단계 xx·실적 100 은 DB 가 함께 쓴다), 항목을 직접 쓰지 않는다', async () => {
    const { admin, captured } = useAdmin({
      agent_work_orders: [{ data: ORDER }],                                   // loadOrderForAdmin 조회
      agent_work_reports: [{ data: { id: R9 } }, { data: [{ id: R9 }] }],   // 최신 completion 대조, review 기록
      wbs_items: [{ data: { name: '항목1', assignee_member_id: null } }],      // 알림용 조회(배정자 없음)
      rpc: [{ data: { ...RPC_OK, order_status: 'approved', stage: 'xx', actual_pct: 100, stage_changed: true, actual_changed: true } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r).toEqual({ ok: true })
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'approve', p_order_id: O1, p_actor: 'admin-1' }))
    expect((captured.wbs_items ?? []).filter((c) => c.op === 'update')).toHaveLength(0)
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1)
  })

  it('반려 → reject 사건 한 번(단계 ip·실적 표.rw)', async () => {
    const { admin } = useAdmin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: [{ data: { id: R9 } }, { data: [{ id: R9 }] }],
      wbs_items: [{ data: { name: '항목1', assignee_member_id: null } }],
    })
    const r = await rejectAgentCompletion(O1, '보완 필요', R9)
    expect(r.ok).toBe(true)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'reject', p_order_id: O1 }))
  })

  it('전이 RPC 가 오류면 승인 실패로 알린다 — 주문·단계·실적이 한 트랜잭션이라 반쪽 상태가 없다', async () => {
    const { captured } = useAdmin({ agent_work_orders: [{ data: ORDER }], agent_work_reports: [{ data: { id: R9 } }], rpc: [{ error: { message: 'db down' } }] })
    const r = await approveAgentCompletion(O1, R9)
    expect(r).toEqual({ ok: false, error: ERR_TRANSITION_RPC }) // DB 문구는 로그에만(workflow-event.test.ts)
    // 보고는 전이 전에 대조만 했다(읽기) — 검토 기록(쓰기)은 전이가 확정된 뒤에만 간다.
    expect(captured.agent_work_reports).toBeUndefined()
  })
})
