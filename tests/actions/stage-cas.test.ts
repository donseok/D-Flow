// 사람의 단계 지정이 '화면이 본 단계'를 받는다(SPU1 — 0048 apply_workflow_event_stage_cas). 서버 단계가 그새 달라졌으면 쓰지 않고
// conflict·latest 로 답한다. 액션에서 실제 도우미(applyWorkflowEvent)를 거쳐 RPC 이름·인자까지 본다 — DB 판정 자체는 tests/rls 몫이다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), resolveProjectId: vi.fn(), createAdminClient: vi.fn(), rpc: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({
  requireProjectAdmin: mocks.requireProjectAdmin, requireProjectMember: mocks.requireProjectMember, resolveProjectId: mocks.resolveProjectId,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn() }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: vi.fn() }))
vi.mock('@/lib/ai/index/enqueueChange', () => ({ enqueueIndexChange: vi.fn(async () => {}) }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn(async () => {}) }))
vi.mock('next/server', async (orig) => ({ ...(await orig() as Record<string, unknown>), after: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { setWbsStage } from '@/app/actions/wbsAssign'
import { ERR_TRANSITION_RPC } from '@/lib/agent/workflowEvent'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'
const RPC_OK = { ok: true, stage: 'ip', stage_changed: true, actual_changed: false, reached_first: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.rpc.mockResolvedValue({ data: RPC_OK, error: null })
  mocks.createAdminClient.mockReturnValue({ rpc: mocks.rpc, from: () => { throw new Error('표를 직접 읽지 않는다(시험)') } })
})

describe('setWbsStage — 내가 본 단계(expectedStage)', () => {
  it('기대값이 오면 단계 값 대조 RPC 를 부른다 — 프로젝트·가드의 행위자·본 단계·새 단계', async () => {
    expect(await setWbsStage(W1, 'ip', undefined, undefined, 'as')).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledWith('apply_workflow_event_stage_cas', {
      p_project_id: P1, p_actor: 'admin-1', p_item_id: W1, p_expected_stage: 'as', p_stage: 'ip', p_expected_step: null,
    })
  })

  it('null 기대값은 "단계 없음을 봤다" — 대조를 건너뛰지 않는다', async () => {
    expect(await setWbsStage(W1, 'as', undefined, undefined, null)).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledWith('apply_workflow_event_stage_cas', expect.objectContaining({ p_expected_stage: null, p_stage: 'as' }))
  })

  it('서버 단계가 그새 달라졌으면 conflict 와 현재 단계(latest) — 단계 없음(null)도 값이다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'conflict', conflict: true, latest_stage: 'im' }, error: null })
    expect(await setWbsStage(W1, 'ip', undefined, undefined, 'as')).toEqual({ ok: false, conflict: true, latest: 'im', error: expect.stringContaining('단계를 먼저') })
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'conflict', conflict: true, latest_stage: null }, error: null })
    expect(await setWbsStage(W1, 'ip', undefined, undefined, 'as')).toMatchObject({ ok: false, conflict: true, latest: null })
  })

  it('래퍼를 지나 온 다른 conflict(주문 상태 — latest_stage 없음)는 옛 stale 그대로다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, reason: 'conflict', conflict: true }, error: null })
    const res = await setWbsStage(W1, 'ip', undefined, undefined, 'as')
    expect(res).toMatchObject({ ok: false, stale: true })
    expect(res).not.toHaveProperty('conflict')
  })

  it('기대값 없이는 옛 RPC — 대조 없는 set_stage', async () => {
    expect(await setWbsStage(W1, 'ip')).toEqual({ ok: true })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc.mock.calls[0][0]).toBe('apply_workflow_event')
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_event: 'set_stage', p_actor: 'admin-1', p_item_id: W1, p_stage: 'ip' })
  })

  it('일괄 편집의 행 revision(expectedUpdatedAt)이 같이 오면 그쪽 래퍼가 우선이다', async () => {
    await setWbsStage(W1, 'ip', undefined, '2026-10-09T00:00:00Z', 'as')
    expect(mocks.rpc.mock.calls.map(c => c[0])).toEqual(['apply_workflow_event_cas'])
  })

  it('RPC 오류는 실패 — 고정 문구, 충돌로 위장하지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'XX000', message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await setWbsStage(W1, 'ip', undefined, undefined, 'as')).toEqual({ ok: false, error: ERR_TRANSITION_RPC })
    spy.mockRestore()
  })

  it('기대값이 단계 코드가 아니면 가드·RPC 앞에서 거부한다', async () => {
    expect(await setWbsStage(W1, 'ip', undefined, undefined, 'zz' as never)).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(mocks.resolveProjectId).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
