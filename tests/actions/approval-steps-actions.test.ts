import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SP5b W1 — 승인 액션 셋의 다단계 경로(스펙 D18·§4.2). 대기 단계의 승인자가 가드를 고르고(admin → requireProjectAdmin,
 * subtree_or_admin → requireCompletionApprover), 화면이 본 단계(expectedStep)를 RPC 에 p_expected_step 으로 넘긴다. 중간 단계는
 * 검토 기록(review_action)을 쓰지 않고 work.approval_step 알림만 낸다. 대기 단계 판독(loadApprovalState)은 전역 셋업의 mock 을 덮는다.
 */
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  resolveProjectId: vi.fn(),
  requireCompletionApprover: vi.fn(),
  requireSubtreeManagerOrAdmin: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin, requireProjectMember: mocks.requireProjectMember, resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/agent/subtreeManager', () => ({
  requireCompletionApprover: mocks.requireCompletionApprover, requireSubtreeManagerOrAdmin: mocks.requireSubtreeManagerOrAdmin,
}))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn(async () => {}) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig() as Record<string, unknown>), after: (fn: () => unknown) => { void fn() } }))

import { approveAgentCompletion } from '@/app/actions/agentWork'
import { approveWbsStep, setWbsStage } from '@/app/actions/wbsAssign'
import { loadApprovalState, notifyApprovalStep } from '@/lib/agent/approvalState'
import { REASON_TEXT } from '@/lib/agent/workflowEvent'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const TWO = [{ code: 'internal', label: '내부 검토', approver: 'subtree_or_admin' as const }, { code: 'client', label: '고객 승인', approver: 'admin' as const }]
const pending = (step: 'internal' | 'client') => ({
  ok: true as const, steps: TWO, stage: 'im',
  pending: step === 'internal' ? { step, index: 1, total: 2, approver: 'subtree_or_admin' as const } : { step, index: 2, total: 2, approver: 'admin' as const },
})
const RPC_BASE = { ok: true, stage: 'im', actual_pct: 80, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }

type Resp = { data?: unknown; error?: { message: string } | null }
function fakeAdmin(queues: Record<string, Resp[]>, rpc: Record<string, unknown>) {
  const updates: { table: string; payload: Record<string, unknown> }[] = []
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'limit', 'order', 'eq', 'is']) b[k] = () => b
      b.update = (payload: Record<string, unknown>) => { updates.push({ table, payload }); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => ({ data: rpc, error: null })),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, updates }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'member-1' } })
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.requireCompletionApprover.mockResolvedValue({ ok: true, actor: { userId: 'mgr-1' }, isAdmin: false })
  mocks.requireSubtreeManagerOrAdmin.mockResolvedValue({ ok: true, actor: { userId: 'mgr-1' }, isAdmin: false })
  const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: P1 }, error: null }) }) }) }) }
  mocks.createServerClient.mockResolvedValue(sb)
})

