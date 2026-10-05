// createProject(스펙 §3.3·§7.1) — 필수 키 누락 거부, modules.enabled 명시 기록, 복사 때 재교집합, 손상 원본 거부(D29 — 아무것도 만들지 않는다),
// 같은 commandId 재전송은 같은 프로젝트, 결과 반환(throw 없음), 팀 캐시 갱신.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSettingsDb } from '../helpers/fakeSettingsDb'
const h = vi.hoisted(() => ({ requireWorkspaceAdmin: vi.fn(), requireProjectAdmin: vi.fn(), adminFor: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('next/server', () => ({ after: (f: () => unknown) => f() }))
vi.mock('@/lib/authz', () => ({ requireWorkspaceAdmin: h.requireWorkspaceAdmin, requireProjectAdmin: h.requireProjectAdmin, getActorViewState: vi.fn() }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => { throw new Error('createProject 는 adminFor 를 쓴다') }) }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => { throw new Error('createProject 는 세션 클라이언트를 쓰지 않는다') }) }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
import { createProject, getProjectCopySource, type CreateProjectInput } from '@/app/actions/project'
import { ERR_DENIED } from '@/lib/authz/errors'
import { DEFAULT_ATTACHMENT_POLICY } from '@/lib/minutes/attachmentPolicy'
import { CONFIG_MESSAGES } from '@/lib/settings/errors'
import { ERR_MODULES_ALLOWED_BROKEN } from '@/lib/settings/validateConfig'
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
  h.revalidatePath.mockClear()
  process.env.WIKI_SERVICE_ENABLED = 'true'
})

