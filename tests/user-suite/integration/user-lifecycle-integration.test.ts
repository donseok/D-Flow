import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  requireSuperuser: vi.fn(),
  requireWorkspaceAdmin: vi.fn(),
  requireProjectMember: vi.fn(),
  requireProjectAdmin: vi.fn(),
  getActor: vi.fn(),
  getSession: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/authz', () => ({
  requireSuperuser: mocks.requireSuperuser,
  requireWorkspaceAdmin: mocks.requireWorkspaceAdmin,
  requireProjectMember: mocks.requireProjectMember,
  requireProjectAdmin: mocks.requireProjectAdmin,
  getActor: mocks.getActor,
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))

import {
  createAccount,
  bulkCreateAccounts,
  setPlatformAdmin,
  setWorkspaceRole,
  type AccountInput,
} from '@/app/actions/accounts'
import { saveUiPrefs } from '@/app/actions/preferences'
import { makeActor, makeSuperuser } from '../../fixtures/actor'
import { ERR_DENIED } from '@/lib/authz/errors'

type Result = { data?: unknown; error: { code?: string; message: string } | null; count?: number | null }

function createMockChain(result: Result) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'range', 'delete', 'update', 'insert', 'upsert']) {
    c[m] = vi.fn(() => c)
  }
  c.maybeSingle = vi.fn(async () => result)
  c.single = vi.fn(async () => result)
  c.then = (res: (v: Result) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c as Record<string, Mock<(...args: unknown[]) => unknown>> & PromiseLike<Result>
}

