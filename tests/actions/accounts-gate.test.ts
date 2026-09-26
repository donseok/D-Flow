import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트를 모킹해 게이트와 쓰기 순서를 검증한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로, 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient, requireProjectAdmin, requireProjectMember, requireSuperuser, requireWorkspaceAdmin, getActor } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
  }),
  requireProjectAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  requireSuperuser: vi.fn(),
  requireWorkspaceAdmin: vi.fn(),
  getActor: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, requireProjectMember, requireSuperuser, requireWorkspaceAdmin, getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import {
  createAccount, bulkCreateAccounts, resetPassword, listAccounts, setPlatformAdmin, setWorkspaceRole,
  type AccountInput,
} from '@/app/actions/accounts'
import { isProjectMember, roleIn, workspaceAdminVerdict, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, makeSuperuser, WS } from '../fixtures/actor'

const DENIED = { ok: false as const, error: '권한 없음' }
const P1 = 'p1'
const WS_B = 'ws-b'
const SU = makeSuperuser({ userId: 'u-su', workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS]]) })
const WS_ADMIN = makeActor({ userId: 'u-wsa', workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS]]) })
const OTHER_WS_ADMIN = makeActor({ userId: 'u-other', workspaceRoles: new Map([[WS_B, 'admin']]) })
// 워크스페이스 멤버이면서 그 프로젝트의 관리자 — 프로젝트 가드는 넘지만 워크스페이스 가드에서 막혀야 한다.
const WS_MEMBER = makeActor({ userId: 'u-mem', projectWorkspace: new Map([[P1, WS]]), projectRoles: new Map([[P1, 'admin']]) })
const INPUT: AccountInput & { workspaceId: string } = {
  email: ' Mina.Park@Example.com ', password: 'password1', name: '박민아', workspaceRole: 'member',
  projectId: P1, accessRole: 'member', workspaceId: WS,
}

/** 워크스페이스·프로젝트 가드를 이 액터의 순수 판정에 위임한다 — 실제 가드와 같은 404/403 구분. */
function signedInAs(a: Actor) {
  requireWorkspaceAdmin.mockImplementation(async (wid: string | null) => {
    const v = workspaceAdminVerdict(a, wid)
    return v === 'ok' ? { ok: true, actor: a } : { ok: false, error: v === 'missing' ? ERR_MISSING : ERR_DENIED }
  })
  requireProjectMember.mockImplementation(async (pid: string | null) => {
    if (roleIn(a, pid) === null) return { ok: false, error: ERR_MISSING }
    return isProjectMember(a, pid) ? { ok: true, actor: a } : { ok: false, error: ERR_DENIED }
  })
}

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(() => {
    throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
  })
  requireProjectAdmin.mockReset()
  requireProjectMember.mockReset()
  requireSuperuser.mockReset()
  requireWorkspaceAdmin.mockReset()
  getActor.mockReset()
})

type Result = { data?: unknown; error: { code?: string; message: string } | null }
/** PostgREST 빌더 흉내 — 체이닝은 자신을, await·maybeSingle·single 은 결과를 낸다. */
function chain(result: Result) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'range', 'delete', 'update', 'insert', 'upsert']) {
    c[m] = vi.fn(() => c)
  }
  c.maybeSingle = vi.fn(async () => result)
  c.single = vi.fn(async () => result)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Record<string, Mock<(...args: unknown[]) => unknown>> & PromiseLike<Result>
}

/**
 * createOne 이 훑는 경로 — createUser → profiles → workspace_members → people(찾기 → 연결 또는 신규) → RPC.
 * 각 단계의 결과를 덮어써 실패 경로를 만든다.
 */
