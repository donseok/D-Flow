import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  requireDelegationRight: vi.fn(),
  myMemberIds: vi.fn(),
  isSubtreeManager: vi.fn(),
  subtreeStanding: vi.fn(),
  recordProgressSnapshot: vi.fn(async () => {}),
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
}))
// 반려·승인 취소·재작업 요청은 loadOrderForReview → requireDelegationRight(관리자 또는 담당자 본인)로 판정한다(2026-09-14).
vi.mock('@/lib/agent/delegation', () => ({ requireDelegationRight: mocks.requireDelegationRight }))
// 승인은 requireCompletionApprover(관리자, 또는 서브트리 관리자이면서 리프 담당자·claim 계정이 아닌 사람 — AUTH-07a),
// 반려 계열의 관리자·담당자 본인 실패 시 폴백은 requireSubtreeManagerOrAdmin(트랙 B, 2026-09-15)이 판정한다.
// subtreeManager.ts 는 실제 모듈을 쓰고(delegation.ts 와 분리돼 있어 가벼움) 그 내부가 부르는
// myMemberIds·isSubtreeManager·subtreeStanding 만 목킹한다.
vi.mock('@/lib/agent/assignee', () => ({
  myMemberIds: mocks.myMemberIds, isSubtreeManager: mocks.isSubtreeManager, subtreeStanding: mocks.subtreeStanding,
}))
// 승인·반려·되감기는 원자 전이 RPC(apply_workflow_event, 0096)로 주문·단계·실적을 한 번에 쓴다 —
// admin(...) 목의 rpc 가 그 응답을 흉내 낸다. after 는 요청 스코프 밖(vitest)에서 던지므로
// stage-lifecycle.test.ts 와 같은 패턴으로 즉시 실행 shim 을 씌운다.
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/server', async orig => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))
import {
  approveAgentCompletion, rejectAgentCompletion, getAgentOrderForItem,
  unapproveAgentCompletion, requestAgentRework,
} from '@/app/actions/agentWork'
import { emitNotification } from '@/lib/notify/emit'
import { ERR_SELF_APPROVAL } from '@/lib/agent/subtreeManager'
import { ERR_TRANSITION_RPC } from '@/lib/agent/workflowEvent'

// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
/** 화면이 본 최신 completion 보고 — 승인·반려는 이 id 를 서버의 최신과 대조한다(H1 Task 11). */
const R9 = '99999999-9999-4999-8999-999999999999'

type Resp = { data?: unknown; error?: { message: string } | null }
/** 전이 RPC 기본 응답 — 부수효과(스냅샷·도달 알림) 없는 성공. 케이스마다 queues.rpc 로 덮는다. */
const RPC_OK = { ok: true, order_status: null, stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  /** 테이블별 select 열 문자열 — 스텁은 열과 무관하게 응답하므로 열이 빠졌는지는 여기서 본다. */
  const selects: Record<string, string[]> = {}
  const rpcCalls: Array<Record<string, unknown>> = []
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['delete', 'eq', 'gte', 'in', 'order', 'limit', 'contains']) b[k] = () => b
      b.select = (cols: string) => { (selects[table] ??= []).push(cols); return b }
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async (...callArgs: unknown[]) => {
      rpcCalls.push(callArgs[1] as Record<string, unknown>)
      const resp = (queues.rpc ?? []).shift() ?? { data: RPC_OK }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, captured, rpcCalls, selects }
}
const ACTOR = { ok: true, actor: { userId: 'admin-1' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue(ACTOR)
  mocks.requireProjectMember.mockResolvedValue(ACTOR)
  // 기본은 관리자 통과 — 개별 테스트가 담당자 본인·거부로 바꾼다.
  mocks.requireDelegationRight.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' }, projectId: P1, isAdmin: true })
  // 서브트리 관리자 경로 기본값 — 개별 테스트가 필요할 때만 override. 기본은 "아니다" 쪽으로
  // 안전하게 둔다(관리자 fast path 가 대부분의 테스트를 그 전에 통과시킨다).
  mocks.myMemberIds.mockResolvedValue([])
  mocks.isSubtreeManager.mockResolvedValue(false)
  mocks.subtreeStanding.mockResolvedValue({ manager: false, leafFound: true, leafAssigneeMemberId: null })
})

const REPORTS = () => [{ data: { id: R9 } }, { data: [{ id: R9 }] }] // 최신 completion, review 기록

