import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 승인·반려는 사람이 본 보고에만 걸린다(H1 Task 11). 서버는 상태(reported)만 CAS 해서, 반려 뒤 재보고된
 * 주문을 새 보고를 보지 않은 채 옛 카드로 승인할 수 있었고 검토 기록은 새 보고에 찍혔다.
 * 화면이 본 보고 id(expectedReportId)를 보내고, 서버가 최신 completion 보고와 대조한 뒤에만 전이한다.
 * admin 가짜·loadOrderForAdmin 경로 mock 은 stage-lifecycle.test.ts 관례를 따르고, update 가 어느 행을
 * 겨눴는지 보려고 eq 필터만 더 기록한다.
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
// 반려는 loadOrderForReview → requireDelegationRight 로 판정한다. 여기선 관리자 통과로 고정.
vi.mock('@/lib/agent/delegation', () => ({
  requireDelegationRight: vi.fn(async () => ({ ok: true, actor: { userId: 'admin-1' }, projectId: '11111111-1111-4111-8111-111111111111', isAdmin: true })),
}))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => {
  const m = await orig() as Record<string, unknown>
  return { ...m, after: (fn: () => unknown) => { void fn() } }
})

import { approveAgentCompletion, rejectAgentCompletion, unapproveAgentCompletion } from '@/app/actions/agentWork'
import { ERR_REPORT_STALE } from '@/lib/domain/agentWork'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const R2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'

type Resp = { data?: unknown; error?: { message: string } | null }
type Update = { table: string; payload: Record<string, unknown>; eq: Array<[string, unknown]> }
const RPC_OK = { ok: true, order_status: null, stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }

function fakeAdmin(queues: Record<string, Resp[]>) {
  const updates: Update[] = []
  /** 보고 조회의 정렬 호출 — 조회 1건마다 한 줄(서버가 고르는 "최신"의 순서를 본다). */
  const reportOrders: Array<Array<[string, unknown]>> = []
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const eq: Array<[string, unknown]> = []
      const order: Array<[string, unknown]> = []
      if (table === 'agent_work_reports') reportOrders.push(order)
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'limit']) b[k] = () => b
      b.order = (col: string, opts: unknown) => { order.push([col, opts]); return b }
      b.eq = (col: string, v: unknown) => { eq.push([col, v]); return b }
      b.update = (payload: Record<string, unknown>) => { updates.push({ table, payload, eq }); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => {
      const resp = (queues.rpc ?? []).shift() ?? { data: RPC_OK }
      return { data: resp.data ?? null, error: resp.error ?? null }
    }),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  const reviews = () => updates.filter(u => u.table === 'agent_work_reports')
  return { admin, updates, reviews, reportOrders }
}

const REPORTED = { id: O1, project_id: P1, status: 'reported', wbs_item_id: W1 }
/** 최신 completion 보고 조회 응답. */
const latest = (id: string | null): Resp => ({ data: id === null ? null : { id } })
const updated = (id: string): Resp => ({ data: [{ id }] })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
})

describe('승인 — 사람이 본 보고(expectedReportId)가 지금도 최신일 때만 전이한다', () => {
  it('(a) 최신 보고 r2 인데 화면은 r1 을 봤다 → stale, 전이·검토 기록·알림 없음', async () => {
    const { admin, reviews } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R2)] })
    expect(await approveAgentCompletion(O1, R1)).toEqual({ ok: false, stale: true, error: ERR_REPORT_STALE })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(reviews()).toEqual([])
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('(b) 일치(r2/r2) → 전이 1회, 검토 기록은 대조한 r2 행에 — 최신을 다시 찾지 않는다', async () => {
    const { admin, reviews } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R2), updated(R2)] })
    expect(await approveAgentCompletion(O1, R2)).toEqual({ ok: true })
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'approve', p_order_id: O1 }))
    expect(reviews()).toHaveLength(1)
    expect(reviews()[0].eq).toEqual([['id', R2]])
    expect(reviews()[0].payload).toMatchObject({ review_action: 'approve', reviewed_by: 'admin-1' })
    // 보고 테이블은 대조 1회 + 기록 1회뿐 — 종전처럼 전이 뒤 "최신"을 다시 찾아 새 보고에 찍지 않는다.
    expect(admin.from.mock.calls.filter(c => c[0] === 'agent_work_reports')).toHaveLength(2)
  })

  it('(c) 보고가 없는 주문(null/null)은 통과 — 기록할 보고가 없으니 검토 기록은 건너뛴다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin, reviews } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(null)] })
    expect(await approveAgentCompletion(O1, null)).toEqual({ ok: true })
    expect(admin.rpc).toHaveBeenCalledTimes(1)
    expect(reviews()).toEqual([])
    expect(errSpy).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('(c-2) 화면은 보고 없음(null)을 봤는데 그 사이 보고가 생겼다 → stale', async () => {
    const { admin } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R1)] })
    expect(await approveAgentCompletion(O1, null)).toEqual({ ok: false, stale: true, error: ERR_REPORT_STALE })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('(d) 최신 보고 조회 실패 → 쓰기 전에 중단(3원칙 ②), 전이 없음', async () => {
    const { admin, reviews } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [{ error: { message: 'boom' } }] })
    const r = await approveAgentCompletion(O1, R1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
    expect(r).not.toHaveProperty('stale')
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(reviews()).toEqual([])
  })

  it('(e) 반려 → 재보고(새 r2) 뒤 옛 r1 카드로 승인하면 stale — 반려 기록은 r1 에 남는다', async () => {
    const { admin, reviews } = fakeAdmin({
      agent_work_orders: [{ data: REPORTED }, { data: REPORTED }], // 반려 시점, (재보고 뒤) 승인 시점
      agent_work_reports: [latest(R1), updated(R1), latest(R2)],
    })
    expect(await rejectAgentCompletion(O1, '테스트 빠짐', R1)).toEqual({ ok: true })
    expect(await approveAgentCompletion(O1, R1)).toEqual({ ok: false, stale: true, error: ERR_REPORT_STALE })
    expect(admin.rpc).toHaveBeenCalledTimes(1) // 반려 1회뿐
    expect(reviews()).toHaveLength(1)
    expect(reviews()[0].eq).toEqual([['id', R1]])
    expect(reviews()[0].payload).toMatchObject({ review_action: 'reject', review_note: '테스트 빠짐' })
  })

  it('(f) 같은 id 로 두 번째 승인은 이미 approved 라 종전 문구로 거부', async () => {
    const { admin } = fakeAdmin({ agent_work_orders: [{ data: { ...REPORTED, status: 'approved' } }], agent_work_reports: [latest(R2)] })
    expect(await approveAgentCompletion(O1, R2)).toEqual({ ok: false, error: '승인 가능한 상태가 아닙니다(approved).' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('(g) expectedReportId 가 빠졌거나(직접 호출) uuid 가 아니면 잘못된 요청, 전이 없음', async () => {
    for (const bad of [undefined, 'r1', 42]) {
      const { admin } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R1)] })
      expect(await approveAgentCompletion(O1, bad as never)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
      expect(admin.rpc).not.toHaveBeenCalled()
    }
  })
})