describe('createProject', () => {
  it('복사 원본 미리보기는 같은 워크스페이스의 유효한 라벨만 제공하고 손상 키를 보여준다', async () => {
    expect(await getProjectCopySource(WID, SRC)).toEqual({ ok: true, levelLabels: ['S1'] })
    expect(await getProjectCopySource(WID, FOREIGN)).toEqual({ ok: false, error: ERR_DENIED })
    db.projects.get(SRC)!.values['wbs.excel_profile'] = { version: 9 }
    expect(await getProjectCopySource(WID, SRC)).toMatchObject({ ok: false, fieldErrors: [{ key: 'wbs.excel_profile' }] })
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('빈 값 — 라벨은 parse 를 거치고 modules.enabled 는 기본값 ∩ 허용∩env 에서 requires 닫힘으로 명시 기록된다. 팀 캐시 갱신·revalidate', async () => {
    const r = await createProject(input({ levelLabels: [' Phase ', 'Task'] }))
    expect(r).toMatchObject({ ok: true, status: 'applied' })
    if (!r.ok) return
    const p = db.projects.get(r.projectId)!
    expect(p.values).toEqual({ 'core.level_labels': ['Phase', 'Task'], 'modules.enabled': ['kanban', 'meetings', 'issues'],   // wiki 는 minutes 미허용으로 빠진다
      'minutes.attachments': DEFAULT_ATTACHMENT_POLICY, 'calendar.timezone': 'UTC', 'calendar.working_days': [1, 2, 3, 4, 5], 'calendar.week_start': [{ day: 'sunday', from: null }] })   // SP5 A — 워크스페이스 값(여기는 기본값)을 복사
    expect(db.history.filter((x) => x.project_id === r.projectId).map((x) => x.source)).toEqual(Array(6).fill('create'))
    expect(db.rpcCalls[0].args).toMatchObject({ p_workspace_id: WID, p_name: 'Acme 신규', p_copy_from: null, p_actor: 'u-admin', p_command_id: CMD, p_schema_version: 1 })
    expect(h.revalidatePath).toHaveBeenCalledWith('/(app)/w/[slug]', 'layout')
  })
  it('같은 commandId 재전송은 duplicate 이고 같은 프로젝트다', async () => {
    const a = await createProject(input()); const b = await createProject(input())
    expect(a.ok && b.ok && a.projectId === b.projectId && b.status === 'duplicate').toBe(true)
    expect(db.projects.size).toBe(3)
  })
  it('첨부 정책을 생성 때 한 번 복사하며 워크스페이스 변경은 기존 프로젝트에 상속하지 않는다', async () => {
    const narrow = { ...DEFAULT_ATTACHMENT_POLICY, maxCount: 2, maxTotalBytes: 2 * DEFAULT_ATTACHMENT_POLICY.maxFileBytes }
    db.workspaces.get(WID)!.values['minutes.attachments'] = narrow
    const r = await createProject(input())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(db.projects.get(r.projectId)!.values['minutes.attachments']).toEqual(narrow)
    db.workspaces.get(WID)!.values['minutes.attachments'] = DEFAULT_ATTACHMENT_POLICY
    expect(db.projects.get(r.projectId)!.values['minutes.attachments']).toEqual(narrow)
  })
  it('프로젝트 복사는 원본의 명시 첨부 정책을 보존하고 손상된 원본/워크스페이스는 생성하지 않는다', async () => {
    const narrow = { ...DEFAULT_ATTACHMENT_POLICY, allowedExtensions: ['pdf'] }
    db.projects.get(SRC)!.values['minutes.attachments'] = narrow
    const r = await createProject(input({ copyFromProjectId: SRC }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(db.projects.get(r.projectId)!.values['minutes.attachments']).toEqual(narrow)
    const before = db.projects.size
    db.projects.get(SRC)!.values['minutes.attachments'] = null
    expect(await createProject(input({ copyFromProjectId: SRC, commandId: '00000000-0000-4000-8000-00000000dd21' }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'minutes.attachments' }] })
    db.workspaces.get(WID)!.values['minutes.attachments'] = null
    expect(await createProject(input({ commandId: '00000000-0000-4000-8000-00000000dd22' }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'minutes.attachments' }] })
    expect(db.projects.size).toBe(before)
  })
  it('복사 — 원본의 set 키 전부를 넘기고 modules.enabled 는 대상 허용과 재교집합, 라벨은 입력값. 이력 source copy', async () => {
    const r = await createProject(input({ copyFromProjectId: SRC, levelLabels: ['P', 'T', 'A'] }))
    expect(r).toMatchObject({ ok: true })
    if (!r.ok) return
    expect(db.projects.get(r.projectId)!.values).toEqual({
      'core.level_labels': ['P', 'T', 'A'], 'modules.enabled': ['kanban'],           // agents 미허용, wiki 는 minutes 없음
      'core.milestone_keywords': ['출시'], 'core.extra_axis_label': 'Track',
      'minutes.attachments': DEFAULT_ATTACHMENT_POLICY, 'calendar.timezone': 'UTC', 'calendar.working_days': [1, 2, 3, 4, 5], 'calendar.week_start': [{ day: 'sunday', from: null }],
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
  it('env 는 생성 초기값을 바꾸지 않는다 — 플래그가 꺼져도 허용된 wiki·chatbot 이 명시 기록되고, 0012 ⑤ 리터럴 9개와 같다(FN-1, 스펙 §4.1)', async () => {
    const ALL13 = ['kanban', 'meetings', 'weekly', 'issues', 'wiki', 'announcements', 'attendance', 'agents', 'minutes', 'minutes_integration', 'chatbot', 'portfolio', 'usage']
    const MIGRATED_9 = ['kanban', 'meetings', 'weekly', 'issues', 'announcements', 'attendance', 'agents', 'wiki', 'chatbot']     // 0012 ⑤ 의 이행 리터럴
    db.workspaces.get(WID)!.values['modules.allowed'] = ALL13
    const enabledWith = async (flag: string | undefined, cmd: string) => {
      if (flag === undefined) delete process.env.WIKI_SERVICE_ENABLED; else process.env.WIKI_SERVICE_ENABLED = flag
      delete process.env.CHAT_V2_ENABLED
      const r = await createProject(input({ commandId: cmd }))
      expect(r).toMatchObject({ ok: true })
      return db.rpcCalls.at(-1)!.args.p_values as Record<string, unknown>
    }
    const off = (await enabledWith(undefined, '00000000-0000-4000-8000-00000000dd11'))['modules.enabled'] as string[]
    const on = (await enabledWith('true', '00000000-0000-4000-8000-00000000dd12'))['modules.enabled'] as string[]
    expect(off).toEqual(expect.arrayContaining(['wiki', 'chatbot']))
    expect(off).toEqual(on)
    expect([...off].sort()).toEqual([...MIGRATED_9].sort())
  })
  it('원본이 앞선 세대(schemaAhead)면 복사를 거부한다 — 모르는 키가 없어도(D29, FN-5)', async () => {
    const AHEAD = '00000000-0000-4000-8000-00000000aa03', AHEAD_BARE = '00000000-0000-4000-8000-00000000aa04'
    db.addProject({ id: AHEAD, workspaceId: WID, schemaVersion: 2, values: { 'core.level_labels': ['S1'], 'modules.enabled': ['kanban'], 'future.new_key': 42 } })
      .addProject({ id: AHEAD_BARE, workspaceId: WID, schemaVersion: 2, values: { 'core.level_labels': ['S1'], 'modules.enabled': ['kanban'] } })
    const r = await createProject(input({ copyFromProjectId: AHEAD }))
    expect(r).toEqual({ ok: false, code: 'CONFIG_INVALID', error: '원본 프로젝트의 설정이 이 서버보다 새 버전이라 복사할 수 없습니다.',
      fieldErrors: [{ key: 'future.new_key', message: expect.any(String) }] })
    const bare = await createProject(input({ copyFromProjectId: AHEAD_BARE }))
    expect(bare).toMatchObject({ ok: false, code: 'CONFIG_INVALID', fieldErrors: [{ key: 'schema_version', message: expect.stringContaining('2') }] })
    expect(db.rpcCalls).toHaveLength(0); expect(db.projects.size).toBe(4)
  })
  it('워크스페이스 modules.allowed 가 손상이면 throw 대신 CONFIG_INVALID 결과 — 복사 경로도, RPC 0회(FN-6)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const broken of [['kanban', 'nope'], 'notarray']) {
      for (const copyFromProjectId of [null, SRC]) {
        err.mockClear()
        db.workspaces.get(WID)!.values['modules.allowed'] = broken
        const r = await createProject(input({ copyFromProjectId }))
        expect(r, JSON.stringify({ broken, copyFromProjectId })).toEqual({ ok: false, code: 'CONFIG_INVALID', error: ERR_MODULES_ALLOWED_BROKEN,
          fieldErrors: [{ key: 'modules.allowed', message: ERR_MODULES_ALLOWED_BROKEN }] })
        expect(err.mock.calls.filter((c) => String(c[0]).startsWith('[createProject]'))).toHaveLength(1)
      }
    }
    expect(db.rpcCalls).toHaveLength(0); expect(db.projects.size).toBe(2)
  })
  it('한쪽만 있는 날짜도 형식·실재를 본다 — RPC 의 22008 이 "설정을 불러오지 못해"로 나가지 않게(FM-15)', async () => {
    for (const [startDate, endDate] of [['2026-13-45', null], [null, '2026-02-30'], ['2026/01/01', null]] as const) {
      expect(await createProject(input({ startDate, endDate })), `${startDate}~${endDate}`).toEqual({ ok: false, code: 'CONFIG_INVALID', error: '날짜 형식이 올바르지 않습니다.' })
    }
    expect(db.rpcCalls).toHaveLength(0)
    expect(await createProject(input({ startDate: '2026-02-28', endDate: null }))).toMatchObject({ ok: true })
  })
  it('워크스페이스 id 가 비면 가드 전에 거부(슈퍼유저도). commandId 가 uuid 가 아니면 거부. 워크스페이스 설정 행이 없으면 CONFIG_UNAVAILABLE', async () => {
    for (const wid of ['', null, undefined, 42]) expect((await createProject(input({ workspaceId: wid as never }))).ok, String(wid)).toBe(false)
    expect(h.requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(await createProject(input({ commandId: 'nope' }))).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
    db.workspaces.delete(WID)
    expect(await createProject(input())).toMatchObject({ ok: false, code: 'CONFIG_UNAVAILABLE' })
  })
})

describe('createProject — DB 원문은 응답에 싣지 않는다(로그로)·존재 오라클 없음·재사용 코드', () => {
  it('설정 조회 실패(I-1)는 고정 문구 + 서버 로그 — 원문은 응답에 없다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.failTable = 'workspace_settings'
    const r = await createProject(input())
    expect(r).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE })
    expect(JSON.stringify(r)).not.toContain('fake failure')
    expect(err.mock.calls.some((c) => JSON.stringify(c).includes('fake failure'))).toBe(true)
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('없는(또는 보이지 않는) 복사 원본은 다른 워크스페이스 원본과 같은 ERR_DENIED(M-2) — id 존재를 구분할 수 없다', async () => {
    const MISSING = '00000000-0000-4000-8000-00000000aa99'
    const missing = await createProject(input({ copyFromProjectId: MISSING }))
    const foreign = await createProject(input({ copyFromProjectId: FOREIGN }))
    expect(missing).toEqual({ ok: false, code: ERR_DENIED, error: ERR_DENIED })
    expect(missing).toEqual(foreign)
    expect(db.rpcCalls).toHaveLength(0)
  })
  it('표에 없는 DB 토큰(M-7)은 throw 하지 않고 로그 + CONFIG_UNAVAILABLE 고정 문구', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = db.client()
    h.adminFor.mockImplementation((s: Record<string, string>) => ({
      ...s, admin: { ...client, rpc: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'relation "secret_tbl" exploded', details: null } })) },
    }))
    const r = await createProject(input())
    expect(r).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: CONFIG_MESSAGES.CONFIG_UNAVAILABLE })
    expect(err.mock.calls.some((c) => JSON.stringify(c).includes('secret_tbl'))).toBe(true)
  })
  it('표에 있는 DB 거부 중 재시도 가능·세대 앞섬은 결과와 함께 로그를 남긴다 — 표시 = 로깅(FM-12)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = db.client()
    h.adminFor.mockImplementation((s: Record<string, string>) => ({ ...s, admin: { ...client, rpc: vi.fn(async () => ({ data: null, error: { code: '40P01', message: 'deadlock detected', details: null } })) } }))
    expect(await createProject(input())).toEqual({ ok: false, code: 'CONFIG_BUSY', error: CONFIG_MESSAGES.CONFIG_BUSY })
    expect(err).toHaveBeenCalledWith('[createProject] RPC 거부', { workspaceId: WID, copyFrom: null, commandId: CMD, token: '40P01' })
  })
  it('같은 요청 번호에 다른 내용이면 code COMMAND_REUSED(M-3 — 모달이 새 번호를 발급한다)', async () => {
    expect(await createProject(input())).toMatchObject({ ok: true })
    expect(await createProject(input({ name: 'Acme 다른 이름' }))).toMatchObject({ ok: false, code: 'COMMAND_REUSED' })
  })
})

