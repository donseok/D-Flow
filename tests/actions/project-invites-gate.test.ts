import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// authz 가드 · admin 클라이언트 · next/cache 3중 모킹(tests/actions/accounts-gate.test.ts 관례).
// vi.mock 팩토리는 최상단으로 호이스팅되므로 스파이는 vi.hoisted 로 먼저 만든다.
const { createAdminClient, requireProjectAdmin, requireWorkspaceAdmin, getTransport, send, guardThrow } = vi.hoisted(() => {
  const send = vi.fn()
  // 기본 구현은 "여기까지 오면 안 된다"는 함정이다. mockClear 는 구현을 되돌리지 않으므로
  // beforeEach 에서 mockReset 후 이 함정을 다시 깐다 — 안 그러면 앞 테스트의 스텁이 남아
  // 게이트 단언이 조용히 무력화되고, 반대로 함정이 남아 성공 경로가 catch 로 떨어진다.
  const guardThrow = (): never => {
    throw new Error('createAdminClient 는 게이트/입력 검증을 통과하기 전에 호출되면 안 된다')
  }
  return {
    createAdminClient: vi.fn(guardThrow),
    requireProjectAdmin: vi.fn(),
    requireWorkspaceAdmin: vi.fn(),
    getTransport: vi.fn(() => ({ ok: true, send })),
    send,
    guardThrow,
  }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, requireWorkspaceAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))
vi.mock('@/lib/mail/transport', () => ({ getTransport }))
// 팀 마스터는 모듈 로드 시 DB 를 읽는다(캐시 프라이밍). 여기서는 이 프로젝트의 팀 목록만 필요하므로
// 실물을 태우지 않는다 — 태우면 TTL 만료 시점에 createAdminClient 호출 단언이 흔들린다.
vi.mock('@/lib/teams/master', () => ({
  teamsForProjectSync: () => [
    { id: 'team-1', code: 'PMO', sortOrder: 0, active: true, progressVisible: true, projectId: 'p1' },
    { id: 'team-2', code: 'MES', sortOrder: 1, active: true, progressVisible: true, projectId: 'p1' },
    { id: 'team-off', code: 'OLD', sortOrder: 2, active: false, progressVisible: true, projectId: 'p1' },
  ],
}))

import { revalidatePath } from 'next/cache'
import {
  listProjectInvites, createProjectInvite, revokeProjectInvite, type CreateInviteInput,
} from '@/app/actions/projectInvites'
import { hashInviteToken } from '@/lib/domain/inviteToken'
import { roleIn, workspaceAdminVerdict, type Actor } from '@/lib/domain/authz'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { makeActor, makeAdminActor, makeSuperuser, WS } from '../fixtures/actor'

const P1 = 'p1'
const DENIED = { ok: false as const, error: '권한 없음' }
const adminActor = makeAdminActor(P1)

/** 두 가드를 이 액터의 순수 판정(roleIn·workspaceAdminVerdict)에 위임한다 — 실제 가드와 같은 404/403 구분. */
function signedInAs(a: Actor) {
  requireProjectAdmin.mockImplementation(async (pid: string | null) => {
    const r = roleIn(a, pid)
    if (r === null) return { ok: false, error: ERR_MISSING }
    return r === 'superuser' || r === 'admin' ? { ok: true, actor: a } : { ok: false, error: ERR_DENIED }
  })
  requireWorkspaceAdmin.mockImplementation(async (wid: string | null) => {
    const v = workspaceAdminVerdict(a, wid)
    return v === 'ok' ? { ok: true, actor: a } : { ok: false, error: v === 'missing' ? ERR_MISSING : ERR_DENIED }
  })
}
const VALID: CreateInviteInput = { email: 'mina.park@example.com', accessRole: 'member', teamIds: ['team-1'] }

const APP_URL = 'https://dflow.example.com'
const DAY_MS = 24 * 60 * 60 * 1000
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL
const originalDomains = process.env.INVITE_ALLOWED_DOMAINS

beforeEach(() => {
  createAdminClient.mockReset()
  createAdminClient.mockImplementation(guardThrow)
  requireProjectAdmin.mockReset()
  requireWorkspaceAdmin.mockReset()
  getTransport.mockClear()
  send.mockReset()
  eqCalls.length = 0
  vi.mocked(revalidatePath).mockClear()
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
  process.env.INVITE_ALLOWED_DOMAINS = 'example.com'
})

afterEach(() => {
  if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl
  if (originalDomains === undefined) delete process.env.INVITE_ALLOWED_DOMAINS
  else process.env.INVITE_ALLOWED_DOMAINS = originalDomains
})

