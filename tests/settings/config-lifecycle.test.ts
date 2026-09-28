// 개정 §2.11 ① 의 액션 층(스펙 §7.1) — 미등록 키, parse 실패(RPC 미호출), 409 와 최신값, 겹치지 않는 편집의 자동 재기준, editor 등급 403,
// set·unset 중복, 손상 저장값은 그 키만 invalid, 앞선 세대는 읽기 성공·쓰기 CONFIG_SCHEMA_AHEAD, D40 도메인, accent·발신명 거부, 모듈 소유 규칙.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(), adminFor: vi.fn(), revalidatePath: vi.fn(), backfill: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin, requireWorkspaceAdmin: h.requireWorkspaceAdmin }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => { throw new Error('세션 클라이언트를 쓰면 안 된다') }) }))
vi.mock('@/lib/agent/ensureOrder', () => ({ backfillProjectOrders: h.backfill }))
import { updateProjectSettings, updateWorkspaceSettings, type SettingsPatch } from '@/app/actions/settings'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const PID = '00000000-0000-4000-8000-00000000aa01', WID = '00000000-0000-4000-8000-00000000bb01'
const CMD = '00000000-0000-4000-8000-00000000dd01'
const admin = makeActor({ userId: 'u-admin', workspaceRoles: new Map([[WID, 'admin']]) })
let db: FakeSettingsDb
const patch = (over: Partial<SettingsPatch>): SettingsPatch => ({ expectedRevision: 1, commandId: CMD, set: {}, unset: [], ...over })

beforeEach(() => {
  vi.clearAllMocks()
  db = new FakeSettingsDb()
    .addWorkspace({ id: WID, values: { 'modules.allowed': ['kanban', 'meetings', 'agents', 'wiki', 'minutes'] }, revision: 1 })
    .addProject({ id: PID, workspaceId: WID, values: { 'core.level_labels': ['Phase', 'Task'], 'modules.enabled': ['kanban'] }, revision: 1 })
  db.teams.push({ id: 't1', code: 'DEV', name: '개발', sort_order: 0, active: true, color: '#6b7280', progress_visible: true, project_id: PID, workspace_id: WID })
  h.adminFor.mockImplementation((scope: Record<string, string>) => ({ ...scope, admin: db.client() }))   // 호출마다 새 객체(react cache 키가 갈린다)
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: admin })
  h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: admin })
  h.revalidatePath.mockReset(); h.backfill.mockReset(); h.backfill.mockResolvedValue({ ok: true, created: 0, failed: [] })
  process.env.WIKI_SERVICE_ENABLED = 'true'
})

