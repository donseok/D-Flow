// tests/actions/wbs-spec-delegation-right.test.ts — 위임·프롬프트 자격(관리자 또는 담당자 본인)과 멤버 경로의 본체
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), resolveProjectId: vi.fn(),
  createAdminClient: vi.fn(), createServerClient: vi.fn(),
  myMemberIds: vi.fn(),
  ensureAgentProject: vi.fn(), backfillProjectOrders: vi.fn(), ensureOrderForWorkflowLeaf: vi.fn(),
  applyWorkflowEvent: vi.fn(), after: vi.fn(), recordProgressSnapshot: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: mocks.requireProjectAdmin, requireProjectMember: mocks.requireProjectMember, resolveProjectId: mocks.resolveProjectId }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: mocks.recordProgressSnapshot }))
vi.mock('@/lib/agent/assignee', () => ({ myMemberIds: mocks.myMemberIds }))
vi.mock('@/lib/data/agentSeatmap', () => ({ DONE_WINDOW_MS: 0 }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureAgentProject: mocks.ensureAgentProject, backfillProjectOrders: mocks.backfillProjectOrders, ensureOrderForWorkflowLeaf: mocks.ensureOrderForWorkflowLeaf }))
vi.mock('@/lib/agent/workflowEvent', () => ({ applyWorkflowEvent: mocks.applyWorkflowEvent }))

import { ERR_AGENT_OFF, ERR_NOT_ASSIGNEE, requireDelegationRight } from '@/lib/agent/delegation'
import { setAgentDelegation, updateAgentPrompt } from '@/app/actions/wbsSpec'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

const P1 = '11111111-1111-4111-8111-111111111111'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null }