describe('createProject 양식 파일 복사와 보상', () => {
  const FT = '00000000-0000-4000-8000-00000000ff01'
  const sourcePath = `ws/${WID}/p/${SRC}/weekly_report_pptx/v3.pptx`
  const scan = { engineVersion: 'forms-engine.v1', format: 'pptx', placeholders: [], issues: [] }
  let files: Set<string>
  let copy: ReturnType<typeof vi.fn>
  let remove: ReturnType<typeof vi.fn>
  let invoke: ReturnType<typeof vi.fn>
  let mode: 'ok' | 'sql' | 'lost' | 'malformed' | 'unknown' | 'race' | 'reused'
  beforeEach(() => {
    mode = 'ok'
    files = new Set([sourcePath])
    copy = vi.fn(async (_src: string, dest: string) => { files.add(dest); return { data: { path: dest }, error: null } })
    remove = vi.fn(async (paths: string[]) => { paths.forEach(p => files.delete(p)); return { data: [], error: null } })
    db.projects.get(SRC)!.revision = 7
    db.projects.get(SRC)!.values['forms.weekly_report_pptx'] = {
      template_id: FT, mapping: {}, options: { max_lines_per_cell: 15, max_rows_per_slide: 5, item_cap: 0, empty_text: '', continuation_label: '(계속)' },
    }
    db.formTemplates = [{ id: FT, project_id: SRC, form_kind: 'weekly_report_pptx', storage_path: sourcePath,
      size_bytes: 100, version: 3, placeholders: scan, file_name: '양식.pptx', active: true },
      { id: '00000000-0000-4000-8000-00000000ff02', project_id: SRC, form_kind: 'weekly_report_pptx', storage_path: sourcePath.replace('v3','v2'),
        size_bytes: 100, version: 2, placeholders: scan, file_name: '이전.pptx', active: false }]
    const base = db.client()
    let receipts = 0
    invoke = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'get_project_creation_receipt') {
        receipts++
        if (receipts > 1 && mode === 'unknown') return { data: null, error: { code: '', message: 'connection lost' } }
        if (receipts > 1 && mode === 'reused') return { data: null, error: { code: '23505', message: 'COMMAND_REUSED' } }
      }
      if (name === 'create_project_with_settings') {
        if (mode === 'sql') return { data: null, error: { code: '40001', message: 'FORM_TEMPLATE_COPY_CHANGED' } }
        if (mode === 'reused') return { data: null, error: { code: '', message: 'connection lost' } }
        if (mode === 'race') {
          const other = await base.rpc(name, { ...args, p_destination_id: '00000000-0000-4000-8000-00000000ee01' })
          return { ...other, data: { status: 'duplicate', project_id: '00000000-0000-4000-8000-00000000ee01' } }
        }
        const applied = await base.rpc(name, args)
        if (['lost', 'unknown'].includes(mode)) return { data: null, error: { code: '', message: 'connection lost' } }
        if (mode === 'malformed') return { data: {}, error: null }
        return applied
      }
      return base.rpc(name, args)
    })
    h.adminFor.mockImplementation(s => ({ ...s, admin: { ...base, rpc: invoke, storage: { from: () => ({ copy, remove }) } } }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  it('활성 버전만 새 프로젝트 v1에 복사한 후 RPC를 호출하며 같은 명령 재시도는 파일을 복사하지 않는다', async () => {
    const r = await createProject(input({ copyFromProjectId: SRC }))
    expect(r).toMatchObject({ ok: true, status: 'applied' })
    if (!r.ok) return
    expect(copy).toHaveBeenCalledExactlyOnceWith(sourcePath, `ws/${WID}/p/${r.projectId}/weekly_report_pptx/v1.pptx`)
    const args = invoke.mock.calls.find(c => c[0] === 'create_project_with_settings')![1]
    expect(args).toMatchObject({ p_destination_id: r.projectId, p_source_revision: 7, p_actor: 'u-admin' })
    expect(args.p_form_manifest).toHaveLength(1)
    expect(await createProject(input({ copyFromProjectId: SRC }))).toEqual({ ...r, status: 'duplicate' })
    expect(copy).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })
  it('부분 복사와 복사 응답 유실은 이 시도의 경로를 모두 정리하고 생성 RPC를 부르지 않는다', async () => {
    const second = { ...db.formTemplates[0], id: '00000000-0000-4000-8000-00000000ff03', form_kind: 'wbs_export_xlsx', version: 1,
      storage_path: `ws/${WID}/p/${SRC}/wbs_export_xlsx/v1.xlsx` }
    db.formTemplates.push(second)
    db.projects.get(SRC)!.values['forms.wbs_export_xlsx'] = { ...db.projects.get(SRC)!.values['forms.weekly_report_pptx'] as object, template_id: second.id }
    copy.mockImplementationOnce(async (_src, dest) => { files.add(dest); return { data: {}, error: null } })
      .mockImplementationOnce(async (_src, dest) => { files.add(dest); throw new Error('copy response lost') })
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false, code: 'CONFIG_UNAVAILABLE' })
    expect(invoke.mock.calls.filter(c => c[0] === 'create_project_with_settings')).toHaveLength(0)
    expect(remove.mock.calls[0][0]).toHaveLength(2)
    expect([...files]).toEqual([sourcePath])
    expect(db.projects.size).toBe(2)
  })
  it('확정된 SQL 실패는 복사 파일을 지우고 새 프로젝트를 남기지 않는다', async () => {
    mode = 'sql'
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false, error: '복사 원본이 변경되었습니다. 다시 시도하세요.' })
    expect([...files]).toEqual([sourcePath])
    expect(db.projects.size).toBe(2)
  })
  it.each(['lost', 'malformed'] as const)('DB 커밋 후 %s 응답은 영수증으로 성공을 확인하고 파일을 보존한다', async lost => {
    mode = lost
    const r = await createProject(input({ copyFromProjectId: SRC }))
    expect(r).toMatchObject({ ok: true, status: 'applied' })
    expect(remove).not.toHaveBeenCalled()
    expect(files.size).toBe(2)
    expect(invoke.mock.calls.filter(c => c[0] === 'get_project_creation_receipt')).toHaveLength(2)
  })
  it('영수증 조회까지 실패하면 커밋된 파일을 지우지 않고 실패를 표시한다', async () => {
    mode = 'unknown'
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false, code: 'CONFIG_UNAVAILABLE' })
    expect(remove).not.toHaveBeenCalled()
    expect(files.size).toBe(2)
    expect(db.projects.size).toBe(3)
  })
  it('동시 재전송의 다른 시도가 확정되면 자기 경로만 지우고 확정된 프로젝트를 돌려준다', async () => {
    mode = 'race'
    const r = await createProject(input({ copyFromProjectId: SRC }))
    expect(r).toMatchObject({ ok: true, status: 'duplicate', projectId: '00000000-0000-4000-8000-00000000ee01' })
    expect([...files]).toEqual([sourcePath])
    expect(remove.mock.calls[0][0][0]).not.toContain('/p/00000000-0000-4000-8000-00000000ee01/')
  })
  it('응답 유실 뒤 다른 내용의 명령 영수증이 확인되면 이 시도 파일을 정리하고 COMMAND_REUSED를 돌려준다', async () => {
    mode = 'reused'
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false, code: 'COMMAND_REUSED' })
    expect([...files]).toEqual([sourcePath])
  })
  it('파일 목록 조회 실패와 원본 연결 손상은 생성도 복사도 하지 않는다', async () => {
    db.failTable = 'form_templates'
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false })
    db.failTable = null
    db.formTemplates[0].storage_path = `ws/${OTHER}/p/${SRC}/weekly_report_pptx/v3.pptx`
    expect(await createProject(input({ copyFromProjectId: SRC }))).toMatchObject({ ok: false })
    expect(copy).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