function accountClient(o: {
  profileErr?: Result['error']
  wsErr?: Result['error']
  existingPerson?: { id: string; user_id: string | null; active?: boolean } | null
  linkRows?: unknown[]
  personInsert?: Result
  rpc?: Result
} = {}) {
  const q = {
    profiles: chain({ error: o.profileErr ?? null }),
    workspace_members: chain({ error: o.wsErr ?? null }),
    peopleFind: chain({ data: o.existingPerson ?? null, error: null }),
    peopleLink: chain({ data: o.linkRows ?? [{ id: 'pe-old' }], error: null }),
    peopleInsert: chain(o.personInsert ?? { data: { id: 'pe-new' }, error: null }),
    peopleDelete: chain({ error: null }),
  }
  const from = vi.fn((t: string) => {
    if (t === 'profiles') return q.profiles
    if (t === 'workspace_members') return q.workspace_members
    if (t === 'people') {
      // people 은 용도별로 다른 빌더를 준다 — 첫 메서드로 가른다.
      return {
        select: (...a: unknown[]) => { q.peopleFind.select(...a); return q.peopleFind },
        update: (...a: unknown[]) => { q.peopleLink.update(...a); return q.peopleLink },
        insert: (...a: unknown[]) => { q.peopleInsert.insert(...a); return q.peopleInsert },
        delete: (...a: unknown[]) => { q.peopleDelete.delete(...a); return q.peopleDelete },
      }
    }
    throw new Error('예상치 못한 테이블 접근: ' + t)
  })
  const rpc = vi.fn(async () => o.rpc ?? { data: 'm-new', error: null })
  const createUser = vi.fn(async () => ({ data: { user: { id: 'u-new' } }, error: null }))
  const deleteUser = vi.fn(async () => ({ error: null }))
  createAdminClient.mockReturnValue({ from, rpc, auth: { admin: { createUser, deleteUser } } } as never)
  return { q, from, rpc, createUser, deleteUser }
}

