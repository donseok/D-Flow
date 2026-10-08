import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AdminClient } from '@/lib/minutes/externalApi'
import { ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { requireModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

vi.mock('@/lib/notify/emit', () => ({
  emitNotification: vi.fn().mockResolvedValue(undefined),
}))

// SP7 — 발행 게이트의 원천은 agents 모듈 하나다(등록 표 agent_projects 는 0041 이 지웠다). 예전에 큐 맨 앞에 넣던 등록 행 응답은 없고,
// 게이트는 전역 mock(tests/setup/module-gate.ts — 기본 통과)의 requireModule 로 준다. "등록 행 없음/꺼짐"을 보던 케이스는 "모듈 꺼짐"으로 옮겼다.
const AGENTS_OFF = { ok: false as const, error: ERR_MODULE_DISABLED }

/**
 * Mock AdminClient 큐 체이닝 기반 테스트.
 * select(...).from(...) 호출 시 큐에 저장되고,
 * maybeSingle()/single() 호출 시 큐의 첫 번째 응답을 반환.
 */
class MockAdminClient {
  private queue: Array<{
    data: unknown
    error: null | { message: string; code?: string }
  }> = []

  lastInsertPayload: Record<string, unknown> | null = null
  /** from() 에 온 표 이름 — 게이트가 닫히면 아무 표도 읽지 않는다는 것을 본다 */
  tables: string[] = []

  from(table: string) {
    this.tables.push(table)
    return this
  }

  select() {
    return this
  }

  eq() {
    return this
  }

  in() {
    return this
  }

  limit() {
    return this
  }

  insert(payload: Record<string, unknown>) {
    this.lastInsertPayload = payload
    return this
  }

  single() {
    const response = this.queue.shift()
    if (!response) {
      return { data: { id: 'mock-order-' + Math.random() }, error: null }
    }
    return response
  }

  async maybeSingle() {
    const response = this.queue.shift()
    return response || { data: null, error: null }
  }

  // 테스트에서 큐 조작용
  pushResponse(data: unknown, error: null | { message: string; code?: string } = null) {
    this.queue.push({ data, error })
    return this
  }
}

// MockAdminClient 는 실제 AdminClient(SupabaseClient) 형과 구조가 다르므로
// 함수 인자로 넘길 때만 캐스트한다 — 프로덕션 시그니처는 그대로 둔다.
const asAdmin = (c: MockAdminClient) => c as unknown as AdminClient

describe('ensureOrderForWorkflowLeaf', () => {
  let admin: AdminClient | MockAdminClient
  const projectId = 'project-1'
  const wbsItemId = 'item-1'
  const actorUserId = 'admin-1'

  beforeEach(() => {
    admin = new MockAdminClient()
    vi.clearAllMocks()
    vi.mocked(requireModule).mockReset()
    vi.mocked(requireModule).mockResolvedValue({ ok: true })
  })

  it('agents 모듈이 꺼져 있으면 → created:false, reason not_agent_project (에러 아님 — 게이트 유지). 어떤 표도 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(AGENTS_OFF)

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
    expect(requireModule).toHaveBeenCalledWith({ projectId }, 'agents', { client: admin })
    expect((admin as MockAdminClient).tables).toEqual([])
    expect((admin as MockAdminClient).lastInsertPayload).toBeNull()
  })

  it('게이트는 모듈 하나다 — 옛 등록 표(agent_projects)는 읽지 않는다. 호출자가 agentsOn 을 넘기면 다시 판정하지 않는다', async () => {
    // 큐: wbs_items [null] — 항목 없음에서 멈춘다(읽은 표를 보려는 것)
    const r1 = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), { projectId, wbsItemId, actorUserId })
    expect(r1).toEqual({ ok: false, error: '항목 없음' })
    expect((admin as MockAdminClient).tables).toEqual(['wbs_items'])
    expect(requireModule).toHaveBeenCalledTimes(1)

    vi.mocked(requireModule).mockClear()
    const r2 = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), { projectId, wbsItemId, actorUserId, agentsOn: true })
    expect(r2).toEqual({ ok: false, error: '항목 없음' })
    expect(requireModule).not.toHaveBeenCalled()

    // agentsOn:false 는 모듈을 다시 읽어 뒤집지 않는다(호출자의 판정이 닫힘이면 닫힘)
    const before = (admin as MockAdminClient).tables.length
    const r3 = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), { projectId, wbsItemId, actorUserId, agentsOn: false })
    expect(r3).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
    expect(requireModule).not.toHaveBeenCalled()
    expect((admin as MockAdminClient).tables.length).toBe(before)
  })

  it('항목 없음(row null) → ok:false (3원칙 — "미도입"으로 위장하지 않는다, F3)', async () => {
    // 큐: wbs_items [null]
    ;(admin as MockAdminClient).pushResponse(null, null)

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: false, error: '항목 없음' })
    expect((admin as MockAdminClient).lastInsertPayload).toBeNull()
  })

  it('dev_workflow=false → created:false, reason not_workflow (주문 insert 미호출)', async () => {
    // 큐: wbs_items [{ dev_workflow: false }]
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: null, dev_workflow: false },
      null
    )

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_workflow' })
    expect((admin as MockAdminClient).lastInsertPayload).toBeNull()
  })

  it('자식 있는 항목(dev_workflow=true) → created:false, reason not_leaf', async () => {
    // 큐: wbs_items [{ dev_workflow: true }] → wbs_items(자식) [{ id: 'child' }]
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: null, dev_workflow: true },
      null
    )
    ;(admin as MockAdminClient).pushResponse({ id: 'child' }, null)

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_leaf' })
  })

  it('활성 주문 존재 → created:false, reason active_exists (no-op 멱등)', async () => {
    // 큐: wbs_items [{ dev_workflow: true }] → wbs_items(자식) [null] → agent_work_orders [{ id: 'o-1' }]
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: null, dev_workflow: true },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse({ id: 'o-1' }, null)

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'active_exists' })
  })

  it('조건 충족(dev_workflow=true, 배정 있음) → insert, created:true, payload 검증 + 알림 발행', async () => {
    // 큐: wbs_items [item] → wbs_items(자식) [null] → agent_work_orders [null] → insert [{ id: 'order-1' }]
    ;(admin as MockAdminClient).pushResponse(
      {
        name: 'Test Item',
        priority: 'high',
        external_ref: 'REF-123',
        assignee_member_id: 'member-1',
        dev_workflow: true,
      },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse({ id: 'order-1' }, null)

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: true })

    // Insert payload 검증
    const payload = (admin as MockAdminClient).lastInsertPayload
    expect(payload).toMatchObject({
      project_id: projectId,
      wbs_item_id: wbsItemId,
      instructions: 'REF-123 Test Item',
      priority: 50, // high = 50
      created_by: actorUserId,
    })

    // 알림 발행 검증
    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).toHaveBeenCalledOnce()
    expect(emitNotification).toHaveBeenCalledWith({
      type: 'work.order_created',
      projectId,
      entityType: 'agent_order',
      entityId: 'order-1',
      payload: {
        title: 'Test Item',
        detail: '작업 주문이 발행되었습니다',
        href: `/p/${projectId}/wbs`,
      },
      recipientMemberIds: ['member-1'],
      dedupeKey: `order_created:${wbsItemId}:order-1`,
    })
  })

  it('dev_workflow=true, 배정 없음(assignee null) → 주문은 생성되나 알림은 발행 안 됨(수신자 없음)', async () => {
    // 큐: wbs_items [item, assignee null] → wbs_items(자식) [null] → agent_work_orders [null] → insert [{ id: 'order-2' }]
    ;(admin as MockAdminClient).pushResponse(
      {
        name: 'Test Item',
        priority: 'medium',
        external_ref: 'REF-456',
        assignee_member_id: null,
        dev_workflow: true,
      },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse({ id: 'order-2' }, null)

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: true })

    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('경합 unique violation(23505) → created:false 수렴(멱등 — 에러 아님, 알림 미발행)', async () => {
    ;(admin as MockAdminClient).pushResponse(
      {
        name: 'Test Item',
        priority: 'high',
        external_ref: 'REF-123',
        assignee_member_id: 'member-1',
        dev_workflow: true,
      },
      null
    )
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(null, null)
    ;(admin as MockAdminClient).pushResponse(
      null,
      { message: 'duplicate key value', code: '23505' }
    )

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: true, created: false, reason: 'active_exists' })

    // 알림이 발행되지 않아야 함
    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  // 삭제(SP7): '선행조회(agent_projects) 실패 → ok:false' — 그 선행조회(등록 표)가 없어졌다. 게이트의 판정 실패는 requireModule 이 로그를 남기고
  // 닫힘({ ok:false })으로 돌려주며(tests/modules/gate.test.ts 가 고정), 여기서는 그 닫힘이 발행 0건이 되는지를 본다(fail-closed — 위 첫 케이스와 같은 갈래).
  it('모듈 판정이 닫히면(판정 실패 포함) 발행하지 않는다 — 항목·주문을 읽지 않고 insert 도 없다', async () => {
    vi.mocked(requireModule).mockResolvedValue(AGENTS_OFF)
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: 'member-1', dev_workflow: true },
      null
    )

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), { projectId, wbsItemId, actorUserId })

    expect(result).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
    expect((admin as MockAdminClient).tables).toEqual([])
    expect((admin as MockAdminClient).lastInsertPayload).toBeNull()
  })

  it('항목 조회 실패 → ok:false (3원칙 — 위장 금지)', async () => {
    ;(admin as MockAdminClient).pushResponse(null, { message: 'item lookup down' })

    const result = await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('항목 조회 실패') })
  })

  it('게이트 미통과(not_agent_project) 시 알림 미발행', async () => {
    // agents 모듈 꺼짐
    vi.mocked(requireModule).mockResolvedValue(AGENTS_OFF)

    await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })

  it('게이트 미통과(not_workflow) 시 알림 미발행', async () => {
    ;(admin as MockAdminClient).pushResponse(
      { name: 'Test Item', priority: 'high', external_ref: 'REF-123', assignee_member_id: 'member-1', dev_workflow: false },
      null
    )

    await ensureOrderForWorkflowLeaf(asAdmin(admin as MockAdminClient), {
      projectId,
      wbsItemId,
      actorUserId,
    })

    const { emitNotification } = await import('@/lib/notify/emit')
    expect(emitNotification).not.toHaveBeenCalled()
  })
})
