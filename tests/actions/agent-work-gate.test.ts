// 승인 계열의 agents 관문(스펙 §4.2) — 주문을 읽는 두 헬퍼(loadOrderForAdmin·loadOrderForReview)의 **모든 성공 갈래**가 주문 행의
// 프로젝트로 관문을 지난다. 꺼지면 전이 RPC·보고 기록에 닿지 않는다. deny 하네스(tests/gates)는 관리자 행위자·항목 있는 주문 하나라
// 갈래 다섯 가운데 둘만 지난다 — 나머지(항목 삭제된 주문의 관리자 갈래 둘·서브트리 관리자 갈래)를 여기서 문다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireDelegationRight: vi.fn(), requireCompletionApprover: vi.fn(), requireSubtreeManagerOrAdmin: vi.fn(),
  row: {} as Record<string, unknown>, rpc: vi.fn(), from: [] as string[],
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: m.requireProjectAdmin, requireProjectMember: vi.fn() }))
vi.mock('@/lib/agent/delegation', () => ({ requireDelegationRight: m.requireDelegationRight }))
vi.mock('@/lib/agent/subtreeManager', () => ({ requireCompletionApprover: m.requireCompletionApprover, requireSubtreeManagerOrAdmin: m.requireSubtreeManagerOrAdmin }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      m.from.push(table)
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit', 'update', 'insert']) b[k] = () => b
      b.maybeSingle = async () => ({ data: table === 'agent_work_orders' ? m.row : null, error: null })
      return b
    },
    rpc: m.rpc,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))

import { approveAgentCompletion, rejectAgentCompletion } from '@/app/actions/agentWork'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const O = '00000000-0000-0000-7e57-000000001711'
const PX = '00000000-0000-0000-7e57-000000001712'
const ITEM = '00000000-0000-0000-7e57-000000001713'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }
const PASS = { ok: true, actor: { userId: 'u-alice' }, isAdmin: false }
const NO = { ok: false, error: '권한 없음' }

beforeEach(() => {
  vi.clearAllMocks()
  m.from.length = 0
  vi.mocked(requireModule).mockResolvedValue(OFF)
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u-alice' } })
})
// 관문 mock 값을 바꾸는 파일 — 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

const expectClosed = async (r: Promise<unknown>) => {
  expect(await r).toEqual(OFF)
  expect(requireModule).toHaveBeenCalledWith({ projectId: PX }, 'agents')   // 주문 행의 프로젝트
  expect(m.rpc).not.toHaveBeenCalled()
  expect(m.from).toEqual(['agent_work_orders'])                            // 주문 한 행만 읽고 끝난다 — 보고 대조·기록 없음
}

describe('승인 계열 — 헬퍼의 모든 성공 갈래가 agents 관문을 지난다', () => {
  it('승인 · 항목이 삭제된 주문(관리자 갈래)', async () => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: null, claimed_by_user_id: null }
    await expectClosed(approveAgentCompletion(O, null))
  })
  it('승인 · 완료 승인자 갈래(requireCompletionApprover)', async () => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: ITEM, claimed_by_user_id: null }
    m.requireCompletionApprover.mockResolvedValue(PASS)
    await expectClosed(approveAgentCompletion(O, null))
  })
  it('반려 · 항목이 삭제된 주문(관리자 갈래)', async () => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: null }
    await expectClosed(rejectAgentCompletion(O, '사유', null))
  })
  it('반려 · 담당자 본인 갈래(requireDelegationRight)', async () => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: ITEM }
    m.requireDelegationRight.mockResolvedValue(PASS)
    await expectClosed(rejectAgentCompletion(O, '사유', null))
  })
  it('반려 · 서브트리 관리자 갈래(requireSubtreeManagerOrAdmin)', async () => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: ITEM }
    m.requireDelegationRight.mockResolvedValue(NO)
    m.requireSubtreeManagerOrAdmin.mockResolvedValue(PASS)
    await expectClosed(rejectAgentCompletion(O, '사유', null))
  })
  it('가드가 거부하면 관문을 부르지 않는다(가드 → 관문)', async () => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: ITEM }
    m.requireDelegationRight.mockResolvedValue(NO)
    m.requireSubtreeManagerOrAdmin.mockResolvedValue(NO)
    expect(await rejectAgentCompletion(O, '사유', null)).toEqual(NO)
    expect(requireModule).not.toHaveBeenCalled()
  })
  it.each([
    ['승인', () => approveAgentCompletion(O, null)],
    ['반려', () => rejectAgentCompletion(O, '사유', null)],
  ] as const)('%s · 항목이 삭제된 주문 — 관리자 가드가 거부하면 관문을 부르지 않는다(가드 → 관문, B5 T17-m1)', async (_n, call) => {
    m.row = { id: O, project_id: PX, status: 'reported', wbs_item_id: null, claimed_by_user_id: null }
    m.requireProjectAdmin.mockResolvedValue(NO)
    expect(await call()).toEqual(NO)
    expect(m.requireProjectAdmin).toHaveBeenCalledWith(PX)
    expect(requireModule).not.toHaveBeenCalled()
  })
})