/** update(...).eq().eq().is().is().select('id') 체인 — 취소 경로가 쓰는 형태 그대로. */
function revokeClient(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    eq: vi.fn(() => chain),
    is: vi.fn(() => chain),
    select: vi.fn(async () => result),
  }
  const update = vi.fn(() => chain)
  return { client: { from: vi.fn(() => ({ update })) }, update, chain }
}

type QueryResult = { data: unknown; error: { code?: string; message: string } | null }

/** PostgREST 빌더 흉내 — 어떤 순서로 체이닝해도 자신을 돌려주고, await 하면 결과를 낸다.
 *  (빌더는 thenable 이므로 .single() 없이 await 하는 호출부도 있다 — 중복 초대 조회가 그렇다.) */
interface Chain {
  select: (...a: unknown[]) => Chain
  eq: (...a: unknown[]) => Chain
  is: (...a: unknown[]) => Chain
  in: (...a: unknown[]) => Chain
  or: (...a: unknown[]) => Chain
  order: (...a: unknown[]) => Chain
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
  then: (res: (v: QueryResult) => unknown, rej?: (e: unknown) => unknown) => Promise<unknown>
}
/** chainOf 가 받은 eq() 인자 — 표별로 쌓인다(T-2: 중복·계정 조회가 정규형 값을 쓰는지 단언). createClient 가 표 이름을 넘긴다. */
const eqCalls: Array<[table: string, column: unknown, value: unknown]> = []
function chainOf(result: QueryResult, table = ''): Chain {
  const chain: Chain = {
    select: () => chain, eq: (col, val) => { eqCalls.push([table, col, val]); return chain }, is: () => chain, in: () => chain, or: () => chain, order: () => chain,
    single: async () => result,
    maybeSingle: async () => result,
    then: (res, rej) => Promise.resolve(result).then(res, rej),
  }
  return chain
}

const INSERTED_ID = 'inv-1'

/** 워크스페이스 설정 행(0012 values 문서) */
const wsRow = (values: Record<string, unknown>) => ({ workspace_id: 'ws-1', values, revision: 1, schema_version: 1 })

/**
 * createProjectInvite 가 훑는 경로 전부를 흉내낸 admin 스텁 —
 * projects 조회 → profiles(계정 유무) → 중복 초대 조회 → insert → 초대자 조회.
 * insert 는 받은 payload 를 그대로 돌려준다(DB 의 returning 과 같은 형태).
 */
function createClient(o: {
  blocking?: Record<string, unknown>[]
  blockingError?: { message: string } | null
  insertError?: { code?: string; message: string } | null
  profile?: QueryResult
  /** workspace_settings 행(허용 도메인) — 기본은 행 있음·값 없음(배포 기본값 env 로). 새 계약에서 행 0건은 fail-closed 다 */
  settings?: QueryResult
} = {}) {
  const insert = vi.fn((payload: Record<string, unknown>) => chainOf({
    data: o.insertError ? null : {
      id: INSERTED_ID, email: payload.email, access_role: payload.access_role, role_label: payload.role_label,
      team_ids: payload.team_ids, created_at: new Date().toISOString(), expires_at: payload.expires_at,
      revoked_at: null, redeemed_at: null,
    },
    error: o.insertError ?? null,
  }))
  // 자동 정리를 걷어냈으므로 중복 검사 경로는 project_invites 를 읽기만 해야 한다.
  const update = vi.fn(() => chainOf({ data: [], error: null }))
  const del = vi.fn(() => chainOf({ data: [], error: null }))
  const settingsEq = vi.fn()

  const from = vi.fn((table: string) => {
    if (table === 'projects') return chainOf({ data: { name: 'Acme Project', workspace_id: 'ws-1' }, error: null })
    if (table === 'profiles') return chainOf(o.profile ?? { data: null, error: null }, 'profiles')
    if (table === 'workspace_settings') {
      const chain = chainOf(o.settings ?? { data: wsRow({}), error: null })
      return { ...chain, select: () => ({ ...chain, eq: (...a: unknown[]) => { settingsEq(...a); return chain } }) }
    }
    if (table === 'project_invites') {
      return {
        ...chainOf({ data: o.blockingError ? null : (o.blocking ?? []), error: o.blockingError ?? null }, 'project_invites'),
        insert, update, delete: del,
      }
    }
    throw new Error('예상치 못한 테이블 접근: ' + table)
  })
  const getUserById = vi.fn(async () => ({
    data: { user: { id: 'u1', email: 'pmo@example.com', user_metadata: { full_name: '초대자' } } },
    error: null,
  }))
  return {
    client: { from, auth: { admin: { getUserById } } },
    from, insert, update, del, settingsEq,
  }
}

/** insert 에 실제로 실린 payload. 성공 경로 단언의 기준점이다. */
function insertedPayload(insert: ReturnType<typeof createClient>['insert']) {
  return insert.mock.calls[0]![0]
}

