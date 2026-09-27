// 원자 전이 RPC 래퍼(스펙 2026-09-15 §4) — 인자 매핑·결과 파싱·사유 문구.
import { describe, expect, it, vi } from 'vitest'
import { applyWorkflowEvent, ERR_TRANSITION_RPC, REASON_TEXT } from '@/lib/agent/workflowEvent'
import { ERR_REPORT_STALE } from '@/lib/domain/agentWork'

function admin(reply: { data?: unknown; error?: { message: string } | null }) {
  const rpc = vi.fn(async () => ({ data: reply.data ?? null, error: reply.error ?? null }))
  return { client: { rpc } as never, rpc }
}
const W1 = '33333333-3333-4333-8333-333333333333'
const O1 = '22222222-2222-4222-8222-222222222222'

describe('applyWorkflowEvent — RPC 인자 매핑·결과 파싱', () => {
  it('인자를 p_* 로 넘기고 성공 jsonb 를 camelCase 로 돌려준다', async () => {
    const { client, rpc } = admin({ data: { ok: true, order_status: 'approved', stage: 'xx', actual_pct: 100, stage_changed: true, actual_changed: true, reached_first: true, skipped: null } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(rpc).toHaveBeenCalledWith('apply_workflow_event', {
      p_event: 'approve', p_actor: 'u1', p_item_id: null, p_order_id: O1, p_stage: null, p_agent: null, p_agent_user_id: null,
      p_expected_report_id: null,
    })
    expect(r).toEqual({ ok: true, orderStatus: 'approved', stage: 'xx', actualPct: 100, stageChanged: true, actualChanged: true, reachedFirst: true, skipped: null })
  })
  it('numeric 실적이 문자열로 와도 숫자로 바꾼다', async () => {
    const { client } = admin({ data: { ok: true, order_status: null, stage: 'im', actual_pct: '80', stage_changed: true, actual_changed: true, reached_first: true, skipped: null } })
    expect(await applyWorkflowEvent(client, { event: 'set_stage', actorUserId: 'u1', itemId: W1, stage: 'im' })).toMatchObject({ ok: true, actualPct: 80 })
  })
  it('conflict 는 ok:false·conflict:true·현재 status', async () => {
    const { client } = admin({ data: { ok: false, conflict: true, order_status: 'claimed' } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(r).toEqual({ ok: false, conflict: true, reason: 'conflict', orderStatus: 'claimed', error: REASON_TEXT.conflict })
  })
  it('reason 은 사람 문구로, 모르는 reason 도 감추지 않는다', async () => {
    const { client } = admin({ data: { ok: false, reason: 'locked' } })
    expect(await applyWorkflowEvent(client, { event: 'set_stage', actorUserId: 'u1', itemId: W1, stage: 'im' }))
      .toMatchObject({ ok: false, conflict: false, reason: 'locked', error: REASON_TEXT.locked })
    const { client: c2 } = admin({ data: { ok: false, reason: 'weird' } })
    expect(await applyWorkflowEvent(c2, { event: 'assign', actorUserId: 'u1', itemId: W1 })).toMatchObject({ ok: false, error: '전이 실패(weird)' })
  })
  it('RPC 호출 오류는 rpc_error — DB 문구는 로그에만 남기고 호출자에게는 고정 문구를 준다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = admin({ error: { message: 'relation "secret_table" does not exist' } })
    const r = await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1 })
    expect(r).toEqual({ ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: ERR_TRANSITION_RPC })
    expect(JSON.stringify(r)).not.toContain('secret_table')
    expect(errSpy).toHaveBeenCalledTimes(1)
    const line = errSpy.mock.calls[0].join(' ')
    expect(line).toContain('apply_workflow_event')
    expect(line).toContain('approve')
    expect(line).toContain(O1)
    expect(line).toContain('relation "secret_table" does not exist')
    errSpy.mockRestore()
  })
  it('RPC 호출 오류 로그의 머리에는 UUID 꼴이 아닌 id 를 싣지 않는다 — 호출자가 로그 줄을 지어내지 못한다', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = admin({ error: { message: 'boom' } })
    await applyWorkflowEvent(client, { event: 'assign', actorUserId: 'u1', itemId: 'x\n[forged] line' })
    expect(errSpy.mock.calls[0][0]).not.toContain('forged')
    errSpy.mockRestore()
  })
  it('approve·reject 는 본 보고 id 를 싣고, 다른 사건은 싣지 않는다', async () => {
    const { client, rpc } = admin({ data: { ok: true } })
    await applyWorkflowEvent(client, { event: 'reject', actorUserId: 'u1', orderId: O1, expectedReportId: 'r-9' })
    expect(rpc).toHaveBeenLastCalledWith('apply_workflow_event', expect.objectContaining({ p_event: 'reject', p_expected_report_id: 'r-9' }))
    await applyWorkflowEvent(client, { event: 'claim', actorUserId: 'u1', orderId: O1, expectedReportId: 'r-9' })
    const last = rpc.mock.calls.at(-1) as unknown as [string, Record<string, unknown>]
    expect(last[1]).not.toHaveProperty('p_expected_report_id')
  })
  it('report_stale 은 stale 표시와 ERR_REPORT_STALE 문구로', async () => {
    const { client } = admin({ data: { ok: false, reason: 'report_stale', stale: true, order_status: 'reported' } })
    expect(await applyWorkflowEvent(client, { event: 'approve', actorUserId: 'u1', orderId: O1, expectedReportId: 'r-1' }))
      .toEqual({ ok: false, conflict: false, reason: 'report_stale', stale: true, orderStatus: 'reported', error: ERR_REPORT_STALE })
  })
})
