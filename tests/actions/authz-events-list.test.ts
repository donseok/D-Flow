import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ guard: vi.fn(), server: vi.fn(), adminFor: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.guard }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.server }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))

import { listAuthzEvents } from '@/app/actions/authzEvents'
import { ERR_DENIED } from '@/lib/authz/errors'

const WS = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const U_ACTOR = '00000000-0000-4000-8000-0000000000a1'
const U_TARGET = '00000000-0000-4000-8000-0000000000a2'
const U_GONE = '00000000-0000-4000-8000-0000000000a3'
const P1 = '00000000-0000-4000-8000-0000000000b1'
const PE = '00000000-0000-4000-8000-0000000000c1'

const row = (id: number, over: Record<string, unknown> = {}) => ({
  id, kind: 'workspace_role', workspace_id: WS, project_id: null, target_user_id: U_TARGET, target_person_id: null,
  before: { role: 'member' }, after: { role: 'admin' }, cause: 'direct', actor_user_id: U_ACTOR, command_id: 'c-1', created_at: '2026-10-01T00:00:00Z', ...over,
})

/** PostgREST 빌더 흉내 — 체인은 자신을, await 는 결과를 낸다. */
function builder(result: { data: unknown; error: { message: string } | null }) {
  const b: Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result> = {} as never
  for (const m of ['select', 'eq', 'or', 'lt', 'order', 'limit', 'in']) b[m] = vi.fn(() => b)
  ;(b as unknown as { then: unknown }).then = (res: (v: typeof result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return b
}
function setup(o: { events?: unknown[]; eventsErr?: string; profiles?: unknown[]; profilesErr?: string; people?: unknown[]; projects?: unknown[]; superuser?: boolean } = {}) {
  h.guard.mockResolvedValue({ ok: true, actor: { userId: U_ACTOR, isSuperuser: o.superuser ?? false } })
  const events = builder({ data: o.eventsErr ? null : (o.events ?? []), error: o.eventsErr ? { message: o.eventsErr } : null })
  h.server.mockResolvedValue({ from: vi.fn((t: string) => { if (t !== 'authz_events') throw new Error(`세션 클라이언트의 예상 밖 표: ${t}`); return events }) })
  const profiles = builder({ data: o.profilesErr ? null : (o.profiles ?? []), error: o.profilesErr ? { message: o.profilesErr } : null })
  const people = builder({ data: o.people ?? [], error: null })
  const projects = builder({ data: o.projects ?? [], error: null })
  const adminFrom = vi.fn((t: string) => ({ profiles, people, projects } as Record<string, unknown>)[t])
  h.adminFor.mockReturnValue({ workspaceId: WS, admin: { from: adminFrom } })
  return { events, profiles, people, projects, adminFrom }
}

beforeEach(() => { vi.clearAllMocks() })

describe('listAuthzEvents — 워크스페이스 설정 \'기록\' 범주의 권한 변경 목록', () => {
  it('가드가 거부하면 그대로 돌려주고 아무것도 읽지 않는다', async () => {
    h.guard.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await listAuthzEvents(WS)).toEqual({ ok: false, error: ERR_DENIED })
    expect(h.server).not.toHaveBeenCalled()
    expect(h.adminFor).not.toHaveBeenCalled()
  })

  it('uuid 가 아닌 워크스페이스 id 는 가드 전에 거부한다', async () => {
    expect((await listAuthzEvents('not-a-uuid')).ok).toBe(false)
    expect(h.guard).not.toHaveBeenCalled()
  })

  it('워크스페이스 관리자는 자기 워크스페이스의 행만 본다 — 플랫폼 행은 질의에 들어가지 않는다', async () => {
    const s = setup({ events: [row(5)], profiles: [{ user_id: U_ACTOR, display_name: '김관리' }, { user_id: U_TARGET, display_name: '이멤버' }] })
    const r = await listAuthzEvents(WS)
    expect(h.guard).toHaveBeenCalledWith(WS)
    expect(s.events.eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(s.events.or).not.toHaveBeenCalled()
    expect(r).toMatchObject({ ok: true, nextBefore: null })
    expect(r.ok && r.rows[0]).toMatchObject({ id: 5, kind: 'workspace_role', summary: '멤버 → 관리자', actorName: '김관리', targetName: '이멤버', causeLabel: '직접 변경' })
  })

  it('플랫폼 관리자는 같은 목록에서 플랫폼 행도 본다', async () => {
    const s = setup({ superuser: true, events: [row(9, { kind: 'platform_admin', workspace_id: null, before: null, after: { granted: true } })], profiles: [{ user_id: U_ACTOR, display_name: 'A' }, { user_id: U_TARGET, display_name: 'B' }] })
    const r = await listAuthzEvents(WS)
    expect(s.events.or).toHaveBeenCalledWith(`workspace_id.eq.${WS},kind.eq.platform_admin`)
    expect(s.events.eq).not.toHaveBeenCalled()
    expect(r.ok && r.rows[0]).toMatchObject({ kind: 'platform_admin', kindLabel: '플랫폼 관리자', summary: '플랫폼 관리자 지정' })
  })

  it('20건씩 끊고 다음 커서를 낸다 — limit+1 로 읽고 before 는 id 미만으로 좁힌다', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => row(100 - i))
    const s = setup({ events: rows })
    const r = await listAuthzEvents(WS, { before: 500 })
    expect(s.events.limit).toHaveBeenCalledWith(21)
    expect(s.events.lt).toHaveBeenCalledWith('id', 500)
    expect(s.events.order).toHaveBeenCalledWith('id', { ascending: false })
    expect(r.ok && r.rows).toHaveLength(20)
    expect(r.ok && r.nextBefore).toBe(81)
  })

  it('지워진 계정은 "삭제된 계정", 행위자 없음은 "시스템", 계정 없는 인물은 인물 이름', async () => {
    setup({
      events: [row(3, { actor_user_id: null, target_user_id: U_GONE }), row(2, { kind: 'project_access', project_id: P1, target_user_id: null, target_person_id: PE, before: null, after: { access_role: 'member' } })],
      profiles: [{ user_id: U_ACTOR, display_name: '김관리' }],
      people: [{ id: PE, display_name: '외부 박' }], projects: [{ id: P1, name: '알파' }],
    })
    const r = await listAuthzEvents(WS)
    expect(r.ok && r.rows[0]).toMatchObject({ actorName: '시스템', targetName: '삭제된 계정' })
    expect(r.ok && r.rows[1]).toMatchObject({ targetName: '외부 박', projectName: '알파', summary: '권한 부여 — 멤버' })
  })

  it('이름 조회가 실패하면 "이름 확인 불가"로 표시하고 로그를 남긴다 — 삭제된 계정으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ events: [row(1)], profilesErr: 'db down' })
    const r = await listAuthzEvents(WS)
    expect(r.ok && r.rows[0]).toMatchObject({ actorName: '이름 확인 불가', targetName: '이름 확인 불가' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('이력 조회 실패는 빈 목록이 아니라 오류로 돌려주고 로그를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setup({ eventsErr: 'boom' })
    const r = await listAuthzEvents(WS)
    expect(r).toEqual({ ok: false, error: '권한 변경 이력을 불러오지 못했습니다.' })
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('이름 조회는 이 워크스페이스로 좁혀서 한다(인물·프로젝트)', async () => {
    const s = setup({ events: [row(1, { kind: 'project_access', project_id: P1, target_person_id: PE, target_user_id: null, before: null, after: { access_role: 'admin' } })] })
    await listAuthzEvents(WS)
    expect(h.adminFor).toHaveBeenCalledWith({ workspaceId: WS })
    expect(s.people.eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(s.projects.eq).toHaveBeenCalledWith('workspace_id', WS)
  })
})
