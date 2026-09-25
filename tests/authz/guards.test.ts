import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase 서버 클라이언트를 모킹해 가드 로직만 검증한다.
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { mockClient } = vi.hoisted(() => ({ mockClient: { auth: { getClaims: vi.fn() }, from: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => mockClient) }))

import {
  getActor, actorFromUser, requireSuperuser, requireProjectAdmin, requireProjectMember, resolveProjectId,
} from '@/lib/authz'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'

const USER = { id: 'u1', email: 'a@b.com' }

type RosterRow = {
  id: string; project_id: string; access_role: string | null
  project_member_teams: { team_id: string; is_primary: boolean; teams: { code: string } | null }[]
}

/** 체인 호출 기록 — '모든 축이 user_id 를 명시 필터로 건다'를 검증한다. executed 는 실제로 await 된(요청이 나간) 표. */
let calls: { table: string; method: string; args: unknown[] }[] = []
let executed: string[] = []

/** buildActor 의 4축(platform_admins·workspace_members·projects·project_members)을 흉내낸다. */
function stubDb(opts: {
  platformAdmin?: boolean; wsRows?: { workspace_id: string; role: string }[]
  projects?: { id: string; workspace_id: string }[]
  roster?: RosterRow[]
  errorOn?: 'platform_admins' | 'workspace_members' | 'projects' | 'project_members'
}) {
  mockClient.auth.getClaims.mockResolvedValue({ data: { claims: { sub: USER.id } } })
  const res = (table: string, data: unknown) => ({ data: opts.errorOn === table ? null : data, error: opts.errorOn === table ? { message: 'boom' } : null })
  mockClient.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    const terminal = async () => {
      executed.push(table)
      if (table === 'platform_admins') return res(table, opts.platformAdmin ? { user_id: USER.id } : null)
      if (table === 'workspace_members') return res(table, opts.wsRows ?? [])
      if (table === 'projects') return res(table, opts.projects ?? [])
      if (table === 'project_members') return res(table, opts.roster ?? [])
      throw new Error(`예상치 못한 테이블: ${table}`)
    }
    for (const m of ['select', 'eq', 'in', 'not', 'is']) chain[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return chain }
    chain.maybeSingle = terminal
    ;(chain as { then?: unknown }).then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => terminal().then(ok, ko)
    return chain
  })
}

const callsOn = (table: string, method: string) => calls.filter(c => c.table === table && c.method === method).map(c => c.args)

const WS_MEMBER = { wsRows: [{ workspace_id: 'w1', role: 'member' }], projects: [{ id: 'p1', workspace_id: 'w1' }, { id: 'p2', workspace_id: 'w1' }] }
const WS_ADMIN = { wsRows: [{ workspace_id: 'w1', role: 'admin' }], projects: [{ id: 'p1', workspace_id: 'w1' }, { id: 'p2', workspace_id: 'w1' }] }
const row = (project_id: string, access_role: string | null, teams: [string, boolean][] = []): RosterRow => ({
  id: `m-${project_id}`, project_id, access_role,
  project_member_teams: teams.map(([code, is_primary]) => ({ team_id: `t-${code}`, is_primary, teams: { code } })),
})

beforeEach(() => { mockClient.from.mockReset(); mockClient.auth.getClaims.mockReset(); calls = []; executed = [] })