describe('approveAgentCompletion', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null }
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await approveAgentCompletion('invalid-id', R9)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('승인 → 전이 RPC(approve 사건) 한 번 + 보고 review 기록, 실적·단계를 앱이 직접 쓰지 않는다', async () => {
    const { captured, rpcCalls } = admin({
      agent_work_orders: [{ data: ORDER }], // loadOrderForAdmin 조회
      agent_work_reports: REPORTS(),
      rpc: [{ data: { ...RPC_OK, order_status: 'approved', stage: 'xx', actual_pct: 100, stage_changed: true, actual_changed: true } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r).toEqual({ ok: true })
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'approve', p_order_id: O1, p_actor: 'admin-1' })])
    expect(captured.agent_work_reports?.[0]).toMatchObject({ review_action: 'approve', reviewed_by: 'admin-1' })
    expect(captured.wbs_items).toBeUndefined()
    expect(captured.change_logs).toBeUndefined()
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1)
  })
  it('실적이 이미 100 이라 바뀌지 않았으면 스냅샷을 남기지 않는다', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      rpc: [{ data: { ...RPC_OK, order_status: 'approved', stage: 'xx', actual_pct: 100, stage_changed: true, actual_changed: false } }],
    })
    expect((await approveAgentCompletion(O1, R9)).ok).toBe(true)
    expect(mocks.recordProgressSnapshot).not.toHaveBeenCalled()
  })
  it('경합(RPC conflict) → 재시도 문구, review 기록·알림 없음 — CAS 가 지면 아무것도 쓰이지 않는다', async () => {
    const { captured } = admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      rpc: [{ data: { ok: false, conflict: true, order_status: 'claimed' } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r).toEqual({ ok: false, error: '상태가 바뀌어 승인하지 못했습니다. 다시 시도하세요.' })
    expect(captured.agent_work_reports).toBeUndefined()
    expect(emitNotification).not.toHaveBeenCalled()
  })
  it('RPC 오류 → 고정 문구로 알린다 — DB 문구는 화면에 싣지 않고 로그에만 남긴다', async () => {
    admin({ agent_work_orders: [{ data: ORDER }], agent_work_reports: REPORTS(), rpc: [{ error: { message: 'db down' } }] })
    expect(await approveAgentCompletion(O1, R9)).toEqual({ ok: false, error: ERR_TRANSITION_RPC })
  })
  it('wbs_item 삭제된 주문은 승인 불가 — 사람이 취소로 정리', async () => {
    const { rpcCalls } = admin({ agent_work_orders: [{ data: { ...ORDER, wbs_item_id: null } }] })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(false)
    expect(rpcCalls).toHaveLength(0)
  })
  it('배정자에게 work.approved 발행', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1' } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.approved', projectId: P1, actorUserId: 'admin-1',
      entityType: 'agent_order', entityId: O1,
      recipientMemberIds: ['m-1'],
    }))
  })
  it('배정자 없으면 발행 생략', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      wbs_items: [{ data: { name: '로그인', assignee_member_id: null } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(true)
    expect(emitNotification).not.toHaveBeenCalled()
  })
  // 종전에는 skipped 중 'stage' 만 문구를 달고 'parent' 는 무음이었다 — 상위 항목에 나간 주문을
  // 승인하면 승인은 성공인데 단계만 뒤처진 반쪽 상태가 화면에 아무 흔적도 남기지 않았다.
  it("하위 항목이 있어 단계·실적을 건너뛰면 warning 으로 알린다 — skipped:'parent' 무음 금지", async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      rpc: [{ data: { ...RPC_OK, order_status: 'approved', skipped: 'parent' } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('하위 항목')
  })
  it('건너뛴 사유를 모르는 값이어도 무음으로 끝내지 않는다 — 사유별 분기가 아니라 skipped 자체가 조건', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      rpc: [{ data: { ...RPC_OK, order_status: 'approved', skipped: 'something_new' } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('something_new')
  })
  it('승인: 관리자도 리프 담당자도 아니지만 서브트리 관리자면 허용(트랙 B) — 전이가 그 행위자로 실행된다', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.subtreeStanding.mockResolvedValue({ manager: true, leafFound: true, leafAssigneeMemberId: null })
    const { rpcCalls } = admin({ agent_work_orders: [{ data: ORDER }], agent_work_reports: REPORTS() })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(true)
    expect(mocks.subtreeStanding).toHaveBeenCalledWith(
      expect.anything(), { itemId: W1, projectId: P1, myMemberIds: ['anc-member'] },
    )
    // 실적 쓰기가 담당 팀 게이트(updateActual)를 거치지 않아 서브트리 관리자(개인 축 자격)여도 실제로 반영된다 —
    // change_logs 의 user_id 는 RPC 가 p_actor 로 남긴다.
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'approve', p_actor: 'anc-1' })])
  })
  it('승인: 조상 조회(subtreeStanding)가 throw 하면 거부 — fail-closed, 전이 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.subtreeStanding.mockRejectedValue(new Error('조상 조회 실패: boom'))
    const { rpcCalls } = admin({ agent_work_orders: [{ data: ORDER }] })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(false)
    expect(rpcCalls).toHaveLength(0)
  })
  it('승인의 work.unblocked 는 im·xx 첫 도달(reachedFirst)일 때만 — 검수 대기(im)에서 온 승인은 새 도달이 아니다', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1' } }], // 알림용 항목 조회
      rpc: [{ data: { ...RPC_OK, order_status: 'approved', stage: 'xx', stage_changed: true, reached_first: false } }],
    })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(true)
    expect(emitNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'work.unblocked' }))
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'work.approved' }))
  })
})