describe('초대 서버액션 권한 게이트', () => {
  it('프로젝트 관리자가 아니면 listProjectInvites 거부 — admin client 미생성', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await listProjectInvites(P1)
    // 권한 거부를 빈 목록으로 위장하면 '아직 안 보냈구나'로 읽혀 재발급을 유발한다.
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자가 아니면 createProjectInvite 거부 — admin client·메일 모두 미도달', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  // 관리자 초대는 관리자 슬롯을 여는 경로다 — 프로젝트 관리자 가드만으로 열리면 '관리자가 관리자를 늘린다'.
  // 그래서 프로젝트 관리자 가드를 먼저(존재 은닉) 통과한 뒤, 그 프로젝트의 워크스페이스 관리자 가드를 한 번 더 건다.
  it('관리자 권한 초대: 워크스페이스 관리자가 아닌 프로젝트 관리자는 거부 — admin client 미도달', async () => {
    signedInAs(adminActor)
    const res = await createProjectInvite(P1, { ...VALID, accessRole: 'admin' })
    expect(res).toEqual({ ok: false, error: ERR_DENIED })
    expect(requireProjectAdmin).toHaveBeenCalledWith(P1)
    expect(requireWorkspaceAdmin).toHaveBeenCalledWith(WS)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('관리자 권한 초대: 다른 워크스페이스의 관리자는 프로젝트 가드에서 존재 은닉 — 워크스페이스 가드까지 가지 않는다', async () => {
    signedInAs(makeActor({ workspaceRoles: new Map([['ws-b', 'admin']]) }))
    expect(await createProjectInvite(P1, { ...VALID, accessRole: 'admin' })).toEqual({ ok: false, error: ERR_MISSING })
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('관리자 권한 초대: 워크스페이스 멤버(명단 없음)는 프로젝트 가드에서 거부', async () => {
    signedInAs(makeActor({ projectWorkspace: new Map([[P1, WS]]) }))
    expect(await createProjectInvite(P1, { ...VALID, accessRole: 'admin' })).toEqual({ ok: false, error: ERR_DENIED })
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
  })

  it('멤버 권한 초대는 워크스페이스 가드를 부르지 않는다', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    await createProjectInvite(P1, VALID)
    expect(requireWorkspaceAdmin).not.toHaveBeenCalled()
  })

  it('프로젝트 관리자가 아니면 revokeProjectInvite 거부 — admin client 미생성', async () => {
    requireProjectAdmin.mockResolvedValue(DENIED)
    const res = await revokeProjectInvite(P1, 'i1')
    expect(res).toEqual({ ok: false, error: '권한 없음' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('권한 조회 실패도 세 함수 모두 중단한다 — 관대한 폴백 금지', async () => {
    requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await listProjectInvites(P1)).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await createProjectInvite(P1, VALID)).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(await revokeProjectInvite(P1, 'i1')).toEqual({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createProjectInvite 입력 검증 — 저장 전에 막는다', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
  })

  /** 도메인 판정은 워크스페이스 설정을 읽은 뒤다 — 거부되면 계정 유무·중복 조회·insert 에 닿지 않는다. */
  function expectRejectedBeforeWrites(c: ReturnType<typeof createClient>) {
    expect(c.insert).not.toHaveBeenCalled()
    expect(c.from).not.toHaveBeenCalledWith('profiles')
    expect(c.from).not.toHaveBeenCalledWith('project_invites')
  }

  it('사외 도메인은 초대를 만들지 않는다', async () => {
    const c = createClient()
    createAdminClient.mockReturnValue(c.client as never)
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@gmail.com' })
    expect(res).toEqual({ ok: false, error: '허용된 이메일 도메인(@example.com)으로만 초대할 수 있습니다.' })
    expectRejectedBeforeWrites(c)
  })

  // 서브도메인 사칭('example.com.evil.io')이 허용 도메인으로 통과하면 화이트리스트가 무의미하다.
  it('허용 도메인을 접두로 가진 사칭 주소도 거부한다', async () => {
    const c = createClient()
    createAdminClient.mockReturnValue(c.client as never)
    const res = await createProjectInvite(P1, { ...VALID, email: 'a@example.com.evil.io' })
    expect(res).toMatchObject({ ok: false, error: '허용된 이메일 도메인(@example.com)으로만 초대할 수 있습니다.' })
    expectRejectedBeforeWrites(c)
  })

  // 문구를 하드코딩하면 다른 도메인을 설정한 배포에서 관리자가 거짓 안내를 받는다.
  it('거부 문구는 설정된 허용 도메인 목록으로 조립한다', async () => {
    process.env.INVITE_ALLOWED_DOMAINS = 'example.com, corp.co.kr'
    const c = createClient()
    createAdminClient.mockReturnValue(c.client as never)
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@gmail.com' })
    expect(res).toEqual({
      ok: false, error: '허용된 이메일 도메인(@example.com, @corp.co.kr)으로만 초대할 수 있습니다.',
    })
    expectRejectedBeforeWrites(c)
  })

  // SP2 §4.4 — 워크스페이스 설정이 비어 있지 않으면 env 보다 우선한다(넓히든 좁히든)
  it('워크스페이스 허용 도메인이 있으면 그것으로 판정하고 env 는 보지 않는다', async () => {
    const c = createClient({ settings: { data: wsRow({ 'invites.allowed_domains': ['acme.test'] }), error: null } })
    createAdminClient.mockReturnValue(c.client as never)
    expect(await createProjectInvite(P1, VALID)).toEqual({
      ok: false, error: '허용된 이메일 도메인(@acme.test)으로만 초대할 수 있습니다.',
    })
    expect(c.settingsEq).toHaveBeenCalledWith('workspace_id', 'ws-1')
    expectRejectedBeforeWrites(c)

    const c2 = createClient({ settings: { data: wsRow({ 'invites.allowed_domains': ['acme.test'] }), error: null } })
    createAdminClient.mockReturnValue(c2.client as never)
    send.mockResolvedValue({ rejected: [] })
    expect(await createProjectInvite(P1, { ...VALID, email: 'mina@acme.test' })).toMatchObject({ ok: true })
  })

  // 저장값이 parse 를 못 지나면(invalid) 판정 불가 — env 로 넓히지 않고 중단한다(D40·fail-closed).
  it('워크스페이스 허용 도메인이 손상되면 env 로 넓히지 않고 중단한다', async () => {
    const c = createClient({ settings: { data: wsRow({ 'invites.allowed_domains': ['*.acme.test', 'nohost'] }), error: null } })
    createAdminClient.mockReturnValue(c.client as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createProjectInvite(P1, VALID)
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    expectRejectedBeforeWrites(c)
  })

  // 명시 [] 는 '초대 불가'다 — 미설정만 배포 기본값(env)으로 간다(D40)
  it('워크스페이스 허용 도메인이 명시 빈 배열이면 env 가 있어도 초대하지 않고 워크스페이스 설정을 안내한다', async () => {
    const c = createClient({ settings: { data: wsRow({ 'invites.allowed_domains': [] }), error: null } })
    createAdminClient.mockReturnValue(c.client as never)
    expect(await createProjectInvite(P1, VALID)).toEqual({
      ok: false,
      error: '워크스페이스 초대 허용 도메인 설정에 쓸 수 있는 항목이 없어 초대할 수 없습니다. 워크스페이스 관리자에게 설정 확인을 요청하세요.',
    })
    expectRejectedBeforeWrites(c)
  })

  // M-3 — 행 이메일은 local@ASCII 호스트다. 가입(GoTrue, ASCII 전용)·수락(consume RPC 의 문자열 비교)이 이 값으로 성립한다.
  it('한글 도메인 메일은 통과하고, 행·발송 이메일은 퓨니코드 호스트로 저장된다', async () => {
    const c = createClient({ settings: { data: wsRow({ 'invites.allowed_domains': ['xn--bj0bj06e.kr'] }), error: null } })
    createAdminClient.mockReturnValue(c.client as never)
    send.mockResolvedValue({ rejected: [] })
    expect(await createProjectInvite(P1, { ...VALID, email: 'kim@한글.kr' })).toMatchObject({ ok: true, row: { email: 'kim@xn--bj0bj06e.kr' } })
    expect(insertedPayload(c.insert).email).toBe('kim@xn--bj0bj06e.kr')
    expect(send.mock.calls[0]![0].to).toEqual(['kim@xn--bj0bj06e.kr'])
    // T-2 — 계정 유무(profiles)·중복 초대(project_invites) 조회도 같은 정규형 값으로
    expect(eqCalls).toContainEqual(['profiles', 'email', 'kim@xn--bj0bj06e.kr'])
    expect(eqCalls).toContainEqual(['project_invites', 'email', 'kim@xn--bj0bj06e.kr'])
    expect(eqCalls.filter(([, col]) => col === 'email').every(([, , v]) => v === 'kim@xn--bj0bj06e.kr')).toBe(true)
  })

  it('끝 점 하나가 붙은 주소는 정규형(끝 점 없음)으로 저장·발송한다', async () => {
    const c = createClient()
    createAdminClient.mockReturnValue(c.client as never)
    send.mockResolvedValue({ rejected: [] })
    expect(await createProjectInvite(P1, { ...VALID, email: 'alice@example.com.' })).toMatchObject({ ok: true })
    expect(insertedPayload(c.insert).email).toBe('alice@example.com')
    expect(send.mock.calls[0]![0].to).toEqual(['alice@example.com'])
  })

  it('워크스페이스 설정 행이 없으면(새 계약의 0건) env 로 폴백하지 않고 중단한다', async () => {
    const c = createClient({ settings: { data: null, error: null } })
    createAdminClient.mockReturnValue(c.client as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await createProjectInvite(P1, VALID)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expectRejectedBeforeWrites(c)
  })

  it('워크스페이스 설정 조회가 실패하면 env 로 폴백하지 않고 발급을 중단한다(fail-closed)', async () => {
    const c = createClient({ settings: { data: null, error: { message: 'boom' } } })
    createAdminClient.mockReturnValue(c.client as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await createProjectInvite(P1, VALID)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
    expectRejectedBeforeWrites(c)
  })

  // 워크스페이스 값도 env 도 없으면 제품 기본값 [] — 고칠 곳 둘을 모두 안내한다
  const FAIL_CLOSED_MSG = '초대 허용 도메인이 없어 초대할 수 없습니다. 워크스페이스 설정에서 허용 도메인을 정하거나 운영자에게 INVITE_ALLOWED_DOMAINS 설정을 요청하세요.'
  // env 가 있는데 쓸 항목이 없으면(공백·쉼표뿐 → 빈 목록) 배포 기본값이 [] 로 잡힌다 — env 를 가리킨다
  const ENV_EMPTY_MSG = '초대 허용 도메인이 설정되지 않아 초대할 수 없습니다. 운영자에게 INVITE_ALLOWED_DOMAINS 설정을 요청하세요.'
  it.each([
    ['미설정', undefined, FAIL_CLOSED_MSG],
    ['빈 문자열', '', FAIL_CLOSED_MSG],
    ['공백·쉼표뿐', '  , ', ENV_EMPTY_MSG],
  ])('환경변수가 %s 이면 어떤 주소도 초대하지 않고 설정을 안내한다(fail-closed)', async (_label, value, msg) => {
    if (value === undefined) delete process.env.INVITE_ALLOWED_DOMAINS
    else process.env.INVITE_ALLOWED_DOMAINS = value
    const c = createClient()
    createAdminClient.mockReturnValue(c.client as never)
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@example.com' })
    expect(res).toEqual({ ok: false, error: msg })
    expectRejectedBeforeWrites(c)
  })

  it("환경변수가 '*' 면 임의 도메인을 허용하지만 이메일 형식 검사는 그대로 적용한다", async () => {
    process.env.INVITE_ALLOWED_DOMAINS = '*'
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await createProjectInvite(P1, { ...VALID, email: 'someone@gmail.com' })
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert).email).toBe('someone@gmail.com')

    createAdminClient.mockClear()
    const bad = await createProjectInvite(P1, { ...VALID, email: 'broken-email' })
    expect(bad).toEqual({ ok: false, error: '이메일 형식을 확인해 주세요.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('대문자·공백이 섞인 허용 도메인 주소는 정규화 후 도메인 검사를 통과한다', async () => {
    // 정규화가 도메인 검사보다 먼저 일어나는지 — 그리고 저장되는 값도 정규화된 것인지 확인한다.
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    send.mockResolvedValue({ rejected: [] })
    const res = await createProjectInvite(P1, { ...VALID, email: '  MINA.PARK@Example.com ' })
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert).email).toBe('mina.park@example.com')
  })

  // F3A-2 — 로컬 파트의 specials 는 메일 발송기가 다른 수신자로 다시 읽는다('bob>,<victim@acme.test' → victim)
  it.each(['bob>,<victim@example.com', 'a,b@example.com', 'x<evil.example>y@example.com'])('로컬 파트에 specials 가 있는 %s 는 DB 전에 거부한다', async (email) => {
    const res = await createProjectInvite(P1, { ...VALID, email })
    expect(res).toEqual({ ok: false, error: '이메일 형식을 확인해 주세요.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('이메일 형식이 깨지면 거부한다', async () => {
    const res = await createProjectInvite(P1, { ...VALID, email: 'broken-email' })
    expect(res).toEqual({ ok: false, error: '이메일 형식을 확인해 주세요.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  // 팀 id 는 이 프로젝트에서 고를 수 있는 활성 팀만 — 다른 프로젝트·워크스페이스의 팀을 명단에 심을 수 없다.
  it('이 프로젝트의 활성 팀이 아닌 id 는 거부한다', async () => {
    for (const teamIds of [['team-other'], ['team-1', 'team-off'], 'team-1' as never]) {
      const res = await createProjectInvite(P1, { ...VALID, teamIds })
      expect(res).toEqual({ ok: false, error: '알 수 없는 팀입니다.' })
    }
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('알 수 없는 권한 값은 거부한다', async () => {
    const res = await createProjectInvite(P1, { ...VALID, accessRole: 'owner' as never })
    expect(res).toEqual({ ok: false, error: '알 수 없는 권한입니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it('유효기간이 범위를 벗어나면 거부한다(0·31·비정수)', async () => {
    for (const days of [0, 31, 7.5, -1]) {
      createAdminClient.mockClear()
      const res = await createProjectInvite(P1, { ...VALID, days })
      expect(res).toEqual({ ok: false, error: '유효기간은 1~30일 사이여야 합니다.' })
      expect(createAdminClient).not.toHaveBeenCalled()
    }
  })

  it('유효기간 미지정은 기본값(7일)으로 통과한다 — 경계(1·30)도 통과', async () => {
    for (const [days, expected] of [[undefined, 7], [1, 1], [30, 30]] as const) {
      const { client, insert } = createClient()
      createAdminClient.mockReturnValue(client as never)
      send.mockResolvedValue({ rejected: [] })
      const t0 = Date.now()
      const res = await createProjectInvite(P1, { ...VALID, days })
      expect(res).toMatchObject({ ok: true })
      // 통과 여부만 보면 '검증을 통과했다'와 '저장까지 됐다'가 구분되지 않는다 — 실제 만료 시각을 본다.
      const delta = new Date(String(insertedPayload(insert).expires_at)).getTime() - t0
      expect(delta).toBeGreaterThan(expected * DAY_MS - 5000)
      expect(delta).toBeLessThan(expected * DAY_MS + 5000)
    }
  })

  // 틀린 origin 의 링크는 발송되고 나면 회수할 수 없다 — 만들지 않는 편이 낫다(fail-closed).
  it('NEXT_PUBLIC_APP_URL 이 없으면 초대를 만들지 않는다', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
    expect(getTransport).not.toHaveBeenCalled()
  })

  it('공백뿐인 NEXT_PUBLIC_APP_URL 도 미설정으로 본다', async () => {
    process.env.NEXT_PUBLIC_APP_URL = '   '
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '앱 주소가 설정되지 않아 초대 링크를 만들 수 없습니다.' })
    expect(createAdminClient).not.toHaveBeenCalled()
  })
})

describe('createProjectInvite 성공 경로 — 저장·링크·메일', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
    send.mockResolvedValue({ rejected: [] })
  })

  it('정상 발급: DB 에는 토큰 해시만 — 링크의 토큰을 해시하면 저장된 값과 같다', async () => {
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)

    const res = await createProjectInvite(P1, { ...VALID, roleLabel: '  개발 ', teamIds: ['team-2', 'team-1'] })
    expect(res).toMatchObject({ ok: true, mailed: true })

    expect(insert).toHaveBeenCalledTimes(1)
    const payload = insertedPayload(insert)
    expect(payload).toEqual({
      project_id: P1,
      workspace_id: 'ws-1',
      email: 'mina.park@example.com',
      access_role: 'member',
      role_label: '개발',
      team_ids: ['team-2', 'team-1'],
      token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      created_by: adminActor.userId,
      expires_at: expect.any(String),
    })
    // 평문 토큰은 어디에도 저장하지 않는다 — 링크(응답)에서만 산다.
    expect(payload).not.toHaveProperty('token')
    if (!res.ok) throw new Error('발급이 실패했다')
    const token = res.url.slice(`${APP_URL}/invite/`.length)
    expect(res.url.startsWith(`${APP_URL}/invite/`)).toBe(true)
    expect(hashInviteToken(token)).toBe(payload.token_hash)
    // 발급 응답의 행에만 링크가 있다(링크는 발급 시 한 번만 표시된다).
    expect(res.row.url).toBe(res.url)
    expect(res.row.teamCodes).toEqual(['MES', 'PMO'])
    expect(send).toHaveBeenCalledTimes(1)
    // 메일에는 팀 코드 대신 팀 이름 목록이 실린다(팀 이름은 코드와 동기).
    expect(send.mock.calls[0]![0].text).toContain('팀: MES, PMO')
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/members`)
  })

  it('팀을 고르지 않으면 team_ids 는 null — 합류해도 팀을 건드리지 않는다', async () => {
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, { ...VALID, teamIds: [] })
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert).team_ids).toBeNull()
    expect(send.mock.calls[0]![0].text).not.toContain('팀:')
  })

  it('그 워크스페이스의 관리자는 관리자 권한 초대를 발급한다', async () => {
    signedInAs(makeActor({ userId: 'u-wsa', workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[P1, WS]]) }))
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, { ...VALID, accessRole: 'admin' })
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert)).toMatchObject({ access_role: 'admin', created_by: 'u-wsa' })
  })

  it('슈퍼유저는 관리자 권한 초대를 발급한다', async () => {
    signedInAs(makeSuperuser({ userId: 'u-su', projectWorkspace: new Map([[P1, WS]]) }))
    const { client, insert } = createClient()
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, { ...VALID, accessRole: 'admin' })
    expect(res).toMatchObject({ ok: true })
    expect(insertedPayload(insert)).toMatchObject({ access_role: 'admin', created_by: 'u-su' })
  })

  // 트리거(project_invites_guard)가 발급자의 등급을 다시 본다 — 가드와 DB 가 엇갈리면 DB 판정을 사용자 문구로.
  it('트리거의 관리자 초대 거부는 사용자 문구로 바꾼다', async () => {
    signedInAs(makeSuperuser({ userId: 'u-su', projectWorkspace: new Map([[P1, WS]]) }))
    const { client } = createClient({ insertError: { code: '42501', message: 'PROJECT_INVITE_ADMIN_FORBIDDEN' } })
    createAdminClient.mockReturnValue(client as never)
    expect(await createProjectInvite(P1, { ...VALID, accessRole: 'admin' }))
      .toEqual({ ok: false, error: '관리자 권한 초대는 워크스페이스 관리자만 발급할 수 있습니다.' })
    expect(send).not.toHaveBeenCalled()
  })

  // 토큰은 초대 링크 그 자체다. UI 가 읽지도 않는 필드로 원본 토큰이 RSC 페이로드에 실려 브라우저까지 가면
  // 목록을 볼 수 있는 사람이 곧 전부의 열쇠를 갖는다 — 해시도 싣지 않는다(DB 조회 키다).
  it('반환 행에 토큰·해시를 싣지 않는다', async () => {
    const { client } = createClient()
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(Object.keys(res.row).sort()).toEqual(
      ['accessRole', 'createdAt', 'email', 'expiresAt', 'id', 'redeemedAt', 'roleLabel', 'status', 'teamCodes', 'url'],
    )
  })

  it('이미 계정이 있는 주소면 alreadyAccount — profiles 단건 조회', async () => {
    const { client, from } = createClient({ profile: { data: { user_id: 'u-9' }, error: null } })
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toMatchObject({ ok: true, alreadyAccount: true })
    expect(from).toHaveBeenCalledWith('profiles')
  })

  it('계정 유무 확인이 실패하면 null — 발급은 막지 않되 지어내지 않는다', async () => {
    const { client } = createClient({ profile: { data: null, error: { message: 'boom' } } })
    createAdminClient.mockReturnValue(client as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createProjectInvite(P1, VALID)
    spy.mockRestore()
    expect(res).toMatchObject({ ok: true, alreadyAccount: null })
  })

  it('활성 초대가 있으면 insert 에 닿지 않고 거부한다', async () => {
    const { client, insert } = createClient({
      blocking: [{
        id: 'i0', expires_at: new Date(Date.now() + DAY_MS).toISOString(),
        revoked_at: null, redeemed_at: null,
      }],
    })
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '이 주소로 발급한 초대가 아직 유효합니다. 취소 후 다시 보내세요.' })
    expect(insert).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  // 만료분을 자동 소프트 취소하면 아무도 취소하지 않은 초대가 '취소됨'으로 남아
  // 소프트 취소를 감사 근거로 삼은 설계(P5)가 무너진다 — 관리자가 직접 취소하게 한다.
  it('만료된 초대가 남아 있으면 자동 취소하지 않고 안내한다', async () => {
    const { client, insert, update, del } = createClient({
      blocking: [{
        id: 'i0', expires_at: new Date(Date.now() - DAY_MS).toISOString(),
        revoked_at: null, redeemed_at: null,
      }],
    })
    createAdminClient.mockReturnValue(client as never)
    const res = await createProjectInvite(P1, VALID)
    expect(res).toEqual({ ok: false, error: '이 주소로 발급한 초대가 남아 있습니다. 목록에서 취소한 뒤 다시 보내세요.' })
    expect(update).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  // 메일이 실패해도 링크는 이미 유효하다. 행을 지우면 관리자에게는 '아무 일도 없었다'로 보이지만
  // SMTP 는 부분 성공을 내므로 메일이 이미 나갔을 수도 있다.
  it('메일 발송이 실패해도 초대는 살아 있다 — ok:true, mailed:false', async () => {
    const { client, insert, update, del } = createClient()
    createAdminClient.mockReturnValue(client as never)
    send.mockRejectedValue(new Error('smtp down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await createProjectInvite(P1, VALID)
    spy.mockRestore()

    expect(res).toMatchObject({ ok: true, mailed: false, mailError: '메일 발송 중 오류가 발생했습니다.' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    if (!res.ok) throw new Error('발급이 실패했다')
    expect(res.row.id).toBe(INSERTED_ID)
    expect(res.url).toContain('/invite/')
  })
})

describe('listProjectInvites — 목록에는 링크가 없다(해시만 저장)', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
  })

  function listClient(invites: QueryResult, teams: QueryResult = { data: [], error: null }) {
    const from = vi.fn((t: string) => {
      if (t === 'project_invites') return chainOf(invites)
      if (t === 'teams') return chainOf(teams)
      throw new Error('예상치 못한 테이블 접근: ' + t)
    })
    createAdminClient.mockReturnValue({ from } as never)
    return from
  }

  const ROW = {
    id: 'i1', email: 'mina.park@example.com', access_role: 'member', role_label: 'PM', team_ids: ['team-2', 'team-1'],
    created_at: '2026-09-20T00:00:00Z', expires_at: '2999-01-01T00:00:00Z', revoked_at: null, redeemed_at: null,
  }

  it('팀 id 를 코드로 풀고(순서 유지) url 은 항상 null', async () => {
    listClient({ data: [ROW], error: null }, { data: [{ id: 'team-1', code: 'PMO' }, { id: 'team-2', code: 'MES' }], error: null })
    const res = await listProjectInvites(P1)
    expect(res).toEqual({
      ok: true,
      rows: [{
        id: 'i1', email: 'mina.park@example.com', accessRole: 'member', roleLabel: 'PM', teamCodes: ['MES', 'PMO'],
        status: 'active', expiresAt: '2999-01-01T00:00:00Z', createdAt: '2026-09-20T00:00:00Z', redeemedAt: null, url: null,
      }],
    })
  })

  it('팀 조회가 실패하면 목록 전체를 실패로 — 팀이 빈 초대로 위장하지 않는다', async () => {
    listClient({ data: [ROW], error: null }, { data: null, error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listProjectInvites(P1)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
  })

  it('초대 조회 실패는 빈 목록이 아니다', async () => {
    listClient({ data: null, error: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await listProjectInvites(P1)).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    spy.mockRestore()
  })
})

describe('revokeProjectInvite — 소프트 취소', () => {
  beforeEach(() => {
    requireProjectAdmin.mockResolvedValue({ ok: true, actor: adminActor })
  })

  it('영향 행이 0이면 실패로 보고한다 — 조용한 no-op 을 성공으로 위장하지 않는다', async () => {
    const { client, chain } = revokeClient({ data: [], error: null })
    createAdminClient.mockReturnValue(client as never)
    const res = await revokeProjectInvite(P1, 'i1')
    expect(res).toEqual({ ok: false, error: '취소할 수 있는 초대가 아닙니다.' })
    // .select('id') 없이는 0행과 1행이 구분되지 않는다.
    expect(chain.select).toHaveBeenCalledWith('id')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('행을 지우지 않고 revoked_at 만 채운다 — 합류 이력 보존', async () => {
    const { client, update, chain } = revokeClient({ data: [{ id: 'i1' }], error: null })
    createAdminClient.mockReturnValue(client as never)
    const res = await revokeProjectInvite(P1, 'i1')
    expect(res).toEqual({ ok: true })
    expect(update).toHaveBeenCalledWith({ revoked_at: expect.any(String) })
    // 이미 합류·이미 취소된 초대는 대상이 아니다(is(...) 두 번) + 타 프로젝트 차단(eq 두 번).
    expect(chain.is).toHaveBeenCalledWith('redeemed_at', null)
    expect(chain.is).toHaveBeenCalledWith('revoked_at', null)
    expect(chain.eq).toHaveBeenCalledWith('project_id', P1)
    expect(revalidatePath).toHaveBeenCalledWith(`/p/${P1}/members`)
  })

  // 만료분이 부분 유니크를 막고 있으므로, 만료 초대를 취소할 수 없으면 같은 주소로 다시 보낼
  // 길이 영영 없다(발급 경로는 더 이상 자동으로 치워주지 않는다).
  it('만료된 초대도 취소 대상이다 — expires_at 조건을 걸지 않는다', async () => {
    const { client, chain } = revokeClient({ data: [{ id: 'i1' }], error: null })
    createAdminClient.mockReturnValue(client as never)
    expect(await revokeProjectInvite(P1, 'i1')).toEqual({ ok: true })
    // 좁히는 조건은 넷뿐 — id·project_id(eq) + 미합류·미취소(is). 만료 여부는 보지 않는다.
    expect(chain.eq).toHaveBeenCalledTimes(2)
    expect(chain.is).toHaveBeenCalledTimes(2)
  })

  it('취소 쿼리가 실패하면 원시 메시지를 노출하지 않고 중단한다', async () => {
    const { client } = revokeClient({ data: null, error: { message: 'permission denied for table project_invites' } })
    createAdminClient.mockReturnValue(client as never)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await revokeProjectInvite(P1, 'i1')
    spy.mockRestore()
    expect(res).toEqual({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
  })
})
