import { describe, it, expect, vi, beforeEach } from 'vitest'

// Supabase 서버 클라이언트를 모킹해 가드 로직만 검증한다.
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { mockClient } = vi.hoisted(() => ({ mockClient: { auth: { getClaims: vi.fn() }, from: vi.fn() } }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => mockClient) }))

import {
  getActor, actorFromUser, requireSuperuser, requireProjectAdmin, requireProjectMember, requireWorkspaceAdmin,
  resolveProjectId, resolveScope,
} from '@/lib/authz'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { adminProjectIds, isAnyProjectAdmin } from '@/lib/domain/authz'

const USER = { id: 'u1', email: 'a@b.com' }

type RosterRow = {
  id: string; project_id: string; access_role: string | null
  project_member_teams: { team_id: string; is_primary: boolean; teams: { code: string } | null }[]
}

/** 체인 호출 기록 — '모든 축이 user_id 를 명시 필터로 건다'를 검증한다. executed 는 실제로 await 된(요청이 나간) 표. */
let calls: { table: string; method: string; args: unknown[] }[] = []
let executed: string[] = []

/** PostgREST 의 max_rows — 한 응답은 이 수에서 조용히 잘린다(count: 'exact' 면 총합은 따로 온다). */
const MAX_ROWS = 1000

