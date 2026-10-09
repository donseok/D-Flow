// 플랫폼 관리 — 워크스페이스 목록·생성·이름 변경·삭제 액션. 이름 변경은 requireWorkspaceAdmin·rename_workspace, 삭제는 requireSuperuser·delete_empty_workspace(0055).
// 목록·생성: 가드(requireSuperuser)·입력 검증·첫 관리자 없음·생성은 RPC 한 번(create_workspace_with_admin — 0054)·사유 매핑.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSuperuser: vi.fn(), requireWorkspaceAdmin: vi.fn(), createAdminClient: vi.fn(), getWorkspaceConfig: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireSuperuser: mocks.requireSuperuser, requireWorkspaceAdmin: mocks.requireWorkspaceAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: mocks.getWorkspaceConfig }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createPlatformWorkspace, deletePlatformWorkspace, listPlatformWorkspaces, renameWorkspace } from '@/app/actions/platformWorkspaces'
import { NON_CORE_MODULES } from '@/lib/modules/defaults'
import { SETTINGS_SCHEMA_VERSION } from '@/lib/settings/registry'

const ACTOR = 'u-platform'
type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null }
type Call = { table: string; op: 'select' | 'insert' | 'delete' | 'rpc'; payload?: unknown; filters: [string, unknown][] }

/** 표·동작별로 응답을 정하는 가짜 service_role 클라이언트 — 부른 순서를 calls 에 남긴다(RPC 는 table 에 이름, payload 에 인자) */
function fakeAdmin(respond: (c: Call) => Result) {
  const calls: Call[] = []
  const from = (table: string) => {
    const call: Call = { table, op: 'select', filters: [] }
    const done = () => { calls.push(call); return Promise.resolve({ data: null, error: null, ...respond(call) }) }
    const q: Record<string, unknown> = {
      select: () => q, order: () => q, range: () => q,
      eq: (col: string, v: unknown) => { call.filters.push([col, v]); return q },
      insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return q },
      delete: () => { call.op = 'delete'; return q },
      maybeSingle: done, single: done,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => done().then(res, rej),
    }
    return q
  }
  const rpc = (name: string, args: unknown) => {
    const call: Call = { table: name, op: 'rpc', payload: args, filters: [] }
    calls.push(call)
    return Promise.resolve({ data: null, error: null, ...respond(call) })
  }
  const admin = { from, rpc }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, calls }
}
const OWNER = { user_id: 'u-owner' }
const SELF = { user_id: ACTOR }
/** 정상 경로의 응답 — 덮어쓸 것만 over 로 */
const happy = (over: (c: Call) => Result | undefined = () => undefined) => (c: Call): Result => {
  const o = over(c)
  if (o) return o
  if (c.table === 'profiles') return { data: c.filters[0][0] === 'email' ? OWNER : SELF }
  if (c.op === 'rpc') return { data: { status: 'applied', workspace_id: 'ws-new', revision: 1 } }
  return {}
}
const input = { name: '새 조직', slug: 'new-org', adminEmail: 'owner@example.com' }
const rpcOf = (calls: Call[]) => calls.filter((c) => c.op === 'rpc')
const valuesOf = (calls: Call[]) => (rpcOf(calls)[0].payload as { p_values: Record<string, unknown> }).p_values

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: { userId: ACTOR, isSuperuser: true } })
  mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u-ws-admin', isSuperuser: false } })
})

