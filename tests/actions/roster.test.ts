import { describe, it, expect, vi, beforeEach } from 'vitest'

// 명단 쓰기는 RPC(upsert_project_member) 하나로만 간다 — 가드·입력 검증·오류 문구·RPC 인자 모양을 고정한다.
// 가드와 두 클라이언트를 모킹한다(tests/actions/*-gate.test.ts 관례). 스파이는 vi.hoisted 로 먼저 만든다.
const { guards, admin, server, revalidatePath } = vi.hoisted(() => ({
  guards: {
    requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), requireSuperuser: vi.fn(), resolveProjectId: vi.fn(),
  },
  admin: { rpc: vi.fn(), from: vi.fn() },
  server: { from: vi.fn() },
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => guards)
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => server }))
vi.mock('next/cache', () => ({ revalidatePath }))
// 팀 마스터는 모듈 로드 시 DB 를 읽는다 — 옛 어댑터의 팀 코드 해석에 필요한 최소 목록만 준다.
vi.mock('@/lib/teams/master', () => ({
  teamsForProjectSync: () => [
    { id: 't-pmo', code: 'PMO', sortOrder: 0, active: true, progressVisible: true, projectId: 'p1' },
    { id: 't-mes', code: 'MES', sortOrder: 1, active: true, progressVisible: true, projectId: 'p1' },
  ],
}))

import {
  upsertRosterMember, removeRosterMember, listRoster,
  addMember, updateMember, removeMember, setProjectRole, ensureRosterRow, listProjectRoles,
  type RosterInput,
} from '@/app/actions/roster'
import { rosterWriteError } from '@/lib/domain/rosterErrors'
import { ROSTER_SELECT } from '@/lib/data/memberSelect'
import { makeAdminActor, makeSuperuser } from '../fixtures/actor'

const P1 = 'p1'
const DENIED = { ok: false as const, error: '권한 없음' }
const actor = makeAdminActor(P1)
const INPUT: RosterInput = {
  name: '홍길동', email: 'hong@example.com', accessRole: 'member', roleLabel: 'PM', title: null, teamIds: ['t-2', 't-1'],
}

/** PostgREST 빌더 흉내 — 어떤 순서로 체이닝해도 자신을 돌려주고, await 하면 결과를 낸다. */
type Result = { data: unknown; error: { code?: string; message: string } | null }
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'delete', 'update', 'insert']) c[m] = vi.fn(() => c)
  c.maybeSingle = vi.fn(async () => result)
  c.single = vi.fn(async () => result)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<Result>
}

beforeEach(() => {
  for (const f of Object.values(guards)) f.mockReset()
  admin.rpc.mockReset(); admin.from.mockReset(); server.from.mockReset(); revalidatePath.mockReset()
  admin.from.mockImplementation((t: string) => { throw new Error('예상치 못한 admin 테이블 접근: ' + t) })
  server.from.mockImplementation((t: string) => { throw new Error('예상치 못한 세션 테이블 접근: ' + t) })
  guards.resolveProjectId.mockResolvedValue({ ok: true, projectId: P1 })
})

