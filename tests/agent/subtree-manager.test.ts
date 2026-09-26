// tests/agent/subtree-manager.test.ts — 서브트리 관리자 판정(트랙 B, 2026-09-15).
// isSubtreeManager(assignee.ts, 조상 순회)와 requireSubtreeManagerOrAdmin(subtreeManager.ts, 가드
// 조합)을 실제 구현으로 검증한다. 호출부(agentWork.ts·agentHub.ts·wbsAssign.ts)의 각 테스트는
// 이 둘을 목킹해 "관리자 또는 서브트리 관리자" 배선만 본다(agent-work-actions.test.ts 등) —
// 조상 순회·로스터 매칭 자체는 여기서만 검증해 중복을 없앤다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin,
  requireProjectMember: mocks.requireProjectMember,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { isSubtreeManager, subtreeStanding } from '@/lib/agent/assignee'
import {
  requireSubtreeManagerOrAdmin, requireCompletionApprover, ERR_NOT_SUBTREE_MANAGER, ERR_SELF_APPROVAL,
} from '@/lib/agent/subtreeManager'
import type { AdminClient } from '@/lib/minutes/externalApi'

const P1 = '11111111-1111-4111-8111-111111111111'
const ROOT = '20000000-0000-4000-8000-000000000001'
const MID = '20000000-0000-4000-8000-000000000002'
const LEAF = '20000000-0000-4000-8000-000000000003'
const OTHER_LEAF = '20000000-0000-4000-8000-000000000004'

type TreeRow = { id: string; parent_id: string | null; assignee_member_id: string | null }
/** 로스터 응답 = DB 가 people.user_id·active 로 이미 거른 '내' 행(스텁은 거르지 않으므로 거른 결과를 준다). */
type RosterRow = { id: string }

/**
 * 조상 조회(wbs_items)·로스터 조회(project_members)를 한 번에 흉내 내는 admin 클라이언트 —
 * requireSubtreeManagerOrAdmin 의 멤버 경로 전체(myMemberIds → isSubtreeManager)를 실제 구현으로 왕복시킨다.
 * 로스터 체인의 select/eq 호출을 rosterCalls 에 남긴다. 뷰어 이메일(auth)은 판정 재료가 아니므로 부르면 실패한다.
 */
const rosterCalls: Array<[string, unknown[]]> = []
function fakeAdmin(opts: {
  tree?: TreeRow[]; treeError?: { message: string } | null
  roster?: RosterRow[]; rosterError?: { message: string } | null
}) {
  rosterCalls.length = 0
  const client = {
    from: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq']) b[k] = (...args: unknown[]) => { if (table === 'project_members') rosterCalls.push([k, args]); return b }
      b.then = (r: (v: unknown) => unknown) => {
        if (table === 'wbs_items') {
          return Promise.resolve({ data: opts.treeError ? null : (opts.tree ?? []), error: opts.treeError ?? null }).then(r)
        }
        if (table === 'project_members') {
          return Promise.resolve({ data: opts.rosterError ? null : (opts.roster ?? []), error: opts.rosterError ?? null }).then(r)
        }
        return Promise.resolve({ data: [], error: null }).then(r)
      }
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => { throw new Error('뷰어 이메일 조회 금지') }) } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return client as unknown as AdminClient
}

describe('isSubtreeManager — strict 조상(부모·조부모…루트, 자신 제외) 담당자 판정', () => {
  it('부모의 담당자가 나 → true', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: null },
      { id: MID, parent_id: ROOT, assignee_member_id: 'm-mine' },
      { id: LEAF, parent_id: MID, assignee_member_id: null },
    ] })
    expect(await isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] })).toBe(true)
  })

  it('부모는 무담당이어도 조부모(루트)의 담당자가 나면 true — 끝까지 올라간다', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: 'm-mine' },
      { id: MID, parent_id: ROOT, assignee_member_id: null },
      { id: LEAF, parent_id: MID, assignee_member_id: null },
    ] })
    expect(await isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] })).toBe(true)
  })

  it('무관한 멤버(조상 담당자와 불일치) → false', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: null },
      { id: MID, parent_id: ROOT, assignee_member_id: 'm-other' },
      { id: LEAF, parent_id: MID, assignee_member_id: null },
    ] })
    expect(await isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] })).toBe(false)
  })

  it('리프 자신의 담당자는 조상이 아니므로 서브트리 관리자가 아니다 — 분리 원칙(자기 완료 자기 승인 금지)의 근거', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: null },
      { id: MID, parent_id: ROOT, assignee_member_id: null },
      { id: LEAF, parent_id: MID, assignee_member_id: 'm-mine' }, // 리프 자신의 담당자
    ] })
    expect(await isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] })).toBe(false)
  })

  it('형제 서브트리의 담당자는 이 리프의 조상이 아니므로 false', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: null },
      { id: MID, parent_id: ROOT, assignee_member_id: null },
      { id: LEAF, parent_id: MID, assignee_member_id: null },
      { id: OTHER_LEAF, parent_id: ROOT, assignee_member_id: 'm-mine' }, // 다른 가지
    ] })
    expect(await isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] })).toBe(false)
  })

  it('myMemberIds 가 비어 있으면 조회 없이 false', async () => {
    const admin = fakeAdmin({ tree: [] })
    expect(await isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: [] })).toBe(false)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('parent_id 순환이 있어도 무한루프 없이 종료한다(visited Set)', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: MID, assignee_member_id: null }, // ROOT ↔ MID 순환(데이터 이상)
      { id: MID, parent_id: ROOT, assignee_member_id: null },
      { id: LEAF, parent_id: ROOT, assignee_member_id: null },
    ] })
    await expect(isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] })).resolves.toBe(false)
  })

  it('조회 실패는 위장하지 않고 throw — fail-closed(myMemberIds 와 동일 계약)', async () => {
    const admin = fakeAdmin({ tree: [], treeError: { message: 'boom' } })
    await expect(isSubtreeManager(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] }))
      .rejects.toThrow('조상 조회 실패: boom')
  })
})

