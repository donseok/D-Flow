// SP5b W2(S20) — 승인 가능 셈(canApproveCompletion — authz.ts 로 이전, seatmap 재수출)이 다단계 승인에서 서버 판정과 같다:
// admin 단계는 관리자만, 서로 다른 승인자 설정에서 이번 라운드의 다른 단계를 승인한 사람은 관리자라도 못 한다. 재료가 없으면 현행.
import { describe, expect, it } from 'vitest'
import { canApproveCompletion } from '@/lib/domain/authz'
import { canApproveCompletion as fromSeatmap } from '@/lib/domain/seatmap'
import { filterApprovable } from '@/lib/domain/approvable'
import { assembleAgentHub, type AgentHubRows } from '@/lib/domain/agentHub'

const base = { isAdmin: false, subtreeManager: true, assigneeMine: false, claimedByMe: false }

describe('canApproveCompletion', () => {
  it('seatmap 은 authz 의 같은 함수를 재수출한다', () => { expect(fromSeatmap).toBe(canApproveCompletion) })
  it('재료가 없으면 현행(관리자, 또는 자기 담당·자기 착수가 아닌 서브트리 관리자)', () => {
    expect(canApproveCompletion(base)).toBe(true)
    expect(canApproveCompletion({ ...base, assigneeMine: true })).toBe(false)
    expect(canApproveCompletion({ ...base, subtreeManager: false, isAdmin: true, assigneeMine: true })).toBe(true)
  })
  it('admin 단계는 관리자만, 같은 라운드에 이미 승인했으면 관리자도 못 한다', () => {
    expect(canApproveCompletion({ ...base, pendingStepApprover: 'admin' })).toBe(false)
    expect(canApproveCompletion({ ...base, isAdmin: true, pendingStepApprover: 'admin' })).toBe(true)
    expect(canApproveCompletion({ ...base, isAdmin: true, approvedThisRound: true })).toBe(false)
    expect(canApproveCompletion({ ...base, pendingStepApprover: 'subtree_or_admin' })).toBe(true)
  })
})

describe('filterApprovable(결재 배지·포털 검토)', () => {
  const items = [{ id: 'root', parent_id: null, assignee_member_id: 'me' }, { id: 'leaf', parent_id: 'root', assignee_member_id: 'other' }]
  const orders = [{ id: 'o', wbs_item_id: 'leaf', claimed_by_user_id: null }]
  it('관리자도 이번 라운드에 승인했으면 빠진다, admin 단계는 서브트리 관리자에게서 빠진다', () => {
    const admin = { isAdmin: true, memberIds: [], userId: 'u' }
    expect(filterApprovable(orders, [], admin)).toHaveLength(1)
    expect(filterApprovable(orders, [], admin, { leaf: { approver: 'admin', approvedBy: ['u'], distinct: true } })).toHaveLength(0)
    expect(filterApprovable(orders, [], admin, { leaf: { approver: 'admin', approvedBy: ['u'], distinct: false } })).toHaveLength(1)
    const mgr = { isAdmin: false, memberIds: ['me'], userId: 'u2' }
    expect(filterApprovable(orders, items, mgr)).toHaveLength(1)
    expect(filterApprovable(orders, items, mgr, { leaf: { approver: 'admin', approvedBy: [], distinct: true } })).toHaveLength(0)
  })
})

describe('assembleAgentHub — 큐 카드의 단계 표시·승인 버튼', () => {
  it('queueApprovals 가 있으면 카드에 approval, admin 단계면 비관리자 canApprove=false', () => {
    const rows: AgentHubRows = {
      project: { id: 'P', name: 'p' }, agentProject: { enabled: true }, watchers: [], members: [{ id: 'me', name: '나', user_id: 'u2', active: true } as never], approvedItemIds: [],
      items: [
        { id: 'root', project_id: 'P', parent_id: null, code: '1', name: 'r', sort_order: 1, milestone: false, dev_workflow: true, tags: [], assignee_member_id: 'me', agent_prompt: null, actual_pct: 0, stage: null, external_ref: null, depends: null },
        { id: 'leaf', project_id: 'P', parent_id: 'root', code: '1.1', name: 'l', sort_order: 1, milestone: false, dev_workflow: true, tags: ['agent'], assignee_member_id: 'other', agent_prompt: null, actual_pct: 80, stage: 'im', external_ref: null, depends: null },
      ] as never,
      orders: [{ id: 'o', project_id: 'P', wbs_item_id: 'leaf', status: 'reported', claimed_by: 'a', claimed_by_user_id: null, claimed_at: null, created_at: '2026-10-04T00:00:00Z', updated_at: '2026-10-04T00:00:00Z', last_heartbeat_at: null, heartbeat_phase: null, heartbeat_agent: null, heartbeat_note: null }] as never,
      reports: [],
      queueApprovals: { leaf: { step: 'client', index: 2, total: 2, approver: 'admin', label: '고객 승인', approvedBy: [], distinct: true } },
    }
    const hub = assembleAgentHub(rows, Date.parse('2026-10-04T01:00:00Z'), { userId: 'u2', isAdmin: false })
    expect(hub.queue[0]).toMatchObject({ canManage: true, canApprove: false, approval: { step: 'client', index: 2, total: 2, label: '고객 승인' } })
    const asAdmin = assembleAgentHub(rows, Date.parse('2026-10-04T01:00:00Z'), { userId: 'u9', isAdmin: true })
    expect(asAdmin.queue[0].canApprove).toBe(true)
  })
})
