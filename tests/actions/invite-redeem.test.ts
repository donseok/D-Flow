import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 공개 redeem 액션은 인증 게이트가 없다 — 세션·초대 행·소비 RPC 세 방어선만 검증하면 되므로
// DB 는 전부 모킹한다. vi.mock 팩토리는 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
// 합류의 쓰기(프로필·인물·워크스페이스 소속·명단·팀)는 전부 RPC consume_project_invite 한 트랜잭션이다 —
// 스텁은 project_members·memberships·project_roles 에 대한 쓰기를 받지 않는다(받으면 즉시 실패).
const { createAdminClient, getSession } = vi.hoisted(() => ({
  createAdminClient: vi.fn(() => {
    throw new Error('createAdminClient 는 선검증 전에 호출되면 안 된다')
  }),
  getSession: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

import {
  getInvitePreview, getInviteSessionState, redeemInvite, redeemInviteWithSignup,
} from '@/app/actions/inviteRedeem'
import { hashInviteToken } from '@/lib/domain/inviteToken'

const TOKEN = '11111111-2222-4333-8444-555555555555'
const HASH = hashInviteToken(TOKEN)
const PROJECT = 'p-1'
const USER = { id: 'u-1', email: 'mina.park@example.com' }
const SIGNUP = { name: ' 홍길동 ', password: 'password1', passwordConfirmation: 'password1' }

const INVITE = {
  project_id: PROJECT,
  email: 'mina.park@example.com',
  access_role: 'member',
  expires_at: '2999-01-01T00:00:00.000Z',
  revoked_at: null,
  redeemed_at: null,
}
const CONSUMED = [{ workspace_id: 'ws-1', project_id: PROJECT, member_id: 'm-1' }]

interface Fixtures {
  invite?: { data: unknown; error: unknown }
  /** 이 프로젝트의 기존 명단 행(세션 사용자 인물) — 기본은 없음. */
  existing?: { data: unknown; error: unknown }
  consume?: { data: unknown; error: unknown }
  profile?: { data: unknown; error: unknown }
  profileInsert?: { error: unknown }
  inviteUpdate?: { error: unknown }
  createUser?: { data: unknown; error: unknown }
}

/** supabase 체인 모킹 + 호출 인자 기록. 예상 밖 테이블·메서드 접근은 즉시 실패시킨다. */
function makeAdmin(f: Fixtures = {}) {
  const spies = {
    rpc: vi.fn(), inviteEq: vi.fn(), inviteUpdate: vi.fn(), inviteUpdateEq: vi.fn(), existingEq: vi.fn(),
    profileEq: vi.fn(), profileInsert: vi.fn(), createUser: vi.fn(), deleteUser: vi.fn(),
  }
  spies.rpc.mockResolvedValue(f.consume ?? { data: CONSUMED, error: null })
  spies.inviteUpdate.mockResolvedValue(f.inviteUpdate ?? { error: null })
  spies.profileInsert.mockResolvedValue(f.profileInsert ?? { error: null })
  spies.createUser.mockResolvedValue(f.createUser ?? { data: { user: { id: 'u-new' } }, error: null })
  spies.deleteUser.mockResolvedValue({ error: null })
  const client = {
    from(table: string) {
      if (table === 'project_invites') {
        return {
          select: () => ({
            eq: (col: string, v: unknown) => {
              spies.inviteEq(col, v)
              return { maybeSingle: async () => f.invite ?? { data: INVITE, error: null } }
            },
          }),
          // update(...).eq(...).eq(...) — 조건을 모두 기록하고, await 시점에 결과를 낸다.
          update: (patch: unknown) => {
            const q = {
              eq: (col: string, v: unknown) => { spies.inviteUpdateEq(col, v); return q },
              then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
                (spies.inviteUpdate(patch) as Promise<unknown>).then(res, rej),
            }
            return q
          },
        }
      }
      if (table === 'project_members') {
        // 선행 조회(읽기)만 허용 — 명단 쓰기는 RPC 몫이다.
        const q = {
          eq: (col: string, v: unknown) => { spies.existingEq(col, v); return q },
          maybeSingle: async () => f.existing ?? { data: null, error: null },
        }
        return { select: () => q }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: (col: string, v: unknown) => {
              spies.profileEq(col, v)
              return { maybeSingle: async () => f.profile ?? { data: null, error: null } }
            },
          }),
          insert: (row: unknown) => spies.profileInsert(row),
        }
      }
      throw new Error('예상치 못한 테이블 접근: ' + table)
    },
    rpc: (fn: string, args: unknown) => spies.rpc(fn, args),
    auth: {
      admin: {
        createUser: (input: unknown) => spies.createUser(input),
        deleteUser: (id: string) => spies.deleteUser(id),
      },
    },
  }
  createAdminClient.mockReturnValue(client as never)
  return spies
}