describe('requireSubtreeManagerOrAdmin — 관리자 또는 서브트리 관리자 가드', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('관리자면 멤버 판정·조상 조회 없이 통과', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const admin = fakeAdmin({})
    const r = await requireSubtreeManagerOrAdmin(LEAF, P1)
    expect(r).toEqual({ ok: true, actor: { userId: 'admin-1' }, isAdmin: true })
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('멤버 + strict 조상의 담당자 = 나(로스터 id 일치) → 통과, isAdmin:false', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'anc-user' } })
    fakeAdmin({
      tree: [
        { id: ROOT, parent_id: null, assignee_member_id: null },
        { id: MID, parent_id: ROOT, assignee_member_id: 'anc-member' },
        { id: LEAF, parent_id: MID, assignee_member_id: null },
      ],
      roster: [{ id: 'anc-member' }],
    })
    const r = await requireSubtreeManagerOrAdmin(LEAF, P1)
    expect(r).toEqual({ ok: true, actor: { userId: 'anc-user' }, isAdmin: false })
    // '나' = people.user_id 하나, 활성 명단 행·활성 인물만(이메일 폴백 없음).
    expect(rosterCalls).toEqual([
      ['select', ['id, people!inner(user_id, active)']],
      ['eq', ['project_id', P1]],
      ['eq', ['people.user_id', 'anc-user']],
      ['eq', ['active', true]],
      ['eq', ['people.active', true]],
    ])
  })

  it('무관한 멤버(조상 담당자가 아님) → 거부(ERR_NOT_SUBTREE_MANAGER)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'user-1' } })
    fakeAdmin({
      tree: [
        { id: ROOT, parent_id: null, assignee_member_id: null },
        { id: MID, parent_id: ROOT, assignee_member_id: 'm-other' },
        { id: LEAF, parent_id: MID, assignee_member_id: null },
      ],
      roster: [{ id: 'm-unrelated' }],
    })
    expect(await requireSubtreeManagerOrAdmin(LEAF, P1)).toEqual({ ok: false, error: ERR_NOT_SUBTREE_MANAGER })
  })

  it('멤버도 아니면 그 가드 오류 그대로, 로스터·조상 조회 없음', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const admin = fakeAdmin({})
    expect(await requireSubtreeManagerOrAdmin(LEAF, P1)).toEqual({ ok: false, error: '멤버 아님' })
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('조상 조회(isSubtreeManager)가 throw 하면 fail-closed 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'user-1' } })
    fakeAdmin({ tree: [], treeError: { message: 'boom' }, roster: [{ id: 'm-1' }] })
    const r = await requireSubtreeManagerOrAdmin(LEAF, P1)
    expect(r.ok).toBe(false)
  })

  it('로스터 조회(myMemberIds)가 throw 해도 fail-closed 거부', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'user-1' } })
    fakeAdmin({ tree: [], roster: [], rosterError: { message: 'roster down' } })
    const r = await requireSubtreeManagerOrAdmin(LEAF, P1)
    expect(r.ok).toBe(false)
  })

})