describe('getActor — 4축 조립', () => {
  it('(a) 비로그인은 null', async () => {
    mockClient.auth.getClaims.mockResolvedValue({ data: null })
    expect(await getActor()).toBe(null)
  })

  it('(b) 플랫폼 관리자 → isSuperuser', async () => {
    stubDb({ platformAdmin: true })
    const a = await getActor()
    expect(a?.userId).toBe('u1')
    expect(a?.isSuperuser).toBe(true)
  })

  it('워크스페이스·프로젝트·명단 축을 Map 으로 조립한다', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'admin'), row('p2', null)] })
    const a = await getActor()
    expect(a?.isSuperuser).toBe(false)
    expect(a?.workspaceRoles.get('w1')).toBe('member')
    expect(a?.projectWorkspace.get('p1')).toBe('w1')
    expect(a?.projectWorkspace.get('p2')).toBe('w1')
    expect(a?.projectRoles.get('p1')).toBe('admin')
    // access_role null(명단에만 있는 사람) — 역할 없음이지만 memberId 는 있다
    expect(a?.projectRoles.has('p2')).toBe(false)
    expect(a?.memberIds.get('p2')).toBe('m-p2')
  })

  // teams(code) 임베드 캐스트 경유라 실값이 아니라 undefined 로 새는 회귀를 잡는다.
  it('(d) 명단 팀 2개 → rosterTeams 에 대표 팀이 첫 원소로, memberIds 에 내 명단 행', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'member', [['QA', false], ['개발', true]])] })
    const a = await getActor()
    expect(a?.rosterTeams.get('p1')?.teamCodes).toHaveLength(2)
    expect(a?.rosterTeams.get('p1')).toEqual({ teamIds: ['t-개발', 't-QA'], teamCodes: ['개발', 'QA'] })
    expect(a?.memberIds.get('p1')).toBe('m-p1')
    expect(a?.rosterTeams.get('p2')).toBeUndefined()
  })

  it('팀 코드 임베드가 비면 그 링크는 버린다(배열 모양 임베드도 수용)', async () => {
    const r = row('p1', 'member')
    r.project_member_teams = [
      { team_id: 't-x', is_primary: true, teams: null },
      { team_id: 't-erp', is_primary: false, teams: [{ code: 'ERP' }] as unknown as { code: string } },
    ]
    stubDb({ ...WS_MEMBER, roster: [r] })
    const a = await getActor()
    expect(a?.rosterTeams.get('p1')).toEqual({ teamIds: ['t-erp'], teamCodes: ['ERP'] })
  })

  // 조회 실패를 '역할 없음'으로 폴백하면 가드가 조용히 전원을 거부하거나(운영 마비)
  // 반대로 실패를 성공처럼 흘려보낸다. 실패는 예외로 드러낸다(fail-closed).
  it.each(['platform_admins', 'workspace_members', 'projects', 'project_members'] as const)(
    '(g) %s 조회가 실패하면 예외를 던진다', async (axis) => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      stubDb({ ...WS_MEMBER, errorOn: axis })
      await expect(getActor()).rejects.toThrow(/권한 정보/)
      spy.mockRestore()
    })

  // 세션·admin 경로가 같은 buildActor 를 쓴다 — admin(RLS 우회) 경로에서 user_id 필터가 빠지면
  // 전원의 권한이 합쳐진 Actor 가 나온다. 모든 축이 명시 필터를 거는지 본다.
  it('모든 축이 user_id 를 명시 필터로 건다 — projects 는 내 워크스페이스로 in 필터', async () => {
    stubDb({ ...WS_MEMBER })
    await getActor()
    expect(callsOn('platform_admins', 'eq')).toContainEqual(['user_id', 'u1'])
    expect(callsOn('workspace_members', 'eq')).toContainEqual(['user_id', 'u1'])
    expect(callsOn('projects', 'in')).toEqual([['workspace_id', ['w1']]])
    const pmEq = callsOn('project_members', 'eq')
    expect(pmEq).toContainEqual(['people.user_id', 'u1'])
    expect(pmEq).toContainEqual(['people.active', true])
    expect(pmEq).toContainEqual(['active', true])
  })

  it('플랫폼 관리자는 projects 를 필터 없이 읽는다', async () => {
    stubDb({ platformAdmin: true, projects: [{ id: 'p9', workspace_id: 'w9' }] })
    const a = await getActor()
    expect(callsOn('projects', 'in')).toEqual([])
    expect(a?.projectWorkspace.get('p9')).toBe('w9')
  })

  // 필터 없는 projects 빌더는 만들어지지만 await 되지 않는다(PostgREST 빌더는 then 에서만 요청을 보낸다).
  it('워크스페이스 소속이 없으면 projects 를 조회하지 않는다 — 필터 없는 전체 조회 금지', async () => {
    stubDb({ wsRows: [], projects: [{ id: 'p1', workspace_id: 'w1' }] })
    const a = await getActor()
    expect(executed).not.toContain('projects')
    expect(a?.projectWorkspace.size).toBe(0)
  })
})

describe('actorFromUser — admin 클라이언트 경로', () => {
  it('세션 없이 주어진 userId 로 같은 4축을 조립한다', async () => {
    stubDb({ ...WS_ADMIN, roster: [row('p1', 'member')] })
    const a = await actorFromUser(mockClient as never, 'u-other')
    expect(mockClient.auth.getClaims).not.toHaveBeenCalled()
    expect(a.userId).toBe('u-other')
    expect(callsOn('platform_admins', 'eq')).toContainEqual(['user_id', 'u-other'])
    expect(callsOn('workspace_members', 'eq')).toContainEqual(['user_id', 'u-other'])
    expect(callsOn('project_members', 'eq')).toContainEqual(['people.user_id', 'u-other'])
    expect(a.workspaceRoles.get('w1')).toBe('admin')
    expect(a.projectRoles.get('p1')).toBe('member')
  })
})

describe('requireSuperuser', () => {
  it('플랫폼 관리자는 통과', async () => {
    stubDb({ platformAdmin: true })
    expect((await requireSuperuser()).ok).toBe(true)
  })
  it('워크스페이스 관리자·프로젝트 관리자는 거부', async () => {
    stubDb({ ...WS_ADMIN, roster: [row('p1', 'admin')] })
    expect(await requireSuperuser()).toEqual({ ok: false, error: ERR_DENIED })
  })
  it('비로그인은 로그인 필요', async () => {
    mockClient.auth.getClaims.mockResolvedValue({ data: null })
    expect(await requireSuperuser()).toEqual({ ok: false, error: ERR_ANON })
  })
})