function silenceConsole() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

const originalDomains = process.env.INVITE_ALLOWED_DOMAINS

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(() => {
    throw new Error('createAdminClient 는 선검증 전에 호출되면 안 된다')
  })
  getSession.mockReset()
  // USER·INVITE 의 도메인(example.com)을 기본으로 허용해 둔다 — 재검사 회귀 테스트만 좁힌다.
  process.env.INVITE_ALLOWED_DOMAINS = 'example.com'
})

afterEach(() => {
  if (originalDomains === undefined) delete process.env.INVITE_ALLOWED_DOMAINS
  else process.env.INVITE_ALLOWED_DOMAINS = originalDomains
})

describe('redeemInvite — 로그인 사용자 합류', () => {
  it('토큰 형식이 틀리면 미존재와 같은 문구로 거부하고 DB 에 닿지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    expect(await redeemInvite('not-a-uuid')).toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비로그인이면 로그인을 요구하고 admin client 에 도달하지 않는다', async () => {
    getSession.mockResolvedValue(null)
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '로그인이 필요합니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('세션 확인이 실패하면 비로그인으로 폴백하지 않고 중단한다 — fail-closed', async () => {
    getSession.mockRejectedValue(new Error('boom'))
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('초대 조회 실패를 미존재로 위장하지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ invite: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
  })

  // DB 에는 평문 토큰이 없다 — 조회 키는 언제나 해시다.
  it('초대는 토큰 해시로 찾는다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin()
    await redeemInvite(TOKEN)
    expect(spies.inviteEq).toHaveBeenCalledWith('token_hash', HASH)
    expect(spies.inviteEq).not.toHaveBeenCalledWith('token', expect.anything())
  })

  // 발급 시점엔 허용됐어도 이후 env 를 좁히면(운영자가 허용 도메인을 줄이는 경우) 이미 나간
  // 초대도 즉시 막혀야 한다 — 허용 목록은 issuance 시점 스냅샷이 아니라 매 호출마다 다시 읽는다.
  it('허용 도메인이 좁혀지면 이미 나간 초대도 재확인에서 막는다(fail-closed)', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin()
    process.env.INVITE_ALLOWED_DOMAINS = 'other.com'
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.rpc).not.toHaveBeenCalled()
  })

  it('세션 이메일이 초대 이메일과 다르면 소비 전에 거부한다', async () => {
    getSession.mockResolvedValue({ id: 'u-2', email: 'other@example.com' })
    const spies = makeAdmin()
    const res = await redeemInvite(TOKEN)
    expect(res).toEqual({
      ok: false,
      error: '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.',
    })
    expect(spies.rpc).not.toHaveBeenCalled()
  })

  it('이미 같거나 높은 권한이 있으면 초대를 태우지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({
      existing: { data: { access_role: 'admin', active: true, people: { user_id: USER.id, active: true } }, error: null },
    })
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: true })
    expect(spies.existingEq).toHaveBeenCalledWith('project_id', PROJECT)
    expect(spies.existingEq).toHaveBeenCalledWith('people.user_id', USER.id)
    expect(spies.rpc).not.toHaveBeenCalled()
  })

  it('관리자 초대면 기존 멤버도 소비해 올린다(초대는 권한을 깎지 않고 올리기만)', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({
      invite: { data: { ...INVITE, access_role: 'admin' }, error: null },
      existing: { data: { access_role: 'member', active: true, people: { user_id: USER.id, active: true } }, error: null },
    })
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: false })
    expect(spies.rpc).toHaveBeenCalled()
  })

  it('비활성 명단 행의 권한은 없는 것으로 본다 — 소비해서 되살린다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({
      existing: { data: { access_role: 'member', active: false, people: { user_id: USER.id, active: true } }, error: null },
    })
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: false })
    expect(spies.rpc).toHaveBeenCalled()
  })

  it('기존 권한 조회가 실패하면 소비하지 않고 중단한다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin({ existing: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expect(spies.rpc).not.toHaveBeenCalled()
  })

  it('소비 RPC 가 0행이면 만료·사용됨과 구분하지 않고 거부한다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ consume: { data: [], error: null } })
    expect(await redeemInvite(TOKEN))
      .toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
  })

  it('정상 합류 — RPC 한 번(토큰 해시·이메일·사용자), 앱은 명단에 직접 쓰지 않는다', async () => {
    getSession.mockResolvedValue(USER)
    const spies = makeAdmin()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: true, projectId: PROJECT, alreadyMember: false })
    expect(spies.rpc).toHaveBeenCalledTimes(1)
    expect(spies.rpc).toHaveBeenCalledWith('consume_project_invite', {
      p_token_hash: HASH, p_email: INVITE.email, p_user: USER.id,
    })
    // RPC 가 원자적이라 앱이 되돌릴 부분 상태가 없다.
    expect(spies.inviteUpdate).not.toHaveBeenCalled()
  })

  // 트리거가 던지는 명단 토큰은 명단 문구로 — 초대 팀이 사라진 경우는 재발급을 안내한다(팀 id 배열엔 FK 가 없다).
  it.each([
    ['PROJECT_MEMBER_TEAM_SCOPE', '초대에 담긴 팀을 더 이상 쓸 수 없습니다. 관리자에게 초대 재발급을 요청해 주세요.'],
    ['PROJECT_MEMBER_CROSS_WORKSPACE', '다른 워크스페이스의 인물입니다.'],
    ['PROJECT_MEMBER_ACCESS_REQUIRES_ACCOUNT',
      '계정이 연결되지 않은 사람에게는 권한을 줄 수 없습니다. 이메일로 초대하거나 계정을 먼저 만드세요.'],
  ])('RPC 의 트리거 오류 %s 는 사용자 문구로', async (token, text) => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ consume: { data: null, error: { code: '23514', message: token } } })
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: text })
    spy.mockRestore()
  })

  it('RPC 오류는 원시 메시지 대신 문구로 — 인물이 다른 계정에 연결된 경우는 따로 안내한다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ consume: { data: null, error: { code: '23505', message: 'PROJECT_INVITE_PERSON_LINKED' } } })
    const spy = silenceConsole()
    expect(await redeemInvite(TOKEN)).toEqual({
      ok: false, error: '이 이메일의 인물이 이미 다른 계정에 연결돼 있습니다. 관리자에게 문의해 주세요.',
    })
    makeAdmin({ consume: { data: null, error: { message: 'connection reset' } } })
    expect(await redeemInvite(TOKEN)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
  })
})