describe('rejectAgentCompletion', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await rejectAgentCompletion('invalid-id', '사유', R9)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('잘못된 요청입니다.')
  })
  it('사유 없으면 거부', async () => {
    const r = await rejectAgentCompletion(O1, '   ', R9)
    expect(r.ok).toBe(false)
  })
  it('성공 시 전이 RPC(reject 사건 — 단계 ip·실적 표.rw) + review 기록(사유 보존)', async () => {
    const { captured, rpcCalls } = admin({ agent_work_orders: [{ data: ORDER }], agent_work_reports: REPORTS() })
    const r = await rejectAgentCompletion(O1, '거절 사유', R9)
    expect(r.ok).toBe(true)
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'reject', p_order_id: O1 })])
    expect(captured.agent_work_reports?.[0]).toMatchObject({ review_action: 'reject', review_note: '거절 사유' })
  })
  it('경합(RPC conflict) → 반려 실패 문구, review 기록 없음', async () => {
    const { captured } = admin({ agent_work_orders: [{ data: ORDER }], agent_work_reports: REPORTS(), rpc: [{ data: { ok: false, conflict: true, order_status: 'approved' } }] })
    expect(await rejectAgentCompletion(O1, '사유', R9)).toEqual({ ok: false, error: '상태가 바뀌어 반려하지 못했습니다.' })
    expect(captured.agent_work_reports).toBeUndefined()
  })
  it('배정자에게 work.rejected 발행', async () => {
    admin({
      agent_work_orders: [{ data: ORDER }],
      agent_work_reports: REPORTS(),
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1' } }],
    })
    const r = await rejectAgentCompletion(O1, '거절 사유', R9)
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.rejected', projectId: P1, actorUserId: 'admin-1',
      entityType: 'agent_order', entityId: O1,
      recipientMemberIds: ['m-1'],
    }))
  })
})