/** buildActor 의 4축(platform_admins·workspace_members·projects·project_members)을 흉내낸다. projects 는 range·count 를 따른다. */
function stubDb(opts: {
  platformAdmin?: boolean
  /** platform_admins.maybeSingle() 응답을 그대로 지정 — 모양이 어긋난 응답([]·{}·남의 행)을 흉내낸다. */
  platformAdminData?: unknown
  wsRows?: { workspace_id: string; role: string }[]
  projects?: { id: string; workspace_id: string }[]
  roster?: RosterRow[]
  errorOn?: 'platform_admins' | 'workspace_members' | 'projects' | 'project_members'
}) {
  mockClient.auth.getClaims.mockResolvedValue({ data: { claims: { sub: USER.id } } })
  const res = (table: string, data: unknown) => ({ data: opts.errorOn === table ? null : data, error: opts.errorOn === table ? { message: 'boom' } : null })
  mockClient.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    let selected = ''
    let range: [number, number] | null = null
    const terminal = async () => {
      executed.push(table)
      if (table === 'platform_admins') {
        return res(table, 'platformAdminData' in opts ? opts.platformAdminData : opts.platformAdmin ? { user_id: USER.id } : null)
      }
      if (table === 'workspace_members') return res(table, opts.wsRows ?? [])
      if (table === 'projects') {
        const all = opts.projects ?? []
        const from = range?.[0] ?? 0
        const to = Math.min(range ? range[1] + 1 : all.length, from + MAX_ROWS)
        return { ...res(table, all.slice(from, to)), count: opts.errorOn === table ? null : all.length }
      }
      // PostgREST 에서 people 임베드가 !inner 가 아니면 .eq('people.user_id') 는 임베드만 거르고 행은 전부 돌려준다.
      // 스텁은 그 반대로 모델링한다 — inner 조인이 사라지면 '내 명단 행'을 못 찾아 명단 기대 테스트가 깨지게.
      if (table === 'project_members') return res(table, selected.includes('people!inner(') ? opts.roster ?? [] : [])
      throw new Error(`예상치 못한 테이블: ${table}`)
    }
    for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'range']) {
      chain[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args })
        if (m === 'select') selected = String(args[0] ?? '')
        if (m === 'range') range = [args[0] as number, args[1] as number]
        return chain
      }
    }
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
    // teamNames 는 표시 전용 — 임베드에 이름이 없으면 code 다
    expect(a?.rosterTeams.get('p1')).toEqual({ teamIds: ['t-개발', 't-QA'], teamCodes: ['개발', 'QA'], teamNames: ['개발', 'QA'] })
    expect(a?.memberIds.get('p1')).toBe('m-p1')
    expect(a?.rosterTeams.get('p2')).toBeUndefined()
  })

  // 대표 팀이 없거나 비대표 팀이 여럿이면 PostgREST 임베드 순서(물리 순서)에 기대지 않는다 — primaryTeamCode 가 흔들리면 안 된다.
  it('(d′) 팀 정렬은 대표 팀 먼저, 나머지는 code 사전순 — 응답 순서와 무관하게 결정적', async () => {
    stubDb({ ...WS_MEMBER, roster: [
      row('p1', 'member', [['QA', false], ['MES', true], ['ERP', false]]),
      row('p2', 'member', [['MES', false], ['ERP', false]]),
    ] })
    const a = await getActor()
    expect(a?.rosterTeams.get('p1')?.teamCodes).toEqual(['MES', 'ERP', 'QA'])
    expect(a?.rosterTeams.get('p1')?.teamIds).toEqual(['t-MES', 't-ERP', 't-QA'])
    expect(a?.rosterTeams.get('p2')?.teamCodes).toEqual(['ERP', 'MES'])
  })

  it('(h) 소속 워크스페이스 밖 프로젝트의 명단 행은 버린다 — 남은 admin 행이 어느 축에도 새지 않는다(AUTH-01b)', async () => {
    // p1 은 w1(소속), pX 는 소속이 없는 워크스페이스의 프로젝트 — projects 조회(in w1)에 나오지 않는다
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'member', [['QA', true]]), row('pX', 'admin', [['ERP', true]])] })
    const a = await getActor()
    expect(a?.projectRoles.get('p1')).toBe('member')
    expect(a?.projectRoles.has('pX')).toBe(false)
    expect(a?.memberIds.has('pX')).toBe(false)
    expect(a?.rosterTeams.has('pX')).toBe(false)
    expect(isAnyProjectAdmin(a)).toBe(false)
    expect(adminProjectIds(a)).toEqual([])
  })

  it('(h′) 플랫폼 관리자는 모든 프로젝트가 projectWorkspace 에 있으므로 명단 행을 버리지 않는다', async () => {
    stubDb({ platformAdmin: true, projects: [{ id: 'p1', workspace_id: 'w1' }, { id: 'pX', workspace_id: 'w9' }], roster: [row('pX', 'admin')] })
    const a = await getActor()
    expect(a?.projectRoles.get('pX')).toBe('admin')
  })

  it('팀 코드 임베드가 비면 그 링크는 버린다(배열 모양 임베드도 수용)', async () => {
    const r = row('p1', 'member')
    r.project_member_teams = [
      { team_id: 't-x', is_primary: true, teams: null },
      { team_id: 't-erp', is_primary: false, teams: [{ code: 'ERP' }] as unknown as { code: string } },
    ]
    stubDb({ ...WS_MEMBER, roster: [r] })
    const a = await getActor()
    expect(a?.rosterTeams.get('p1')).toEqual({ teamIds: ['t-erp'], teamCodes: ['ERP'], teamNames: ['ERP'] })
  })

  it('팀 이름을 teamCodes 와 같은 순서로 싣는다(표시 전용) — 빈 이름은 code, 순서·식별은 code 그대로', async () => {
    const r = row('p1', 'member')
    r.project_member_teams = [
      { team_id: 't-qa', is_primary: false, teams: { code: 'QA', name: '품질' } as unknown as { code: string } },
      { team_id: 't-dev', is_primary: true, teams: { code: 'DEV', name: '개발' } as unknown as { code: string } },
      { team_id: 't-ops', is_primary: false, teams: { code: 'OPS', name: '  ' } as unknown as { code: string } },
    ]
    stubDb({ ...WS_MEMBER, roster: [r] })
    const a = await getActor()
    expect(a?.rosterTeams.get('p1')).toEqual({ teamIds: ['t-dev', 't-ops', 't-qa'], teamCodes: ['DEV', 'OPS', 'QA'], teamNames: ['개발', 'OPS', '품질'] })
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
    // .eq('people.user_id') 가 행 필터가 되려면 people 임베드가 !inner 여야 한다 — 빠지면 admin 경로에서 전원의 명단 행이 섞인다.
    const pmSelect = String(callsOn('project_members', 'select')[0]?.[0])
    expect(pmSelect).toMatch(/people!inner\(/)
    expect(pmSelect).toMatch(/project_member_teams\([^)]*teams\(code, name\)/)
  })

  // ④ 명단 축은 user_id 만으로 걸러지므로 ② 워크스페이스 축을 기다리지 않는다 — ③ projects 만 2단계.
  it('명단 축은 첫 묶음에서 나가고 projects 만 워크스페이스 결과를 기다린다', async () => {
    stubDb({ ...WS_MEMBER })
    await getActor()
    expect(executed.indexOf('project_members')).toBeGreaterThanOrEqual(0)
    expect(executed.indexOf('project_members')).toBeLessThan(executed.indexOf('projects'))
  })

  // 최고 권한 비트는 응답 모양이 아니라 내용으로 판정한다 — 범용 스텁의 [] 나 남의 행이 슈퍼유저를 만들면 안 된다.
  it.each([
    ['빈 배열', []],
    ['빈 객체', {}],
    ['다른 사용자의 행', { user_id: 'u-other' }],
  ])('platform_admins 응답이 %s 이면 슈퍼유저가 아니다', async (_n, data) => {
    stubDb({ ...WS_MEMBER, platformAdminData: data })
    const a = await getActor()
    expect(a?.isSuperuser).toBe(false)
  })

  // max_rows(1000) 를 넘는 플랫폼 — 잘린 맵은 1001번째 프로젝트를 '존재하지 않음'으로 읽는다(isHiddenProject → 404, SP2 최종 리뷰 ERR-3).
  it('플랫폼 관리자 — 프로젝트가 max_rows 를 넘어도 전부 싣는다(id 정렬 페이지 + count 총합 대조)', async () => {
    const projects = Array.from({ length: 1001 }, (_, i) => ({ id: `p${String(i).padStart(4, '0')}`, workspace_id: 'w1' }))
    stubDb({ platformAdmin: true, projects })
    const a = await getActor()
    expect(a?.projectWorkspace.size).toBe(1001)
    expect(a?.projectWorkspace.get('p1000')).toBe('w1')
    expect(callsOn('projects', 'order')).toContainEqual(['id'])
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

describe('requireWorkspaceAdmin', () => {
  it('비로그인은 로그인 필요', async () => {
    mockClient.auth.getClaims.mockResolvedValue({ data: null })
    expect(await requireWorkspaceAdmin('w1')).toEqual({ ok: false, error: ERR_ANON })
  })
  it('비소속 워크스페이스·null 은 대상 없음(존재 은닉)', async () => {
    stubDb({ ...WS_ADMIN })
    expect(await requireWorkspaceAdmin('w9')).toEqual({ ok: false, error: ERR_MISSING })
    stubDb({ ...WS_ADMIN })
    expect(await requireWorkspaceAdmin(null)).toEqual({ ok: false, error: ERR_MISSING })
  })
  it('워크스페이스 멤버는 권한 없음 — 명단 관리자여도', async () => {
    stubDb({ ...WS_MEMBER, roster: [row('p1', 'admin')] })
    expect(await requireWorkspaceAdmin('w1')).toEqual({ ok: false, error: ERR_DENIED })
  })
  it('워크스페이스 관리자는 통과', async () => {
    stubDb({ ...WS_ADMIN })
    const r = await requireWorkspaceAdmin('w1')
    expect(r.ok && r.actor.userId).toBe('u1')
  })
  it('플랫폼 관리자는 소속 없이도 통과', async () => {
    stubDb({ platformAdmin: true })
    expect((await requireWorkspaceAdmin('w9')).ok).toBe(true)
  })
  it('권한 조회 실패는 ERR_LOOKUP', async () => {
    stubDb({ ...WS_ADMIN, errorOn: 'workspace_members' })
    expect(await requireWorkspaceAdmin('w1')).toEqual({ ok: false, error: ERR_LOOKUP })
  })
})

/** 세션 클라이언트의 from(table).select(cols).eq().maybeSingle() 을 한 응답으로 고정한다. */
const stubRow = (res: { data: unknown; error: { message: string } | null }) =>
  mockClient.from.mockImplementation(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => res }) }) }))