describe('반려 — 승인과 같은 대조', () => {
  it('(a) 최신 보고 r2 인데 화면은 r1 → stale, 전이·검토 기록 없음', async () => {
    const { admin, reviews } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R2)] })
    expect(await rejectAgentCompletion(O1, '사유', R1)).toEqual({ ok: false, stale: true, error: ERR_REPORT_STALE })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(reviews()).toEqual([])
  })

  it('(d) 최신 보고 조회 실패 → 쓰기 전에 중단, 전이 없음', async () => {
    const { admin } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [{ error: { message: 'boom' } }] })
    const r = await rejectAgentCompletion(O1, '사유', R1)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('boom')
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('(g) expectedReportId 가 빠졌거나 uuid 가 아니면 잘못된 요청, 전이 없음', async () => {
    for (const bad of [undefined, 'r1']) {
      const { admin } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R1)] })
      expect(await rejectAgentCompletion(O1, '사유', bad as never)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
      expect(admin.rpc).not.toHaveBeenCalled()
    }
  })
})

describe('expectedReportId 모양 검사는 맨 앞 — 주문을 읽기 전에 거부한다(Task 11 M3)', () => {
  it('승인: uuid 가 아니면 주문 조회·권한 판정 없이 잘못된 요청 — 이미 승인된 주문이어도 상태 문구가 아니다', async () => {
    for (const bad of [undefined, 'r1', 42, '']) {
      const { admin } = fakeAdmin({ agent_work_orders: [{ data: { ...REPORTED, status: 'approved' } }] })
      expect(await approveAgentCompletion(O1, bad as never)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
      expect(admin.from).not.toHaveBeenCalled()
      expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
    }
  })
  it('반려: 같은 검사가 사유·주문 조회보다 먼저다', async () => {
    const { admin } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }] })
    expect(await rejectAgentCompletion(O1, '사유', 'r1' as never)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(await rejectAgentCompletion(O1, '', 'r1' as never)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(admin.from).not.toHaveBeenCalled()
  })
})

describe('최신 completion 보고의 순서 — created_at 이 같으면 id 로 가른다(Task 11 M4)', () => {
  const NEWEST_FIRST = [['created_at', { ascending: false }], ['id', { ascending: false }]]
  it('승인 대조는 created_at 내림차순 다음 id 내림차순으로 최신 1건을 고른다', async () => {
    const { reportOrders } = fakeAdmin({ agent_work_orders: [{ data: REPORTED }], agent_work_reports: [latest(R2), updated(R2)] })
    expect(await approveAgentCompletion(O1, R2)).toEqual({ ok: true })
    expect(reportOrders[0]).toEqual(NEWEST_FIRST)
  })
  it('되감기(승인 취소)의 검토 기록도 같은 판정으로 최신을 찾는다 — 같은 조회를 두 번 적지 않는다(M2)', async () => {
    const { reviews, reportOrders } = fakeAdmin({
      agent_work_orders: [{ data: { ...REPORTED, status: 'approved' } }],
      agent_work_reports: [latest(R2), updated(R2)],
    })
    expect(await unapproveAgentCompletion(O1)).toEqual({ ok: true })
    expect(reportOrders[0]).toEqual(NEWEST_FIRST)
    expect(reviews()).toHaveLength(1)
    expect(reviews()[0].eq).toEqual([['id', R2]])
    expect(reviews()[0].payload).toMatchObject({ review_action: null, reviewed_by: null })
  })
})

describe('되감기 검토 기록의 조회 실패 로그', () => {
  it('보고 조회가 실패하면 그 사유를 한 번만 적는다 — "보고 조회 실패" 접두어가 겹치지 않는다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { reviews } = fakeAdmin({
      agent_work_orders: [{ data: { ...REPORTED, status: 'approved' } }],
      agent_work_reports: [{ error: { message: 'boom' } }],
    })
    expect(await unapproveAgentCompletion(O1)).toEqual({ ok: true }) // 전이는 확정 — 부수 기록 실패는 로깅만
    expect(reviews()).toEqual([])
    const logged = errSpy.mock.calls.map(c => c.join(' ')).filter(l => l.includes('boom'))
    expect(logged).toHaveLength(1)
    expect(logged[0].split('보고 조회 실패').length - 1).toBe(1)
    errSpy.mockRestore()
  })
})
