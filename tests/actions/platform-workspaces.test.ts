// 플랫폼 관리 — 워크스페이스 목록·생성 액션. 가드(requireSuperuser)·입력 검증·slug 중복·첫 관리자 없음·보상(만든 행 삭제)·설정은 RPC 한 길.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireSuperuser: vi.fn(), createAdminClient: vi.fn(), writeWorkspaceSettingsInternal: vi.fn(), getWorkspaceConfig: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireSuperuser: mocks.requireSuperuser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/settings/write', () => ({ writeWorkspaceSettingsInternal: mocks.writeWorkspaceSettingsInternal }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: mocks.getWorkspaceConfig }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { createPlatformWorkspace, listPlatformWorkspaces } from '@/app/actions/platformWorkspaces'
import { NON_CORE_MODULES } from '@/lib/modules/defaults'

const ACTOR = 'u-platform'
type Result = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null }
type Call = { table: string; op: 'select' | 'insert' | 'delete'; payload?: unknown; filters: [string, unknown][] }

/** 표·동작별로 응답을 정하는 가짜 service_role 클라이언트 — 부른 순서를 calls 에 남긴다 */
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
  const admin = { from }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, calls }
}
const OWNER = { user_id: 'u-owner', email: 'owner@example.com', display_name: '오너' }
const SELF = { user_id: ACTOR, email: 'me@example.com', display_name: '나' }
/** 정상 경로의 응답 — 덮어쓸 것만 over 로 */
const happy = (over: (c: Call) => Result | undefined = () => undefined) => (c: Call): Result => {
  const o = over(c)
  if (o) return o
  if (c.table === 'profiles') return { data: c.filters[0][0] === 'email' ? OWNER : SELF }
  if (c.table === 'workspaces' && c.op === 'select') return { data: null }
  if (c.table === 'workspaces' && c.op === 'insert') return { data: { id: 'ws-new' } }
  return {}
}
const input = { name: '새 조직', slug: 'new-org', adminEmail: 'owner@example.com' }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: { userId: ACTOR, isSuperuser: true } })
  mocks.writeWorkspaceSettingsInternal.mockResolvedValue({ ok: true, status: 'applied', revision: 2, commandId: 'c' })
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
  it('정상 — 워크스페이스·관리자 멤버십·인물을 만들고 설정은 내부 쓰기(RPC 한 길)로 적는다', async () => {
    const { admin, calls } = fakeAdmin(happy())
    const res = await createPlatformWorkspace({ ...input, modules: ['kanban', 'wiki'], timezone: 'Asia/Tokyo' })
    expect(res).toEqual({ ok: true, workspace: { id: 'ws-new', slug: 'new-org', name: '새 조직' } })
    const writes = calls.filter((c) => c.op !== 'select')
    expect(writes.map((c) => `${c.op}:${c.table}`)).toEqual(['insert:workspaces', 'insert:workspace_members', 'insert:people'])
    expect(writes[0].payload).toEqual({ slug: 'new-org', name: '새 조직', created_by: ACTOR })
    expect(writes[1].payload).toEqual({ workspace_id: 'ws-new', user_id: 'u-owner', role: 'admin', invited_by: ACTOR })
    expect(writes[2].payload).toEqual({ workspace_id: 'ws-new', email: 'owner@example.com', display_name: '오너', user_id: 'u-owner' })
    // 설정 표를 직접 쓰지 않는다 — 내부 쓰기 함수 한 번, 행위자는 가드 결과의 userId
    expect(calls.some((c) => c.table.includes('settings'))).toBe(false)
    expect(mocks.writeWorkspaceSettingsInternal).toHaveBeenCalledExactlyOnceWith(admin, 'ws-new',
      { set: { 'modules.allowed': ['kanban', 'wiki'], 'calendar.timezone': 'Asia/Tokyo' } }, ACTOR)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/', 'layout')
  })
  it('기본값 — 이메일을 비우면 만드는 사람이 첫 관리자, 허용 모듈은 비core 전부, 시간대는 쓰지 않는다', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await createPlatformWorkspace({ name: '조직', slug: 'org' })).toMatchObject({ ok: true })
    expect(calls[0]).toMatchObject({ table: 'profiles', filters: [['user_id', ACTOR]] })
    expect(calls.find((c) => c.table === 'workspace_members')!.payload).toMatchObject({ user_id: ACTOR, role: 'admin' })
    expect(mocks.writeWorkspaceSettingsInternal.mock.calls[0][2]).toEqual({ set: { 'modules.allowed': [...NON_CORE_MODULES] } })
  })
  it('초대 허용 도메인을 적으면 생성 때 그 설정으로 쓴다(정규화된 목록) — 같은 내부 쓰기 한 번', async () => {
    fakeAdmin(happy())
    expect(await createPlatformWorkspace({ ...input, modules: ['kanban'], inviteDomains: ['Example.com', '@partner.co.kr'] })).toMatchObject({ ok: true })
    expect(mocks.writeWorkspaceSettingsInternal).toHaveBeenCalledTimes(1)
    expect(mocks.writeWorkspaceSettingsInternal.mock.calls[0][2])
      .toEqual({ set: { 'modules.allowed': ['kanban'], 'invites.allowed_domains': ['example.com', 'partner.co.kr'] } })
  })
  it('초대 허용 도메인을 비우면 그 키를 쓰지 않는다 — 정책 기본값(초대 불가)·배포 기본값을 그대로 둔다', async () => {
    fakeAdmin(happy())
    await createPlatformWorkspace({ ...input, modules: ['kanban'], inviteDomains: [] })
    expect(mocks.writeWorkspaceSettingsInternal.mock.calls[0][2]).toEqual({ set: { 'modules.allowed': ['kanban'] } })
  })
  it('도메인 형식 밖이면 아무것도 만들지 않는다 — 그 필드의 사유로 거부', async () => {
    const { calls } = fakeAdmin(happy())
    expect(await createPlatformWorkspace({ ...input, inviteDomains: ['*', 'example.com'] }))
      .toEqual({ ok: false, code: 'domains_invalid', field: 'inviteDomains' })
    expect(calls).toEqual([])
    expect(mocks.writeWorkspaceSettingsInternal).not.toHaveBeenCalled()
  })
  it('허용 모듈을 모두 끄면 빈 배열을 명시로 적는다(core 만)', async () => {
    fakeAdmin(happy())
    await createPlatformWorkspace({ ...input, modules: [] })
    expect(mocks.writeWorkspaceSettingsInternal.mock.calls[0][2]).toEqual({ set: { 'modules.allowed': [] } })
  })
  it('첫 관리자 계정이 없으면 거부 — 워크스페이스를 만들지 않는다(계정을 여기서 만들지 않는다)', async () => {
    const { calls } = fakeAdmin(happy((c) => (c.table === 'profiles' ? { data: null } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'admin_not_found', field: 'adminEmail' })
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
  })
  it('첫 관리자 조회 실패는 "없음"으로 바꾸지 않고 멈춘다 — 쓰기 0건, 원문은 응답에 없다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { calls } = fakeAdmin(happy((c) => (c.table === 'profiles' ? { error: { message: 'relation "profiles" boom' } } : undefined)))
    const res = await createPlatformWorkspace(input)
    expect(res).toEqual({ ok: false, code: 'lookup_failed', field: 'adminEmail' })
    expect(JSON.stringify(res)).not.toContain('boom')
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
    spy.mockRestore()
  })
  it('slug 중복 — 사전 조회에서 걸리면 만들지 않는다', async () => {
    const { calls } = fakeAdmin(happy((c) => (c.table === 'workspaces' && c.op === 'select' ? { data: { id: 'ws-old' } } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'slug_taken', field: 'slug' })
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
  })
  it('slug 중복 — 사전 조회를 지난 경합은 유니크 위반(23505)이 잡는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin(happy((c) => (c.table === 'workspaces' && c.op === 'insert' ? { data: null, error: { message: 'duplicate key', code: '23505' } } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'slug_taken', field: 'slug' })
    expect(mocks.writeWorkspaceSettingsInternal).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('slug 조회 실패는 중단 — 쓰기 전 선행 조회가 실패하면 만들지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { calls } = fakeAdmin(happy((c) => (c.table === 'workspaces' && c.op === 'select' ? { error: { message: 'down' } } : undefined)))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'lookup_failed', field: 'slug' })
    expect(calls.filter((c) => c.op !== 'select')).toEqual([])
    spy.mockRestore()
  })
  it.each([
    ['멤버십', (c: Call) => c.table === 'workspace_members'],
    ['인물', (c: Call) => c.table === 'people'],
  ])('보상 — %s 저장이 실패하면 만든 워크스페이스를 지우고 create_failed', async (_name, failing) => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { calls } = fakeAdmin(happy((c) => (c.op === 'insert' && failing(c) ? { error: { message: 'insert boom' } } : undefined)))
    const res = await createPlatformWorkspace(input)
    expect(res).toEqual({ ok: false, code: 'create_failed', field: null })
    expect(JSON.stringify(res)).not.toContain('boom')
    expect(calls.at(-1)).toMatchObject({ table: 'workspaces', op: 'delete', filters: [['id', 'ws-new']] })
    expect(mocks.writeWorkspaceSettingsInternal).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    spy.mockRestore()
  })
  it('보상 — 설정 저장이 거부(ok:false)되거나 던져도 워크스페이스를 지운다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const fail of [
      () => mocks.writeWorkspaceSettingsInternal.mockResolvedValueOnce({ ok: false, code: 'CONFIG_INVALID', error: 'x' }),
      () => mocks.writeWorkspaceSettingsInternal.mockRejectedValueOnce(new Error('알 수 없는 DB 오류')),
    ]) {
      const { calls } = fakeAdmin(happy())
      fail()
      expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'create_failed', field: null })
      expect(calls.at(-1)).toMatchObject({ table: 'workspaces', op: 'delete', filters: [['id', 'ws-new']] })
    }
    spy.mockRestore()
  })
  it('보상의 한계 — 삭제까지 실패하면 cleanup_failed 로 알리고 로그에 id 를 남긴다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeAdmin(happy((c) => {
      if (c.table === 'people' && c.op === 'insert') return { error: { message: 'x' } }
      if (c.table === 'workspaces' && c.op === 'delete') return { error: { message: 'delete blocked' } }
      return undefined
    }))
    expect(await createPlatformWorkspace(input)).toEqual({ ok: false, code: 'cleanup_failed', field: null })
    expect(spy.mock.calls.some((c) => String(c[0]).includes('workspace_id=ws-new'))).toBe(true)
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
