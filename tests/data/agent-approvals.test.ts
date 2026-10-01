// 사이드바 결재 대기 배지의 수(2026-09-18) — 내가 승인할 수 있는 것만, 남의 프로젝트 수는 흘리지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  actor: null as unknown,
  orders: [] as Array<{ wbs_item_id: string | null; claimed_by_user_id: string | null }>,
  ordersError: null as { message: string } | null,
  items: [] as Array<{ id: string; parent_id: string | null; assignee_member_id: string | null }>,
  memberIds: [] as string[],
  itemReads: 0,
  maxRows: 1000 as number,
  afterOrders: undefined as undefined | ((n: number, rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>> | void),
  ordersTable: undefined as unknown,
  itemsTable: undefined as unknown,
}))

vi.mock('@/lib/authz', () => ({ getActorForView: async () => m.actor }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: async () => m.memberIds }))
// 키셋 가짜(SP4 A2 과제 17) — 표는 테스트마다 한 번 만들어 쪽 사이에 이어 쓴다(afterOrders 의 변경이 다음 쪽에 보이게).
// itemReads 는 이제 "항목 표를 연 횟수"(쪽마다)다 — 관리자·로스터 밖은 0 그대로.
vi.mock('@/lib/supabase/admin', async () => {
  const { keysetTable } = await import('../helpers/keysetTable')
  return {
    createAdminClient: () => ({
      from: (table: string) => {
        if (table === 'agent_work_orders') {
          m.ordersTable ??= keysetTable(
            m.orders.map((o, i) => ({ id: `o${String(i).padStart(5, '0')}`, project_id: P_ID, status: 'reported', ...o })),
            { maxRows: m.maxRows, error: m.ordersError ?? undefined, afterResponse: m.afterOrders },
          )
          return (m.ordersTable as ReturnType<typeof keysetTable>).make()
        }
        if (table === 'wbs_items') {
          m.itemReads++
          m.itemsTable ??= keysetTable(m.items.map((it) => ({ project_id: P_ID, ...it })), { maxRows: m.maxRows })
          return (m.itemsTable as ReturnType<typeof keysetTable>).make()
        }
        throw new Error(`unexpected ${table}`)
      },
    }),
  }
})
const P_ID = vi.hoisted(() => '11111111-1111-4111-8111-111111111111')

import { countApprovable, getPendingApprovalCount } from '@/lib/data/agentApprovals'
import { makeActor, WS } from '../fixtures/actor'

const P = '11111111-1111-4111-8111-111111111111'
const actor = (role?: 'admin' | 'member', superuser = false) => makeActor({
  isSuperuser: superuser,
  // P 는 이 사용자 워크스페이스의 프로젝트 — 없으면 roleIn 이 null(존재 은닉)이라 역할이 무시된다
  projectWorkspace: new Map([[P, WS]]),
  projectRoles: new Map(role ? [[P, role]] : []),
})
// 트리: root(담당 m-boss) ─ wp(담당 없음) ─ leaf1(담당 m-dev), leaf2 · other(담당 m-other) ─ leaf3
const ITEMS = [
  { id: 'root', parent_id: null, assignee_member_id: 'm-boss' },
  { id: 'wp', parent_id: 'root', assignee_member_id: null },
  { id: 'leaf1', parent_id: 'wp', assignee_member_id: 'm-dev' },
  { id: 'leaf2', parent_id: 'wp', assignee_member_id: null },
  { id: 'other', parent_id: null, assignee_member_id: 'm-other' },
  { id: 'leaf3', parent_id: 'other', assignee_member_id: null },
]
const ORDERS = [
  { wbs_item_id: 'leaf1', claimed_by_user_id: null }, { wbs_item_id: 'leaf2', claimed_by_user_id: null },
  { wbs_item_id: 'leaf3', claimed_by_user_id: null }, { wbs_item_id: null, claimed_by_user_id: null },
]
const viewer = (isAdmin: boolean, memberIds: string[], userId = 'u-viewer') => ({ isAdmin, memberIds, userId })

describe('countApprovable', () => {
  it('관리자는 결재 대기 전부', () => {
    expect(countApprovable(ORDERS, ITEMS, viewer(true, []))).toBe(4)
  })
  it('서브트리 관리자는 자기 하위만', () => {
    expect(countApprovable(ORDERS, ITEMS, viewer(false, ['m-boss']))).toBe(2)
    expect(countApprovable(ORDERS, ITEMS, viewer(false, ['m-other']))).toBe(1)
  })
  it('리프 담당자 본인은 승인할 수 없으니 세지 않는다', () => {
    expect(countApprovable(ORDERS, ITEMS, viewer(false, ['m-dev']))).toBe(0)
  })
  it('서브트리 관리자라도 자기 담당 리프·자기 claim 주문·트리에 없는 리프는 빠진다(AUTH-07a) — 관리자 수는 그대로', () => {
    const items = [...ITEMS, { id: 'leaf4', parent_id: 'wp', assignee_member_id: 'm-boss' }] // 상위 담당자가 리프도 맡음
    const orders = [
      { wbs_item_id: 'leaf1', claimed_by_user_id: 'u-dev' },  // 남이 claim — 센다
      { wbs_item_id: 'leaf2', claimed_by_user_id: 'u-boss' }, // 내가 claim — 뺀다
      { wbs_item_id: 'leaf4', claimed_by_user_id: null },     // 내 담당 리프 — 뺀다
      { wbs_item_id: 'ghost', claimed_by_user_id: null },     // 트리에 없는 리프 — 서버도 거부한다
    ]
    expect(countApprovable(orders, items, viewer(false, ['m-boss'], 'u-boss'))).toBe(1)
    expect(countApprovable(orders, items, viewer(true, ['m-boss'], 'u-boss'))).toBe(4)
  })
})