describe('createPlatformWorkspace', () => {
  it('플랫폼 관리자가 아니면 거부 — service_role 클라이언트를 만들지 않는다', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'denied', field: null, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('입력 검증은 가드 뒤, DB 앞 — slug 형식 밖이면 아무것도 읽거나 쓰지 않는다', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await createPlatformWorkspace({ ...input, slug: 'Bad Slug' })).toEqual({ ok: false, code: 'slug_invalid', field: 'slug' })
    expect(calls).toEqual([])
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('정상 — 첫 관리자 계정을 읽고 생성 RPC 한 번. 표에 직접 쓰지 않고, 행위자는 가드 결과의 userId', async () => {
    const { calls } = fakeAdmin(happy())
    const res = await createPlatformWorkspace({ ...input, modules: ['kanban', 'wiki'], timezone: 'Asia/Tokyo' })
    expect(res).toEqual({ ok: true, workspace: { id: 'ws-new', slug: 'new-org', name: '새 조직' } })
    // 쓰기는 RPC 하나뿐 — 워크스페이스·멤버십·인물·설정 표를 액션이 직접 만지지 않는다(보상 삭제도 없다)
    expect(calls.map((c) => `${c.op}:${c.table}`)).toEqual(['select:profiles', 'rpc:create_workspace_with_admin'])
    const args = rpcOf(calls)[0].payload as Record<string, unknown>
    expect(args).toMatchObject({
      p_actor: ACTOR, p_slug: 'new-org', p_name: '새 조직', p_admin_user_id: 'u-owner', p_schema_version: SETTINGS_SCHEMA_VERSION,
    })
    expect(args.p_command_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(args.p_values).toMatchObject({ 'calendar.timezone': 'Asia/Tokyo' })
    expect([...(args.p_values as Record<string, string[]>)['modules.allowed']].sort()).toEqual(['kanban', 'wiki'])
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
  it('기본값 — 이메일을 비우면 만드는 사람이 첫 관리자, 허용 모듈은 비core 전부, 시간대는 쓰지 않는다', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await createPlatformWorkspace({ name: '조직', slug: 'org' })).toMatchObject({ ok: true })
    expect(calls[0]).toMatchObject({ table: 'profiles', filters: [['user_id', ACTOR]] })
    expect(rpcOf(calls)[0].payload).toMatchObject({ p_admin_user_id: ACTOR })
    expect(Object.keys(valuesOf(calls))).toEqual(['modules.allowed'])
    expect([...(valuesOf(calls)['modules.allowed'] as string[])].sort()).toEqual([...NON_CORE_MODULES].sort())
  })
  it('초대 허용 도메인을 적으면 생성 때 그 설정으로 쓴다(정규화된 목록) — 같은 RPC 한 번', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await createPlatformWorkspace({ ...input, modules: ['kanban'], inviteDomains: ['Example.com', '@partner.co.kr'] })).toMatchObject({ ok: true })
    expect(rpcOf(calls)).toHaveLength(1)
    expect(valuesOf(calls)).toEqual({ 'modules.allowed': ['kanban'], 'invites.allowed_domains': ['example.com', 'partner.co.kr'] })
  })
  it('초대 허용 도메인을 비우면 그 키를 쓰지 않는다 — 정책 기본값(초대 불가)·배포 기본값을 그대로 둔다', async () => {
    const { calls } = fakeAdmin(happy())
    await createPlatformWorkspace({ ...input, modules: ['kanban'], inviteDomains: [] })
    expect(valuesOf(calls)).toEqual({ 'modules.allowed': ['kanban'] })
  })
  it('도메인 형식 밖이면 아무것도 만들지 않는다 — 그 필드의 사유로 거부', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await createPlatformWorkspace({ ...input, inviteDomains: ['*', 'example.com'] }))
      .toEqual({ ok: false, code: 'domains_invalid', field: 'inviteDomains' })
    expect(calls).toEqual([])
  })
  it('허용 모듈을 모두 끄면 빈 배열을 명시로 적는다(core 만)', async () => {
    const { calls } = fakeAdmin(happy())
    await createPlatformWorkspace({ ...input, modules: [] })
    expect(valuesOf(calls)).toEqual({ 'modules.allowed': [] })
  })
  it('첫 관리자 계정이 없으면 거부 — RPC 를 부르지 않는다(계정을 여기서 만들지 않는다)', async () => {
    const { calls } = fakeAdmin(happy((c) => (c.table === 'profiles' ? { data: null } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'admin_not_found', field: 'adminEmail' })
    expect(rpcOf(calls)).toEqual([])
  })
  it('첫 관리자 조회 실패는 "없음"으로 바꾸지 않고 멈춘다 — 쓰기 0건, 원문은 응답에 없다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { calls } = fakeAdmin(happy((c) => (c.table === 'profiles' ? { error: { message: 'relation "profiles" boom' } } : undefined)))
    const res = await createPlatformWorkspace(input)
    expect(res).toEqual({ ok: false, code: 'lookup_failed', field: 'adminEmail' })
    expect(JSON.stringify(res)).not.toContain('boom')
    expect(rpcOf(calls)).toEqual([])
    spy.mockRestore()
  })
  it.each([
    ['slug 중복(사전 조회 없이 RPC 의 유니크 판정이 사유를 낸다)', { code: '23505', message: 'WORKSPACE_SLUG_TAKEN' }, { ok: false, code: 'slug_taken', field: 'slug' }],
    ['조회와 RPC 사이에 첫 관리자 계정이 사라짐', { code: 'P0002', message: 'WORKSPACE_ADMIN_NOT_FOUND' }, { ok: false, code: 'admin_not_found', field: 'adminEmail' }],
    ['RPC 의 등급 재판정이 거부(가드 뒤 플랫폼 관리자에서 빠짐)', { code: '42501', message: 'AUTHZ_FORBIDDEN' }, { ok: false, code: 'denied', field: null }],
  ])('RPC 사유 매핑 — %s', async (_name, error, want) => {
    const { calls } = fakeAdmin(happy((c) => (c.op === 'rpc' ? { data: null, error } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual(want)
    // 실패는 곧 아무것도 남지 않음이다 — 되돌릴 것이 없으므로 보상 호출도 없다
    expect(calls.filter((c) => c.op === 'delete' || c.op === 'insert')).toEqual([])
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('표에 없는 RPC 오류는 create_failed — 원문은 로그로만, 보상 삭제를 시도하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const error of [
      { code: '23514', message: 'new row for relation "people" violates check constraint boom' },
      { code: '42501', message: 'permission denied for function create_workspace_with_admin boom' },   // 실행권 문제는 '권한 없음'이 아니라 배포 문제다
      { code: 'P0001', message: 'SETTINGS_ROW_MISSING boom' },
    ]) {
      const { calls } = fakeAdmin(happy((c) => (c.op === 'rpc' ? { data: null, error } : undefined)))
      const res = await createPlatformWorkspace(input)
      expect(res).toEqual({ ok: false, code: 'create_failed', field: null })
      expect(JSON.stringify(res)).not.toContain('boom')
      expect(calls.map((c) => c.op)).toEqual(['select', 'rpc'])
    }
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
  it('RPC 가 성공했는데 워크스페이스 id 가 없으면 성공으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin(happy((c) => (c.op === 'rpc' ? { data: { status: 'applied' } } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'create_failed', field: null })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('listPlatformWorkspaces', () => {
  const WS = [
    { id: 'w1', slug: 'alpha', name: '알파', created_at: '2026-09-01T00:00:00Z' },
    { id: 'w2', slug: 'beta', name: '베타', created_at: '2026-10-01T00:00:00Z' },
  ]
  const rows = (c: Call): Result => {
    if (c.table === 'workspaces') return { data: WS, count: 2 }
    if (c.table === 'workspace_members') return { data: [{ workspace_id: 'w1' }, { workspace_id: 'w1' }, { workspace_id: 'w2' }], count: 3 }
    if (c.table === 'projects') return { data: [{ workspace_id: 'w1' }], count: 1 }
    return {}
  }
  it('플랫폼 관리자가 아니면 거부', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await listPlatformWorkspaces()).toEqual({ ok: false, error: '권한 없음' })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('이름·slug·멤버 수·프로젝트 수·만든 날·허용 모듈', async () => {
    fakeAdmin(rows)
    mocks.getWorkspaceConfig.mockImplementation(async (id: string) => ({
      keys: { 'modules.allowed': id === 'w1' ? { status: 'set', value: ['kanban'] } : { status: 'default', value: [], from: 'product' } },
    }))
    expect(await listPlatformWorkspaces()).toEqual({ ok: true, rows: [
      { id: 'w1', slug: 'alpha', name: '알파', createdAt: '2026-09-01T00:00:00Z', memberCount: 2, projectCount: 1, allowedModules: ['kanban'] },
      { id: 'w2', slug: 'beta', name: '베타', createdAt: '2026-10-01T00:00:00Z', memberCount: 1, projectCount: 0, allowedModules: [] },
    ] })
  })
  it('한 워크스페이스의 설정이 손상·판독 실패여도 목록은 나오고 그 칸만 null(빈 목록으로 위장하지 않는다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin(rows)
    mocks.getWorkspaceConfig.mockImplementation(async (id: string) => {
      if (id === 'w1') throw new Error('워크스페이스 설정 조회 실패')
      return { keys: { 'modules.allowed': { status: 'invalid', error: 'x' } } }
    })
    const res = await listPlatformWorkspaces()
    expect(res.ok && res.rows.map((r) => r.allowedModules)).toEqual([null, null])
    spy.mockRestore()
  })
  it('목록 조회 실패는 빈 목록이 아니라 오류 — 원문은 응답에 없다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin((c) => (c.table === 'projects' ? { error: { message: 'permission denied for table projects' } } : rows(c)))
    const res = await listPlatformWorkspaces()
    expect(res).toEqual({ ok: false, error: '워크스페이스 목록을 불러오지 못했습니다.' })
    spy.mockRestore()
  })
  it('행 수(count)와 받은 행이 어긋나면 잘린 수를 내지 않고 오류', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let n = 0
    fakeAdmin((c) => (c.table === 'workspace_members' ? (n++ === 0 ? { data: [{ workspace_id: 'w1' }], count: 5 } : { data: [], count: 5 }) : rows(c)))
    expect(await listPlatformWorkspaces()).toMatchObject({ ok: false })
    spy.mockRestore()
  })
})