describe('subtreeStanding — 조상 판정과 리프 담당자를 한 번의 조회로', () => {
  it('서브트리 관리자 여부·리프 행 존재·리프 담당자를 함께 돌려준다(wbs_items 1회)', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: null },
      { id: MID, parent_id: ROOT, assignee_member_id: 'm-mine' },
      { id: LEAF, parent_id: MID, assignee_member_id: 'm-leaf' },
    ] })
    expect(await subtreeStanding(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] }))
      .toEqual({ manager: true, leafFound: true, leafAssigneeMemberId: 'm-leaf' })
    expect(admin.from).toHaveBeenCalledTimes(1)
    expect(admin.from).toHaveBeenCalledWith('wbs_items')
  })

  it('리프 행이 조회 결과에 없으면 leafFound:false — 담당자도 조상도 모른다', async () => {
    const admin = fakeAdmin({ tree: [
      { id: ROOT, parent_id: null, assignee_member_id: 'm-mine' },
      { id: MID, parent_id: ROOT, assignee_member_id: 'm-mine' },
    ] })
    expect(await subtreeStanding(admin, { itemId: LEAF, projectId: P1, myMemberIds: ['m-mine'] }))
      .toEqual({ manager: false, leafFound: false, leafAssigneeMemberId: null })
  })
})

describe('requireCompletionApprover — 완료 승인 자격(자기 승인 금지)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '관리자 아님' })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'user-1' } })
  })
  /** ROOT ─ MID(담당 m-mine) ─ LEAF(담당 leafAssignee). 액터 user-1 의 로스터 행은 m-mine. */
  const tree = (leafAssignee: string | null): TreeRow[] => [
    { id: ROOT, parent_id: null, assignee_member_id: null },
    { id: MID, parent_id: ROOT, assignee_member_id: 'm-mine' },
    { id: LEAF, parent_id: MID, assignee_member_id: leafAssignee },
  ]

  it('(a) 부모와 리프의 담당자가 모두 나 → 자기 완료라 거부(ERR_SELF_APPROVAL)', async () => {
    fakeAdmin({ tree: tree('m-mine'), roster: [{ id: 'm-mine' }] })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: null }))
      .toEqual({ ok: false, error: ERR_SELF_APPROVAL })
  })

  it('(b) 미배정 리프를 내 계정이 claim 했다 → 자기 착수라 거부(ERR_SELF_APPROVAL)', async () => {
    fakeAdmin({ tree: tree(null), roster: [{ id: 'm-mine' }] })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: 'user-1' }))
      .toEqual({ ok: false, error: ERR_SELF_APPROVAL })
  })

  it('(c) 같은 트리, 남의 계정이 claim → 서브트리 관리자로 통과', async () => {
    fakeAdmin({ tree: tree(null), roster: [{ id: 'm-mine' }] })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: 'user-2' }))
      .toEqual({ ok: true, actor: { userId: 'user-1' }, isAdmin: false })
  })

  it('(d) 관리자는 자기 담당·자기 착수여도 통과 — 멤버 판정·조회 없음(관리자 자기 승인 금지는 비목표)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'user-1' } })
    const admin = fakeAdmin({ tree: tree('m-mine'), roster: [{ id: 'm-mine' }] })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: 'user-1' }))
      .toEqual({ ok: true, actor: { userId: 'user-1' }, isAdmin: true })
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('(e) 리프 행이 트리에 없으면 담당자를 확인할 수 없어 거부(ERR_NOT_SUBTREE_MANAGER)', async () => {
    fakeAdmin({ tree: tree('m-mine').filter(r => r.id !== LEAF), roster: [{ id: 'm-mine' }] })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: null }))
      .toEqual({ ok: false, error: ERR_NOT_SUBTREE_MANAGER })
  })

  it('(f) 조상 조회 오류 → fail-closed 거부', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin({ tree: [], treeError: { message: 'boom' }, roster: [{ id: 'm-mine' }] })
    const r = await requireCompletionApprover(LEAF, P1, { claimedByUserId: null })
    expect(r.ok).toBe(false)
    errSpy.mockRestore()
  })

  it('(f) 로스터 0행 → ERR_NOT_SUBTREE_MANAGER, 조상 조회(wbs_items) 없음', async () => {
    const admin = fakeAdmin({ tree: tree(null), roster: [] })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: null }))
      .toEqual({ ok: false, error: ERR_NOT_SUBTREE_MANAGER })
    expect(vi.mocked(admin.from).mock.calls.map(c => c[0])).toEqual(['project_members'])
  })

  it('리프 담당자이지만 서브트리 관리자가 아니면 종전대로 ERR_NOT_SUBTREE_MANAGER', async () => {
    fakeAdmin({
      tree: [
        { id: ROOT, parent_id: null, assignee_member_id: null },
        { id: MID, parent_id: ROOT, assignee_member_id: 'm-other' },
        { id: LEAF, parent_id: MID, assignee_member_id: 'm-mine' },
      ],
      roster: [{ id: 'm-mine' }],
    })
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: null }))
      .toEqual({ ok: false, error: ERR_NOT_SUBTREE_MANAGER })
  })

  it('멤버도 아니면 그 가드 오류 그대로, 조회 없음', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: false, error: '멤버 아님' })
    const admin = fakeAdmin({})
    expect(await requireCompletionApprover(LEAF, P1, { claimedByUserId: null })).toEqual({ ok: false, error: '멤버 아님' })
    expect(admin.from).not.toHaveBeenCalled()
  })
})