describe('getAgentOrderForItem — 명세 패널 진행 상황(2026-08-24, agent-ops 대체)', () => {
  it('비형식 itemId 거부', async () => {
    const r = await getAgentOrderForItem('invalid-id')
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('항목 없음 → 대상을 찾을 수 없습니다', async () => {
    const sb = { from: vi.fn(() => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: null, error: null }); return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
  })
  it('프로젝트 멤버 아니면 거부', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const sb = { from: vi.fn(() => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null }); return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r).toEqual({ ok: false, error: '멤버 아님' })
  })
  it('위임한 적 없음(주문 0건) → order:null', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    let call = 0
    const sb = { from: vi.fn(() => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => {
        call += 1
        return { data: { project_id: P1 }, error: null } // wbs_items
      }
      // 주문 조회는 limit(1)+maybeSingle 이 아니라 목록이다 — 빌더를 그대로 await 한다.
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r).toEqual({ ok: true, order: null, priorOrders: [], projectId: P1 })
    expect(call).toBeGreaterThan(0)
  })
  it('주문 있음 → 최신 주문 + 보고 이력', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    const sb = { from: vi.fn((table: string) => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit', 'in']) b[k] = () => b
      if (table === 'wbs_items') b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null })
      else if (table === 'agent_work_orders') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [{ id: O1, status: 'reported', claimed_by: 'agent-x', claimed_at: '2026-08-24T00:00:00Z', updated_at: '2026-08-24T01:00:00Z' }],
          error: null,
        }).then(r)
      } else if (table === 'agent_work_reports') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [{ id: 'r1', kind: 'completion', percent: 100, summary: '완료', links: [], agent: 'agent-x',
            review_action: null, review_note: null, created_at: '2026-08-24T01:00:00Z' }],
          error: null,
        }).then(r)
      }
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.order?.id).toBe(O1)
      expect(r.order?.status).toBe('reported')
      expect(r.order?.reports).toHaveLength(1)
      expect(r.priorOrders).toEqual([])
    }
  })
  // 재발행 — approved 는 "활성 주문" 검사 어디에도 안 들어가므로 항목에 주문이 쌓인다.
  // 최신 하나만 읽던 종전 구현은 그 앞의 승인 이력을 통째로 감췄다(2026-08-27 감사).
  it('주문이 여러 개면 최신 하나를 order 로, 나머지를 priorOrders 로 준다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    const sb = { from: vi.fn((table: string) => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit', 'in']) b[k] = () => b
      if (table === 'wbs_items') b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null })
      else if (table === 'agent_work_orders') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [
            { id: O1, status: 'ready', claimed_by: null, claimed_at: null, updated_at: '2026-08-27T02:00:00Z' },
            { id: 'o-old', status: 'approved', claimed_by: 'agent-x', claimed_at: null, updated_at: '2026-08-26T02:00:00Z' },
          ],
          error: null,
        }).then(r)
      } else if (table === 'agent_work_reports') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      }
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    const r = await getAgentOrderForItem(W1)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.order?.id).toBe(O1)
      expect(r.priorOrders).toEqual([
        { id: 'o-old', status: 'approved', updated_at: '2026-08-26T02:00:00Z' },
      ])
    }
  })
})

/**
 * 승인을 무르는 두 경로(2026-08-27) — 승인 취소(approved→reported)와 재작업 요청(approved→claimed).
 * 주문·단계·실적은 전이 RPC(unapprove·rework 사건)가 한 트랜잭션으로 쓴다: 승인 취소 = im·표.im,
 * 재작업 = ip·표.rw(스펙 2026-09-15 §3.4). 여기서는 사건 인자·리뷰 기록·알림·실패 처리를 본다.
 * 종전의 change_logs 기반 실적 복원(이력 불일치·부재면 warning)은 사건 크레딧으로 대체돼 사라졌다.
 */
const APPROVED = { id: O1, project_id: P1, status: 'approved', wbs_item_id: W1 }
/** 승인된 주문 + 최신 완료 보고(리뷰 기록 대상) + 알림용 항목(배정자 m-1). */
function approvedQueues(over: Record<string, Resp[]> = {}) {
  return {
    agent_work_orders: [{ data: APPROVED }],
    agent_work_reports: REPORTS(),
    wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1' } }],
    ...over,
  }
}

describe('unapproveAgentCompletion — 승인 취소(approved→reported)', () => {
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await unapproveAgentCompletion('invalid-id')
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('approved 아닌 주문은 거부', async () => {
    const { rpcCalls } = admin({ agent_work_orders: [{ data: { ...APPROVED, status: 'reported' } }] })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('reported')
    expect(rpcCalls).toHaveLength(0)
  })
  it('성공 — 전이 RPC(unapprove 사건) + 리뷰 필드 전부 해제, 앱이 실적·단계를 직접 쓰지 않는다', async () => {
    const { captured, rpcCalls } = admin(approvedQueues({
      rpc: [{ data: { ...RPC_OK, order_status: 'reported', stage: 'im', actual_pct: 80, stage_changed: true, actual_changed: true } }],
    }))
    const r = await unapproveAgentCompletion(O1)
    expect(r).toEqual({ ok: true })
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'unapprove', p_order_id: O1, p_actor: 'admin-1' })])
    expect(captured.agent_work_reports?.[0]).toMatchObject({
      review_action: null, reviewed_by: null, reviewed_at: null, review_note: null,
    })
    expect(captured.wbs_items).toBeUndefined()
    expect(captured.change_logs).toBeUndefined()
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1)
  })
  it('경합(RPC conflict) — 처리 실패, 리뷰 기록·알림 없음', async () => {
    const { captured } = admin({ agent_work_orders: [{ data: APPROVED }], rpc: [{ data: { ok: false, conflict: true, order_status: 'reported' } }] })
    const r = await unapproveAgentCompletion(O1)
    expect(r).toEqual({ ok: false, error: '상태가 바뀌어 처리하지 못했습니다. 다시 시도하세요.' })
    expect(captured.agent_work_reports).toBeUndefined()
    expect(emitNotification).not.toHaveBeenCalled()
  })
  it('배정자에게 work.rejected 발행 — detail 은 반려가 아니라 승인 취소', async () => {
    admin(approvedQueues())
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.rejected', projectId: P1, actorUserId: 'admin-1',
      entityType: 'agent_order', entityId: O1, recipientMemberIds: ['m-1'],
      payload: expect.objectContaining({ detail: '완료 승인이 취소되었습니다' }),
    }))
  })
})