describe('renameWorkspace', () => {
  const WS = 'ws-1'
  it('그 워크스페이스의 관리자 가드 — 거부되면 service_role 클라이언트를 만들지 않는다', async () => {
    mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await renameWorkspace(WS, '새 이름')).toEqual({ ok: false, code: 'denied', error: '권한 없음' })
    expect(mocks.requireWorkspaceAdmin).toHaveBeenCalledExactlyOnceWith(WS)
    expect(mocks.requireSuperuser).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('워크스페이스 id 가 없으면 가드도 부르지 않는다', async () => {
    expect(await renameWorkspace('', '새 이름')).toEqual({ ok: false, code: 'not_found' })
    expect(await renameWorkspace(undefined as never, '새 이름')).toEqual({ ok: false, code: 'not_found' })
    expect(mocks.requireWorkspaceAdmin).not.toHaveBeenCalled()
  })
  it('이름 검증은 가드 뒤, DB 앞 — 비었거나 80자를 넘거나 줄바꿈이 있으면 RPC 를 부르지 않는다', async () => {
    const { calls } = fakeAdmin(() => ({}))
    expect(await renameWorkspace(WS, '   ')).toEqual({ ok: false, code: 'name_required' })
    expect(await renameWorkspace(WS, 7 as never)).toEqual({ ok: false, code: 'name_required' })
    expect(await renameWorkspace(WS, 'a'.repeat(81))).toEqual({ ok: false, code: 'name_too_long' })
    expect(await renameWorkspace(WS, '두\n줄')).toEqual({ ok: false, code: 'name_too_long' })
    expect(mocks.requireWorkspaceAdmin).toHaveBeenCalledTimes(4)
    expect(calls).toEqual([])
  })
  it('정상 — RPC 한 번(다듬은 이름, 행위자는 가드 결과의 userId). 표에 직접 쓰지 않고, 레이아웃 데이터까지 새로 읽게 한다', async () => {
    const { calls } = fakeAdmin(() => ({ data: { status: 'applied', name: '새 이름', previous: '옛 이름' } }))
    expect(await renameWorkspace(WS, '  새 이름 ')).toEqual({ ok: true, name: '새 이름', unchanged: false })
    expect(calls).toEqual([{ table: 'rename_workspace', op: 'rpc', filters: [], payload: { p_actor: 'u-ws-admin', p_workspace_id: WS, p_name: '새 이름' } }])
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith('/', 'layout')
  })
  it('같은 이름이면 unchanged — 다시 읽게 하지 않는다', async () => {
    fakeAdmin(() => ({ data: { status: 'unchanged', name: '같은 이름' } }))
    expect(await renameWorkspace(WS, '같은 이름')).toEqual({ ok: true, name: '같은 이름', unchanged: true })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it.each([
    [{ code: 'P0002', message: 'WORKSPACE_NOT_FOUND' }, 'not_found'],
    [{ code: '22023', message: 'WORKSPACE_NAME_INVALID' }, 'name_too_long'],
    [{ code: '42501', message: 'AUTHZ_FORBIDDEN' }, 'denied'],
    [{ code: '42501', message: 'permission denied for function rename_workspace' }, 'rename_failed'],
    [{ code: 'XX000', message: 'relation "public.workspaces" is broken' }, 'rename_failed'],
  ])('RPC 오류 %o → %s — 원문은 응답에 없다', async (error, code) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin(() => ({ error }))
    const res = await renameWorkspace(WS, '새 이름')
    expect(res).toEqual({ ok: false, code })
    expect(JSON.stringify(res)).not.toContain('relation')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('RPC 가 성공했는데 결과를 읽지 못하면 성공으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const data of [null, {}, { status: 'applied' }, { status: 'weird', name: 'x' }]) {
      fakeAdmin(() => ({ data }))
      expect(await renameWorkspace(WS, '새 이름'), JSON.stringify(data)).toEqual({ ok: false, code: 'rename_failed' })
    }
    spy.mockRestore()
  })
})

describe('deletePlatformWorkspace', () => {
  const WS = 'ws-9'
  it('플랫폼 관리자가 아니면 거부 — 그 워크스페이스의 관리자 가드로 열지 않는다', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await deletePlatformWorkspace(WS, 'empty-org')).toEqual({ ok: false, code: 'denied', error: '권한 없음' })
    expect(mocks.requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
  it('확인 slug 가 형식 밖이면 DB 에 묻지 않는다 — 다듬어 맞춰 주지 않는다', async () => {
    const { calls } = fakeAdmin(() => ({}))
    for (const slug of ['', ' empty-org', 'Empty-Org', 'empty org', null, undefined]) {
      expect(await deletePlatformWorkspace(WS, slug as never), String(slug)).toEqual({ ok: false, code: 'slug_mismatch' })
    }
    expect(await deletePlatformWorkspace('', 'empty-org')).toEqual({ ok: false, code: 'not_found' })
    expect(calls).toEqual([])
  })
  it('정상 — RPC 한 번(적은 slug 그대로, 행위자는 가드 결과의 userId). 표를 직접 지우지 않는다', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { calls } = fakeAdmin(() => ({ data: { status: 'deleted', slug: 'empty-org', name: '빈 조직', removed: { workspace_settings: 1 } } }))
    expect(await deletePlatformWorkspace(WS, 'empty-org')).toEqual({ ok: true, workspace: { slug: 'empty-org', name: '빈 조직' } })
    expect(calls).toEqual([{ table: 'delete_empty_workspace', op: 'rpc', filters: [], payload: { p_actor: ACTOR, p_workspace_id: WS, p_expected_slug: 'empty-org' } }])
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith('/', 'layout')
    // 서버 로그에 흔적 — 이름·주소는 싣지 않는다
    expect(info).toHaveBeenCalledOnce()
    expect(JSON.stringify(info.mock.calls[0])).not.toContain('빈 조직')
    info.mockRestore()
  })
  it('비어 있지 않으면 not_empty 와 남은 것 — 아무것도 새로 읽게 하지 않는다', async () => {
    fakeAdmin(() => ({ data: { status: 'blocked', slug: 'busy', name: '바쁜 조직', remaining: { projects: 3, workspace_members: 2, zz_new: 1 } } }))
    expect(await deletePlatformWorkspace(WS, 'busy')).toEqual({
      ok: false, code: 'not_empty',
      remaining: [{ key: 'projects', count: 3 }, { key: 'members', count: 2 }, { key: 'other', count: 1, table: 'zz_new' }],
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
  it('거부인데 남은 것을 읽지 못하면 "남은 것 없음"으로 그리지 않고 실패', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const remaining of [undefined, {}, { projects: 'many' }, []]) {
      fakeAdmin(() => ({ data: { status: 'blocked', remaining } }))
      expect(await deletePlatformWorkspace(WS, 'busy'), JSON.stringify(remaining)).toEqual({ ok: false, code: 'delete_failed' })
    }
    spy.mockRestore()
  })
  it.each([
    [{ code: '22023', message: 'WORKSPACE_SLUG_MISMATCH' }, 'slug_mismatch'],
    [{ code: 'P0002', message: 'WORKSPACE_NOT_FOUND' }, 'not_found'],
    [{ code: '23503', message: 'WORKSPACE_DELETE_REFERENCED' }, 'referenced'],
    [{ code: '42501', message: 'AUTHZ_FORBIDDEN' }, 'denied'],
    [{ code: '0A000', message: 'WORKSPACE_DELETE_UNKNOWN_REFERENCE' }, 'delete_failed'],
    [{ code: '22P02', message: 'invalid input syntax for type uuid: "ws-9"' }, 'delete_failed'],
  ])('RPC 오류 %o → %s — 원문은 응답에 없다', async (error, code) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin(() => ({ error }))
    const res = await deletePlatformWorkspace(WS, 'empty-org')
    expect(res).toEqual({ ok: false, code })
    expect(JSON.stringify(res)).not.toContain('uuid')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('RPC 가 성공했는데 결과 형태가 어긋나면 삭제됐다고 하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const data of [null, {}, { status: 'deleted' }, { status: 'applied', slug: 'a', name: 'b' }]) {
      fakeAdmin(() => ({ data }))
      expect(await deletePlatformWorkspace(WS, 'empty-org'), JSON.stringify(data)).toEqual({ ok: false, code: 'delete_failed' })
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