describe('resolveScope / resolveProjectId', () => {
  it('행의 프로젝트·워크스페이스를 돌려준다 — resolveProjectId 는 프로젝트만', async () => {
    stubRow({ data: { project_id: 'p1', projects: { workspace_id: 'w1' } }, error: null })
    expect(await resolveScope('meetings', 'm1')).toEqual({ ok: true, projectId: 'p1', workspaceId: 'w1' })
    expect(await resolveProjectId('meetings', 'm1')).toEqual({ ok: true, projectId: 'p1' })
  })

  it('무프로젝트 회의록은 projectId null 로 ok', async () => {
    stubRow({ data: { project_id: null, workspace_id: 'w1' }, error: null })
    expect(await resolveProjectId('minutes', 'mn1')).toEqual({ ok: true, projectId: null })
  })

  it('행이 없으면 대상을 찾을 수 없음', async () => {
    stubRow({ data: null, error: null })
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '대상을 찾을 수 없습니다.',
    })
  })

  // 3원칙 ①②: 조회 실패는 '대상 없음'(404)이 아니라 판정 불가로 중단한다.
  it('조회가 실패하면 중단한다 — ERR_MISSING 과 구분', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubRow({ data: null, error: { message: 'boom' } })
    expect(await resolveProjectId('meetings', 'm1')).toEqual({
      ok: false, error: '권한을 확인할 수 없어 중단했습니다.',
    })
    expect(ERR_LOOKUP).not.toBe(ERR_MISSING)
    spy.mockRestore()
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