describe('requestAgentRework — 재작업 요청(approved→claimed)', () => {
  it('orderId 형식 검증 — 비형식 거부', async () => {
    const r = await requestAgentRework('invalid-id', '사유')
    expect(r).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
  it('사유 없으면 거부 — 주문을 읽기도 전에 막는다', async () => {
    const r = await requestAgentRework(O1, '   ')
    expect(r.ok).toBe(false)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
  it('approved 아닌 주문은 거부', async () => {
    admin({ agent_work_orders: [{ data: { ...APPROVED, status: 'claimed' } }] })
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('claimed')
  })
  it('성공 — 전이 RPC(rework 사건 — 단계 ip·실적 표.rw) + 반려로 기록(사유 보존)', async () => {
    const { captured, rpcCalls } = admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(true)
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'rework', p_order_id: O1 })])
    expect(captured.agent_work_reports?.[0]).toMatchObject({
      review_action: 'reject', reviewed_by: 'admin-1', review_note: '테스트가 빠졌습니다',
    })
  })
  it('배정자에게 work.rejected 발행 — detail 은 재작업 요청', async () => {
    admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트가 빠졌습니다')
    expect(r.ok).toBe(true)
    expect(emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.rejected', entityId: O1, recipientMemberIds: ['m-1'],
      payload: expect.objectContaining({ detail: '재작업이 요청되었습니다' }),
    }))
  })
})