describe('updateProjectSettings', () => {
  it('applied — revision 이 오르고 이력이 남고 revalidatePath 가 불린다. 같은 commandId 재전송은 duplicate 이고 이력 1벌', async () => {
    const r = await updateProjectSettings(PID, patch({ set: { 'core.milestone_keywords': ['Kick-Off'] } }))
    expect(r).toEqual({ ok: true, kind: 'applied', commandId: CMD, revision: 2, rebased: false })
    expect(db.projects.get(PID)!.values['core.milestone_keywords']).toEqual(['kick-off'])       // parse 정규화가 저장 형태
    expect(db.history.filter((x) => x.project_id === PID)).toHaveLength(1)
    expect(h.revalidatePath).toHaveBeenCalledWith(`/p/${PID}`, 'layout')
    const again = await updateProjectSettings(PID, patch({ set: { 'core.milestone_keywords': ['Kick-Off'] } }))
    expect(again).toEqual({ ok: true, kind: 'duplicate', commandId: CMD, revision: 2, rebased: false })
    expect(db.history).toHaveLength(1)
  })
  it('set 의 null 은 명시 값으로 저장되고 unset 은 키를 지운다(기본값으로 돌아감)', async () => {
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': null } }))).toMatchObject({ ok: true, revision: 2 })
    expect(Object.prototype.hasOwnProperty.call(db.projects.get(PID)!.values, 'core.extra_axis_label')).toBe(true)
    expect(db.projects.get(PID)!.values['core.extra_axis_label']).toBeNull()
    expect(await updateProjectSettings(PID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd04', unset: ['core.extra_axis_label'] })))
      .toMatchObject({ ok: true, revision: 3 })
    expect(Object.prototype.hasOwnProperty.call(db.projects.get(PID)!.values, 'core.extra_axis_label')).toBe(false)
    expect(await updateProjectSettings(PID, patch({ expectedRevision: 3, commandId: '00000000-0000-4000-8000-00000000dd05', unset: ['core.level_labels'] })))
      .toMatchObject({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', fieldErrors: [{ key: 'core.level_labels' }] })
  })
  it('가드 거부는 denied 이고 admin 을 만들지 않는다', async () => {
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'x' } }))).toEqual({ ok: false, kind: 'denied', code: '권한 없음', commandId: CMD, error: '권한 없음', retryable: false })
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('미등록 키·워크스페이스 키는 CONFIG_UNKNOWN_KEY, set·unset 겹침은 CONFIG_INVALID — RPC 미호출', async () => {
    expect(await updateProjectSettings(PID, patch({ set: { 'nope.key': 1 } as never }))).toMatchObject({ ok: false, kind: 'invalid', code: 'CONFIG_UNKNOWN_KEY', fieldErrors: [{ key: 'nope.key' }] })
    expect(await updateProjectSettings(PID, patch({ set: { 'ai.enabled': false } }))).toMatchObject({ code: 'CONFIG_UNKNOWN_KEY' })
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'x' }, unset: ['core.extra_axis_label'] }))).toMatchObject({ code: 'CONFIG_INVALID' })
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('parse 실패는 키별 fieldErrors 와 부분 저장 0', async () => {
    const r = await updateProjectSettings(PID, patch({ set: { 'core.level_labels': ['A', 'A'], 'core.extra_axis_label': 'ok' } }))
    expect(r).toMatchObject({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', fieldErrors: [{ key: 'core.level_labels', message: '단계 이름이 중복됩니다.' }], retryable: false })
    expect(db.projects.get(PID)!.values['core.extra_axis_label']).toBeUndefined()
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('교차 검증 — 트리 깊이보다 얕게 못 줄이고, 허용 밖 모듈은 새로 못 켠다', async () => {
    db.wbsItems.push({ id: 'a', parent_id: null, project_id: PID, is_owner_split: false, stub_for: null }, { id: 'b', parent_id: 'a', project_id: PID, is_owner_split: false, stub_for: null })
    expect(await updateProjectSettings(PID, patch({ set: { 'core.level_labels': ['One'] } }))).toMatchObject({ code: 'CONFIG_INVALID', fieldErrors: [{ key: 'core.level_labels' }] })
    expect(await updateProjectSettings(PID, patch({ set: { 'modules.enabled': ['kanban', 'issues'] } }))).toMatchObject({ code: 'CONFIG_INVALID', fieldErrors: [{ key: 'modules.enabled', message: expect.stringContaining('issues') }] })
  })
  it('revision 불일치 — 겹치는 키면 conflict 와 최신값·changedKeys, 겹치지 않으면 자동 재기준 1회(rebased)', async () => {
    db.externalWrite({ projectId: PID }, { 'core.milestone_keywords': ['x'] })          // revision 2
    const c = await updateProjectSettings(PID, patch({ expectedRevision: 1, set: { 'core.milestone_keywords': ['y'] } }))
    expect(c).toEqual({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', commandId: CMD, error: expect.stringContaining('먼저 바꿨습니다'),
      latest: { revision: 2, values: { 'core.milestone_keywords': ['x'] } }, changedKeys: ['core.milestone_keywords'], retryable: false })
    const r = await updateProjectSettings(PID, patch({ expectedRevision: 1, set: { 'core.extra_axis_label': 'Track' } }))
    expect(r).toEqual({ ok: true, kind: 'applied', commandId: CMD, revision: 3, rebased: true })
    expect(db.rpcCalls.filter((x) => x.args.p_command_id === CMD).map((x) => x.args.p_expected_revision)).toEqual([1, 1, 2])
  })
  it('재기준 뒤 두 번째 충돌은 conflict — 재시도는 한 번', async () => {
    db.externalWrite({ projectId: PID }, { 'core.milestone_keywords': ['x'] })
    db.beforeRpc = () => {}  // 첫 호출은 그대로 충돌
    let n = 0
    const orig = db.client
    db.client = function () { const c = orig.call(this); const rpc = c.rpc.bind(c); c.rpc = async (name, args) => { n++; if (n === 2) db.externalWrite({ projectId: PID }, { 'wbs.excel_profile': null }); return rpc(name, args) }; return c }
    const r = await updateProjectSettings(PID, patch({ expectedRevision: 1, set: { 'core.extra_axis_label': 'T' } }))
    expect(r).toMatchObject({ ok: false, kind: 'conflict', latest: { revision: 3 } })
    expect(n).toBe(2)
  })
  it('손상 저장값은 그 키만 invalid — 다른 키는 저장된다. 세대가 앞서면 읽기는 되고 쓰기는 schema_ahead', async () => {
    db.projects.get(PID)!.values['wbs.excel_profile'] = { version: 9 }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    const cfg = await getProjectConfig(PID, { client: db.client() as never })
    expect(cfg.keys['wbs.excel_profile']).toMatchObject({ status: 'invalid' }); expect(cfg.keys['core.extra_axis_label']).toEqual({ status: 'set', value: 'T' })
    db.projects.get(PID)!.schemaVersion = 2
    expect((await getProjectConfig(PID, { client: db.client() as never })).schemaAhead).toBe(true)
    expect(await updateProjectSettings(PID, patch({ expectedRevision: 2, set: { 'core.extra_axis_label': 'U' } }))).toEqual({ ok: false, kind: 'schema_ahead', code: 'CONFIG_SCHEMA_AHEAD', commandId: CMD, error: expect.any(String), retryable: false })
  })
  it('agents 를 더하면 저장 뒤 agent_projects 를 맞추고 백필한다. 동기화 실패는 unavailable 로 알린다(설정은 저장됨)', async () => {
    const r = await updateProjectSettings(PID, patch({ set: { 'modules.enabled': ['kanban', 'agents'] } }))
    expect(r).toMatchObject({ ok: true, revision: 2 })
    expect(db.agentProjects).toEqual([{ enabled: true, project_id: PID, created_by: 'u-admin', note: '설정에서 켬' }])
    expect(h.backfill).toHaveBeenCalledTimes(1)
    h.backfill.mockResolvedValue({ ok: false, error: 'bf' })
    db.projects.get(PID)!.values['modules.enabled'] = ['kanban']; db.agentProjects = []
    const f = await updateProjectSettings(PID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd02', set: { 'modules.enabled': ['kanban', 'agents'] } }))
    expect(f).toMatchObject({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', error: expect.stringContaining('저장됐지만'), retryable: true })
    expect(db.projects.get(PID)!.revision).toBe(3)
  })
  it('설정 행이 없으면 unavailable, patch 모양이 틀리면 invalid', async () => {
    expect(await updateProjectSettings('00000000-0000-4000-8000-00000000aa99', patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', retryable: true })
    expect(await updateProjectSettings(PID, { expectedRevision: -1, commandId: 'nope', set: {}, unset: [] })).toMatchObject({ kind: 'invalid', code: 'CONFIG_INVALID' })
  })
  it('values 가 객체가 아니면 기본값으로 풀지 않고 unavailable — RPC 미호출', async () => {
    (db.projects.get(PID)! as { values: unknown }).values = ['broken']
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', retryable: true })
    expect(db.rpcCalls).toHaveLength(0)
  })
})

describe('updateWorkspaceSettings', () => {
  it('platform_admin 키(modules.allowed)는 슈퍼유저만 — 워크스페이스 관리자는 ERR_DENIED', async () => {
    const r = await updateWorkspaceSettings(WID, patch({ set: { 'modules.allowed': ['kanban'] } }))
    expect(r).toMatchObject({ ok: false, kind: 'denied', code: expect.stringContaining('권한') })
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser({ userId: 'u-su' }) })
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'modules.allowed': ['kanban'] } }))).toMatchObject({ ok: true, revision: 2 })
    expect(h.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
  it('D40 — 틀린 도메인 거부, * 섞임 거부, 정규화·중복 제거 저장, 명시 [] 저장', async () => {
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'invites.allowed_domains': ['bad domain'] } }))).toMatchObject({ code: 'CONFIG_INVALID', fieldErrors: [{ key: 'invites.allowed_domains' }] })
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'invites.allowed_domains': ['*', 'a.com'] } }))).toMatchObject({ code: 'CONFIG_INVALID' })
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'invites.allowed_domains': ['Acme.test', 'acme.test', '@Example.com.'] } }))).toMatchObject({ ok: true })
    expect(db.workspaces.get(WID)!.values['invites.allowed_domains']).toEqual(['acme.test', 'example.com'])
    expect(await updateWorkspaceSettings(WID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd03', set: { 'invites.allowed_domains': [] } }))).toMatchObject({ ok: true })
    expect(db.workspaces.get(WID)!.values['invites.allowed_domains']).toEqual([])
  })
  it('accent 는 입력 hex → 파생 세트로 저장, 저장 형태를 직접 보내면 invalid. 줄바꿈 발신명 거부. 로고는 자기 워크스페이스 경로만', async () => {
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'branding.accent': '#315CDB' } }))).toMatchObject({ ok: true })
    const stored = db.workspaces.get(WID)!.values['branding.accent'] as { base: string; light: object; dark: object }
    expect(stored.base).toBe('#315cdb'); expect(Object.keys(stored.light)).toHaveLength(6)
    expect(await updateWorkspaceSettings(WID, patch({ expectedRevision: 2, set: { 'branding.accent': stored } }))).toMatchObject({ code: 'CONFIG_INVALID', fieldErrors: [{ key: 'branding.accent' }] })
    expect(await updateWorkspaceSettings(WID, patch({ expectedRevision: 2, set: { 'branding.mail_from_name': 'Acme\n알림' } }))).toMatchObject({ code: 'CONFIG_INVALID' })
    const other = '00000000-0000-4000-8000-00000000bb02'
    expect(await updateWorkspaceSettings(WID, patch({ expectedRevision: 2, set: { 'branding.logo': { full: `ws/${other}/branding/full-0123456789abcdef.png`, full_dark: null, mark: null } } })))
      .toMatchObject({ code: 'CONFIG_INVALID', fieldErrors: [{ key: 'branding.logo', message: expect.stringContaining('다른 워크스페이스') }] })
  })
  it('저장된 accent 가 red;} 나 </style> 이면 읽기에서 invalid 다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.workspaces.get(WID)!.values['branding.accent'] = 'red;}'
    const r = await updateWorkspaceSettings(WID, patch({ set: { 'ai.enabled': false } }))
    expect(r).toMatchObject({ ok: true })
    const { getWorkspaceConfig } = await import('@/lib/settings/workspaceConfig')
    expect((await getWorkspaceConfig(WID, { client: db.client() as never })).keys['branding.accent']).toMatchObject({ status: 'invalid' })
  })
  it('modules.allowed 가 손상돼도 복구 경로는 열려 있다 — 슈퍼유저가 다시 저장하면 ok(Review Focus 6)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.workspaces.get(WID)!.values['modules.allowed'] = 'nope'
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser({ userId: 'u-su' }) })
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'modules.allowed': ['kanban'] } }))).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    expect(db.workspaces.get(WID)!.values['modules.allowed']).toEqual(['kanban'])
  })
  it('워크스페이스 modules.allowed 가 손상돼도 프로젝트의 core 키는 저장되고, 새 모듈은 못 켠다(fail-closed)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.workspaces.get(WID)!.values['modules.allowed'] = 'nope'
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: true, revision: 2 })
    expect(await updateProjectSettings(PID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd06', set: { 'modules.enabled': ['kanban', 'meetings'] } })))
      .toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'modules.enabled', message: expect.stringContaining('meetings') }] })
  })
})