describe('approveAgentCompletion — 다단계', () => {
  it('첫 단계(subtree_or_admin) — 승인 가드, p_expected_step 동봉, 중간이면 검토 기록 없이 work.approval_step·remaining', async () => {
    vi.mocked(loadApprovalState).mockResolvedValueOnce(pending('internal'))
    const { admin, updates } = fakeAdmin(
      { agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null } }], agent_work_reports: [{ data: { id: R1 } }] },
      { ...RPC_BASE, order_status: 'reported', approval: { round: 1, step_code: 'internal', remaining: 1 } })
    expect(await approveAgentCompletion(O1, R1, 'internal')).toEqual({ ok: true, remaining: 1 })
    expect(mocks.requireCompletionApprover).toHaveBeenCalledWith(W1, P1, { claimedByUserId: null })
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'approve', p_actor: 'mgr-1', p_expected_step: 'internal' }))
    expect(updates.filter((u) => u.table === 'agent_work_reports')).toEqual([])
    expect(notifyApprovalStep).toHaveBeenCalledWith(admin, expect.objectContaining({ projectId: P1, itemId: W1, nextIndex: 2, total: 2 }))
    expect(mocks.emitNotification).not.toHaveBeenCalled()   // work.approved 는 마지막 단계에서만
  })
  it('admin 단계 — requireProjectAdmin 이 가드다(서브트리 관리자 경로를 타지 않는다)', async () => {
    vi.mocked(loadApprovalState).mockResolvedValueOnce(pending('client'))
    mocks.requireProjectAdmin.mockResolvedValueOnce({ ok: false, error: '관리자만' })
    fakeAdmin({ agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null } }] }, RPC_BASE)
    expect(await approveAgentCompletion(O1, R1, 'client')).toEqual({ ok: false, error: '관리자만' })
    expect(mocks.requireCompletionApprover).not.toHaveBeenCalled()
  })
  it('화면이 본 단계가 지금 대기 단계가 아니면 쓰기 전에 stale', async () => {
    vi.mocked(loadApprovalState).mockResolvedValueOnce(pending('client'))
    const { admin } = fakeAdmin({ agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null } }] }, RPC_BASE)
    expect(await approveAgentCompletion(O1, R1, 'internal')).toEqual({ ok: false, stale: true, error: REASON_TEXT.approval_stale })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('RPC approval_stale → stale 로 알린다(새로고침 안내)', async () => {
    vi.mocked(loadApprovalState).mockResolvedValueOnce(pending('internal'))
    fakeAdmin({ agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null } }], agent_work_reports: [{ data: { id: R1 } }] },
      { ok: false, reason: 'approval_stale', order_status: 'reported' })
    expect(await approveAgentCompletion(O1, R1, 'internal')).toEqual({ ok: false, stale: true, error: REASON_TEXT.approval_stale })
  })
  it('대기 단계 판독 실패 → 거부(fail-closed), 가드·RPC 없음', async () => {
    vi.mocked(loadApprovalState).mockResolvedValueOnce({ ok: false, error: '판독 실패' })
    const { admin } = fakeAdmin({ agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null } }] }, RPC_BASE)
    expect(await approveAgentCompletion(O1, R1)).toEqual({ ok: false, error: '판독 실패' })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(mocks.requireCompletionApprover).not.toHaveBeenCalled()
  })
  it('expectedStep 모양이 틀리면 거부', async () => {
    expect(await approveAgentCompletion(O1, R1, 'Bad Step')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

describe('approveWbsStep·setWbsStage(xx) — 사람 경로', () => {
  it('approveWbsStep — 멤버 가드 → 대기 단계 → 승인자 가드 순, approve_step 사건', async () => {
    const order: string[] = []
    mocks.requireProjectMember.mockImplementationOnce(async () => { order.push('member'); return { ok: true, actor: { userId: 'member-1' } } })
    vi.mocked(loadApprovalState).mockImplementationOnce(async () => { order.push('state'); return pending('internal') })
    mocks.requireCompletionApprover.mockImplementationOnce(async () => { order.push('approver'); return { ok: true, actor: { userId: 'mgr-1' }, isAdmin: false } })
    const { admin } = fakeAdmin({}, { ...RPC_BASE, approval: { round: 1, step_code: 'internal', remaining: 1 } })
    expect(await approveWbsStep(W1, 'internal')).toEqual({ ok: true, remaining: 1 })
    expect(order).toEqual(['member', 'state', 'approver'])
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'approve_step', p_item_id: W1, p_actor: 'mgr-1', p_expected_step: 'internal' }))
    expect(notifyApprovalStep).toHaveBeenCalledTimes(1)
  })
  it('approveWbsStep — 멤버가 아니면 대기 단계를 읽지 않는다(가드 앞 service_role 읽기 없음)', async () => {
    mocks.requireProjectMember.mockResolvedValueOnce({ ok: false, error: '멤버 아님' })
    fakeAdmin({}, RPC_BASE)
    expect(await approveWbsStep(W1, 'internal')).toEqual({ ok: false, error: '멤버 아님' })
    expect(loadApprovalState).not.toHaveBeenCalled()
  })
  it('setWbsStage(xx) — 서브트리 관리자 가드가 아니라 승인 가드(자기 승인 금지 — §8 #3)', async () => {
    vi.mocked(loadApprovalState).mockResolvedValueOnce({ ok: true, steps: [], stage: 'ip', pending: { step: 'review', index: 1, total: 1, approver: 'subtree_or_admin' } })
    mocks.requireCompletionApprover.mockResolvedValueOnce({ ok: false, error: '자기 담당' })
    const { admin } = fakeAdmin({}, RPC_BASE)
    expect(await setWbsStage(W1, 'xx')).toEqual({ ok: false, error: '자기 담당' })
    expect(mocks.requireSubtreeManagerOrAdmin).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('setWbsStage(ip) — 현행 서브트리 관리자 가드, 대기 단계를 읽지 않는다', async () => {
    const { admin } = fakeAdmin({}, { ...RPC_BASE, stage: 'ip' })
    expect(await setWbsStage(W1, 'ip')).toEqual({ ok: true })
    expect(loadApprovalState).not.toHaveBeenCalled()
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.not.objectContaining({ p_expected_step: expect.anything() }))
  })
})