describe('getPendingApprovalCount', () => {
  beforeEach(() => {
    m.actor = actor('admin'); m.orders = ORDERS; m.ordersError = null; m.items = ITEMS; m.memberIds = []; m.itemReads = 0
    m.maxRows = 1000; m.afterOrders = undefined; m.ordersTable = undefined; m.itemsTable = undefined
  })
  it('비로그인·잘못된 id 는 0', async () => {
    expect(await getPendingApprovalCount('not-a-uuid')).toBe(0)
    m.actor = null
    expect(await getPendingApprovalCount(P)).toBe(0)
  })
  it('관리자는 항목 트리를 읽지 않고 바로 센다', async () => {
    expect(await getPendingApprovalCount(P)).toBe(4)
    expect(m.itemReads).toBe(0)
  })
  it('슈퍼유저도 관리자와 같다', async () => {
    m.actor = actor(undefined, true)
    expect(await getPendingApprovalCount(P)).toBe(4)
  })
  it('로스터에 없는 사람(남의 프로젝트 id 를 넣은 경우 포함)은 0 — 트리도 읽지 않는다', async () => {
    m.actor = actor()
    expect(await getPendingApprovalCount(P)).toBe(0)
    expect(m.itemReads).toBe(0)
  })
  it('조회 전용 명단(access_role null)은 부모 항목 담당자여도 0 — 서버 가드(requireProjectMember)와 같은 축, 트리도 읽지 않는다', async () => {
    m.actor = actor(); m.memberIds = ['m-boss'] // 명단 행은 있으나 역할이 없다 — roleIn 은 view
    expect(await getPendingApprovalCount(P)).toBe(0)
    expect(m.itemReads).toBe(0)
  })
  it('멤버는 서브트리 관리자로서 승인할 수 있는 것만', async () => {
    m.actor = actor('member'); m.memberIds = ['m-boss']
    expect(await getPendingApprovalCount(P)).toBe(2)
  })
  it('멤버 배지에서 내 계정(actor.userId)이 claim 한 주문은 빠진다', async () => {
    m.actor = actor('member'); m.memberIds = ['m-boss']
    m.orders = ORDERS.map(o => (o.wbs_item_id === 'leaf2' ? { ...o, claimed_by_user_id: 'u1' } : o))
    expect(await getPendingApprovalCount(P)).toBe(1)
  })
  it('결재 대기가 없으면 0', async () => {
    m.orders = []
    expect(await getPendingApprovalCount(P)).toBe(0)
  })
  it('조회 실패는 0 으로 위장하지 않고 throw', async () => {
    m.ordersError = { message: 'boom' }
    await expect(getPendingApprovalCount(P)).rejects.toThrow('결재 대기 조회 실패')
  })
  it('결재 대기가 한 응답의 상한(여기서는 2)·옛 500 을 넘어도 끝까지 센다 — 배지가 포화하지 않는다', async () => {
    m.actor = actor('admin')
    m.maxRows = 2
    m.orders = Array.from({ length: 503 }, () => ({ wbs_item_id: null, claimed_by_user_id: null }))
    expect(await getPendingApprovalCount(P)).toBe(503)
  })
  it('비관리자의 항목 트리도 끝까지 — 둘째 쪽의 리프를 못 찾아 덜 세지 않는다', async () => {
    m.actor = actor('member')
    m.memberIds = ['m-boss']
    m.maxRows = 2
    m.items = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, parent_id: null, assignee_member_id: null })),
      { id: 'root', parent_id: null, assignee_member_id: 'm-boss' }, { id: 'zleaf', parent_id: 'root', assignee_member_id: 'm-dev' },
    ]
    m.orders = [{ wbs_item_id: 'zleaf', claimed_by_user_id: null }]
    expect(await getPendingApprovalCount(P)).toBe(1)
  })
  it('[RF5] 읽는 사이 주문이 바뀌면(count 불일치) throw — 잘린 수를 배지로 내지 않는다(셸이 격리한다)', async () => {
    m.actor = actor('admin')
    m.maxRows = 2
    m.orders = Array.from({ length: 4 }, () => ({ wbs_item_id: null, claimed_by_user_id: null }))
    m.afterOrders = (n, rows) => (n === 1 ? [...rows, { id: 'o99999', project_id: P_ID, status: 'reported', wbs_item_id: null, claimed_by_user_id: null }] : undefined)
    await expect(getPendingApprovalCount(P)).rejects.toThrow(/끝까지 읽지 못했습니다/)
  })
})
