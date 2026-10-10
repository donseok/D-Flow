import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn(), config: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// 워크스페이스 알림 정책(notify.policy)의 읽기 — 해석기만 가짜로 두고 관문(src/lib/notify/policy.ts)은 실물을 지난다
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: mocks.config }))

import { emitNotification } from '@/lib/notify/emit'
import { WorkspaceArchivedError } from '@/lib/settings/errors'

type Resp = { data?: unknown; error?: { code?: string; message: string } | null }

/** 정책 값 하나를 가진 워크스페이스 설정 — valueOf 가 읽는 꼴만 */
const policyCfg = (value: unknown) => ({ keys: { 'notify.policy': { status: 'set', value } } })

/** 테이블별 응답 큐 mock — tests/actions/agent-work-actions.test.ts 관례 축소판. projects 는 큐가 없으면 p1 → ws-1(정책 관문의 워크스페이스 해석) */
function admin(queues: Record<string, Resp[]>) {
  const inserted: Record<string, unknown[]> = {}
  const calls: Record<string, unknown[][]> = {}
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? (table === 'projects' && !queues.projects ? { data: { workspace_id: 'ws-1' } } : { data: null, error: null })
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit']) {
        b[k] = (...args: unknown[]) => { (calls[`${table}.${k}`] ??= []).push(args); return b }
      }
      b.insert = (rows: unknown) => { (inserted[table] ??= []).push(rows); return b }
      b.single = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.maybeSingle = b.single
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(client)
  return { client, inserted, calls }
}

