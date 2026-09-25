import { describe, it, expect, vi, beforeEach } from 'vitest'

// 명단 쓰기는 RPC(upsert_project_member) 하나로만 간다 — 가드·입력 검증·오류 문구·RPC 인자 모양을 고정한다.
// 가드와 두 클라이언트를 모킹한다(tests/actions/*-gate.test.ts 관례). 스파이는 vi.hoisted 로 먼저 만든다.
const { guards, admin, server, revalidatePath } = vi.hoisted(() => ({
  guards: {
    requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), resolveProjectId: vi.fn(),
  },
  admin: { rpc: vi.fn(), from: vi.fn() },
  server: { from: vi.fn() },
  revalidatePath: vi.fn(),
}))
vi.mock('@/lib/authz', () => guards)
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: async () => server }))
vi.mock('next/cache', () => ({ revalidatePath }))

import {
  upsertRosterMember, removeRosterMember, listRoster, type RosterInput,
} from '@/app/actions/roster'
import { rosterWriteError } from '@/lib/domain/rosterErrors'
import { ROSTER_SELECT } from '@/lib/data/memberSelect'
import { makeAdminActor } from '../fixtures/actor'

const P1 = 'p1'
// 입력의 인물·팀 id 는 uuid 모양이어야 한다(RPC 앞에서 검사).
const T1 = '00000000-0000-4000-8000-0000000000a1'
const T2 = '00000000-0000-4000-8000-0000000000a2'
const PE = '00000000-0000-4000-8000-0000000000e1'
const DENIED = { ok: false as const, error: '권한 없음' }
const actor = makeAdminActor(P1)
const INPUT: RosterInput = {
  name: '홍길동', email: 'hong@example.com', accessRole: 'member', roleLabel: 'PM', title: null, teamIds: [T2, T1],
}