describe('redeemInviteWithSignup — 가입 + 합류', () => {
  it('로그인 상태에서는 가입 경로를 쓸 수 없다', async () => {
    getSession.mockResolvedValue(USER)
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '이미 로그인되어 있습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비밀번호가 일치하지 않으면 계정을 만들지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const res = await redeemInviteWithSignup(TOKEN, { ...SIGNUP, passwordConfirmation: 'password2' })
    expect(res).toEqual({ ok: false, error: '비밀번호가 일치하지 않습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('만료된 초대면 계정을 만들지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({
      invite: { data: { ...INVITE, expires_at: '2020-01-01T00:00:00.000Z' }, error: null },
    })
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.createUser).not.toHaveBeenCalled()
  })

  it('허용 도메인이 좁혀지면 이미 나간 초대도 재확인에서 막는다(fail-closed)', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin()
    process.env.INVITE_ALLOWED_DOMAINS = 'other.com'
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.createUser).not.toHaveBeenCalled()
  })

  it('계정은 초대 행의 이메일로만 — 가입 폼의 이름을 프로필에 먼저 넣고 RPC 로 합류한다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    expect(res).toEqual({ ok: true, projectId: PROJECT, email: INVITE.email })
    expect(spies.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: INVITE.email, password: SIGNUP.password, email_confirm: true,
    }))
    // RPC 는 기존 프로필 이름을 유지하므로(없으면 이메일 로컬 파트) 가입 폼의 이름이 명단에 오르려면 먼저 넣어야 한다.
    expect(spies.profileInsert).toHaveBeenCalledWith({ user_id: 'u-new', email: INVITE.email, display_name: '홍길동' })
    expect(spies.profileInsert.mock.invocationCallOrder[0]).toBeLessThan(spies.rpc.mock.invocationCallOrder[0])
    expect(spies.rpc).toHaveBeenCalledWith('consume_project_invite', {
      p_token_hash: HASH, p_email: INVITE.email, p_user: 'u-new',
    })
    expect(spies.deleteUser).not.toHaveBeenCalled()
  })

  it('createUser 실패는 원인을 구분해 알리지 않는다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ createUser: { data: null, error: { message: 'already registered' } } })
    expect(await redeemInviteWithSignup(TOKEN, SIGNUP))
      .toEqual({ ok: false, error: '이미 가입된 계정이거나 입력값을 확인해 주세요.' })
    expect(spies.profileInsert).not.toHaveBeenCalled()
  })

  it('프로필 저장이 실패하면 소비 전에 계정을 되돌린다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ profileInsert: { error: { message: 'boom' } } })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '가입 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' })
    expect(spies.rpc).not.toHaveBeenCalled()
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('소비 RPC 가 0행이면 유령 계정을 남기지 않는다 — 보상 롤백', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ consume: { data: [], error: null } })
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    expect(res).toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
    // 소비되지 않은 행에도 되돌리기를 시도하지만 null 을 다시 null 로 쓸 뿐이라 무해하다. 대상은 해시로 찾는다.
    expect(spies.inviteUpdate).toHaveBeenCalledWith({ redeemed_by: null, redeemed_at: null })
    // 되돌리기는 이번 가입이 만든 계정의 소비만 — 다른 계정이 정당하게 쓴 링크를 다시 열지 않는다.
    expect(spies.inviteUpdateEq).toHaveBeenCalledWith('token_hash', HASH)
    expect(spies.inviteUpdateEq).toHaveBeenCalledWith('redeemed_by', 'u-new')
  })

  it('트리거 오류(초대 팀이 사라짐)도 계정을 되돌리고, 재발급을 안내한다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ consume: { data: null, error: { code: '23514', message: 'PROJECT_MEMBER_TEAM_SCOPE' } } })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대에 담긴 팀을 더 이상 쓸 수 없습니다. 관리자에게 초대 재발급을 요청해 주세요.' })
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('소비 RPC 가 에러로 실패해도 되돌리기를 먼저 한다 — 커밋됐는데 응답만 깨진 경우', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({ consume: { data: null, error: { message: 'connection reset' } } })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    expect(spies.inviteUpdate).toHaveBeenCalledWith({ redeemed_by: null, redeemed_at: null })
    expect(spies.inviteUpdate.mock.invocationCallOrder[0])
      .toBeLessThan(spies.deleteUser.mock.invocationCallOrder[0])
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
  })

  it('되돌리기가 실패해도 계정은 지운다 — 초대 고착보다 유령 계정이 더 나쁘다', async () => {
    getSession.mockResolvedValue(null)
    const spies = makeAdmin({
      consume: { data: null, error: { message: 'connection reset' } }, inviteUpdate: { error: { message: 'again' } },
    })
    const spy = silenceConsole()
    const res = await redeemInviteWithSignup(TOKEN, SIGNUP)
    // 사용자에게는 소비 실패 문구가 그대로 간다(되돌리기 실패는 운영 로그의 몫).
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    expect(spies.deleteUser).toHaveBeenCalledWith('u-new')
    // 고착된 초대를 찾을 단서는 남기되 토큰 전문은 남기지 않는다.
    const logged = spy.mock.calls.flat().join(' ')
    spy.mockRestore()
    expect(logged).toContain('u-new')
    expect(logged).not.toContain(TOKEN)
  })
})