beforeEach(() => { vi.clearAllMocks(); mocks.config.mockReset(); mocks.config.mockResolvedValue(policyCfg({})) })

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
  it('수신자는 활성 명단 행·활성 인물만 — 쿼리가 두 active 필터를 건다', async () => {
    const { calls } = admin({
      project_members: [{ data: [{ id: 'm1', people: { user_id: 'u1' } }] }],
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    await emitNotification({
      type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' }, recipientMemberIds: ['m1'],
    })
    expect(calls['project_members.select']).toEqual([['id, people!inner(user_id, active)']])
    expect(calls['project_members.eq']).toEqual([['active', true], ['people.active', true]])
  })
  it('프로젝트가 있으면 workspace_id 는 null 로 싣는다(트리거가 채운다)', async () => {
    const { inserted } = admin({
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    await emitNotification({ type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' }, recipientUserIds: ['u1'] })
    expect(inserted.notification_events[0]).toMatchObject({ project_id: 'p1', workspace_id: null })
  })
  it('프로젝트 없는 알림은 workspaceId 를 싣는다', async () => {
    const { inserted } = admin({
      notification_events: [{ data: { id: 'ev1' } }],
      notification_recipients: [{ data: null }],
    })
    const r = await emitNotification({
      type: 'issue.assigned', projectId: null, workspaceId: 'ws-1', payload: { title: 'T' }, recipientUserIds: ['u1'],
    })
    expect(r.ok).toBe(true)
    expect(inserted.notification_events[0]).toMatchObject({ project_id: null, workspace_id: 'ws-1' })
  })
  it('프로젝트도 workspaceId 도 없으면 ok:false + 로깅 — 이벤트를 쓰지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { inserted } = admin({})
    const r = await emitNotification({ type: 'issue.assigned', projectId: null, payload: { title: 'T' }, recipientUserIds: ['u1'] })
    expect(r).toEqual({ ok: false })
    expect(inserted.notification_events).toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('emitNotification — 워크스페이스 알림 정책 notify.policy(개정 §4.10)', () => {
  const full = () => ({ notification_events: [{ data: { id: 'ev1' } }], notification_recipients: [{ data: null }] })
  const emitIssue = (over: Record<string, unknown> = {}) => emitNotification({
    type: 'issue.assigned', projectId: 'p1', payload: { title: 'T' }, recipientUserIds: ['u1'], ...over,
  } as Parameters<typeof emitNotification>[0])

  it('켜진 유형은 발행한다 — 프로젝트의 워크스페이스로 정책을 읽는다(같은 service_role 클라이언트)', async () => {
    const { client, inserted, calls } = admin(full())
    mocks.config.mockResolvedValue(policyCfg({ 'issue.update': { enabled: false } }))
    expect(await emitIssue()).toEqual({ ok: true, recipients: 1 })
    expect(inserted.notification_events).toHaveLength(1)
    expect(calls['projects.eq']).toEqual([['id', 'p1']])
    expect(mocks.config).toHaveBeenCalledWith('ws-1', { client })
  })
  it('꺼진 유형은 발행하지 않는다 — 이벤트·수신자 행 0, 수신자 해석도 하지 않는다. 실패가 아니다(suppressed)', async () => {
    const { client, inserted } = admin({ project_members: [{ data: [{ id: 'm1', people: { user_id: 'u1' } }] }], ...full() })
    mocks.config.mockResolvedValue(policyCfg({ 'issue.assigned': { enabled: false } }))
    expect(await emitIssue({ recipientMemberIds: ['m1'] })).toEqual({ ok: true, recipients: 0, suppressed: true })
    expect(inserted.notification_events).toBeUndefined()
    expect(inserted.notification_recipients).toBeUndefined()
    expect(client.from.mock.calls.map((c) => c[0])).toEqual(['projects'])
  })
  it('필수 유형은 정책과 무관하게 발행한다 — 저장값이 끄라고 해도. 워크스페이스 설정은 보관 판정(0056) 때문에 읽는다', async () => {
    const { inserted } = admin(full())
    mocks.config.mockResolvedValue(policyCfg({ 'work.reported': { enabled: false } }))
    expect(await emitIssue({ type: 'work.reported' })).toEqual({ ok: true, recipients: 1 })
    expect(inserted.notification_events).toHaveLength(1)
    expect(mocks.config).toHaveBeenCalledTimes(1)
  })
  it('필수 유형 — 설정을 읽지 못해도 발행한다(로그 없이: 필수 유형은 정책이 필요 없다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { inserted } = admin(full())
    mocks.config.mockRejectedValue(new Error('settings down'))
    expect(await emitIssue({ type: 'work.reported' })).toEqual({ ok: true, recipients: 1 })
    expect(inserted.notification_events).toHaveLength(1)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('보관된 워크스페이스(0056) — 동결이다. 일반 유형도 필수 유형도 이벤트·수신자 행을 쓰지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const type of ['issue.assigned', 'work.reported'] as const) {
      const { inserted } = admin(full())
      mocks.config.mockRejectedValue(new WorkspaceArchivedError('ws-1'))
      expect(await emitIssue({ type }), type).toEqual({ ok: true, recipients: 0, suppressed: true })
      expect(inserted.notification_events, type).toBeUndefined()
      expect(inserted.notification_recipients, type).toBeUndefined()
    }
    expect(spy).not.toHaveBeenCalled()   // 읽기 실패가 아니다 — 닫은 것이다
    spy.mockRestore()
  })
  it('정책 읽기 실패 — 발행하고 로그를 남긴다(알림 유실보다 과발행)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { inserted } = admin(full())
    mocks.config.mockRejectedValue(new Error('settings down'))
    expect(await emitIssue()).toEqual({ ok: true, recipients: 1 })
    expect(inserted.notification_events).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0].join(' ')).toContain('notify.policy')
    expect(spy.mock.calls[0].join(' ')).toContain('settings down')
    spy.mockRestore()
  })
  it('정책 값이 손상(invalid)이어도 발행하고 로그를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { inserted } = admin(full())
    mocks.config.mockResolvedValue({ keys: { 'notify.policy': { status: 'invalid', error: '모르는 알림 유형입니다: x' } } })
    expect((await emitIssue()).ok).toBe(true)
    expect(inserted.notification_events).toHaveLength(1)
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('프로젝트의 워크스페이스를 읽지 못하면(조회 오류·행 없음) 정책 없이 발행하고 로그를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const projects of [[{ data: null, error: { message: 'boom' } }], [{ data: null }]]) {
      const { inserted } = admin({ projects, ...full() })
      expect((await emitIssue()).ok).toBe(true)
      expect(inserted.notification_events).toHaveLength(1)
    }
    expect(mocks.config).not.toHaveBeenCalled()
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
  it('프로젝트 없는 알림은 넘겨받은 workspaceId 의 정책을 따른다 — 프로젝트 조회 없음', async () => {
    const { client, inserted } = admin(full())
    mocks.config.mockResolvedValue(policyCfg({ 'issue.assigned': { enabled: false } }))
    expect(await emitIssue({ projectId: null, workspaceId: 'ws-9' })).toEqual({ ok: true, recipients: 0, suppressed: true })
    expect(mocks.config).toHaveBeenCalledWith('ws-9', { client })
    expect(client.from).not.toHaveBeenCalled()
    expect(inserted.notification_events).toBeUndefined()
  })
  it('워크스페이스를 알 수 없는 알림(프로젝트·workspaceId 둘 다 없음)에는 정책을 적용하지 않는다 — 지금처럼 emit 이 판정한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    admin({})
    mocks.config.mockResolvedValue(policyCfg({ 'issue.assigned': { enabled: false } }))
    expect(await emitIssue({ projectId: null })).toEqual({ ok: false })           // suppressed 가 아니라 기존 거절(workspaceId 누락) 그대로
    expect(mocks.config).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('한 워크스페이스의 정책은 다른 워크스페이스의 발행을 막지 않는다', async () => {
    mocks.config.mockImplementation(async (wid: string) => policyCfg(wid === 'ws-r' ? { 'issue.assigned': { enabled: false } } : {}))
    const r = admin({ projects: [{ data: { workspace_id: 'ws-r' } }], ...full() })
    expect((await emitIssue({ projectId: 'pr' })).suppressed).toBe(true)
    expect(r.inserted.notification_events).toBeUndefined()
    const c = admin({ projects: [{ data: { workspace_id: 'ws-c' } }], ...full() })
    expect(await emitIssue({ projectId: 'pc' })).toEqual({ ok: true, recipients: 1 })
    expect(c.inserted.notification_events).toHaveLength(1)
  })
})
