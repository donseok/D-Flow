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
// wiki 소유 키 픽스처(Phase A 에는 비core 소유 키가 없다) — 소유 모듈 규칙이 env 를 보는지 확인하려고 settingDef 에만 더한다
vi.mock('@/lib/settings/registry', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/settings/registry')>()
  const fixture = { ...m.settingDef('project', 'core.extra_axis_label')!, key: 'wiki.fixture_key', module: 'wiki' }
  return { ...m, settingDef: (scope: 'project' | 'workspace', key: string) => (scope === 'project' && key === 'wiki.fixture_key' ? fixture : m.settingDef(scope as 'project', key)) }
})
import { updateProjectSettings, updateWorkspaceSettings, type SettingsPatch } from '@/app/actions/settings'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { CONFIG_MESSAGES, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
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
    expect(h.requireProjectAdmin).toHaveBeenCalledWith(PID)                          // 가드는 요청의 그 프로젝트로(FM-4)
    expect(h.adminFor).not.toHaveBeenCalled()
  })
  it('워크스페이스 가드 거부도 denied 이고 admin 을 만들지 않는다 — 가드는 요청의 그 워크스페이스로(FM-4)', async () => {
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'ai.enabled': false } }))).toEqual({ ok: false, kind: 'denied', code: '권한 없음', commandId: CMD, error: '권한 없음', retryable: false })
    expect(h.requireWorkspaceAdmin).toHaveBeenCalledWith(WID)
    expect(h.adminFor).not.toHaveBeenCalled()
    expect(db.rpcCalls).toHaveLength(0)
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
      latest: { revision: 2, values: { 'core.milestone_keywords': ['x'] }, invalidKeys: [] }, changedKeys: ['core.milestone_keywords'], retryable: false })
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
  it('재기준 — 두 판독 사이에 요청 키가 바뀌면 덮어쓰지 않고 conflict(최신 판독이 먼저, 바뀐 키가 나중)', async () => {
    db.externalWrite({ projectId: PID }, { 'core.milestone_keywords': ['x'] })          // revision 2 — 요청 키와 겹치지 않는다
    let injected = false
    const orig = db.client
    db.client = function () {
      const c = orig.call(this); const from = c.from
      c.from = (table: string) => {
        const b = from(table)
        if (table === 'project_settings_history') {
          const then = b.then as (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>
          // 이력 판독의 결과가 정해진 직후, 다른 사용자가 요청 키를 저장한다
          b.then = (res: (x: unknown) => unknown, rej?: (e: unknown) => unknown) => then((x) => {
            if (!injected) { injected = true; db.externalWrite({ projectId: PID }, { 'core.extra_axis_label': 'theirs' }) }
            return res(x)
          }, rej)
        }
        return b
      }
      return c
    }
    const r = await updateProjectSettings(PID, patch({ expectedRevision: 1, set: { 'core.extra_axis_label': 'mine' } }))
    expect(injected).toBe(true)
    expect(r).toMatchObject({ ok: false, kind: 'conflict', latest: { revision: 3, values: { 'core.extra_axis_label': 'theirs' } } })
    expect(db.projects.get(PID)!.values['core.extra_axis_label']).toBe('theirs')
  })
  it('conflict 의 latest 는 손상(invalid) 키를 invalidKeys 로 따로 알린다 — 값 없음과 구분', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.externalWrite({ projectId: PID }, { 'core.milestone_keywords': ['x'], 'wbs.excel_profile': { version: 9 } })
    const c = await updateProjectSettings(PID, patch({ expectedRevision: 1, set: { 'core.milestone_keywords': ['y'] } }))
    expect(c).toMatchObject({ ok: false, kind: 'conflict', latest: { revision: 2, invalidKeys: ['wbs.excel_profile'] } })
    expect(c.ok === false && c.kind === 'conflict' && c.changedKeys.includes('wbs.excel_profile')).toBe(true)
  })
  it('RPC 가 오류 없이 빈 응답을 주면 이름 붙은 오류로 멈춘다(TypeError 아님)', async () => {
    const orig = db.client
    db.client = function () { const c = orig.call(this); c.rpc = (async () => ({ data: null, error: null })) as never; return c }
    await expect(updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).rejects.toMatchObject({ name: 'SettingsRpcShapeError' })
  })
  it('DB 원문은 사용자 응답에 싣지 않고 로그에만 남긴다 — 선행 조회·교차 검증 조회·동기화 실패', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logged = () => JSON.stringify(spy.mock.calls)
    db.failTable = 'teams'
    const a = await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))
    expect(a).toMatchObject({ ok: false, kind: 'unavailable', error: expect.stringContaining('설정을 불러오지 못해') })
    expect(JSON.stringify(a)).not.toContain('fake failure'); expect(logged()).toContain('fake failure: teams')
    db.failTable = 'wbs_items'
    const b = await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))
    expect(b).toMatchObject({ ok: false, kind: 'unavailable' })
    expect(JSON.stringify(b)).not.toContain('fake failure'); expect(logged()).toContain('fake failure: wbs_items')
    db.failTable = null
    h.backfill.mockResolvedValue({ ok: false, error: 'db-said-no' })
    const c = await updateProjectSettings(PID, patch({ set: { 'modules.enabled': ['kanban', 'agents'] } }))
    expect(c).toMatchObject({ ok: false, kind: 'unavailable', error: expect.stringContaining('revision 2') })
    expect(JSON.stringify(c)).not.toContain('db-said-no'); expect(logged()).toContain('db-said-no')
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
  // SP7 — 등록 표(agent_projects)와 그 행 동기는 없다(0041). agents 를 더한 저장의 후속은 백필 하나다. 가짜 DB 는 그 표를 모른다(읽으면 던진다).
  it('agents 를 더하면 저장 뒤 백필한다(등록 표를 읽거나 쓰지 않는다). 백필 실패는 저장됨을 알리고 재시도를 권하지 않는다(FN-10)', async () => {
    const r = await updateProjectSettings(PID, patch({ set: { 'modules.enabled': ['kanban', 'agents'] } }))
    expect(r).toMatchObject({ ok: true, revision: 2 })
    expect(db.inserts).toEqual([])
    expect(h.backfill).toHaveBeenCalledTimes(1)
    expect(h.backfill).toHaveBeenCalledWith(expect.anything(), { projectId: PID, actorUserId: 'u-admin' })
    expect(h.backfill.mock.calls[0][0]).not.toBe(h.adminFor.mock.results[0].value.admin)
    h.backfill.mockResolvedValue({ ok: false, error: 'bf' })
    db.projects.get(PID)!.values['modules.enabled'] = ['kanban']
    h.revalidatePath.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = await updateProjectSettings(PID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd02', set: { 'modules.enabled': ['kanban', 'agents'] } }))
    // 같은 id 재전송은 duplicate 라 동기화를 건너뛰고, 새 id 면 prev 에 agents 가 있어 동기화 조건이 거짓이다 — 재시도는 지킬 수 없는 약속
    expect(f).toEqual({ ok: false, kind: 'unavailable', code: 'CONFIG_UNAVAILABLE', commandId: '00000000-0000-4000-8000-00000000dd02', retryable: false, appliedRevision: 3,
      error: expect.stringContaining('revision 3 으로 저장됐지만') })
    expect(!f.ok && f.error.startsWith(ERR_CONFIG_UNAVAILABLE)).toBe(false)
    expect(h.revalidatePath).toHaveBeenCalledTimes(1)                     // 저장은 됐다 — 화면이 새 값을 보게
    expect(db.projects.get(PID)!.revision).toBe(3)
  })
  it('늘 명시 키(core.level_labels·modules.enabled)의 unset 은 CONFIG_INVALID — RPC 미호출(FN-3)', async () => {
    for (const key of ['modules.enabled', 'core.level_labels'] as const) {
      expect(await updateProjectSettings(PID, patch({ unset: [key] }))).toEqual({ ok: false, kind: 'invalid', code: 'CONFIG_INVALID', commandId: CMD,
        error: CONFIG_MESSAGES.CONFIG_INVALID, fieldErrors: [{ key, message: '필수 설정은 기본값으로 되돌릴 수 없습니다.' }], retryable: false })
    }
    expect(db.rpcCalls).toHaveLength(0)
    expect(db.projects.get(PID)!.values['modules.enabled']).toEqual(['kanban'])
  })
  it('env 는 modules.enabled 저장을 막지 않는다 — 플래그 꺼짐 + 허용된 wiki 는 applied(FN-1, 스펙 §4.1)', async () => {
    delete process.env.WIKI_SERVICE_ENABLED
    expect(await updateProjectSettings(PID, patch({ set: { 'modules.enabled': ['kanban', 'wiki'] } }))).toEqual({ ok: true, kind: 'applied', commandId: CMD, revision: 2, rebased: false })
    expect(db.projects.get(PID)!.values['modules.enabled']).toEqual(['kanban', 'wiki'])
  })
  it('소유 모듈 규칙은 env 를 본다 — 플래그 꺼짐이면 wiki 소유 키는 CONFIG_MODULE_NOT_ALLOWED, 켜짐이면 prepared 로 저장(FN-1, 개정 §2.7.3)', async () => {
    delete process.env.WIKI_SERVICE_ENABLED
    expect(await updateProjectSettings(PID, patch({ set: { 'wiki.fixture_key': 'x' } as never })))
      .toMatchObject({ ok: false, kind: 'invalid', code: 'CONFIG_MODULE_NOT_ALLOWED', fieldErrors: [{ key: 'wiki.fixture_key', message: expect.stringContaining('wiki') }] })
    expect(db.rpcCalls).toHaveLength(0)
    process.env.WIKI_SERVICE_ENABLED = 'true'
    expect(await updateProjectSettings(PID, patch({ set: { 'wiki.fixture_key': 'x' } as never }))).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
  })
  it('재기준 판독 이력이 한도(1000행)에서 잘리면 재기준하지 않고 conflict — 999행이면 재기준(FN-4, 3원칙 ②)', async () => {
    const flood = (n: number) => { for (let i = 0; i < n; i++) db.externalWrite({ projectId: PID }, { 'core.milestone_keywords': [`k${i}`] }) }
    flood(999)
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: true, kind: 'applied', rebased: true })
    db = new FakeSettingsDb()
      .addWorkspace({ id: WID, values: { 'modules.allowed': ['kanban'] }, revision: 1 })
      .addProject({ id: PID, workspaceId: WID, values: { 'core.level_labels': ['Phase', 'Task'], 'modules.enabled': ['kanban'] }, revision: 1 })
    flood(1000)
    const r = await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))
    expect(r).toMatchObject({ ok: false, kind: 'conflict', code: 'CONFIG_CONFLICT', latest: { revision: 1001 } })
    expect(db.rpcCalls).toHaveLength(1)                                   // 두 번째 RPC 없음
    expect(db.projects.get(PID)!.values['core.extra_axis_label']).toBeUndefined()
  })
  it('표에 있는 DB 거부 중 재시도 가능·세대 앞섬은 결과와 함께 로그를 남긴다 — 표시 = 로깅(FM-12)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.beforeRpc = () => { db.projects.get(PID)!.schemaVersion = 2 }       // 판독 뒤 새 인스턴스가 세대 2 로 저장
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: false, kind: 'schema_ahead', code: 'CONFIG_SCHEMA_AHEAD' })
    expect(spy).toHaveBeenCalledWith('[settings] RPC 거부', { scope: { projectId: PID }, commandId: CMD, token: 'SETTINGS_SCHEMA_AHEAD' })
    spy.mockClear()
    const orig = db.client
    db.client = function () { const c = orig.call(this); c.rpc = (async () => ({ data: null, error: { code: '40P01', message: 'deadlock detected' } })) as never; return c }
    db.projects.get(PID)!.schemaVersion = 1
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: false, kind: 'unavailable', code: 'CONFIG_BUSY', retryable: true })
    expect(spy).toHaveBeenCalledWith('[settings] RPC 거부', { scope: { projectId: PID }, commandId: CMD, token: '40P01' })
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
  it('agents 재허용 뒤 주문을 백필하고 같은 값 재저장으로 실패분을 재시도한다', async () => {
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser({ userId: 'u-su' }) })
    db.workspaces.get(WID)!.values['modules.allowed'] = ['kanban']
    db.projects.get(PID)!.values['modules.enabled'] = ['kanban', 'agents']
    h.backfill.mockResolvedValueOnce({ ok: false, error: 'queue unavailable' })
    const first = await updateWorkspaceSettings(WID, patch({ set: { 'modules.allowed': ['kanban', 'agents'] } }))
    expect(first).toMatchObject({ ok: false, kind: 'unavailable', retryable: false, error: expect.stringContaining('같은 modules.allowed 값을 새 명령으로 다시 저장') })
    expect(db.workspaces.get(WID)!.values['modules.allowed']).toEqual(['kanban', 'agents'])
    expect(h.backfill).toHaveBeenCalledWith(expect.anything(), { projectId: PID, actorUserId: 'u-su' })
    expect(h.backfill.mock.calls[0][0]).not.toBe(h.adminFor.mock.results[0].value.admin)
    const retry = await updateWorkspaceSettings(WID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd07', set: { 'modules.allowed': ['kanban', 'agents'] } }))
    expect(retry).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    expect(h.backfill).toHaveBeenCalledTimes(2)
  })
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
  it('워크스페이스 modules.allowed 의 unset 은 허용한다 — 미설정 = 기본값 [] 이 정상 상태(개정 §2.2.1, FN-3 범위)', async () => {
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser({ userId: 'u-su' }) })
    expect(await updateWorkspaceSettings(WID, patch({ unset: ['modules.allowed'] }))).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    expect(Object.prototype.hasOwnProperty.call(db.workspaces.get(WID)!.values, 'modules.allowed')).toBe(false)
  })
  it('modules.allowed 가 손상돼도 복구 경로는 열려 있다 — 슈퍼유저가 다시 저장하면 ok(Review Focus 6)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.workspaces.get(WID)!.values['modules.allowed'] = 'nope'
    h.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: makeSuperuser({ userId: 'u-su' }) })
    expect(await updateWorkspaceSettings(WID, patch({ set: { 'modules.allowed': ['kanban'] } }))).toMatchObject({ ok: true, kind: 'applied', revision: 2 })
    expect(db.workspaces.get(WID)!.values['modules.allowed']).toEqual(['kanban'])
  })
  it('워크스페이스 modules.allowed 가 손상돼도 프로젝트의 core 키는 저장되고, 새 모듈은 손상 사유로 거부된다(fail-closed)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.workspaces.get(WID)!.values['modules.allowed'] = 'nope'
    expect(await updateProjectSettings(PID, patch({ set: { 'core.extra_axis_label': 'T' } }))).toMatchObject({ ok: true, revision: 2 })
    spy.mockClear()
    expect(await updateProjectSettings(PID, patch({ expectedRevision: 2, commandId: '00000000-0000-4000-8000-00000000dd06', set: { 'modules.enabled': ['kanban', 'meetings'] } })))
      .toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'modules.enabled', message: expect.stringContaining('손상돼 새 모듈을 켤 수 없습니다') }] })
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('modules.allowed 손상'))).toHaveLength(1)     // 저장 한 번에 한 줄
  })
})