describe('검토 계열 자격(2026-09-14 "담당자 본인도 허용") — 반려·승인 취소·재작업은 requireDelegationRight, 승인은 관리자만', () => {
  const REPORTED = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
  const APPROVED = { id: O1, project_id: P1, status: 'approved', wbs_item_id: W1 }
  const asMember = () => mocks.requireDelegationRight.mockResolvedValue({ ok: true, actor: { userId: 'member-1' }, projectId: P1, isAdmin: false })
  const DENY = { ok: false, error: '담당자 본인 또는 프로젝트 관리자만 바꿀 수 있습니다.' }

  it('반려: 담당자 본인(member) 도 가능 — requireDelegationRight(wbs_item_id)로 판정, 관리자 가드는 부르지 않는다', async () => {
    asMember()
    admin({
      agent_work_orders: [{ data: REPORTED }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: R9 } }, { data: [{ id: R9 }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1', stage: null, external_ref: null } }],
    })
    const r = await rejectAgentCompletion(O1, '내가 다시 볼게요', R9)
    expect(r.ok).toBe(true)
    expect(mocks.requireDelegationRight).toHaveBeenCalledWith(W1)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
  it('반려: requireDelegationRight 가 거부하고 관리자·서브트리 관리자도 아니면 그 오류 그대로, 상태 변경 없음(트랙 B 폴백 포함)', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const { captured } = admin({ agent_work_orders: [{ data: REPORTED }] })
    expect(await rejectAgentCompletion(O1, '사유', R9)).toEqual(DENY)
    expect(captured.agent_work_orders).toBeUndefined()
  })
  it('반려: requireDelegationRight 가 거부해도 서브트리 관리자면 허용(트랙 B)', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    admin({
      agent_work_orders: [{ data: REPORTED }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: R9 } }, { data: [{ id: R9 }] }],
    })
    const r = await rejectAgentCompletion(O1, '사유', R9)
    expect(r.ok).toBe(true)
  })
  it('승인 취소: 담당자 본인도 가능(requireDelegationRight), 관리자 가드 미사용', async () => {
    asMember()
    admin({
      agent_work_orders: [{ data: APPROVED }, { data: [{ id: O1 }] }],
      agent_work_reports: [{ data: { id: R9, reviewed_at: null } }, { data: [{ id: R9 }] }],
      wbs_items: [{ data: { name: '로그인', assignee_member_id: 'm-1', stage: 'xx', external_ref: null, dev_workflow: true } }],
    })
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(mocks.requireDelegationRight).toHaveBeenCalledWith(W1)
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })
  // r.ok:true 만으로는 부족하다 — 자격 판정이 통과해도 전이가 다른 행위자로 실행되면 감사 기록이 틀어진다.
  // 그래서 전이 RPC 가 그 행위자(p_actor)로 실행됐는지와 warning 이 비었는지를 함께 본다.
  it('승인 취소: requireDelegationRight 가 거부해도 서브트리 관리자면 허용(트랙 B) — 전이가 그 행위자로 실행된다', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { rpcCalls } = admin(approvedQueues())
    const r = await unapproveAgentCompletion(O1)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'unapprove', p_actor: 'anc-1' })])
  })
  it('재작업 요청: requireDelegationRight 가 거부하고 관리자·서브트리 관리자도 아니면 거부', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    admin({ agent_work_orders: [{ data: APPROVED }] })
    expect(await requestAgentRework(O1, '테스트 빠짐')).toEqual(DENY)
  })
  // r.ok:true 만으로는 부족하다(위 승인 취소 케이스와 같은 이유) — 전이 행위자·warning 부재까지 본다.
  it('재작업 요청: requireDelegationRight 가 거부해도 서브트리 관리자면 허용(트랙 B) — 전이가 그 행위자로 실행된다', async () => {
    mocks.requireDelegationRight.mockResolvedValue(DENY)
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-1' } })
    mocks.myMemberIds.mockResolvedValue(['anc-member'])
    mocks.isSubtreeManager.mockResolvedValue(true)
    const { rpcCalls } = admin(approvedQueues())
    const r = await requestAgentRework(O1, '테스트 빠짐')
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'rework', p_actor: 'anc-1' })])
  })
  it('WBS 항목이 삭제된 주문(wbs_item_id 없음)은 담당자를 특정 못 해 관리자만 — requireDelegationRight 대신 requireProjectAdmin', async () => {
    admin({ agent_work_orders: [{ data: { ...REPORTED, wbs_item_id: null } }, { data: [{ id: O1 }] }], agent_work_reports: [{ data: { id: R9 } }, { data: [{ id: R9 }] }] })
    const r = await rejectAgentCompletion(O1, '사유', R9)
    expect(mocks.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })
  it('승인은 담당자여도 관리자·서브트리 관리자가 아니면 거부, review 경로 미사용', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 필요' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '관리자 필요' })
    admin({ agent_work_orders: [{ data: REPORTED }] })
    expect(await approveAgentCompletion(O1, R9)).toEqual({ ok: false, error: '관리자 필요' })
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
  })
  it('승인: 리프 본인 담당자(멤버)여도 거부 — 조상 담당자가 아니면 서브트리 관리자가 아니다(분리 원칙)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'leaf-1' } })
    mocks.myMemberIds.mockResolvedValue(['leaf-member']) // 리프 자신의 담당자 id — 조상 담당자가 아니다
    mocks.subtreeStanding.mockResolvedValue({ manager: false, leafFound: true, leafAssigneeMemberId: 'leaf-member' })
    admin({ agent_work_orders: [{ data: REPORTED }] })
    const r = await approveAgentCompletion(O1, R9)
    expect(r.ok).toBe(false)
    expect(mocks.requireDelegationRight).not.toHaveBeenCalled()
  })
})