/** 큐 기반 admin 목 — 테이블별 순차 응답 + update/insert payload 캡처 + 호출된 테이블 목록. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const calls: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      calls.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'neq', 'order', 'limit']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { captured, calls }
}

const MEMBER = { ok: true, actor: { userId: 'member-1' } }
const DENIED = { ok: false, error: '권한이 없습니다.' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
  mocks.requireProjectAdmin.mockResolvedValue(DENIED)
  mocks.requireProjectMember.mockResolvedValue(MEMBER)
  mocks.myMemberIds.mockResolvedValue(['m1'])
  mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: true, activated: false, stopped: false })
  mocks.ensureOrderForWorkflowLeaf.mockResolvedValue({ ok: true, created: true })
  mocks.applyWorkflowEvent.mockResolvedValue({ ok: true })
})
// 모듈 거부 케이스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('requireDelegationRight', () => {
  it('관리자면 멤버 판정·담당자 조회 없이 통과', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { calls } = admin({})
    const r = await requireDelegationRight(W1)
    expect(r).toEqual({ ok: true, actor: { userId: 'admin-1' }, projectId: P1, isAdmin: true })
    expect(mocks.requireProjectMember).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })
  it('멤버 + 담당자 본인(로스터 id 일치) → 통과, isAdmin=false', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }] })
    const r = await requireDelegationRight(W1)
    expect(r).toEqual({ ok: true, actor: { userId: 'member-1' }, projectId: P1, isAdmin: false })
    expect(mocks.myMemberIds).toHaveBeenCalledWith(expect.anything(), { userId: 'member-1', projectId: P1 })
  })
  it('멤버 + 담당자가 남 → 거부(ERR_NOT_ASSIGNEE)', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm9' } }] })
    expect(await requireDelegationRight(W1)).toEqual({ ok: false, error: ERR_NOT_ASSIGNEE })
  })
  it('멤버 + 담당자 미배정 → 거부', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: null } }] })
    expect(await requireDelegationRight(W1)).toEqual({ ok: false, error: ERR_NOT_ASSIGNEE })
  })
  it('멤버도 아니면 멤버 가드 오류 그대로', async () => {
    mocks.requireProjectMember.mockResolvedValue(DENIED)
    expect(await requireDelegationRight(W1)).toEqual(DENIED)
  })
  it('resolveProjectId 실패면 담당자 조회 전에 중단', async () => {
    mocks.resolveProjectId.mockResolvedValue({ ok: false, error: '대상을 찾을 수 없습니다.' })
    const { calls } = admin({})
    expect(await requireDelegationRight(W1)).toEqual({ ok: false, error: '대상을 찾을 수 없습니다.' })
    expect(calls).toEqual([])
  })
  it('로스터 판정(myMemberIds)이 throw 하면 거부(fail-closed)', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }] })
    mocks.myMemberIds.mockRejectedValue(new Error('로스터 조회 실패: db down'))
    const r = await requireDelegationRight(W1)
    expect(r.ok).toBe(false)
  })
  it('잘못된 itemId → 거부', async () => {
    expect(await requireDelegationRight('nope')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
  })
})

describe('setAgentDelegation — 멤버 경로', () => {
  it('담당자 본인 + 프로젝트 등록·활성 → 태그 붙이고 주문 보장, ensureAgentProject 호출', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }],
      agent_projects: [{ data: { enabled: true } }],
    })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect((captured.wbs_items?.[0] as { tags: string[] }).tags).toEqual(['agent'])
    expect(mocks.ensureAgentProject).toHaveBeenCalled()
    expect(mocks.ensureOrderForWorkflowLeaf).toHaveBeenCalled()
  })
  it('담당자 본인 + 프로젝트 미등록 → ERR_AGENT_OFF, 태그 쓰기 0, ensureAgentProject 미호출', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: null }] })
    expect(await setAgentDelegation(W1, true)).toEqual({ ok: false, error: ERR_AGENT_OFF })
    expect(captured.wbs_items).toBeUndefined()
    expect(mocks.ensureAgentProject).not.toHaveBeenCalled()
  })
  it('담당자 본인 + 프로젝트 중지(enabled=false) → ERR_AGENT_OFF', async () => {
    admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: { enabled: false } }] })
    expect(await setAgentDelegation(W1, true)).toEqual({ ok: false, error: ERR_AGENT_OFF })
  })
  it('담당자 본인 + 행은 활성이어도 agents 모듈이 꺼지면 ERR_AGENT_OFF — 태그 쓰기 0(과제 18, 두 원천 AND)', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: [], dev_workflow: true } }], agent_projects: [{ data: { enabled: true } }] })
    // 액션 관문(세션)은 통과시키고 본체의 두 원천 판정(service_role — { client })만 거부한다
    vi.mocked(requireModule).mockImplementation(async (_s, _m, o) => (o?.client ? { ok: false, error: ERR_MODULE_DISABLED } : { ok: true }))
    expect(await setAgentDelegation(W1, true)).toEqual({ ok: false, error: ERR_AGENT_OFF })
    expect(captured.wbs_items).toBeUndefined()
    expect(requireModule).toHaveBeenCalledWith({ projectId: P1 }, 'agents', { client: expect.anything() })
    expect(mocks.ensureAgentProject).not.toHaveBeenCalled()
  })
  it('관리자 위임 ON — 모듈이 꺼졌으면(moduleOff) 태그는 붙이되 주문은 내지 않고 모듈 안내를 경고로(과제 18)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: false, activated: false, stopped: false, moduleOff: true })
    const { captured } = admin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    const r = await setAgentDelegation(W1, true)
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining('에이전트 모듈이 꺼져') })
    expect((captured.wbs_items?.[0] as { tags: string[] }).tags).toEqual(['agent'])
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })
  it('담당자 본인 해제(false)는 프로젝트 상태와 무관하게 진행 — ready 주문 취소', async () => {
    const { captured } = admin({
      wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: ['agent'], dev_workflow: true } }, { data: [{ id: W1 }] }],
      agent_work_orders: [{ data: [{ id: 'o1', status: 'ready' }] }, { data: null }],
    })
    const r = await setAgentDelegation(W1, false)
    expect(r.ok).toBe(true)
    expect((captured.agent_work_orders?.[0] as { status: string }).status).toBe('cancelled')
  })
  // 2026-09-19 중단 설계 §1 — 위임 해제가 진행 중(claimed) 주문을 취소했으면 단계를 착수 전(as)으로 되돌린다.
  const offQueues = (orders: Array<{ id: string; status: string }>, cancelledIds: string[]) => ({
    wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: { tags: ['agent'], dev_workflow: true } }, { data: [{ id: W1 }] }],
    agent_work_orders: [{ data: orders }, { data: cancelledIds.map(id => ({ id })) }],
  })
  it('해제가 claimed 주문을 취소하면 태그·주문 정리 뒤 set_stage as 로 단계를 되돌린다', async () => {
    const { calls } = admin(offQueues([{ id: 'o1', status: 'claimed' }], ['o1']))
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: true })
    const r = await setAgentDelegation(W1, false)
    expect(r).toMatchObject({ ok: true, cancelledClaimedIds: ['o1'], actualChanged: true })
    expect(r.warning).toBeUndefined()
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'set_stage', actorUserId: 'member-1', itemId: W1, stage: 'as' })
    // 순서: 태그 update(wbs_items) → 주문 조회·취소(agent_work_orders) 뒤에 전이 RPC 가 온다(locked 회피).
    expect(calls.lastIndexOf('agent_work_orders')).toBeGreaterThan(calls.lastIndexOf('wbs_items'))
    // 실적이 바뀌었으면 진척 스냅샷을 응답 뒤로 미룬다.
    expect(mocks.after).toHaveBeenCalledTimes(1)
    mocks.after.mock.calls[0][0]()
    expect(mocks.recordProgressSnapshot).toHaveBeenCalledWith(P1)
  })
  it('ready 만 취소했으면 단계는 건드리지 않는다(재작업 대기 단계를 지우지 않는다)', async () => {
    admin(offQueues([{ id: 'o1', status: 'ready' }], ['o1']))
    const r = await setAgentDelegation(W1, false)
    expect(r.ok).toBe(true)
    expect(r.cancelledClaimedIds).toBeUndefined()
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })
  it('claimed 로 읽었어도 CAS 가 못 바꿨으면(경합) 단계를 되돌리지 않는다', async () => {
    admin(offQueues([{ id: 'o1', status: 'claimed' }], []))
    const r = await setAgentDelegation(W1, false)
    expect(r.ok).toBe(true)
    expect(r.cancelledClaimedIds).toBeUndefined()
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })
  it('단계 되돌리기가 실패해도 해제는 성공 — warning 으로 드러낸다', async () => {
    admin(offQueues([{ id: 'o1', status: 'claimed' }], ['o1']))
    mocks.applyWorkflowEvent.mockResolvedValue({ ok: false, conflict: false, reason: 'rpc_error', orderStatus: null, error: '전이 실패: boom' })
    const r = await setAgentDelegation(W1, false)
    expect(r.ok).toBe(true)
    expect(r.cancelledClaimedIds).toEqual(['o1'])
    expect(r.warning).toContain('단계를 착수 전(as)으로 되돌리지 못했습니다')
    expect(r.warning).toContain('전이 실패: boom')
  })
  it('관리자 경로는 agent_projects 사전 확인 없이 ensureAgentProject 로 간다(종전 동작)', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { calls } = admin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect(mocks.ensureAgentProject).toHaveBeenCalled()
    expect(calls.filter(t => t === 'agent_projects')).toEqual([])
  })
  it('dev_workflow 가 꺼져 있던 리프는 켜면서 이력 1건 + 담당자 있고 단계 없으면 as 전이', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    const { captured } = admin({
      wbs_items: [
        { data: { tags: [], dev_workflow: false } },                                      // 본체 첫 조회
        { data: [{ id: W1 }] },                                                            // 태그 update
        { data: [{ id: W1, assignee_member_id: 'm1', stage: null }] },                     // dev_workflow update
      ],
    })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect((captured.wbs_items?.[1] as { dev_workflow: boolean }).dev_workflow).toBe(true)
    expect((captured.change_logs?.[0] as { field: string; new_value: string })).toMatchObject({ field: 'dev_workflow', new_value: 'true', wbs_item_id: W1 })
    expect(mocks.applyWorkflowEvent).toHaveBeenCalledWith(expect.anything(), { event: 'assign', actorUserId: 'admin-1', itemId: W1 })
  })
  it('프로젝트가 중지 상태면 태그는 붙고 주문은 안 나가며 warning 에 에이전트 페이지 안내', async () => {
    mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'admin-1' } })
    mocks.ensureAgentProject.mockResolvedValue({ ok: true, enabled: false, activated: false, stopped: true })
    admin({ wbs_items: [{ data: { tags: [], dev_workflow: true } }, { data: [{ id: W1 }] }] })
    const r = await setAgentDelegation(W1, true)
    expect(r.ok).toBe(true)
    expect(r.warning).toContain('모듈·메뉴에서 에이전트를 껐다 다시 켜면')
    expect(mocks.ensureOrderForWorkflowLeaf).not.toHaveBeenCalled()
  })
})

describe('updateAgentPrompt — 담당자 본인', () => {
  it('멤버 담당자 본인이면 저장', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm1' } }, { data: [{ id: W1 }] }] })
    expect(await updateAgentPrompt(W1, ' 지시 ')).toEqual({ ok: true })
    expect((captured.wbs_items?.[0] as { agent_prompt: string }).agent_prompt).toBe('지시')
  })
  it('멤버 비담당자면 거부, 쓰기 0', async () => {
    const { captured } = admin({ wbs_items: [{ data: { assignee_member_id: 'm9' } }] })
    expect(await updateAgentPrompt(W1, 'x')).toEqual({ ok: false, error: ERR_NOT_ASSIGNEE })
    expect(captured.wbs_items).toBeUndefined()
  })
})
