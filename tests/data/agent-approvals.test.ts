// 사이드바 결재 대기 배지의 수(2026-09-18) — 내가 승인할 수 있는 것만, 남의 프로젝트 수는 흘리지 않는다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  actor: null as unknown,
  orders: [] as Array<{ wbs_item_id: string | null; claimed_by_user_id: string | null }>,
  ordersError: null as { message: string } | null,
  items: [] as Array<{ id: string; parent_id: string | null; assignee_member_id: string | null }>,
  memberIds: [] as string[],
  itemReads: 0,
}))

vi.mock('@/lib/authz', () => ({ getActorForView: async () => m.actor }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: async () => m.memberIds }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain, eq: () => chain,
        limit: async () => ({ data: m.orders, error: m.ordersError }),
        then: (res: (v: unknown) => void) => { m.itemReads++; res({ data: m.items, error: null }) },
      }
      if (table !== 'agent_work_orders' && table !== 'wbs_items') throw new Error(`unexpected ${table}`)
      return chain
    },
  }),
}))

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
})
