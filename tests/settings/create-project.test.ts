// createProject(스펙 §3.3·§7.1) — 필수 키 누락 거부, modules.enabled 명시 기록, 복사 때 재교집합, 손상 원본 거부(D29 — 아무것도 만들지 않는다),
// 같은 commandId 재전송은 같은 프로젝트, 결과 반환(throw 없음), 팀 캐시 갱신.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(), adminFor: vi.fn(), refreshTeams: vi.fn(async () => true), revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('next/server', () => ({ after: (f: () => unknown) => f() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin, requireProjectAdmin: h.requireProjectAdmin, getActorViewState: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => { throw new Error('createProject 는 adminFor 를 쓴다') }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => { throw new Error('createProject 는 세션 클라이언트를 쓰지 않는다') }) }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/teams/master', () => ({ refreshTeams: h.refreshTeams }))
import { createProject, type CreateProjectInput } from '@/app/actions/project'
import { ERR_DENIED } from '@/lib/authz/errors'
import { makeActor } from '../fixtures/actor'

const WID = '00000000-0000-4000-8000-00000000bb01', OTHER = '00000000-0000-4000-8000-00000000bb02'
const SRC = '00000000-0000-4000-8000-00000000aa01', FOREIGN = '00000000-0000-4000-8000-00000000aa02'
const CMD = '00000000-0000-4000-8000-00000000dd01'
let db: FakeSettingsDb
const input = (over: Partial<CreateProjectInput> = {}): CreateProjectInput =>
  ({ workspaceId: WID, name: 'Acme 신규', startDate: null, endDate: null, description: null, levelLabels: ['Phase', 'Task'], commandId: CMD, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb()
    .addWorkspace({ id: WID, values: { 'modules.allowed': ['kanban', 'meetings', 'issues', 'wiki'] } })   // minutes 없음 → wiki 는 requires 로 빠진다
    .addWorkspace({ id: OTHER, values: { 'modules.allowed': ['kanban'] } })
    .addProject({ id: SRC, workspaceId: WID, values: { 'core.level_labels': ['S1'], 'modules.enabled': ['kanban', 'agents', 'wiki'], 'core.milestone_keywords': ['출시'], 'core.extra_axis_label': 'Track' } })
    .addProject({ id: FOREIGN, workspaceId: OTHER, values: { 'core.level_labels': ['F1'], 'modules.enabled': [] } })
  h.adminFor.mockImplementation((s: Record<string, string>) => ({ ...s, admin: db.client() }))
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WID, 'admin']]) }) })
  h.refreshTeams.mockClear(); h.revalidatePath.mockClear()
  process.env.WIKI_SERVICE_ENABLED = 'true'
})

describe('createProject', () => {
  it('빈 값 — 라벨은 parse 를 거치고 modules.enabled 는 기본값 ∩ 허용∩env 에서 requires 닫힘으로 명시 기록된다. 팀 캐시 갱신·revalidate', async () => {
    const r = await createProject(input({ levelLabels: [' Phase ', 'Task'] }))
    expect(r).toMatchObject({ ok: true, status: 'applied' })
    if (!r.ok) return
    const p = db.projects.get(r.projectId)!
    expect(p.values).toEqual({ 'core.level_labels': ['Phase', 'Task'], 'modules.enabled': ['kanban', 'meetings', 'issues'] })   // wiki 는 minutes 미허용으로 빠진다
    expect(db.history.filter((x) => x.project_id === r.projectId).map((x) => x.source)).toEqual(['create', 'create'])
    expect(db.rpcCalls[0].args).toMatchObject({ p_workspace_id: WID, p_name: 'Acme 신규', p_copy_from: null, p_actor: 'u-admin', p_command_id: CMD, p_schema_version: 1 })
    expect(h.refreshTeams).toHaveBeenCalledOnce(); expect(h.revalidatePath).toHaveBeenCalledWith('/projects')
  })
  it('같은 commandId 재전송은 duplicate 이고 같은 프로젝트다', async () => {
    const a = await createProject(input()); const b = await createProject(input())
    expect(a.ok && b.ok && a.projectId === b.projectId && b.status === 'duplicate').toBe(true)
    expect(db.projects.size).toBe(3)
  })
  it('복사 — 원본의 set 키 전부를 넘기고 modules.enabled 는 대상 허용과 재교집합, 라벨은 입력값. 이력 source copy', async () => {
    const r = await createProject(input({ copyFromProjectId: SRC, levelLabels: ['P', 'T', 'A'] }))
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(db.projects.get(r.projectId)!.values).toEqual({
      'core.level_labels': ['P', 'T', 'A'], 'modules.enabled': ['kanban'],           // agents 미허용, wiki 는 minutes 없음
      'core.milestone_keywords': ['출시'], 'core.extra_axis_label': 'Track',
    })
    expect(db.history.filter((x) => x.project_id === r.projectId).every((x) => x.source === 'copy' && x.copied_from === SRC)).toBe(true)
  })
  it('원본에 invalid 키가 있으면 거부하고 아무것도 만들지 않는다(D29). 다른 워크스페이스 원본은 ERR_DENIED', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.projects.get(SRC)!.values['wbs.excel_profile'] = { version: 9 }
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'wbs.excel_profile' }] })
    expect(db.rpcCalls).toHaveLength(0); expect(db.projects.size).toBe(2)
    expect(await createProject(input({ copyFromProjectId: FOREIGN }))).toEqual({ ok: false, code: ERR_DENIED, error: expect.any(String) })
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('라벨 없음·중복·형식 오류는 CONFIG_INVALID(RPC 미호출). 날짜 역순도 거부. 가드 거부는 그 문구가 code', async () => {
    expect(await createProject(input({ levelLabels: [] }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'core.level_labels' }] })
    expect(await createProject(input({ levelLabels: ['A', 'A'] }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
    expect(await createProject(input({ levelLabels: ['A', 1 as never] }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
    expect(await createProject(input({ startDate: '2026-02-01', endDate: '2026-01-01' }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID', error: expect.stringContaining('종료일') })
    expect(db.rpcCalls).toHaveLength(0)
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await createProject(input())).toEqual({ ok: false, code: '권한 없음', error: '권한 없음' })
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('워크스페이스 id 가 비면 가드 전에 거부(슈퍼유저도). commandId 가 uuid 가 아니면 거부. 워크스페이스 설정 행이 없으면 CONFIG_UNAVAILABLE', async () => {
    for (const wid of ['', null, undefined, 42]) expect((await createProject(input({ workspaceId: wid as never }))).ok, String(wid)).toBe(false)
    expect(h.requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(await createProject(input({ commandId: 'nope' }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
    db.workspaces.delete(WID)
    expect(await createProject(input())).toMatchObject({ ok: false, code: 'CONFIG_UNAVAILABLE' })
    expect(h.refreshTeams).not.toHaveBeenCalled()
  })
})