describe('getInvitePreview', () => {
  const PREVIEW_ROW = {
    email: INVITE.email,
    expires_at: INVITE.expires_at,
    revoked_at: null,
    redeemed_at: null,
    projects: { name: 'Acme Project', description: '전사 프로젝트' },
  }

  it('잘못된 토큰은 DB 조회 없이 미존재와 같은 문구', async () => {
    expect(await getInvitePreview('nope')).toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('전체 이메일 대신 마스킹된 주소만 돌려준다', async () => {
    const spies = makeAdmin({ invite: { data: PREVIEW_ROW, error: null } })
    const res = await getInvitePreview(TOKEN)
    expect(res).toEqual({
      ok: true,
      preview: {
        projectName: 'Acme Project',
        projectDescription: '전사 프로젝트',
        maskedEmail: 'mi*******@example.com',
        status: 'active',
        accountExists: false,
      },
    })
    // 계정 유무는 profiles(email) 단건 — 전 계정 목록을 훑지 않는다.
    expect(spies.profileEq).toHaveBeenCalledWith('email', INVITE.email)
  })

  it('같은 이메일의 계정이 있으면 accountExists 로 로그인 폼을 유도한다', async () => {
    makeAdmin({ invite: { data: PREVIEW_ROW, error: null }, profile: { data: { user_id: 'x' }, error: null } })
    const res = await getInvitePreview(TOKEN)
    expect(res.ok && res.preview.accountExists).toBe(true)
  })

  it('취소된 초대는 상태만 돌려준다 — 프로젝트명·수신자·계정 유무를 흘리지 않는다', async () => {
    const spies = makeAdmin({ invite: { data: { ...PREVIEW_ROW, revoked_at: '2026-08-01T00:00:00.000Z' }, error: null } })
    const res = await getInvitePreview(TOKEN)
    expect(res).toEqual({
      ok: true,
      preview: {
        projectName: '', projectDescription: null, maskedEmail: '',
        status: 'revoked', accountExists: false,
      },
    })
    // 최소 preview 라 계정 유무 조회도 하지 않는다.
    expect(spies.profileEq).not.toHaveBeenCalled()
  })

  it('만료·사용됨도 같은 최소 preview 다', async () => {
    for (const [patch, status] of [
      [{ expires_at: '2020-01-01T00:00:00.000Z' }, 'expired'],
      [{ redeemed_at: '2026-08-01T00:00:00.000Z' }, 'redeemed'],
    ] as const) {
      makeAdmin({ invite: { data: { ...PREVIEW_ROW, ...patch }, error: null } })
      const res = await getInvitePreview(TOKEN)
      expect(res.ok && res.preview).toEqual({
        projectName: '', projectDescription: null, maskedEmail: '', status, accountExists: false,
      })
    }
  })

  it('계정 유무 조회 실패를 계정 없음으로 위장하지 않는다', async () => {
    makeAdmin({ invite: { data: PREVIEW_ROW, error: null }, profile: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    const res = await getInvitePreview(TOKEN)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })

  it('허용 도메인이 좁혀지면 이미 나간 초대도 재확인에서 막는다 — 계정 유무도 조회하지 않는다', async () => {
    const spies = makeAdmin({ invite: { data: PREVIEW_ROW, error: null } })
    process.env.INVITE_ALLOWED_DOMAINS = 'other.com'
    const res = await getInvitePreview(TOKEN)
    expect(res).toEqual({ ok: false, error: '만료되었거나 사용할 수 없는 초대입니다.' })
    expect(spies.profileEq).not.toHaveBeenCalled()
  })
})

describe('getInviteSessionState — 화면 분기용 세션 판정', () => {
  it('잘못된 토큰은 DB 조회 없이 미존재와 같은 문구', async () => {
    expect(await getInviteSessionState('nope')).toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('비로그인 호출자에게는 초대 이메일에 관한 어떤 정보도 주지 않는다 — 조회조차 하지 않는다', async () => {
    getSession.mockResolvedValue(null)
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: false, emailMatches: false })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('세션 확인 실패는 비로그인으로 폴백하지 않는다 — fail-closed', async () => {
    getSession.mockRejectedValue(new Error('boom'))
    const spy = silenceConsole()
    const res = await getInviteSessionState(TOKEN)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })

  it('세션 이메일이 초대 이메일과 같으면 일치로 판정한다(대소문자·공백 무시)', async () => {
    getSession.mockResolvedValue({ id: 'u-1', email: '  MINA.PARK@Example.com ' })
    const spies = makeAdmin()
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: true, emailMatches: true })
    expect(spies.inviteEq).toHaveBeenCalledWith('token_hash', HASH)
  })

  it('마스킹이 같아도 원문이 다르면 불일치다 — 클라이언트 마스킹 비교 회귀 방어', async () => {
    // maskEmail 은 앞 2자와 길이만 남기므로 두 주소가 같은 'ho*****@example.com' 이 된다.
    getSession.mockResolvedValue({ id: 'u-9', email: 'hong.gs@example.com' })
    makeAdmin({ invite: { data: { ...INVITE, email: 'hong.gd@example.com' }, error: null } })
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: true, emailMatches: false })
  })

  it('세션에 이메일이 없으면 일치로 보지 않는다', async () => {
    getSession.mockResolvedValue({ id: 'u-1', email: null })
    makeAdmin({ invite: { data: { ...INVITE, email: '' }, error: null } })
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: true, authed: true, emailMatches: false })
  })

  it('초대 조회 실패는 미존재와 구분한다', async () => {
    getSession.mockResolvedValue(USER)
    makeAdmin({ invite: { data: null, error: { message: 'boom' } } })
    const spy = silenceConsole()
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    makeAdmin({ invite: { data: null, error: null } })
    expect(await getInviteSessionState(TOKEN))
      .toEqual({ ok: false, error: '초대를 찾을 수 없습니다.' })
  })
})