// 계정 관리는 슈퍼유저 전용(2026-08-20 결정). assertCanTouchAccount 의 비슈퍼유저 분기는 현 게이트에선 도달 불가지만
// SP2 에서 게이트가 느슨해지는 순간 살아나는 보안 코드라, 아래에서 가드가 비슈퍼유저 액터를 돌려주는 경우로 직접 고정한다.
describe('계정 서버액션 권한 게이트', () => {
  it('createAccount: 워크스페이스 멤버는 거부, 다른 워크스페이스 관리자는 존재 은닉 — admin client 미생성', async () => {
    signedInAs(WS_MEMBER)
    expect(await createAccount(INPUT)).toEqual({ ok: false, error: ERR_DENIED })
    signedInAs(OTHER_WS_ADMIN)
    expect(await createAccount(INPUT)).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('bulkCreateAccounts: 워크스페이스 멤버는 거부, 다른 워크스페이스 관리자는 존재 은닉', async () => {
    signedInAs(WS_MEMBER)
    expect(await bulkCreateAccounts(WS, 'a@b.com,member,password1', P1)).toMatchObject({ ok: false, error: ERR_DENIED })
    signedInAs(OTHER_WS_ADMIN)
    expect(await bulkCreateAccounts(WS, 'a@b.com,member,password1', P1)).toMatchObject({ ok: false, error: ERR_MISSING })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  // 다른 워크스페이스의 프로젝트를 넣으면 createUser 까지 가서 RPC 가 거부하기 전에 계정이 생겼다 지워지고,
  // RPC 의 PROJECT_NOT_FOUND / 거부 차이로 다른 워크스페이스 프로젝트의 존재가 샌다 — 쓰기 전에 ERR_MISSING 으로 끊는다.
  it('다른 워크스페이스의 프로젝트를 넣으면 계정을 만들기 전에 ERR_MISSING(단건·일괄)', async () => {
    const actor = makeActor({ userId: 'u-wsa', workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS], ['p-b', WS_B]]) })
    for (const a of [actor, makeSuperuser({ workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS], ['p-b', WS_B]]) })]) {
      signedInAs(a)
      const c = accountClient()
      expect(await createAccount({ ...INPUT, projectId: 'p-b' })).toEqual({ ok: false, error: ERR_MISSING })
      expect(await createAccount({ ...INPUT, projectId: 'p-unknown' })).toEqual({ ok: false, error: ERR_MISSING })
      expect(await bulkCreateAccounts(WS, 'a@example.com, member, password1', 'p-b')).toEqual({ ok: false, error: ERR_MISSING, results: [] })
      expect(c.createUser).not.toHaveBeenCalled()
      expect(c.from).not.toHaveBeenCalled()
    }
  })

  it('워크스페이스가 비면 가드 전에 거부한다 — 슈퍼유저도(null 이면 가드가 통과시키므로)', async () => {
    signedInAs(SU)
    for (const wid of [null, undefined, '']) {
      expect((await createAccount({ ...INPUT, workspaceId: wid as never })).ok).toBe(false)
      expect((await bulkCreateAccounts(wid as never, 'a@b.com,member,password1', P1)).ok).toBe(false)
    }
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자도 resetPassword 거부 — 계정 조작은 슈퍼유저 전용', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await resetPassword('u-superuser', 'password1')).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  /** 게이트가 느슨해진 뒤(비슈퍼유저 액터)의 등급 경계 — 대상의 세 축을 모의한다. */
  function touchClient(o: { platform?: Result; wsAdmin?: Result; projectAdmin?: Result } = {}) {
    const q = {
      platform_admins: chain(o.platform ?? { data: null, error: null }),
      workspace_members: chain(o.wsAdmin ?? { data: [], error: null }),
      project_members: chain(o.projectAdmin ?? { data: [], error: null }),
    }
    const updateUserById = vi.fn(async () => ({ error: null }))
    createAdminClient.mockReturnValue({
      from: vi.fn((t: keyof typeof q) => q[t]),
      auth: { admin: { updateUserById } },
    } as never)
    return { q, updateUserById }
  }
  const RELAXED = { ok: true, actor: makeActor({ userId: 'u-admin', isSuperuser: false }) }

  it('비슈퍼유저는 플랫폼 관리자 계정을 만질 수 없다', async () => {
    requireSuperuser.mockResolvedValue(RELAXED)
    const c = touchClient({ platform: { data: { user_id: 'u-t' }, error: null } })
    expect(await resetPassword('u-t', 'password1')).toEqual({ ok: false, error: '슈퍼유저 계정은 슈퍼유저만 변경할 수 있습니다.' })
    expect(c.q.platform_admins.eq).toHaveBeenCalledWith('user_id', 'u-t')
    expect(c.updateUserById).not.toHaveBeenCalled()
  })

  it('비슈퍼유저는 어느 프로젝트든 관리자인 계정·워크스페이스 관리자 계정을 만질 수 없다', async () => {
    requireSuperuser.mockResolvedValue(RELAXED)
    const c = touchClient({ projectAdmin: { data: [{ id: 'm-1' }], error: null } })
    expect(await resetPassword('u-t', 'password1')).toEqual({ ok: false, error: '관리자 계정은 슈퍼유저만 변경할 수 있습니다.' })
    // 명단 권한은 인물을 거쳐 계정에 붙는다 — 임베드 필터 모양을 고정한다.
    expect(c.q.project_members.select).toHaveBeenCalledWith('id, people!inner(user_id)')
    expect(c.q.project_members.eq).toHaveBeenCalledWith('people.user_id', 'u-t')
    expect(c.q.project_members.eq).toHaveBeenCalledWith('access_role', 'admin')
    expect(c.updateUserById).not.toHaveBeenCalled()

    const w = touchClient({ wsAdmin: { data: [{ workspace_id: WS }], error: null } })
    expect(await resetPassword('u-t', 'password1')).toEqual({ ok: false, error: '관리자 계정은 슈퍼유저만 변경할 수 있습니다.' })
    expect(w.q.workspace_members.eq).toHaveBeenCalledWith('role', 'admin')
    expect(w.updateUserById).not.toHaveBeenCalled()
  })

  it('비슈퍼유저라도 일반 계정은 초기화할 수 있다', async () => {
    requireSuperuser.mockResolvedValue(RELAXED)
    const c = touchClient()
    expect(await resetPassword('u-t', 'password1')).toEqual({ ok: true })
    expect(c.updateUserById).toHaveBeenCalledWith('u-t', { password: 'password1' })
  })

  it('대상 등급 조회가 하나라도 실패하면 거부한다 — "관리자 아님" 폴백 금지', async () => {
    requireSuperuser.mockResolvedValue(RELAXED)
    const c = touchClient({ wsAdmin: { data: null, error: { message: 'boom' } } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await resetPassword('u-t', 'password1')).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expect(c.updateUserById).not.toHaveBeenCalled()
  })

  it('슈퍼유저는 누구의 비밀번호든 초기화할 수 있다', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    const updateUserById = vi.fn(async () => ({ error: null }))
    createAdminClient.mockReturnValue({
      from: vi.fn(() => { throw new Error('슈퍼유저는 등급 조회 없이 통과한다') }),
      auth: { admin: { updateUserById } },
    } as never)
    expect(await resetPassword('u-superuser', 'password1')).toEqual({ ok: true })
    expect(updateUserById).toHaveBeenCalledWith('u-superuser', { password: 'password1' })
  })

  it('listAccounts 는 권한 거부를 빈 배열로 위장하지 않는다 — 멤버는 거부, 다른 워크스페이스 관리자는 존재 은닉', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    signedInAs(WS_MEMBER)
    expect(await listAccounts(P1)).toEqual({ ok: false, error: ERR_DENIED })
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    signedInAs(OTHER_WS_ADMIN)
    expect(await listAccounts(P1)).toEqual({ ok: false, error: ERR_MISSING })
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회 실패는 resetPassword 를 중단한다 — 관대한 폴백 금지', async () => {
    requireSuperuser.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await resetPassword('u1', 'password1'))
      .toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('setPlatformAdmin 은 슈퍼유저 전용', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await setPlatformAdmin('u2', true)).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('setWorkspaceRole: 멤버는 거부, 다른 워크스페이스 관리자는 존재 은닉', async () => {
    signedInAs(WS_MEMBER)
    expect(await setWorkspaceRole(WS, 'u2', 'admin')).toEqual({ ok: false, error: ERR_DENIED })
    signedInAs(OTHER_WS_ADMIN)
    expect(await setWorkspaceRole(WS, 'u2', 'admin')).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createAccount — 계정·프로필·워크스페이스·인물·명단을 차례로, 실패하면 계정을 되돌린다', () => {
  beforeEach(() => { signedInAs(SU) })

  it('그 워크스페이스의 관리자는 입력 워크스페이스에 만든다(p_actor·invited_by = 본인)', async () => {
    signedInAs(WS_ADMIN)
    const c = accountClient()
    expect(await createAccount(INPUT)).toEqual({ ok: true })
    expect(c.q.workspace_members.insert)
      .toHaveBeenCalledWith({ workspace_id: WS, user_id: 'u-new', role: 'member', invited_by: 'u-wsa' })
    expect(c.rpc).toHaveBeenCalledWith('upsert_project_member', expect.objectContaining({ p_actor: 'u-wsa' }))
  })

  // 이미 있는 계정(이메일)은 createUser 가 거부한다 — 기존 계정의 비밀번호·표시 이름을 덮는 분기가 없다.
  // 워크스페이스 관리자에게 이 액션이 열려도 다른 워크스페이스 소속 계정을 탈취하는 길이 되지 않음을 고정한다.
  it('이미 있는 이메일이면 기존 계정을 건드리지 않고 거부한다(비밀번호 무변경)', async () => {
    signedInAs(WS_ADMIN)
    const c = accountClient()
    c.createUser.mockResolvedValueOnce({
      data: { user: null }, error: { message: 'A user with this email address has already been registered' },
    } as never)
    const updateUserById = vi.fn()
    const client = { from: c.from, rpc: c.rpc, auth: { admin: { createUser: c.createUser, deleteUser: c.deleteUser, updateUserById } } }
    createAdminClient.mockReturnValue(client as never)
    const res = await createAccount(INPUT)
    expect(res.ok).toBe(false)
    expect(updateUserById).not.toHaveBeenCalled()
    expect(c.from).not.toHaveBeenCalled()
    expect(c.deleteUser).not.toHaveBeenCalled()
  })

  it('정상 — 새 인물을 만들고 명단 권한은 RPC(p_actor = 슈퍼유저)로 준다', async () => {
    const c = accountClient()
    expect(await createAccount(INPUT)).toEqual({ ok: true })
    expect(c.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'mina.park@example.com', password: 'password1', email_confirm: true,
    }))
    expect(c.q.profiles.insert).toHaveBeenCalledWith({ user_id: 'u-new', email: 'mina.park@example.com', display_name: '박민아' })
    expect(c.q.workspace_members.insert)
      .toHaveBeenCalledWith({ workspace_id: WS, user_id: 'u-new', role: 'member', invited_by: 'u-su' })
    expect(c.q.peopleFind.eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(c.q.peopleFind.eq).toHaveBeenCalledWith('email', 'mina.park@example.com')
    expect(c.q.peopleInsert.insert).toHaveBeenCalledWith({
      workspace_id: WS, display_name: '박민아', email: 'mina.park@example.com', user_id: 'u-new',
    })
    expect(c.rpc).toHaveBeenCalledWith('upsert_project_member', {
      p_actor: 'u-su', p_project_id: P1, p_person: { id: 'pe-new' }, p_member: { access_role: 'member' }, p_team_ids: null,
    })
    expect(c.deleteUser).not.toHaveBeenCalled()
  })

  it('이름이 없으면 표시 이름은 이메일 로컬 파트', async () => {
    const c = accountClient()
    await createAccount({ ...INPUT, name: '  ' })
    expect(c.q.profiles.insert).toHaveBeenCalledWith(expect.objectContaining({ display_name: 'mina.park' }))
  })

  it('권한 없이 만들면(조회 전용 시작) 명단 RPC 를 부르지 않는다', async () => {
    const c = accountClient()
    expect(await createAccount({ ...INPUT, accessRole: null })).toEqual({ ok: true })
    expect(c.rpc).not.toHaveBeenCalled()
  })

  it('같은 이메일의 외부 인력이 있으면 새로 만들지 않고 그 인물에 계정을 잇는다(아직 미연결일 때만)', async () => {
    const c = accountClient({ existingPerson: { id: 'pe-old', user_id: null, active: true } })
    expect(await createAccount(INPUT)).toEqual({ ok: true })
    expect(c.q.peopleFind.select).toHaveBeenCalledWith('id, user_id, active')
    expect(c.q.peopleLink.update).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-new' }))
    // 활성 인물이면 active 를 건드리지 않는다.
    expect(c.q.peopleLink.update.mock.calls[0]![0]).not.toHaveProperty('active')
    expect(c.q.peopleLink.eq).toHaveBeenCalledWith('id', 'pe-old')
    expect(c.q.peopleLink.is).toHaveBeenCalledWith('user_id', null)
    expect(c.q.peopleInsert.insert).not.toHaveBeenCalled()
    expect(c.rpc).toHaveBeenCalledWith('upsert_project_member', expect.objectContaining({ p_person: { id: 'pe-old' } }))
  })

  // 헬퍼·buildActor 는 인물이 활성일 때만 권한을 인정한다 — 비활성 인물에 이으면 '권한 부여 성공' 이 실제로는 무효다.
  // consume_project_invite 의 재활성화와 같은 규칙(service_role 이라 people.active 컬럼 권한을 넘는다).
  it('비활성 외부 인력에 이을 때는 함께 되살린다', async () => {
    const c = accountClient({ existingPerson: { id: 'pe-old', user_id: null, active: false } })
    expect(await createAccount(INPUT)).toEqual({ ok: true })
    expect(c.q.peopleLink.update).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-new', active: true }))
  })

  it('그 인물이 이미 다른 계정에 연결돼 있으면 거부하고 계정을 되돌린다', async () => {
    const c = accountClient({ existingPerson: { id: 'pe-old', user_id: 'u-other' } })
    expect(await createAccount(INPUT)).toEqual({ ok: false, error: '이미 다른 계정에 연결된 사람입니다.' })
    expect(c.q.peopleLink.update).not.toHaveBeenCalled()
    expect(c.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('연결 직전에 다른 계정이 먼저 이었으면(0행) 같은 거부 — 덮어쓰지 않는다', async () => {
    const c = accountClient({ existingPerson: { id: 'pe-old', user_id: null }, linkRows: [] })
    expect(await createAccount(INPUT)).toEqual({ ok: false, error: '이미 다른 계정에 연결된 사람입니다.' })
    expect(c.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('인물 insert 의 유니크 위반(경합)은 조용히 재시도하지 않고 오류로 돌린다', async () => {
    const c = accountClient({
      personInsert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "people_ws_email_uidx"' } },
    })
    const res = await createAccount(INPUT)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('같은 이메일')
    expect(c.q.peopleInsert.insert).toHaveBeenCalledTimes(1)
    expect(c.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('워크스페이스 소속 저장이 실패하면 계정을 되돌린다 — 소속 없는 유령 계정 방지', async () => {
    const c = accountClient({ wsErr: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createAccount(INPUT)
    spy.mockRestore()
    expect(res.ok).toBe(false)
    expect(c.deleteUser).toHaveBeenCalledWith('u-new')
    expect(c.q.peopleFind.select).not.toHaveBeenCalled()
  })

  it('명단 RPC 가 실패하면 만든 인물과 계정을 함께 되돌린다', async () => {
    const c = accountClient({ rpc: { data: null, error: { code: '23514', message: 'PROJECT_MEMBER_CROSS_WORKSPACE' } } })
    expect(await createAccount(INPUT)).toEqual({ ok: false, error: '다른 워크스페이스의 인물입니다.' })
    expect(c.q.peopleDelete.delete).toHaveBeenCalled()
    expect(c.q.peopleDelete.eq).toHaveBeenCalledWith('id', 'pe-new')
    expect(c.deleteUser).toHaveBeenCalledWith('u-new')
    // 인물을 먼저 지운다 — 계정 삭제의 set null 이 남긴 외부 인력 행이 같은 이메일을 붙잡지 않게.
    expect(c.q.peopleDelete.delete.mock.invocationCallOrder[0]).toBeLessThan(c.deleteUser.mock.invocationCallOrder[0])
  })

  it('입력 검증 — 비밀번호·워크스페이스 권한·권한 값 — 계정을 만들기 전에 막는다', async () => {
    const c = accountClient()
    expect(await createAccount({ ...INPUT, password: 'short' })).toEqual({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' })
    expect(await createAccount({ ...INPUT, workspaceRole: 'owner' as never })).toEqual({ ok: false, error: '알 수 없는 워크스페이스 권한' })
    expect(await createAccount({ ...INPUT, accessRole: 'viewer' as never })).toEqual({ ok: false, error: '알 수 없는 권한' })
    expect(await createAccount({ ...INPUT, projectId: null })).toEqual({ ok: false, error: '권한을 줄 프로젝트를 지정하세요.' })
    // 검증이 createUser 뒤로 밀리면 같은 문구를 내면서 유령 계정·보상 롤백이 생긴다 — 순서를 고정한다.
    expect(c.createUser).not.toHaveBeenCalled()
    expect(c.deleteUser).not.toHaveBeenCalled()
  })
})

describe('bulkCreateAccounts — 이메일, 권한, 초기비번[, 이름]', () => {
  it('행마다 만들고, viewer 는 명단 권한 없이 만든다(워크스페이스 멤버)', async () => {
    signedInAs(SU)
    const c = accountClient()
    const res = await bulkCreateAccounts(WS, 'a@example.com, viewer, password1\nbroken, member, password1', P1)
    expect(res.ok).toBe(true)
    expect(res.results).toEqual([
      { lineNo: 1, email: 'a@example.com', ok: true, error: undefined },
      { lineNo: 2, email: 'broken', ok: false, error: '이메일 형식 오류' },
    ])
    expect(c.q.workspace_members.insert).toHaveBeenCalledWith(expect.objectContaining({ role: 'member' }))
    expect(c.rpc).not.toHaveBeenCalled()
  })
})

describe('setPlatformAdmin — 마지막 관리자 보호', () => {
  beforeEach(() => { requireSuperuser.mockResolvedValue({ ok: true, actor: SU }) })

  it('마지막 슈퍼유저 해제는 거부한다 — 전역 관리 잠금 방지', async () => {
    const q = chain({ data: [{ user_id: 'u1' }], error: null })
    createAdminClient.mockReturnValue({ from: vi.fn(() => q) } as never)
    const res = await setPlatformAdmin('u1', false)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('마지막 슈퍼유저')
    expect(q.delete).not.toHaveBeenCalled()
  })

  it('목록 조회 실패는 해제를 중단한다 — 0명 폴백 금지(fail-closed)', async () => {
    createAdminClient.mockReturnValue({ from: vi.fn(() => chain({ data: null, error: { message: 'boom' } })) } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await setPlatformAdmin('u1', false)
    spy.mockRestore()
    expect(res.ok).toBe(false)
    expect(res.error).toContain('확인할 수 없어')
  })

  it('본인 해제는 거부한다 — 조회·쓰기 없이(다른 슈퍼유저가 해야 한다)', async () => {
    const res = await setPlatformAdmin('u-su', false)
    expect(res).toEqual({ ok: false, error: '본인의 플랫폼 관리자 권한은 스스로 해제할 수 없습니다. 다른 슈퍼유저에게 요청하세요.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('다른 사람 해제는 기존대로(둘 이상이면 해제한다)', async () => {
    const list = chain({ data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null })
    const del = chain({ error: null })
    let n = 0
    createAdminClient.mockReturnValue({ from: vi.fn(() => (n++ === 0 ? list : del)) } as never)
    expect(await setPlatformAdmin('u1', false)).toEqual({ ok: true })
    expect(del.delete).toHaveBeenCalled()
    expect(del.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('지정은 발급자를 남기고 이미 있으면 그대로 둔다', async () => {
    const q = chain({ error: null })
    createAdminClient.mockReturnValue({ from: vi.fn(() => q) } as never)
    expect(await setPlatformAdmin('u2', true)).toEqual({ ok: true })
    expect(q.upsert).toHaveBeenCalledWith({ user_id: 'u2', granted_by: 'u-su' }, { onConflict: 'user_id', ignoreDuplicates: true })
  })
})

describe('setWorkspaceRole', () => {
  beforeEach(() => { signedInAs(WS_ADMIN) })

  it('마지막 관리자 강등은 트리거가 거부한다 — 사용자 문구로', async () => {
    createAdminClient.mockReturnValue({
      from: vi.fn(() => chain({ data: null, error: { code: '23514', message: 'WORKSPACE_LAST_ADMIN' } })),
    } as never)
    expect(await setWorkspaceRole(WS, 'u1', 'member'))
      .toEqual({ ok: false, error: '워크스페이스의 마지막 관리자는 강등할 수 없습니다. 다른 관리자를 먼저 지정하세요.' })
  })

  it('소속이 아닌 계정(0행)은 성공으로 위장하지 않는다', async () => {
    createAdminClient.mockReturnValue({ from: vi.fn(() => chain({ data: [], error: null })) } as never)
    expect(await setWorkspaceRole(WS, 'u9', 'admin')).toEqual({ ok: false, error: '이 워크스페이스에 소속되지 않은 계정입니다.' })
  })

  it('정상 — (workspace_id, user_id) 로 좁혀 role 만 바꾼다', async () => {
    const q = chain({ data: [{ user_id: 'u1' }], error: null })
    createAdminClient.mockReturnValue({ from: vi.fn(() => q) } as never)
    expect(await setWorkspaceRole(WS, 'u1', 'admin')).toEqual({ ok: true })
    expect(q.update).toHaveBeenCalledWith({ role: 'admin' })
    expect(q.eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(q.eq).toHaveBeenCalledWith('user_id', 'u1')
  })

  it('알 수 없는 등급은 거부', async () => {
    expect(await setWorkspaceRole(WS, 'u1', 'owner' as never)).toEqual({ ok: false, error: '알 수 없는 워크스페이스 권한' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('listAccounts — profiles + platform_admins + workspace_members + 그 프로젝트 명단 권한', () => {
  it('각 축을 한 행으로 합친다', async () => {
    signedInAs(SU)
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'profiles') {
          return chain({
            data: [
              { user_id: 'u1', email: 'kim@example.com', display_name: '김관리', created_at: '2026-09-01T00:00:00Z' },
              { user_id: 'u2', email: 'lee@example.com', display_name: '이멤버', created_at: '2026-09-02T00:00:00Z' },
            ],
            error: null,
          })
        }
        if (t === 'platform_admins') return chain({ data: [{ user_id: 'u1' }], error: null })
        if (t === 'workspace_members') return chain({ data: [{ user_id: 'u1', role: 'admin' }, { user_id: 'u2', role: 'member' }], error: null })
        if (t === 'project_members') {
          return chain({ data: [{ access_role: 'member', active: true, people: { user_id: 'u2', active: true } }], error: null })
        }
        throw new Error('예상치 못한 테이블 접근: ' + t)
      }),
    } as never)
    const res = await listAccounts(P1)
    expect(res).toEqual({
      ok: true,
      workspaceId: WS,
      rows: [
        { id: 'u1', email: 'kim@example.com', name: '김관리', workspaceRole: 'admin', isPlatformAdmin: true, accessRole: null, createdAt: '2026-09-01T00:00:00Z' },
        { id: 'u2', email: 'lee@example.com', name: '이멤버', workspaceRole: 'member', isPlatformAdmin: false, accessRole: 'member', createdAt: '2026-09-02T00:00:00Z' },
      ],
    })
  })

  it('어느 축이든 조회가 실패하면 오류 — 부분 목록은 곧 잘못된 권한 정보다', async () => {
    signedInAs(SU)
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'workspace_members') return chain({ data: null, error: { message: 'boom' } })
        return chain({ data: [], error: null })
      }),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listAccounts(P1)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '계정 권한 정보를 불러오지 못했습니다.' })
  })

  it('워크스페이스 관리자에게는 그 워크스페이스 소속·명단 계정만 보인다 — 다른 워크스페이스 계정 누설 금지', async () => {
    signedInAs(WS_ADMIN)
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'profiles') {
          return chain({
            data: [
              { user_id: 'u1', email: 'kim@example.com', display_name: '김관리', created_at: '2026-09-01T00:00:00Z' },
              { user_id: 'u-b', email: 'bob@example.com', display_name: '밥', created_at: '2026-09-03T00:00:00Z' },
            ],
            error: null,
          })
        }
        if (t === 'platform_admins') return chain({ data: [], error: null })
        if (t === 'workspace_members') return chain({ data: [{ user_id: 'u1', role: 'admin' }], error: null })
        if (t === 'project_members') return chain({ data: [], error: null })
        throw new Error('예상치 못한 테이블 접근: ' + t)
      }),
    } as never)
    const res = await listAccounts(P1)
    expect(res.ok && res.rows.map(r => r.id)).toEqual(['u1'])
    expect(res.ok && res.workspaceId).toBe(WS)
  })
})