describe('upsertRosterMember — RPC upsert_project_member 한 번', () => {
  it('(a) 가드 거부면 그대로 돌려주고 RPC 를 부르지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await upsertRosterMember(P1, INPUT)).toEqual(DENIED)
    expect(guards.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('(b) 정상 — p_actor 는 가드의 actor, p_team_ids 는 입력 순서 그대로(첫 원소 = 대표 팀)', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-9', error: null })
    expect(await upsertRosterMember(P1, INPUT)).toEqual({ ok: true, memberId: 'm-9' })
    expect(admin.rpc).toHaveBeenCalledWith('upsert_project_member', {
      p_actor: actor.userId,
      p_project_id: P1,
      p_person: { display_name: '홍길동', email: 'hong@example.com' },
      p_member: { access_role: 'member', role_label: 'PM', title: null },
      p_team_ids: ['t-2', 't-1'],
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/members`)
  })

  it('기존 인물은 id 로 지목하고, 이메일은 소문자·공백 정리 후 넘긴다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-1', error: null })
    await upsertRosterMember(P1, { ...INPUT, personId: 'person-1', name: '  홍길동 ', email: ' Hong@Example.COM ', roleLabel: ' PM ' })
    expect(admin.rpc.mock.calls[0]![1].p_person).toEqual({ id: 'person-1', display_name: '홍길동', email: 'hong@example.com' })
    expect(admin.rpc.mock.calls[0]![1].p_member.role_label).toBe('PM')
  })

  it('외부 인력(이메일 없음·권한 없음)도 명단에 올린다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-2', error: null })
    const res = await upsertRosterMember(P1, { ...INPUT, email: null, accessRole: null, roleLabel: '  ', teamIds: [] })
    expect(res).toEqual({ ok: true, memberId: 'm-2' })
    const args = admin.rpc.mock.calls[0]![1]
    expect(args.p_person).toEqual({ display_name: '홍길동', email: null })
    expect(args.p_member).toEqual({ access_role: null, role_label: null, title: null })
    expect(args.p_team_ids).toEqual([])
  })

  it('active 를 주면 p_member.active 로 넘긴다(비활성 토글) — 안 주면 키 자체가 없다(기존 값 유지)', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-1', error: null })
    await upsertRosterMember(P1, { ...INPUT, active: false })
    expect(admin.rpc.mock.calls[0]![1].p_member).toEqual({ access_role: 'member', role_label: 'PM', title: null, active: false })
  })

  it('(c) RPC 의 PROJECT_MEMBER_ADMIN_SLOT 은 사용자 문구로 바꾼다 — 원시 코드를 노출하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'PROJECT_MEMBER_ADMIN_SLOT' } })
    expect(await upsertRosterMember(P1, { ...INPUT, accessRole: 'admin' }))
      .toEqual({ ok: false, error: '관리자 권한은 워크스페이스 관리자만 부여·회수할 수 있습니다.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('(d) 이름이 공백뿐이면 RPC 전에 거부한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    expect(await upsertRosterMember(P1, { ...INPUT, name: '   ' })).toEqual({ ok: false, error: '이름을 입력하세요.' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('(e) 이메일 형식이 틀리면 RPC 전에 거부한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    expect(await upsertRosterMember(P1, { ...INPUT, email: 'broken-email' }))
      .toEqual({ ok: false, error: '올바른 이메일 형식이 아닙니다.' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('알 수 없는 권한 값·팀 id 모양은 RPC 전에 거부한다 — 서버 액션 입력은 신뢰하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    const badRole = await upsertRosterMember(P1, { ...INPUT, accessRole: 'owner' as never })
    expect(badRole).toEqual({ ok: false, error: '알 수 없는 권한입니다.' })
    const badTeams = await upsertRosterMember(P1, { ...INPUT, teamIds: 'PMO' as never })
    expect(badTeams).toEqual({ ok: false, error: '알 수 없는 팀입니다.' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})

describe('rosterWriteError — DB 오류 → 사용자 문구', () => {
  it.each([
    [{ code: '23514', message: 'PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT' },
      '계정이 연결되지 않은 사람에게는 권한을 줄 수 없습니다. 이메일로 초대하거나 계정을 먼저 만드세요.'],
    [{ code: '42501', message: 'PROJECT_MEMBER_ADMIN_SLOT' }, '관리자 권한은 워크스페이스 관리자만 부여·회수할 수 있습니다.'],
    [{ code: '42501', message: 'PROJECT_MEMBER_SELF_DEMOTE' }, '본인의 권한은 회수할 수 없습니다.'],
    [{ code: '23514', message: 'PROJECT_MEMBER_CROSS_WORKSPACE' }, '다른 워크스페이스의 인물입니다.'],
    [{ code: '23505', message: 'duplicate key value violates unique constraint "people_ws_email_uidx"' },
      '같은 이메일의 사람이 이미 있습니다. 목록에서 선택하세요.'],
    [{ code: '23503', message: 'update or delete on table "project_members" violates foreign key constraint "issue_assignees_member_project_fk"' },
      '담당·참석 기록이 있는 사람은 삭제할 수 없습니다. 비활성으로 바꾸세요.'],
    [{ code: '42501', message: 'PROJECT_MEMBER_FORBIDDEN' }, '권한 없음'],
    [{ code: '23514', message: 'PROJECT_MEMBER_TEAM_SCOPE' }, '이 프로젝트에서 쓸 수 없는 팀입니다.'],
    [{ code: 'P0002', message: 'PERSON_NOT_FOUND' }, '인물을 찾을 수 없습니다.'],
  ])('%o', (error, expected) => {
    expect(rosterWriteError(error)).toBe(expected)
  })

  it('모르는 오류는 원문을 흘리지 않고 일반 문구 + 로그', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(rosterWriteError({ code: 'XX000', message: 'relation "secret_table" does not exist' }))
      .toBe('명단을 저장하지 못했습니다. 잠시 후 다시 시도하세요.')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('removeRosterMember — 행 삭제(세션 경로, RLS 가 관리자 행을 지킨다)', () => {
  it('대상 행의 프로젝트를 못 읽으면 판정 전에 중단한다', async () => {
    guards.resolveProjectId.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await removeRosterMember('m-1')).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(guards.requireProjectAdmin).not.toHaveBeenCalled()
    expect(server.from).not.toHaveBeenCalled()
  })

  it('가드 거부면 지우지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await removeRosterMember('m-1')).toEqual(DENIED)
    expect(guards.requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(server.from).not.toHaveBeenCalled()
  })

  it('정상 — id·project_id 로 좁혀 지우고 영향 행을 확인한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    const q = chain({ data: [{ id: 'm-1' }], error: null })
    server.from.mockReturnValue(q)
    expect(await removeRosterMember('m-1')).toEqual({ ok: true })
    expect(server.from).toHaveBeenCalledWith('project_members')
    expect(q.delete).toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('id', 'm-1')
    expect(q.eq).toHaveBeenCalledWith('project_id', P1)
    expect(q.select).toHaveBeenCalledWith('id')
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/members`)
  })

  it('0행이면 RLS 가 막은 것이다(관리자 행) — 조용한 성공으로 위장하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    server.from.mockReturnValue(chain({ data: [], error: null }))
    expect(await removeRosterMember('m-1'))
      .toEqual({ ok: false, error: '관리자 권한이 있는 사람은 워크스페이스 관리자만 명단에서 삭제할 수 있습니다.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('담당 FK(restrict) 위반은 비활성 안내 문구로 바꾼다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    server.from.mockReturnValue(chain({
      data: null, error: { code: '23503', message: 'violates foreign key constraint "wbs_items_assignee_fk"' },
    }))
    expect(await removeRosterMember('m-1'))
      .toEqual({ ok: false, error: '담당·참석 기록이 있는 사람은 삭제할 수 없습니다. 비활성으로 바꾸세요.' })
  })
})

describe('listRoster — 정본 select(ROSTER_SELECT) + 매퍼', () => {
  const ROW = {
    id: 'm-1', project_id: P1, person_id: 'pe-1', access_role: 'member', role_label: null, title: null,
    active: true, sort_order: 0, created_at: '2026-09-01',
    people: { display_name: '홍길동', email: 'hong@example.com', user_id: 'u-9', kind: 'account', active: true },
    project_member_teams: [{ team_id: 't-pmo', is_primary: true, teams: { id: 't-pmo', code: 'PMO', name: 'PMO' } }],
  }

  it('멤버 미만이면 거부 — 조회를 빈 목록으로 위장하지 않는다', async () => {
    guards.requireProjectMember.mockResolvedValue(DENIED)
    expect(await listRoster(P1)).toEqual(DENIED)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('정상 — ROSTER_SELECT 로 읽어 RosterMember 로 편다', async () => {
    guards.requireProjectMember.mockResolvedValue({ ok: true, actor })
    const q = chain({ data: [ROW], error: null })
    admin.from.mockReturnValue(q)
    const res = await listRoster(P1)
    expect(q.select).toHaveBeenCalledWith(ROSTER_SELECT)
    expect(q.eq).toHaveBeenCalledWith('project_id', P1)
    expect(res).toMatchObject({ ok: true, rows: [{ id: 'm-1', name: '홍길동', accessRole: 'member', teamCode: 'PMO', hasAccount: true }] })
  })

  it('조회 실패는 오류로 돌려준다', async () => {
    guards.requireProjectMember.mockResolvedValue({ ok: true, actor })
    admin.from.mockReturnValue(chain({ data: null, error: { message: 'boom' } }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listRoster(P1)).toEqual({ ok: false, error: '명단을 불러오지 못했습니다.' })
    spy.mockRestore()
  })
})

describe('@deprecated 옛 화면 어댑터 — 전부 같은 RPC 로 간다', () => {
  it('addMember 는 팀 코드를 이 프로젝트의 팀 id 로 풀어 upsert 한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-3', error: null })
    const res = await addMember(P1, { name: '홍길동', email: null, teamCode: 'MES', accessRole: 'member', title: '수석', roleLabel: null })
    expect(res).toEqual({ ok: true })
    expect(admin.rpc).toHaveBeenCalledWith('upsert_project_member', expect.objectContaining({
      p_person: { display_name: '홍길동', email: null },
      p_member: { access_role: 'member', role_label: null, title: '수석' },
      p_team_ids: ['t-mes'],
    }))
  })

  // 같은 이메일의 기존 인물이면 RPC 가 그 행을 갱신한다 — '추가' 가 기존 권한·팀을 지우면 안 된다.
  it('addMember 는 권한·팀을 안 주면 access_role 키와 팀을 싣지 않는다(기존 값 유지)', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-3', error: null })
    await addMember(P1, { name: '홍길동', email: 'hong@example.com', teamCode: null, accessRole: null, title: null, roleLabel: null })
    const args = admin.rpc.mock.calls[0]![1]
    expect(args.p_member).toEqual({ role_label: null, title: null })
    expect(args.p_team_ids).toBeNull()
  })

  it('addMember 는 모르는 팀 코드를 거부한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    expect(await addMember(P1, { name: '홍길동', email: null, teamCode: '없는팀', accessRole: null, title: null, roleLabel: null }))
      .toEqual({ ok: false, error: '알 수 없는 팀 코드' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  /** updateMember 선행 조회: 대상 행의 인물·이메일·현재 팀. */
  function memberRow(teams: Array<{ id: string; code: string; primary: boolean }>, email: string | null = 'hong@example.com') {
    return chain({
      data: {
        person_id: 'pe-1', people: { email },
        project_member_teams: teams.map(t => ({ team_id: t.id, is_primary: t.primary, teams: { code: t.code } })),
      },
      error: null,
    })
  }

  it('updateMember — 권한을 안 주면 access_role 키를 싣지 않고, 팀이 그대로면 팀도 건드리지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.from.mockReturnValue(memberRow([{ id: 't-pmo', code: 'PMO', primary: true }]))
    admin.rpc.mockResolvedValue({ data: 'm-1', error: null })
    const res = await updateMember('m-1', { name: '홍길동', email: 'hong@example.com', teamCode: 'PMO', title: '책임', roleLabel: null })
    expect(res).toEqual({ ok: true })
    expect(admin.rpc).toHaveBeenCalledWith('upsert_project_member', {
      p_actor: actor.userId, p_project_id: P1,
      p_person: { id: 'pe-1', display_name: '홍길동' },
      p_member: { role_label: null, title: '책임' },
      p_team_ids: null,
    })
  })

  it('updateMember — 대표 팀을 바꾸면 나머지 팀은 남기고 대표만 바꾼다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.from.mockReturnValue(memberRow([
      { id: 't-pmo', code: 'PMO', primary: true }, { id: 't-x', code: 'X', primary: false },
    ]))
    admin.rpc.mockResolvedValue({ data: 'm-1', error: null })
    await updateMember('m-1', { name: '홍길동', email: 'hong@example.com', teamCode: 'MES', title: null, roleLabel: null })
    expect(admin.rpc.mock.calls[0]![1].p_team_ids).toEqual(['t-mes', 't-x'])
  })

  it('updateMember — 이메일은 여기서 바꿀 수 없다(인물의 신원) — 조용히 무시하지 않고 거부한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.from.mockReturnValue(memberRow([], 'hong@example.com'))
    const res = await updateMember('m-1', { name: '홍길동', email: 'other@example.com', teamCode: null, title: null, roleLabel: null })
    expect(res).toEqual({ ok: false, error: '이메일은 명단에서 바꿀 수 없습니다.' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('updateMember — 가드 거부면 선행 조회도 하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue(DENIED)
    expect(await updateMember('m-1', { name: '홍길동', email: null, teamCode: null, title: null, roleLabel: null })).toEqual(DENIED)
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('removeMember 는 removeRosterMember 와 같다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    server.from.mockReturnValue(chain({ data: [{ id: 'm-1' }], error: null }))
    expect(await removeMember('m-1')).toEqual({ ok: true })
  })

  /** 계정 → 이 프로젝트 워크스페이스의 인물 id. */
  function personLookup(personId: string | null) {
    admin.from.mockImplementation((t: string) => {
      if (t === 'projects') return chain({ data: { workspace_id: 'ws-1' }, error: null })
      if (t === 'people') return chain({ data: personId ? { id: personId } : null, error: null })
      throw new Error('예상치 못한 admin 테이블 접근: ' + t)
    })
  }

  it('setProjectRole(admin) 은 슈퍼유저 가드만 쓴다 — 거부면 DB 미접근', async () => {
    guards.requireSuperuser.mockResolvedValue(DENIED)
    expect(await setProjectRole(P1, 'u-2', 'admin')).toEqual(DENIED)
    expect(guards.requireProjectAdmin).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('setProjectRole(viewer) 는 권한을 null 로 — 명단 행은 남는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    personLookup('pe-2')
    admin.rpc.mockResolvedValue({ data: 'm-2', error: null })
    expect(await setProjectRole(P1, 'u-2', 'viewer')).toEqual({ ok: true })
    expect(admin.rpc).toHaveBeenCalledWith('upsert_project_member', {
      p_actor: actor.userId, p_project_id: P1, p_person: { id: 'pe-2' }, p_member: { access_role: null }, p_team_ids: null,
    })
  })

  it('setProjectRole — 기존 관리자 강등을 RPC 가 거부하면 그 문구를 돌려준다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    personLookup('pe-2')
    admin.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'PROJECT_MEMBER_ADMIN_SLOT' } })
    expect(await setProjectRole(P1, 'u-2', 'member'))
      .toEqual({ ok: false, error: '관리자 권한은 워크스페이스 관리자만 부여·회수할 수 있습니다.' })
  })

  it('setProjectRole — 인물 행이 없는 계정이면 지어내지 않고 거부한다', async () => {
    guards.requireSuperuser.mockResolvedValue({ ok: true, actor: makeSuperuser() })
    personLookup(null)
    expect(await setProjectRole(P1, 'u-2', 'admin'))
      .toEqual({ ok: false, error: '이 계정은 이 워크스페이스의 인물로 등록돼 있지 않습니다.' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('ensureRosterRow 는 명단 필드를 건드리지 않는 빈 p_member 로 행만 보장한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    personLookup('pe-3')
    admin.rpc.mockResolvedValue({ data: 'm-3', error: null })
    expect(await ensureRosterRow(P1, 'u-3')).toEqual({ ok: true, memberId: 'm-3' })
    expect(admin.rpc.mock.calls[0]![1]).toMatchObject({ p_person: { id: 'pe-3' }, p_member: {}, p_team_ids: null })
  })

  it('listProjectRoles — 명단 행 + 명단에 없는 워크스페이스 계정(조회 후보)', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    let profilesQ: ReturnType<typeof chain> | null = null
    admin.from.mockImplementation((t: string) => {
      if (t === 'projects') return chain({ data: { workspace_id: 'ws-1' }, error: null })
      if (t === 'project_members') {
        return chain({
          data: [{
            id: 'm-1', project_id: P1, person_id: 'pe-1', access_role: 'admin', role_label: 'PM', title: '수석',
            active: true, sort_order: 0, created_at: '2026-09-01',
            people: { display_name: '관리자김', email: 'kim@example.com', user_id: 'u-1', kind: 'account', active: true },
            project_member_teams: [],
          }, {
            id: 'm-2', project_id: P1, person_id: 'pe-2', access_role: null, role_label: null, title: null,
            active: true, sort_order: 0, created_at: '2026-09-01',
            people: { display_name: '외부홍', email: null, user_id: null, kind: 'external', active: true },
            project_member_teams: [],
          }],
          error: null,
        })
      }
      if (t === 'workspace_members') return chain({ data: [{ user_id: 'u-1' }, { user_id: 'u-5' }], error: null })
      if (t === 'profiles') {
        profilesQ = chain({ data: [{ user_id: 'u-5', email: 'choi@example.com', display_name: '조회최' }], error: null })
        return profilesQ
      }
      if (t === 'platform_admins') return chain({ data: [{ user_id: 'u-5' }], error: null })
      throw new Error('예상치 못한 admin 테이블 접근: ' + t)
    })
    const res = await listProjectRoles(P1)
    if (!res.ok) throw new Error(res.error)
    expect(res.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: 'u-1', memberId: 'm-1', role: 'admin', isSuperuser: false, title: '수석' }),
      expect.objectContaining({ userId: null, memberId: 'm-2', name: '외부홍', role: 'viewer' }),
      expect.objectContaining({ userId: 'u-5', memberId: null, name: '조회최', role: 'viewer', isSuperuser: true }),
    ]))
    expect(res.rows).toHaveLength(3)
    // 명단에 이미 있는 계정(u-1)은 후보 프로필 조회에서 뺀다.
    expect(profilesQ!.in).toHaveBeenCalledWith('user_id', ['u-5'])
  })

  it('listProjectRoles — 어느 조회든 실패하면 부분 목록으로 위장하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.from.mockImplementation((t: string) => {
      if (t === 'projects') return chain({ data: { workspace_id: 'ws-1' }, error: null })
      if (t === 'platform_admins') return chain({ data: null, error: { message: 'boom' } })
      return chain({ data: [], error: null })
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listProjectRoles(P1)
    spy.mockRestore()
    expect(res.ok).toBe(false)
  })
})
