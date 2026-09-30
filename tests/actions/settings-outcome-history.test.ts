// getSettingsCommandOutcome·listSettingsHistory — 스코프 가드, 세션 클라이언트(D24), applied/unknown, 20건 쪽 나눔, 오류 원문은 로그에만.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(), createServerClient: vi.fn(), adminFor: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin, requireWorkspaceAdmin: h.requireWorkspaceAdmin }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
import { getSettingsCommandOutcome, listSettingsHistory } from '@/app/actions/settings'
import { makeActor } from '../fixtures/actor'

const PID = 'p1', WID = 'w1'
let db: FakeSettingsDb
beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb().addProject({ id: PID, workspaceId: WID, values: {} }).addWorkspace({ id: WID, values: {} })
  h.createServerClient.mockResolvedValue(db.client())
  h.adminFor.mockReturnValue({ admin: { from: () => ({ select: () => ({ in: async () => ({ data: [{ user_id: 'me', display_name: '관리자' }], error: null }) }) }) } })
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor({ userId: 'me' }) })
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeActor({ userId: 'me' }) })
})

describe('getSettingsCommandOutcome', () => {
  it('내 명령이 이력에 있으면 applied 와 revision, 없으면 unknown. 남의 같은 id 는 unknown', async () => {
    db.externalWrite({ projectId: PID }, { 'core.extra_axis_label': 'x' }, 'me')
    const cmd = db.history[0].command_id
    expect(await getSettingsCommandOutcome({ projectId: PID }, cmd)).toEqual({ ok: true, outcome: { status: 'applied', revision: 1 } })
    expect(await getSettingsCommandOutcome({ projectId: PID }, '00000000-0000-4000-8000-00000000ffff')).toEqual({ ok: true, outcome: { status: 'unknown' } })
    db.externalWrite({ workspaceId: WID }, { 'ai.enabled': false }, 'someone-else')
    expect(await getSettingsCommandOutcome({ workspaceId: WID }, db.history[1].command_id)).toEqual({ ok: true, outcome: { status: 'unknown' } })
    expect(h.requireWorkspaceAdmin).toHaveBeenCalledWith(WID)
  })
  it('가드 거부는 ok:false', async () => {
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await getSettingsCommandOutcome({ projectId: PID }, 'c')).toEqual({ ok: false, error: '권한 없음' })
    expect(h.createServerClient).not.toHaveBeenCalled()
  })
  it('uuid 모양이 아닌 commandId 는 조회하지 않고 unknown', async () => {
    expect(await getSettingsCommandOutcome({ projectId: PID }, 'not-a-uuid')).toEqual({ ok: true, outcome: { status: 'unknown' } })
    expect(h.createServerClient).not.toHaveBeenCalled()
  })
  it('조회 실패는 고정 문구 — DB 원문은 로그에만', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.failTable = 'project_settings_history'
    const r = await getSettingsCommandOutcome({ projectId: PID }, '00000000-0000-4000-8000-00000000dd01')
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).not.toContain('fake failure'); expect(JSON.stringify(spy.mock.calls)).toContain('fake failure')
  })
})

describe('listSettingsHistory', () => {
  it('20건씩 id 내림차순, nextBefore 로 이어 읽는다. 조회 실패는 ok:false', async () => {
    for (let i = 0; i < 25; i++) db.externalWrite({ projectId: PID }, { 'core.extra_axis_label': `v${i}` }, 'me')
    const p1 = await listSettingsHistory({ projectId: PID })
    expect(p1.ok).toBe(true)
    if (!p1.ok) return
    expect(p1.rows).toHaveLength(20); expect(p1.rows[0].newValue).toBe('v24'); expect(p1.nextBefore).toBe(p1.rows[19].id)
    expect(p1.rows[0].changedByName).toBe('관리자')
    const p2 = await listSettingsHistory({ projectId: PID }, { before: p1.nextBefore! })
    expect(p2).toMatchObject({ ok: true })                         // 좁히기 전에 — ok:false 면 아래 단언이 조용히 건너뛰어진다(FM-5)
    if (p2.ok) { expect(p2.rows).toHaveLength(5); expect(p2.nextBefore).toBeNull() }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.failTable = 'project_settings_history'
    const f = await listSettingsHistory({ projectId: PID })
    expect(f).toEqual({ ok: false, error: expect.stringContaining('이력을 불러오지 못했습니다') })
    expect(JSON.stringify(f)).not.toContain('fake failure'); expect(JSON.stringify(spy.mock.calls)).toContain('fake failure')
  })
  it('프로필이 지워진 작성자는 삭제된 계정으로 표시한다', async () => {
    db.externalWrite({ workspaceId: WID }, { 'ai.enabled': false }, 'deleted-user')
    const result = await listSettingsHistory({ workspaceId: WID })
    expect(result).toMatchObject({ ok: true, rows: [{ changedByName: '삭제된 계정' }] })
  })
})