describe('사용자 생애주기 통합 테스트 슈트 (User Lifecycle Integration Tests)', () => {
  const PID = '22222222-2222-4222-8222-222222222222'
  const WS_ID = '11111111-1111-4111-8111-111111111111'
  const ADMIN_USER_ID = 'u-admin'
  const TARGET_USER_ID = 'u-target-123'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  describe('1. 신규 사용자 계정 등록 (createAccount)', () => {
    it('워크스페이스 관리자가 신규 유저 생성 시 계정, 프로필, 멤버십, 인물 연동 및 프로젝트 명단 등록이 순차적으로 완료된다', async () => {
      const adminActor = makeActor({
        userId: ADMIN_USER_ID,
        workspaceRoles: new Map([[WS_ID, 'admin']]),
        projectWorkspace: new Map([[PID, WS_ID]]),
      })

      mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: adminActor })
      mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: adminActor })

      const createUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: TARGET_USER_ID } },
        error: null,
      })

      const profileInsertMock = createMockChain({ error: null })
      const wsMemberUpsertMock = createMockChain({ error: null })
      const peopleFindMock = createMockChain({ data: null, error: null }) // 기존 인물 없음
      const peopleInsertMock = createMockChain({ data: { id: 'pe-new' }, error: null })
      const rpcMock = vi.fn().mockResolvedValue({ data: { ok: true }, error: null })

      const adminClientMock = {
        auth: { admin: { createUser: createUserMock } },
        from: vi.fn((table: string) => {
          if (table === 'profiles') return profileInsertMock
          if (table === 'workspace_members') return wsMemberUpsertMock
          if (table === 'people') {
            return {
              ...peopleFindMock,
              insert: () => peopleInsertMock,
            }
          }
          if (table === 'project_members') return createMockChain({ data: null, error: null })
          return createMockChain({ error: null })
        }),
        rpc: rpcMock,
      }

      mocks.createAdminClient.mockReturnValue(adminClientMock)

      const input: AccountInput & { workspaceId: string } = {
        workspaceId: WS_ID,
        email: 'newuser@example.com',
        password: 'securePassword123!',
        name: '신규유저',
        workspaceRole: 'member',
        projectId: PID,
        accessRole: 'member',
      }

      const res = await createAccount(input)

      expect(res.ok).toBe(true)
      expect(createUserMock).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'newuser@example.com', email_confirm: true }),
      )
      expect(adminClientMock.from).toHaveBeenCalledWith('profiles')
      expect(adminClientMock.from).toHaveBeenCalledWith('workspace_members')
      expect(adminClientMock.from).toHaveBeenCalledWith('people')
      expect(rpcMock).toHaveBeenCalledWith('upsert_project_member_cmd', expect.any(Object))
    })

    it('워크스페이스 관리자가 아닌 일반 사용자의 계정 생성 시도는 차단된다', async () => {
      mocks.requireWorkspaceAdmin.mockResolvedValue({
        ok: false,
        error: ERR_DENIED,
      })

      const input: AccountInput & { workspaceId: string } = {
        workspaceId: WS_ID,
        email: 'test@example.com',
        password: 'password123',
        name: '해커',
        workspaceRole: 'admin',
      }

      const res = await createAccount(input)
      expect(res.ok).toBe(false)
      expect(res.error).toBe(ERR_DENIED)
      expect(mocks.createAdminClient).not.toHaveBeenCalled()
    })

    it('이미 다른 계정에 연결된 인물(people)과 이메일이 겹칠 경우 등록이 거부된다', async () => {
      const adminActor = makeActor({
        userId: ADMIN_USER_ID,
        workspaceRoles: new Map([[WS_ID, 'admin']]),
      })
      mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: adminActor })

      const createUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: TARGET_USER_ID } },
        error: null,
      })
      const deleteUserMock = vi.fn().mockResolvedValue({ error: null })

      const peopleFindMock = createMockChain({
        data: { id: 'pe-existing', user_id: 'other-user-uuid', active: true },
        error: null,
      })

      const adminClientMock = {
        auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
        from: vi.fn((table: string) => {
          if (table === 'people') return peopleFindMock
          return createMockChain({ error: null })
        }),
      }

      mocks.createAdminClient.mockReturnValue(adminClientMock)

      const input: AccountInput & { workspaceId: string } = {
        workspaceId: WS_ID,
        email: 'linked@example.com',
        password: 'password123',
        name: '중복자',
        workspaceRole: 'member',
      }

      const res = await createAccount(input)
      expect(res.ok).toBe(false)
      expect(res.error).toBe('이미 다른 계정에 연결된 사람입니다.')
      expect(deleteUserMock).toHaveBeenCalledWith(TARGET_USER_ID) // 롤백 삭제 확인
    })

    it('비활성화(active: false)된 인물과 이메일이 겹칠 경우 명단 재활성화 안내 에러를 반환한다', async () => {
      const adminActor = makeActor({
        userId: ADMIN_USER_ID,
        workspaceRoles: new Map([[WS_ID, 'admin']]),
      })
      mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: adminActor })

      const createUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: TARGET_USER_ID } },
        error: null,
      })
      const deleteUserMock = vi.fn().mockResolvedValue({ error: null })

      const peopleFindMock = createMockChain({
        data: { id: 'pe-inactive', user_id: null, active: false },
        error: null,
      })

      const adminClientMock = {
        auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
        from: vi.fn((table: string) => {
          if (table === 'people') return peopleFindMock
          return createMockChain({ error: null })
        }),
      }

      mocks.createAdminClient.mockReturnValue(adminClientMock)

      const input: AccountInput & { workspaceId: string } = {
        workspaceId: WS_ID,
        email: 'inactive@example.com',
        password: 'password123',
        name: '비활성자',
        workspaceRole: 'member',
      }

      const res = await createAccount(input)
      expect(res.ok).toBe(false)
      expect(res.error).toContain('이 인원(또는 명단 행)이 비활성 상태입니다')
      expect(deleteUserMock).toHaveBeenCalledWith(TARGET_USER_ID)
    })
  })

  describe('2. 일괄 계정 등록 (bulkCreateAccounts)', () => {
    it('유효한 계정과 잘못된 형식의 계정이 혼합된 일괄 입력을 라인별로 정밀하게 처리한다', async () => {
      const adminActor = makeActor({
        userId: ADMIN_USER_ID,
        workspaceRoles: new Map([[WS_ID, 'admin']]),
        projectWorkspace: new Map([[PID, WS_ID]]),
      })
      mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: adminActor })

      const createUserMock = vi.fn().mockResolvedValue({
        data: { user: { id: 'u-created' } },
        error: null,
      })
      const deleteUserMock = vi.fn().mockResolvedValue({ error: null })

      const peopleInsertMock = createMockChain({ data: { id: 'pe-created' }, error: null })

      const adminClientMock = {
        auth: { admin: { createUser: createUserMock, deleteUser: deleteUserMock } },
        from: vi.fn((table: string) => {
          if (table === 'people') {
            return {
              ...createMockChain({ data: null, error: null }),
              insert: () => peopleInsertMock,
            }
          }
          return createMockChain({ data: null, error: null })
        }),
        rpc: vi.fn().mockResolvedValue({ data: { status: 'applied', matched: 1 }, error: null }),
      }
      mocks.createAdminClient.mockReturnValue(adminClientMock)

      const bulkText = [
        'valid1@example.com, member, password123, 유저1',
        'invalid-email, member, password123, 유저2', // 이메일 오류
        'valid2@example.com, member, short, 유저3', // 비번 길이 오류
      ].join('\n')

      const response = await bulkCreateAccounts(WS_ID, bulkText, PID)

      expect(response.ok).toBe(true)
      const results = response.results
      expect(results).toHaveLength(3)

      expect(results[0]).toMatchObject({
        lineNo: 1,
        email: 'valid1@example.com',
        ok: true,
      })

      expect(results[1]).toMatchObject({
        lineNo: 2,
        email: 'invalid-email',
        ok: false,
        error: expect.stringContaining('이메일 형식 오류'),
      })

      expect(results[2]).toMatchObject({
        lineNo: 3,
        email: 'valid2@example.com',
        ok: false,
        error: expect.stringContaining('비밀번호는 8자 이상'),
      })
    })
  })

  describe('3. 플랫폼 관리자 및 워크스페이스 역할 제어 (setPlatformAdmin & setWorkspaceRole)', () => {
    it('슈퍼유저는 타 계정의 플랫폼 관리자 여부를 변경할 수 있다', async () => {
      const suActor = makeSuperuser({ userId: 'u-su' })
      mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: suActor })

      const adminClientMock = {
        from: vi.fn(() => createMockChain({ error: null })),
        rpc: vi.fn().mockResolvedValue({
          data: { status: 'applied', matched: 1 },
          error: null,
        }),
      }
      mocks.createAdminClient.mockReturnValue(adminClientMock)

      const res = await setPlatformAdmin('u-other', true)
      expect(res.ok).toBe(true)
      expect(adminClientMock.rpc).toHaveBeenCalledWith(
        'set_platform_admin',
        expect.objectContaining({ p_target: 'u-other', p_grant: true }),
      )
    })

    it('본인의 플랫폼 관리자 권한을 자가 해제하려는 시도는 안전하게 방어된다', async () => {
      const suActor = makeSuperuser({ userId: 'u-su' })
      mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: suActor })

      const res = await setPlatformAdmin('u-su', false)
      expect(res.ok).toBe(false)
      expect(res.error).toBe('본인의 플랫폼 관리자 권한은 스스로 해제할 수 없습니다. 다른 슈퍼유저에게 요청하세요.')
      expect(mocks.createAdminClient).not.toHaveBeenCalled()
    })

    it('워크스페이스 관리자는 워크스페이스 멤버의 역할을 변경할 수 있다', async () => {
      const adminActor = makeActor({
        userId: ADMIN_USER_ID,
        workspaceRoles: new Map([[WS_ID, 'admin']]),
      })
      mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: adminActor })

      const adminClientMock = {
        from: vi.fn(() => createMockChain({ error: null })),
        rpc: vi.fn().mockResolvedValue({
          data: { status: 'applied', matched: 1 },
          error: null,
        }),
      }
      mocks.createAdminClient.mockReturnValue(adminClientMock)

      const res = await setWorkspaceRole(WS_ID, 'u-member', 'admin')
      expect(res.ok).toBe(true)
      expect(adminClientMock.rpc).toHaveBeenCalledWith(
        'set_workspace_role',
        expect.objectContaining({ p_target: 'u-member', p_role: 'admin' }),
      )
    })
  })

  describe('4. 사용자 선호도 저장 및 멀티테넌트 격리 (saveUiPrefs & Multi-tenant Isolation)', () => {
    it('로그인 사용자는 본인의 계정 선호도를 account_preferences에 정상 저장한다', async () => {
      mocks.getSession.mockResolvedValue({ id: 'u-user' })

      const selectMock = createMockChain({ data: { prefs: { locale: 'ko' } }, error: null })

      const serverClientMock = {
        from: vi.fn((table: string) => {
          if (table === 'account_preferences') {
            return {
              ...selectMock,
              upsert: vi.fn().mockResolvedValue({ error: null }),
            }
          }
          return createMockChain({ error: null })
        }),
      }
      mocks.createServerClient.mockResolvedValue(serverClientMock)

      const res = await saveUiPrefs({ projectsView: 'cards', sidebarCollapsed: true })
      expect(res.ok).toBe(true)
      expect(serverClientMock.from).toHaveBeenCalledWith('account_preferences')
    })

    it('소속되지 않은 다른 워크스페이스에 설정을 저장하려 할 경우 격리 보호로 거부된다', async () => {
      const OTHER_WS_ID = '33333333-3333-4333-8333-333333333333'
      mocks.getSession.mockResolvedValue({ id: 'u-user' })

      // 사용자는 WS_ID에만 소속되어 있음
      const actor = makeActor({
        userId: 'u-user',
        workspaceRoles: new Map([[WS_ID, 'member']]),
      })
      mocks.getActor.mockResolvedValue(actor)

      const serverClientMock = {
        from: vi.fn(() => createMockChain({ error: null })),
      }
      mocks.createServerClient.mockResolvedValue(serverClientMock)

      // OTHER_WS_ID에 대한 설정 저장 시도
      const res = await saveUiPrefs(
        { startPage: 'projects' },
        { workspaceId: OTHER_WS_ID },
      )

      expect(res.ok).toBe(false)
      // 타 워크스페이스에 대한 쓰기가 수행되지 않아야 함
      expect(serverClientMock.from).not.toHaveBeenCalled()
    })
  })
})
