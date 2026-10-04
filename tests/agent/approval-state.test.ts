import { describe, expect, it, vi } from 'vitest'

/**
 * SP5b W1 — 승인 판정 재료 로더(진짜 모듈 — 전역 셋업의 mock 을 vi.importActual 로 우회한다). 판정 규칙은 RPC 와 같고(judgePendingApproval),
 * 조회 실패·설정 손상은 결과로 돌려준다(fail-closed). 설정은 getProjectConfig 를 mock 한다.
 */
const cfg = vi.hoisted(() => ({ steps: null as unknown, fail: false }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: vi.fn(async () => ({ projectId: 'p' })) }))
vi.mock('@/lib/settings/registry', () => ({
  valueOf: vi.fn(() => { if (cfg.fail) throw new Error('CONFIG_INVALID'); return cfg.steps }),
}))

const { loadApprovalState, ERR_APPROVAL_CONFIG, ERR_APPROVAL_STATE } =
  await vi.importActual<typeof import('@/lib/agent/approvalState')>('@/lib/agent/approvalState')

type Resp = { data?: unknown; error?: { message: string } | null }
function fakeAdmin(queues: Record<string, Resp[]>) {
  const calls: string[] = []
  const admin = {
    from: (table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'is']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    },
  }
  return { admin: admin as never, calls }
}
const TWO = [{ code: 'internal', label: 'a', approver: 'subtree_or_admin' }, { code: 'client', label: 'b', approver: 'admin' }]

describe('loadApprovalState', () => {
  it('열린 라운드 — 원장의 미철회 승인 다음 단계와 그 승인자', async () => {
    cfg.steps = TWO; cfg.fail = false
    const { admin, calls } = fakeAdmin({
      wbs_items: [{ data: { stage: 'im', review_round: 2, review_steps: ['internal', 'client'] } }],
      wbs_stage_approvals: [{ data: [{ step_code: 'internal' }] }],
    })
    expect(await loadApprovalState(admin, 'i', 'p')).toEqual({
      ok: true, stage: 'im', steps: TWO, pending: { step: 'client', index: 2, total: 2, approver: 'admin' },
    })
    expect(calls).toEqual(['wbs_items', 'wbs_stage_approvals'])
  })
  it('스냅샷 없는 항목 — 원장을 읽지 않고 현재 설정의 첫 단계', async () => {
    cfg.steps = TWO; cfg.fail = false
    const { admin, calls } = fakeAdmin({ wbs_items: [{ data: { stage: 'ip', review_round: 0, review_steps: null } }] })
    expect(await loadApprovalState(admin, 'i', 'p')).toMatchObject({ ok: true, pending: { step: 'internal', total: 2 } })
    expect(calls).toEqual(['wbs_items'])
  })
  it('조회 실패·설정 손상·항목 없음 → 결과로 거부', async () => {
    cfg.steps = TWO; cfg.fail = false
    expect(await loadApprovalState(fakeAdmin({ wbs_items: [{ error: { message: 'x' } }] }).admin, 'i', 'p')).toEqual({ ok: false, error: ERR_APPROVAL_STATE })
    expect(await loadApprovalState(fakeAdmin({ wbs_items: [{ data: null }] }).admin, 'i', 'p')).toEqual({ ok: false, error: '항목 없음' })
    expect(await loadApprovalState(fakeAdmin({
      wbs_items: [{ data: { stage: 'im', review_round: 1, review_steps: ['internal', 'client'] } }], wbs_stage_approvals: [{ error: { message: 'x' } }],
    }).admin, 'i', 'p')).toEqual({ ok: false, error: ERR_APPROVAL_STATE })
    cfg.fail = true
    expect(await loadApprovalState(fakeAdmin({ wbs_items: [{ data: { stage: 'ip', review_round: 0, review_steps: null } }] }).admin, 'i', 'p'))
      .toEqual({ ok: false, error: ERR_APPROVAL_CONFIG })
  })
})
