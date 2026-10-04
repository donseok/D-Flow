import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * SP5b W2(스펙 D21) — 선행 기준 final 에서 소비처 다섯(claim 게이트 재료·후속 알림·대기 사유·상세 패널 판정)이 같은 입력·같은 답을 낸다.
 * 기준 판독(loadPredecessorGate)은 전역 셋업이 'reached' 로 mock 한다 — 여기서 final 을 준다.
 */
const mocks = vi.hoisted(() => ({ emitNotification: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { loadDependsInfo } from '@/lib/agent/depends'
import { notifySuccessorsOnReached } from '@/lib/agent/stageTransition'
import { loadPredecessorGate } from '@/lib/agent/predecessorGate'
import { deriveWaitReason } from '@/lib/domain/waitReason'
import { evaluateStartReadiness } from '@/lib/domain/dependencyReadiness'
import { dependencyNotMetMessage } from '@/lib/domain/agentWork'

type Resp = { data?: unknown; error?: { message: string } | null }
function fakeAdmin(queues: Record<string, Resp[]>) {
  const calls: string[] = []
  const admin = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit', 'order', 'contains']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  return { admin: admin as never, calls }
}

beforeEach(() => { vi.clearAllMocks() })

describe('loadDependsInfo — reached 값이 기준을 따른다(키·타입 불변)', () => {
  const imRow = { id: 'p1', external_ref: 'R1', stage: 'im', actual_pct: 80, dev_workflow: true }
  it('기본(reached): im 선행은 충족', async () => {
    const { admin } = fakeAdmin({ wbs_items: [{ data: [imRow] }], agent_work_orders: [{ data: null }] })
    expect((await loadDependsInfo(admin, { projectId: 'P', depends: ['R1'] }))[0]).toMatchObject({ reached: true, stage: 'im' })
  })
  it('final: im 선행은 미충족, 흐름 안 실적 100 도 미충족, 흐름 밖 실적 100·승인 주문은 충족', async () => {
    const run = async (row: object, approved: boolean) => {
      const { admin } = fakeAdmin({ wbs_items: [{ data: [row] }], agent_work_orders: [{ data: approved ? { id: 'o' } : null }], agent_work_reports: [{ data: null }] })
      return (await loadDependsInfo(admin, { projectId: 'P', depends: ['R1'], gate: 'final' }))[0].reached
    }
    expect(await run(imRow, false)).toBe(false)
    expect(await run({ ...imRow, stage: 'ip', actual_pct: 100 }, false)).toBe(false)
    expect(await run({ ...imRow, stage: null, actual_pct: 100, dev_workflow: false }, false)).toBe(true)
    expect(await run(imRow, true)).toBe(true)
    expect(await run({ ...imRow, stage: 'xx' }, false)).toBe(true)
  })
  it('claim 거부 문구는 기준마다 충족 조건을 말한다(code·키는 그대로)', () => {
    expect(dependencyNotMetMessage('reached')).toContain('검수 대기 이상')
    expect(dependencyNotMetMessage('final')).toContain('최종 승인')
  })
})

describe('notifySuccessorsOnReached — final 이면 im 선행으로 work.unblocked 를 내지 않는다', () => {
  const item = { id: 'pred', project_id: 'P', name: '선행', external_ref: 'R1' }
  const successor = { id: 's1', name: '후행', assignee_member_id: 'm1', depends: ['R1'] }
  it('final + 선행 im → 승인 주문 축을 읽고(없음) 발행 생략', async () => {
    vi.mocked(loadPredecessorGate).mockResolvedValueOnce('final')
    const { admin, calls } = fakeAdmin({
      wbs_items: [{ data: [successor] }, { data: [{ id: 'pred', external_ref: 'R1', stage: 'im', actual_pct: 80, dev_workflow: true }] }],
      agent_work_orders: [{ data: [] }],
    })
    await notifySuccessorsOnReached(admin, item, 'u1')
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(calls).toContain('agent_work_orders')
  })
  it('final + 선행 xx → 발행(승인 주문 축은 읽지 않는다)', async () => {
    vi.mocked(loadPredecessorGate).mockResolvedValueOnce('final')
    const { admin, calls } = fakeAdmin({
      wbs_items: [{ data: [successor] }, { data: [{ id: 'pred', external_ref: 'R1', stage: 'xx', actual_pct: 100, dev_workflow: true }] }],
    })
    await notifySuccessorsOnReached(admin, item, 'u1')
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'work.unblocked', dedupeKey: 'unblocked:s1:pred' }))
    expect(calls).not.toContain('agent_work_orders')
  })
  it('기준 판독 실패 → 발행 생략(거짓 착수 가능 알림 없음)', async () => {
    vi.mocked(loadPredecessorGate).mockRejectedValueOnce(new Error('CONFIG_INVALID'))
    const { admin } = fakeAdmin({ wbs_items: [{ data: [successor] }] })
    await notifySuccessorsOnReached(admin, item, 'u1')
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })
})

describe('대기 사유·상세 패널 — claim 게이트와 같은 판정', () => {
  const pred = { external_ref: 'R1', code: 'P-1', name: '선행', stage: 'im', order_approved: false, actual_pct: 80, dev_workflow: true }
  it('deriveWaitReason: final 이면 im 선행이 선행 대기, 문구가 기준을 말한다', () => {
    const base = { depends: ['R1'], predecessorByRef: () => pred, assignee: null, watchers: [] }
    expect(deriveWaitReason({ ...base, gate: 'reached' }).kind).toBe('agent_off')
    const w = deriveWaitReason({ ...base, gate: 'final' })
    expect(w.kind).toBe('dependency')
    expect(w.text).toContain('완료(xx)')
  })
  it('evaluateStartReadiness: spec 링크는 승인 축·dev_workflow 를 본다', () => {
    const link = [{ id: 'd', predecessorId: 'p', successorId: 't', type: 'FS' as const, lagDays: 0, origin: 'spec' as const }]
    const t = { id: 't', rolledActualPct: 0 }
    const at = (p: object, gate: 'reached' | 'final') => evaluateStartReadiness(t, link, new Map([['p', { id: 'p', rolledActualPct: 0, ...p }]]), [], gate).ready
    expect(at({ stage: 'im' }, 'reached')).toBe(true)
    expect(at({ stage: 'im' }, 'final')).toBe(false)
    expect(at({ stage: 'im', orderApproved: true }, 'final')).toBe(true)
    expect(at({ stage: null, rolledActualPct: 100, devWorkflow: true }, 'final')).toBe(false)
    expect(at({ stage: null, rolledActualPct: 100, devWorkflow: false }, 'final')).toBe(true)
  })
})
