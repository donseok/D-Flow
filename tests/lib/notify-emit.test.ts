import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { emitNotification } from '@/lib/notify/emit'

type Resp = { data?: unknown; error?: { code?: string; message: string } | null }

/** 테이블별 응답 큐 mock — tests/actions/agent-work-actions.test.ts 관례 축소판 */
function admin(queues: Record<string, Resp[]>) {
  const inserted: Record<string, unknown[]> = {}
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) b[k] = () => b
      b.insert = (rows: unknown) => { (inserted[table] ??= []).push(rows); return b }
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, inserted }
}

beforeEach(() => vi.clearAllMocks())

describe('emitNotification', () => {
  it('member 수신자를 people.user_id 스냅샷으로 해석해 이벤트+수신자 행을 쓴다', async () => {
    const { inserted } = admin({
      project_members: [{ data: [{ id: 'm1', people: { user_id: 'u1' } }, { id: 'm2', people: { user_id: null } }] }],
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', actorUserId: 'actor',
      payload: { title: 'T' }, recipientMemberIds: ['m1', 'm2'],
    })
    expect(r.ok).toBe(true)
    expect(r.recipients).toBe(2) // 계정 미링크(m2)도 행은 남는다 — 링크 후 대비는 아니고 감사 목적
    const rows = inserted.notification_recipients[0] as { member_id: string | null; user_id: string | null }[]
    // member 수신자는 project_id 필수(CHECK notification_recipients_member_needs_project, 0003) — 이벤트의 프로젝트.
    expect(rows).toEqual([
      { event_id: 'ev1', member_id: 'm1', user_id: 'u1', project_id: 'p1' },
      { event_id: 'ev1', member_id: 'm2', user_id: null, project_id: 'p1' },
    ])
  })
  it('행위자 본인이 유일 수신자면 발행하지 않는다 (no-op)', async () => {
    admin({ project_members: [{ data: [{ id: 'm1', people: { user_id: 'actor' } }] }] })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', actorUserId: 'actor',
      payload: { title: 'T' }, recipientMemberIds: ['m1'],
    })
    expect(r).toEqual({ ok: true, recipients: 0 })
  })
  it('dedupe_key 충돌(23505)은 성공으로 삼킨다', async () => {
    admin({
      project_members: [{ data: [{ id: 'm1', people: { user_id: 'u1' } }] }],
      notification_events: [{ data: null, error: { code: '23505', message: 'duplicate' } }],
    })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' },
      recipientMemberIds: ['m1'], dedupeKey: 'k1',
    })
    expect(r).toEqual({ ok: true, deduped: true })
  })
  it('수신자 해석 실패는 ok:false + 로깅 — throw 하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin({ project_members: [{ data: null, error: { message: 'boom' } }] })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' }, recipientMemberIds: ['m1'],
    })
    expect(r.ok).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('actor 미지정 + 미링크 멤버 → recipient row가 유지된다', async () => {
    const { inserted } = admin({
      project_members: [{ data: [{ id: 'm1', people: { user_id: null } }] }],
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    // member 수신자는 프로젝트 이벤트에서만 성립한다(0003 CHECK·복합 FK) — 프로젝트 있는 이벤트로 검증한다.
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1',
      payload: { title: 'T' }, recipientMemberIds: ['m1'],
    })
    expect(r.ok).toBe(true)
    expect(r.recipients).toBe(1)
    const rows = inserted.notification_recipients[0] as { member_id: string | null; user_id: string | null }[]
    expect(rows).toEqual([{ event_id: 'ev1', member_id: 'm1', user_id: null, project_id: 'p1' }])
  })
  it('user 수신자(member 없음)는 project_id 를 싣지 않는다 — member 가 없으면 CHECK 대상이 아니다', async () => {
    const { inserted } = admin({
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' }, recipientUserIds: ['u7'],
    })
    expect(r.ok).toBe(true)
    expect(inserted.notification_recipients[0]).toEqual([{ event_id: 'ev1', member_id: null, user_id: 'u7', project_id: null }])
  })
})
