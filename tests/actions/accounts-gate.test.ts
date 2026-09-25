import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// next/cache · authz 가드 · admin 클라이언트를 모킹해 게이트와 쓰기 순서를 검증한다.
// vi.mock 팩토리는 파일 최상단으로 호이스팅되므로, 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient, requireProjectAdmin, requireSuperuser, getActor } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
  }),
  requireProjectAdmin: vi.fn(),
  requireSuperuser: vi.fn(),
  getActor: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, requireSuperuser, getActor }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import {
  createAccount, bulkCreateAccounts, resetPassword, listAccounts, setPlatformAdmin, setWorkspaceRole,
  type AccountInput,
} from '@/app/actions/accounts'
import { makeSuperuser, WS } from '../fixtures/actor'

const DENIED = { ok: false as const, error: '권한 없음' }
const P1 = 'p1'
const SU = makeSuperuser({ userId: 'u-su', workspaceRoles: new Map([[WS, 'admin']]) })
const INPUT: AccountInput = {
  email: ' Mina.Park@Example.com ', password: 'password1', name: '박민아', workspaceRole: 'member',
  projectId: P1, accessRole: 'member',
}

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(() => {
    throw new Error('createAdminClient 는 게이트 통과 전에 호출되면 안 된다')
  })
  requireProjectAdmin.mockReset()
  requireSuperuser.mockReset()
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
  existingPerson?: { id: string; user_id: string | null } | null
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

// 계정 관리는 슈퍼유저 전용(2026-08-20 결정). assertCanTouchAccount 는 정책이 다시 느슨해질 때를 대비해
// 코드에 남아 있지만 현 게이트에서는 도달 불가(슈퍼유저는 단락 통과)라 여기서 검증하지 않는다.
describe('계정 서버액션 권한 게이트', () => {
  it('슈퍼유저가 아니면 createAccount 거부 — admin client 미생성', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await createAccount(INPUT)).toEqual(DENIED)
    expect(requireProjectAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('슈퍼유저가 아니면 bulkCreateAccounts 거부', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    const res = await bulkCreateAccounts('a@b.com,member,password1', P1)
    expect(res).toMatchObject({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자도 resetPassword 거부 — 계정 조작은 슈퍼유저 전용', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await resetPassword('u-superuser', 'password1')).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
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

  it('listAccounts 는 권한 거부를 빈 배열로 위장하지 않는다', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listAccounts(P1)
    spy.mockRestore()
    expect(res).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회 실패는 resetPassword 를 중단한다 — 관대한 폴백 금지', async () => {
    requireSuperuser.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await resetPassword('u1', 'password1'))
      .toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('setPlatformAdmin·setWorkspaceRole 은 슈퍼유저 전용', async () => {
    requireSuperuser.mockResolvedValue(DENIED)
    expect(await setPlatformAdmin('u2', true)).toEqual(DENIED)
    expect(await setWorkspaceRole(WS, 'u2', 'admin')).toEqual(DENIED)
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createAccount — 계정·프로필·워크스페이스·인물·명단을 차례로, 실패하면 계정을 되돌린다', () => {
  beforeEach(() => { requireSuperuser.mockResolvedValue({ ok: true, actor: SU }) })

  it('워크스페이스를 하나로 정할 수 없으면 계정을 만들지 않는다', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: makeSuperuser({ workspaceRoles: new Map() }) })
    expect(await createAccount(INPUT)).toEqual({ ok: false, error: '워크스페이스에 소속돼 있지 않습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
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
    const c = accountClient({ existingPerson: { id: 'pe-old', user_id: null } })
    expect(await createAccount(INPUT)).toEqual({ ok: true })
    expect(c.q.peopleLink.update).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u-new' }))
    expect(c.q.peopleLink.eq).toHaveBeenCalledWith('id', 'pe-old')
    expect(c.q.peopleLink.is).toHaveBeenCalledWith('user_id', null)
    expect(c.q.peopleInsert.insert).not.toHaveBeenCalled()
    expect(c.rpc).toHaveBeenCalledWith('upsert_project_member', expect.objectContaining({ p_person: { id: 'pe-old' } }))
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

  it('입력 검증 — 비밀번호·워크스페이스 권한·권한 값', async () => {
    accountClient()
    expect(await createAccount({ ...INPUT, password: 'short' })).toEqual({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' })
    expect(await createAccount({ ...INPUT, workspaceRole: 'owner' as never })).toEqual({ ok: false, error: '알 수 없는 워크스페이스 권한' })
    expect(await createAccount({ ...INPUT, accessRole: 'viewer' as never })).toEqual({ ok: false, error: '알 수 없는 권한' })
    expect(await createAccount({ ...INPUT, projectId: null })).toEqual({ ok: false, error: '권한을 줄 프로젝트를 지정하세요.' })
  })
})

describe('bulkCreateAccounts — 이메일, 권한, 초기비번[, 이름]', () => {
  it('행마다 만들고, viewer 는 명단 권한 없이 만든다(워크스페이스 멤버)', async () => {
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    const c = accountClient()
    const res = await bulkCreateAccounts('a@example.com, viewer, password1\nbroken, member, password1', P1)
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

  it('둘 이상이면 해제한다', async () => {
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
  beforeEach(() => { requireSuperuser.mockResolvedValue({ ok: true, actor: SU }) })

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
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'projects') return chain({ data: { workspace_id: WS }, error: null })
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
    requireSuperuser.mockResolvedValue({ ok: true, actor: SU })
    createAdminClient.mockReturnValue({
      from: vi.fn((t: string) => {
        if (t === 'projects') return chain({ data: { workspace_id: WS }, error: null })
        if (t === 'workspace_members') return chain({ data: null, error: { message: 'boom' } })
        return chain({ data: [], error: null })
      }),
    } as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await listAccounts(P1)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '계정 권한 정보를 불러오지 못했습니다.' })
  })
})
