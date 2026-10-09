import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getActor: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/authz', () => ({ getActor: mocks.getActor }))

import { getUsageDirectory } from '@/lib/data/usage'
import { makeSuperuser, makeActor } from '../fixtures/actor'

type Result = { data: unknown; error: { message: string } | null }

function builder(result: Result) {
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'not', 'order']) q[m] = vi.fn(() => q)
  q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return q
}

const USERS = [
  { id: 'u-root', email: 'root@example.com', created_at: '2026-09-01T00:00:00Z', last_sign_in_at: null, user_metadata: {} },
  { id: 'u-alice', email: 'alice@example.com', created_at: '2026-09-02T00:00:00Z', last_sign_in_at: '2026-09-20T00:00:00Z', user_metadata: { name: '메타이름' } },
  { id: 'u-bob', email: 'bob@example.com', created_at: '2026-09-03T00:00:00Z', last_sign_in_at: null, user_metadata: {} },
  { id: 'u-none', email: 'none@example.com', created_at: '2026-09-04T00:00:00Z', last_sign_in_at: null, user_metadata: { name: '무소속' } },
]

function setup(tables: Record<string, Result>) {
  const from = vi.fn((table: string) => {
    if (!(table in tables)) throw new Error(`unexpected table: ${table}`)
    return builder(tables[table])
  })
  const admin = {
    from,
    auth: { admin: { listUsers: vi.fn(async () => ({ data: { users: USERS }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, from }
}

const OK_TABLES: Record<string, Result> = {
  profiles: { data: [
    { user_id: 'u-root', display_name: '루트' },
    { user_id: 'u-alice', display_name: '앨리스' },
    { user_id: 'u-bob', display_name: '밥' },
  ], error: null },
  platform_admins: { data: [{ user_id: 'u-root' }], error: null },
  workspace_members: { data: [
    { user_id: 'u-alice', role: 'admin' },
    { user_id: 'u-bob', role: 'member' },
  ], error: null },
  project_members: { data: [
    // 앨리스: 프로젝트 둘 — 대표 팀 MES, ERP. 대표 아닌 QA 는 열에 넣지 않는다.
    { people: { user_id: 'u-alice' }, project_member_teams: [
      { is_primary: false, teams: { code: 'QA' } }, { is_primary: true, teams: { code: 'MES' } },
    ] },
    { people: [{ user_id: 'u-alice' }], project_member_teams: [{ is_primary: true, teams: { code: 'ERP' } }] },
    // 같은 대표 팀이 두 번 나와도 한 번만.
    { people: { user_id: 'u-alice' }, project_member_teams: [{ is_primary: true, teams: { code: 'ERP' } }] },
    // 밥: 팀 없는 명단 행.
    { people: { user_id: 'u-bob' }, project_member_teams: [] },
    // 외부 인력(계정 없음)은 계정 디렉터리와 무관하다.
    { people: { user_id: null }, project_member_teams: [{ is_primary: true, teams: { code: 'ERP' } }] },
  ], error: null },
}

describe('getUsageDirectory — profiles·platform_admins·workspace_members·명단 팀', () => {
  beforeEach(() => vi.clearAllMocks())

  it('역할은 플랫폼 관리자·워크스페이스 역할, 팀은 활성 명단 행의 대표 팀 합집합(가나다순 · join)', async () => {
    mocks.getActor.mockResolvedValue(makeSuperuser())
    const { from } = setup(OK_TABLES)

    const rows = await getUsageDirectory()
    const by = new Map(rows.map(r => [r.id, r]))

    expect(by.get('u-root')).toMatchObject({ name: '루트', role: 'admin', teamCode: null })
    expect(by.get('u-alice')).toMatchObject({ name: '앨리스', role: 'admin', teamCode: 'ERP·MES', lastSignInAt: '2026-09-20T00:00:00Z' })
    expect(by.get('u-bob')).toMatchObject({ name: '밥', role: 'member', teamCode: null })
    // profiles 행이 없으면 계정 메타데이터 이름으로 폴백하고, 워크스페이스가 없으면 역할 없음.
    expect(by.get('u-none')).toMatchObject({ name: '무소속', role: null, teamCode: null })
    expect(from.mock.calls.map(c => c[0])).not.toContain('memberships')
  })

  it('팀 이름을 함께 준다(teamLabel — 표시용). 이름이 없는 팀은 code, 그 사람의 팀 안에서 이름이 겹치면 `이름 (code)`', async () => {
    mocks.getActor.mockResolvedValue(makeSuperuser())
    const { from } = setup({ ...OK_TABLES, project_members: { data: [
      { people: { user_id: 'u-alice' }, project_member_teams: [{ is_primary: true, teams: { code: 'MES', name: '제조' } }] },
      { people: { user_id: 'u-alice' }, project_member_teams: [{ is_primary: true, teams: { code: 'ERP', name: '' } }] },
      { people: { user_id: 'u-bob' }, project_member_teams: [{ is_primary: true, teams: { code: 'QA', name: '품질' } }] },
      { people: { user_id: 'u-bob' }, project_member_teams: [{ is_primary: true, teams: [{ code: 'QC', name: '품질' }] }] },
    ], error: null } })
    const by = new Map((await getUsageDirectory()).map(r => [r.id, r]))
    expect(by.get('u-alice')).toMatchObject({ teamCode: 'ERP·MES', teamLabel: '제조·ERP' })
    expect(by.get('u-bob')).toMatchObject({ teamCode: 'QA·QC', teamLabel: '품질 (QA)·품질 (QC)' })
    expect(by.get('u-root')).toMatchObject({ teamCode: null, teamLabel: null })
    const pm = from.mock.results[from.mock.calls.findIndex(c => c[0] === 'project_members')].value as Record<string, ReturnType<typeof vi.fn>>
    expect(String(pm.select.mock.calls[0][0])).toContain('teams(code, name)')
  })

  it('명단 조회는 활성 행·활성 인물만(buildActor 의 명단 팀과 같은 축)', async () => {
    mocks.getActor.mockResolvedValue(makeSuperuser())
    const { from } = setup(OK_TABLES)
    await getUsageDirectory()
    const pmIdx = from.mock.calls.findIndex(c => c[0] === 'project_members')
    const pm = from.mock.results[pmIdx].value as Record<string, ReturnType<typeof vi.fn>>
    expect(String(pm.select.mock.calls[0][0])).toContain('people!inner(user_id')
    expect(pm.eq).toHaveBeenCalledWith('active', true)
    expect(pm.eq).toHaveBeenCalledWith('people.active', true)
  })

  it.each(['profiles', 'platform_admins', 'workspace_members', 'project_members'])(
    '%s 조회 실패는 역할·팀 없음으로 위장하지 않고 던진다', async table => {
      mocks.getActor.mockResolvedValue(makeSuperuser())
      setup({ ...OK_TABLES, [table]: { data: null, error: { message: 'boom' } } })
      await expect(getUsageDirectory()).rejects.toThrow(/boom/)
    },
  )

  it('슈퍼유저가 아니면 조회 전에 거절한다', async () => {
    mocks.getActor.mockResolvedValue(makeActor())
    const { from } = setup(OK_TABLES)
    await expect(getUsageDirectory()).rejects.toThrow()
    expect(from).not.toHaveBeenCalled()
  })
})