/** PostgREST 빌더 흉내 — 어떤 순서로 체이닝해도 자신을 돌려주고, await 하면 결과를 낸다. */
type Result = { data: unknown; error: { code?: string; message: string } | null; count?: number | null }
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
      p_team_ids: [T2, T1],
    })
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/members`)
  })

  it('기존 인물은 id 로 지목하고, 이메일은 소문자·공백 정리 후 넘긴다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    admin.rpc.mockResolvedValue({ data: 'm-1', error: null })
    await upsertRosterMember(P1, { ...INPUT, personId: PE, name: '  홍길동 ', email: ' Hong@Example.COM ', roleLabel: ' PM ' })
    expect(admin.rpc.mock.calls[0]![1].p_person).toEqual({ id: PE, display_name: '홍길동', email: 'hong@example.com' })
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

  it('알 수 없는 권한 값은 RPC 전에 거부한다 — 서버 액션 입력은 신뢰하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    const badRole = await upsertRosterMember(P1, { ...INPUT, accessRole: 'owner' as never })
    expect(badRole).toEqual({ ok: false, error: '알 수 없는 권한입니다.' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  // uuid 가 아닌 id 는 RPC 안의 캐스트에서 22P02 로 터져 '다시 시도하세요' 로 보인다 — 다시 해도 안 되는 입력이다.
  it.each([
    ['팀 id 가 배열이 아님', { teamIds: 'PMO' as never }],
    ['팀 id 가 uuid 가 아님', { teamIds: [T1, 'abc'] }],
    ['인물 id 가 uuid 가 아님', { personId: 'person-1' }],
  ])('%s → RPC 전에 "잘못된 요청입니다."', async (_label, patch) => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    expect(await upsertRosterMember(P1, { ...INPUT, ...patch })).toEqual({ ok: false, error: '잘못된 요청입니다.' })
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

  /** 삭제 전 종속 행 검사 — 표별 결과를 준다(기본 0건). project_members 를 참조하는 업무 기록 FK 6표
   *  (팀 소속 project_member_teams·알림 수신 notification_recipients 는 행과 함께 사라지는 게 맞아 제외). */
  const DEPENDANTS: Array<[string, string]> = [
    ['attendance_records', 'member_id'], ['issue_assignees', 'member_id'], ['issues', 'assignee_member_id'],
    ['meeting_attendees', 'member_id'], ['wbs_items', 'assignee_member_id'], ['wiki_items', 'owner_member_id'],
  ]
  function dependants(over: Record<string, Result> = {}) {
    const qs: Record<string, ReturnType<typeof chain>> = {}
    admin.from.mockImplementation((t: string) => {
      if (!DEPENDANTS.some(([table]) => table === t)) throw new Error('예상치 못한 admin 테이블 접근: ' + t)
      qs[t] = chain(over[t] ?? { data: null, error: null, count: 0 })
      return qs[t]
    })
    return qs
  }

  it('정상 — 종속 행이 없으면 id·project_id 로 좁혀 지우고 영향 행을 확인한다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    const qs = dependants()
    const q = chain({ data: [{ id: 'm-1' }], error: null })
    server.from.mockReturnValue(q)
    expect(await removeRosterMember('m-1')).toEqual({ ok: true })
    // 업무 기록 6표를 전부 센다(서비스 롤 — RLS 에 가려 0건으로 보이면 안 된다). 알림·팀 소속은 세지 않는다.
    for (const [table, col] of DEPENDANTS) {
      expect(qs[table]!.select).toHaveBeenCalledWith(col, { count: 'exact', head: true })
      expect(qs[table]!.eq).toHaveBeenCalledWith(col, 'm-1')
    }
    expect(Object.keys(qs).sort()).toEqual(DEPENDANTS.map(([t]) => t).sort())
    expect(admin.from).not.toHaveBeenCalledWith('notification_recipients')
    expect(server.from).toHaveBeenCalledWith('project_members')
    expect(q.delete).toHaveBeenCalled()
    expect(q.eq).toHaveBeenCalledWith('id', 'm-1')
    expect(q.eq).toHaveBeenCalledWith('project_id', P1)
    expect(q.select).toHaveBeenCalledWith('id')
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/members`)
  })

  // 0003 의 참조 FK 는 전부 CASCADE·SET NULL 이다 — 지우면 근태·참석·담당 기록이 조용히 사라진다. 그래서 앱이 먼저 센다.
  it.each(DEPENDANTS.map(([t]) => t))('%s 에 이 사람의 행이 있으면 거부하고 지우지 않는다', async (table) => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    dependants({ [table]: { data: null, error: null, count: 2 } })
    expect(await removeRosterMember('m-1'))
      .toEqual({ ok: false, error: '담당·참석 기록이 있는 사람은 삭제할 수 없습니다. 비활성으로 바꾸세요.' })
    expect(server.from).not.toHaveBeenCalled()
  })

  it('종속 행 조회가 하나라도 실패하면 지우지 않는다(3원칙 ②)', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    dependants({ wbs_items: { data: null, error: { message: 'boom' }, count: null } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await removeRosterMember('m-1')).toEqual({ ok: false, error: '명단 정보를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expect(server.from).not.toHaveBeenCalled()
  })

  it('0행이면 RLS 가 막은 것이다(관리자 행) — 조용한 성공으로 위장하지 않는다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    dependants()
    server.from.mockReturnValue(chain({ data: [], error: null }))
    expect(await removeRosterMember('m-1'))
      .toEqual({ ok: false, error: '관리자 권한이 있는 사람은 워크스페이스 관리자만 명단에서 삭제할 수 있습니다.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // 사전 검사와 삭제 사이에 담당이 생기는 경합, 또는 뒤에 RESTRICT FK 가 생기는 경우의 방어선 — 같은 문구.
  it('삭제의 FK 위반(23503)도 같은 안내 문구로 바꾼다', async () => {
    guards.requireProjectAdmin.mockResolvedValue({ ok: true, actor })
    dependants()
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
    expect(q.order).toHaveBeenNthCalledWith(1, 'sort_order')
    expect(q.order).toHaveBeenNthCalledWith(2, 'created_at')
    expect(res).toMatchObject({ ok: true, rows: [{ id: 'm-1', name: '홍길동', accessRole: 'member', hasAccount: true }] })
    expect(res.ok && res.rows[0].teams.map(t => t.code)).toEqual(['PMO'])
  })

  it('조회 실패는 오류로 돌려준다', async () => {
    guards.requireProjectMember.mockResolvedValue({ ok: true, actor })
    admin.from.mockReturnValue(chain({ data: null, error: { message: 'boom' } }))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listRoster(P1)).toEqual({ ok: false, error: '명단을 불러오지 못했습니다.' })
    spy.mockRestore()
  })
})
