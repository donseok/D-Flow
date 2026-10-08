import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn().mockResolvedValue(undefined) }))

import { backfillProjectOrders } from '@/lib/agent/ensureOrder'
import { moduleState, requireModule } from '@/lib/modules/gate'
import type { AdminClient } from '@/lib/minutes/externalApi'

type Resp = { data?: unknown; error?: { message: string; code?: string } | null }
/** 테이블별 응답 큐 — 호출 순서대로 소비. update/insert payload 는 captured 에 쌓인다. */
function admin(queues: Record<string, Resp[]>) {
  const captured: Record<string, unknown[]> = {}
  const tables: string[] = []
  const client = {
    from: vi.fn((table: string) => {
      tables.push(table)
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'limit']) b[k] = () => b
      b.update = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.insert = (payload: unknown) => { (captured[table] ??= []).push(payload); return b }
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  return { client: client as unknown as AdminClient, captured, tables }
}
const P1 = 'project-1'
beforeEach(() => { vi.mocked(moduleState).mockClear(); vi.mocked(requireModule).mockClear() })

// 삭제(SP7 — 0041 이 등록 표 agent_projects 를 지웠다): 'ensureAgentProject — 자동 활성(위임 체크 = 발행)' 5 케이스.
//  · 행 없음 → insert·activated / insert 23505 경합 → 재조회: 자동 등록 자체가 없어졌다(정본 §5.3.1 "자동 생성 분기 삭제" — 켜는 입구는 프로젝트 설정 하나).
//  · 이미 활성 → no-op / 중지(enabled:false)는 되살리지 않는다: 켜짐·꺼짐의 원천이 agents 모듈 하나가 됐다 — "꺼져 있으면 발행하지 않는다"는
//    아래 백필의 꺼짐 케이스와 tests/agent/ensure-order.test.ts(리프 게이트)·tests/modules/agents-gate.test.ts(호출부)가 본다.
//  · 조회 실패는 ok:false: 등록 조회가 없다. 모듈 판정 불가는 아래 'unknown' 케이스(오류로 드러낸다 — 3원칙).
describe('backfillProjectOrders — 활성 시점 소급 발행', () => {
  it('dev_workflow 리프마다 주문 보장 — 생성 수 집계, 개별 실패는 failed 로 모으고 계속', async () => {
    // wbs_items: 백필 대상 3건. 이후 ensureOrderForWorkflowLeaf 가 항목마다 wbs_items→wbs_items(child)→orders→insert 순으로 읽는다.
    const { client, tables } = admin({
      wbs_items: [
        { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
        // a: 항목 조회 → 리프 → 발행
        { data: { name: 'A', priority: 'high', external_ref: 'm/A', assignee_member_id: null, dev_workflow: true } }, { data: null },
        // b: 항목 조회 실패 → failed
        { data: null, error: { message: 'boom' } },
        // c: 항목 조회 → 자식 있음(리프 아님) → skip
        { data: { name: 'C', priority: null, external_ref: 'm/C', assignee_member_id: null, dev_workflow: true } }, { data: { id: 'child' } },
      ],
      agent_work_orders: [{ data: null }, { data: { id: 'o-a' } }],
    })
    const r = await backfillProjectOrders(client, { projectId: P1, actorUserId: 'u1' })
    expect(r).toEqual({ ok: true, created: 1, failed: ['b'] })
    // 게이트는 모듈 판정 한 번(moduleState)이다 — 옛 등록 표는 읽지 않고, 리프마다 모듈을 다시 판정하지도 않는다
    expect(tables).not.toContain('agent_projects')
    expect(new Set(tables)).toEqual(new Set(['wbs_items', 'agent_work_orders']))
    expect(moduleState).toHaveBeenCalledTimes(1)
    expect(moduleState).toHaveBeenCalledWith({ projectId: P1 }, 'agents', { client })
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('agents 모듈이 꺼져 있으면 발행 0 — 대상도 읽지 않는다(예전 "등록 행이 꺼져 있으면 닫힘"의 자리)', async () => {
    vi.mocked(moduleState).mockResolvedValueOnce('off')
    const { client, tables } = admin({ wbs_items: [{ data: [{ id: 'a' }] }] })
    expect(await backfillProjectOrders(client, { projectId: P1, actorUserId: 'u1' })).toEqual({ ok: true, created: 0, failed: [] })
    expect(tables).toEqual([])
  })
  it('모듈 설정을 판정하지 못하면(unknown) 오류로 돌린다 — 0건 성공으로 위장하지 않는다', async () => {
    vi.mocked(moduleState).mockResolvedValueOnce('unknown')
    const { client, tables } = admin({ wbs_items: [{ data: [{ id: 'a' }] }] })
    expect(await backfillProjectOrders(client, { projectId: P1, actorUserId: 'u1' })).toEqual({ ok: false, error: '에이전트 모듈 설정을 확인하지 못했습니다.' })
    expect(tables).toEqual([])
  })
  it('대상 조회 실패는 ok:false', async () => {
    const { client } = admin({ wbs_items: [{ data: null, error: { message: 'boom' } }] })
    const r = await backfillProjectOrders(client, { projectId: P1, actorUserId: 'u1' })
    expect(r.ok).toBe(false)
  })
})