describe('자기 완료 승인 금지(AUTH-07a) — 비관리자는 리프 담당자 본인·claim 계정이면 승인하지 못한다, 반려는 열려 있다', () => {
  const REPORTED = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1, claimed_by_user_id: null }
  /** 비관리자 멤버 self-1(명단 행 m-self)이 서브트리 관리자인 상태. */
  const asSubtreeManager = (leafAssigneeMemberId: string | null) => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'self-1' } })
    mocks.myMemberIds.mockResolvedValue(['m-self'])
    mocks.subtreeStanding.mockResolvedValue({ manager: true, leafFound: true, leafAssigneeMemberId })
  }
  const reportReads = (client: { from: { mock: { calls: unknown[][] } } }) =>
    client.from.mock.calls.filter(c => c[0] === 'agent_work_reports').length

  it('(g) 서브트리 관리자인데 리프 담당자도 나 → ERR_SELF_APPROVAL, 전이 없음, 보고 대조보다 먼저 거부', async () => {
    asSubtreeManager('m-self')
    const { client, rpcCalls } = admin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: REPORTS() })
    expect(await approveAgentCompletion(O1, R9)).toEqual({ ok: false, error: ERR_SELF_APPROVAL })
    expect(rpcCalls).toHaveLength(0)
    expect(reportReads(client)).toBe(0)
  })
  it('(h) 주문을 claim 한 계정이 나 → 같은 거부, 전이 없음', async () => {
    asSubtreeManager(null)
    const { client, rpcCalls, selects } = admin({
      agent_work_orders: [{ data: { ...REPORTED, claimed_by_user_id: 'self-1' } }], agent_work_reports: REPORTS(),
    })
    expect(await approveAgentCompletion(O1, R9)).toEqual({ ok: false, error: ERR_SELF_APPROVAL })
    expect(rpcCalls).toHaveLength(0)
    expect(reportReads(client)).toBe(0)
    // 스텁은 select 열과 무관하게 claimed_by_user_id 를 돌려준다 — 실제 조회가 그 열을 읽는지는 select 문자열로 본다.
    expect(selects.agent_work_orders?.[0]).toContain('claimed_by_user_id')
    // 가드에 주문의 claim 계정이 그대로 넘어갔다 — 주문 select 가 claimed_by_user_id 를 싣는다.
    expect(mocks.subtreeStanding).toHaveBeenCalledWith(expect.anything(), { itemId: W1, projectId: P1, myMemberIds: ['m-self'] })
  })
  it('(i) 같은 멤버(리프 담당자 본인)의 반려는 성공 — 되돌리는 결정은 계속 열려 있다', async () => {
    asSubtreeManager('m-self')
    mocks.requireDelegationRight.mockResolvedValue({ ok: true, actor: { userId: 'self-1' }, projectId: P1, isAdmin: false })
    const { rpcCalls } = admin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: REPORTS() })
    const r = await rejectAgentCompletion(O1, '다시 볼게요', R9)
    expect(r.ok).toBe(true)
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'reject', p_actor: 'self-1' })])
  })
  it('남이 claim 한 주문은 서브트리 관리자가 승인한다(대조군)', async () => {
    asSubtreeManager(null)
    const { rpcCalls } = admin({
      agent_work_orders: [{ data: { ...REPORTED, claimed_by_user_id: 'agent-owner-2' } }], agent_work_reports: REPORTS(),
    })
    expect(await approveAgentCompletion(O1, R9)).toEqual({ ok: true })
    expect(rpcCalls).toEqual([expect.objectContaining({ p_event: 'approve', p_actor: 'self-1' })])
  })
})

describe('getAgentOrderForItem — 보고 순서(H1 Task 11 M4)', () => {
  it('보고는 created_at 오름차순, 같으면 id 오름차순 — 명세 패널이 고르는 마지막 completion 이 서버의 최신과 같다', async () => {
    mocks.requireProjectMember.mockResolvedValue(ACTOR)
    const orderCalls: unknown[][] = []
    const sb = { from: vi.fn((table: string) => { const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'limit', 'in']) b[k] = () => b
      b.order = (...a: unknown[]) => { if (table === 'agent_work_reports') orderCalls.push(a); return b }
      if (table === 'wbs_items') b.maybeSingle = async () => ({ data: { project_id: P1 }, error: null })
      else if (table === 'agent_work_orders') {
        b.then = (r: (v: unknown) => unknown) => Promise.resolve({
          data: [{ id: O1, status: 'reported', claimed_by: 'agent-x', claimed_at: null, updated_at: '2026-08-24T01:00:00Z' }], error: null,
        }).then(r)
      } else b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r)
      return b }) }
    mocks.createServerClient.mockResolvedValue(sb)
    expect((await getAgentOrderForItem(W1)).ok).toBe(true)
    expect(orderCalls).toEqual([['created_at', { ascending: true }], ['id', { ascending: true }]])
  })
})