describe('requireProjectAdmin / requireProjectMember', () => {
  it('(c) 워크스페이스 관리자는 명단 행이 없어도 admin·member 가드 모두 통과', async () => {
    stubDb({ ...WS_ADMIN })
    expect((await requireProjectAdmin('p1')).ok).toBe(true)
    stubDb({ ...WS_ADMIN })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('명단 관리자는 admin·member 가드 모두 통과', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'admin')] })
    expect((await requireProjectAdmin('p1')).ok).toBe(true)
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'admin')] })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('멤버는 admin 가드에서 거부, member 가드는 통과', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'member')] })
    expect(await requireProjectAdmin('p1')).toEqual({ ok: false, error: ERR_DENIED })
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'member')] })
    expect((await requireProjectMember('p1')).ok).toBe(true)
  })

  it('(f) 같은 워크스페이스의 조회 전용(viewer)은 권한 없음', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', null)] })
    expect(await requireProjectMember('p1')).toEqual({ ok: false, error: ERR_DENIED })
    stubDb({ ...WS_MEMBER })
    expect(await requireProjectAdmin('p1')).toEqual({ ok: false, error: ERR_DENIED })
  })

  it('다른 프로젝트 관리자는 거부 — 프로젝트 스코프', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'admin')] })
    expect(await requireProjectAdmin('p2')).toEqual({ ok: false, error: ERR_DENIED })
  })

  it('(e) 내 워크스페이스에 없는 pid 는 대상 없음(존재 은닉) — admin·member 가드 모두', async () => {
    stubDb({ ...WS_ADMIN, roster: [row('p1', 'admin')] })
    expect(await requireProjectMember('px')).toEqual({ ok: false, error: ERR_MISSING })
    stubDb({ ...WS_ADMIN, roster: [row('p1', 'admin')] })
    expect(await requireProjectAdmin('px')).toEqual({ ok: false, error: ERR_MISSING })
  })

  it('pid null 은 플랫폼 관리자 외 권한 없음(fail-closed) — 존재 은닉이 아니다', async () => {
    stubDb({ ...WS_ADMIN })
    expect(await requireProjectAdmin(null)).toEqual({ ok: false, error: ERR_DENIED })
    stubDb({ platformAdmin: true })
    expect((await requireProjectAdmin(null)).ok).toBe(true)
  })

  it('플랫폼 관리자는 미존재 pid 도 통과 — 존재 여부 판정은 호출부 몫', async () => {
    stubDb({ platformAdmin: true })
    expect((await requireProjectMember('px')).ok).toBe(true)
  })

  it('(g) 조회 실패는 통과시키지 않고 사유를 구분해 돌려준다', async () => {
    stubDb({ ...WS_MEMBER, errorOn: 'project_members' })
    expect(await requireProjectAdmin('p1')).toEqual({ ok: false, error: ERR_LOOKUP })
    stubDb({ ...WS_MEMBER, errorOn: 'projects' })
    expect(await requireProjectMember('p1')).toEqual({ ok: false, error: ERR_LOOKUP })
  })
})

describe('resolveProjectId', () => {
  it('행의 project_id 를 돌려준다', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { project_id: 'p1' }, error: null }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({ ok: true, projectId: 'p1' })
  })

  it('행이 없으면 대상을 찾을 수 없음', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '대상을 찾을 수 없습니다.',
    })
  })

  // 3원칙 ②: 쓰기 전 선행 조회가 실패하면 중단한다.
  it('조회가 실패하면 중단한다', async () => {
    mockClient.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
    }))
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '권한을 확인할 수 없어 중단했습니다.',
    })
  })
})

describe('getActorForView — 화면 계층 열화', () => {
  it('권한 조회 실패는 조회 전용(null)으로 열화한다 — 인증 영역 전체 500 방지', async () => {
    stubDb({ ...WS_MEMBER, errorOn: 'project_members' })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { getActorForView } = await import('@/lib/authz')
    expect(await getActorForView()).toBe(null)
    spy.mockRestore()
  })

  // Next 의 제어 흐름 예외를 삼키면 정적/동적 판정과 redirect 가 조용히 깨진다.
  it.each([
    ['DYNAMIC_SERVER_USAGE', { digest: 'DYNAMIC_SERVER_USAGE' }],
    ['NEXT_REDIRECT', { digest: 'NEXT_REDIRECT;replace;/login;307;' }],
    ['NEXT_NOT_FOUND', { digest: 'NEXT_NOT_FOUND' }],
  ])('%s 신호는 그대로 다시 던진다', async (_n, thrown) => {
    mockClient.auth.getClaims.mockImplementation(() => { throw thrown })
    const { getActorForView } = await import('@/lib/authz')
    await expect(getActorForView()).rejects.toBe(thrown)
  })
})
