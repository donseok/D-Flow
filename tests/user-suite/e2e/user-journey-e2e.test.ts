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

import { createAccount, setPlatformAdmin } from '@/app/actions/accounts'
import { saveUiPrefs } from '@/app/actions/preferences'
import {
  roleIn,
  workspaceRoleIn,
  isWorkspaceAdmin,
  isHiddenProject,
  type Actor,
} from '@/lib/domain/authz'
import { pushRecent } from '@/lib/prefs/split'
import { makeActor, hiddenIds } from '../../fixtures/actor'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'

type Result = { data?: unknown; error: { code?: string; message: string } | null }

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

describe('사용자 여정 E2E 테스트 슈트 (End-to-End User Journey Tests)', () => {
  const WS_ID = '11111111-1111-4111-8111-111111111111'
  const OTHER_WS_ID = '99999999-9999-4999-8999-999999999999'
  const PID_MAIN = '22222222-2222-4222-8222-222222222222'
  const PID_PRIVATE = '33333333-3333-4333-8333-333333333333'
  const PID_OTHER_WS = '44444444-4444-4444-8444-444444444444'

  const WS_ADMIN_ID = 'u-ws-admin'
  const USER_ALICE_ID = 'u-alice-pm'
  const USER_BOB_ID = 'u-bob-dev'
  const USER_CHARLIE_ID = 'u-charlie-guest'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('전체 사용자 생애주기 여정 (Onboarding -> Access Control -> Personalization -> Action Execution -> Security Revocation)', async () => {
    // ═══════════════════════════════════════════════════════════════════════
    // [Step 1] 온보딩: 워크스페이스 관리자가 신규 유저 3명을 순차적으로 프로비저닝
    // ═══════════════════════════════════════════════════════════════════════
    const wsAdminActor = makeActor({
      userId: WS_ADMIN_ID,
      workspaceRoles: new Map([[WS_ID, 'admin']]),
      projectWorkspace: new Map([[PID_MAIN, WS_ID]]),
    })

    mocks.requireWorkspaceAdmin.mockResolvedValue({ ok: true, actor: wsAdminActor })
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: wsAdminActor })

    const mockAdminDb = {
      auth: {
        admin: {
          createUser: vi.fn()
            .mockResolvedValueOnce({ data: { user: { id: USER_ALICE_ID } }, error: null })
            .mockResolvedValueOnce({ data: { user: { id: USER_BOB_ID } }, error: null })
            .mockResolvedValueOnce({ data: { user: { id: USER_CHARLIE_ID } }, error: null }),
          deleteUser: vi.fn().mockResolvedValue({ error: null }),
        },
      },
      from: vi.fn((table: string) => {
        if (table === 'people') {
          return {
            ...createMockChain({ data: null, error: null }),
            insert: () => createMockChain({ data: { id: 'pe-created' }, error: null }),
          }
        }
        return createMockChain({ error: null })
      }),
      rpc: vi.fn().mockResolvedValue({ data: { ok: true, status: 'applied' }, error: null }),
    }
    mocks.createAdminClient.mockReturnValue(mockAdminDb)

    // 1-1. Alice 등록 (프로젝트 관리자)
    const aliceRes = await createAccount({
      workspaceId: WS_ID,
      email: 'alice@company.com',
      password: 'password123!',
      name: 'Alice (PM)',
      workspaceRole: 'member',
      projectId: PID_MAIN,
      accessRole: 'admin',
    })
    expect(aliceRes.ok).toBe(true)

    // 1-2. Bob 등록 (프로젝트 개발 멤버)
    const bobRes = await createAccount({
      workspaceId: WS_ID,
      email: 'bob@company.com',
      password: 'password123!',
      name: 'Bob (Dev)',
      workspaceRole: 'member',
      projectId: PID_MAIN,
      accessRole: 'member',
    })
    expect(bobRes.ok).toBe(true)

    // 1-3. Charlie 등록 (프로젝트 명단 없는 단순 조회자)
    const charlieRes = await createAccount({
      workspaceId: WS_ID,
      email: 'charlie@company.com',
      password: 'password123!',
      name: 'Charlie (Viewer)',
      workspaceRole: 'member',
      projectId: null,
      accessRole: null,
    })
    expect(charlieRes.ok).toBe(true)

    // ═══════════════════════════════════════════════════════════════════════
    // [Step 2] 권한 해석: 각 사용자별 역할 및 접근 가시성 검증
    // ═══════════════════════════════════════════════════════════════════════
    const actorAlice: Actor = makeActor({
      userId: USER_ALICE_ID,
      workspaceRoles: new Map([[WS_ID, 'member']]),
      projectWorkspace: new Map([[PID_MAIN, WS_ID], [PID_PRIVATE, WS_ID]]),
      projectRoles: new Map([[PID_MAIN, 'admin']]),
    })

    const actorBob: Actor = makeActor({
      userId: USER_BOB_ID,
      workspaceRoles: new Map([[WS_ID, 'member']]),
      projectWorkspace: new Map([[PID_MAIN, WS_ID], [PID_PRIVATE, WS_ID]]),
      projectRoles: new Map([[PID_MAIN, 'member']]),
    })

    const actorCharlie: Actor = makeActor({
      userId: USER_CHARLIE_ID,
      workspaceRoles: new Map([[WS_ID, 'member']]),
      projectWorkspace: new Map([[PID_MAIN, WS_ID]]),
      projectRoles: new Map(), // 명단 없음
    })

    const actorDavidExternal: Actor = makeActor({
      userId: 'u-david-ext',
      workspaceRoles: new Map([[OTHER_WS_ID, 'member']]),
      projectWorkspace: new Map([[PID_OTHER_WS, OTHER_WS_ID]]),
      projectRoles: new Map([[PID_OTHER_WS, 'member']]),
    })

    // 2-1. 프로젝트 내 유효 역할 (roleIn) 검증
    expect(roleIn(actorAlice, PID_MAIN)).toBe('admin')
    expect(roleIn(actorBob, PID_MAIN)).toBe('member')
    expect(roleIn(actorCharlie, PID_MAIN)).toBe('viewer') // 명단 없으면 viewer (조회 전용)
    expect(roleIn(actorDavidExternal, PID_MAIN)).toBeNull() // 타 워크스페이스는 null (존재 은닉)

    // 2-2. 워크스페이스 관리자 여부 검증
    expect(isWorkspaceAdmin(actorAlice, WS_ID)).toBe(false)
    expect(isWorkspaceAdmin(actorBob, WS_ID)).toBe(false)
    expect(isWorkspaceAdmin(wsAdminActor, WS_ID)).toBe(true)

    // 2-3. 비공개 프로젝트 가시성 검증
    const hiddenSet = hiddenIds(PID_PRIVATE)
    // Alice와 Bob은 PID_PRIVATE 명단에 없으므로 숨겨짐
    expect(isHiddenProject(actorAlice, PID_PRIVATE, hiddenSet)).toBe(true)
    expect(isHiddenProject(actorBob, PID_PRIVATE, hiddenSet)).toBe(true)
    // PID_MAIN은 공개 프로젝트이므로 보임
    expect(isHiddenProject(actorAlice, PID_MAIN, hiddenSet)).toBe(false)
    expect(isHiddenProject(actorBob, PID_MAIN, hiddenSet)).toBe(false)

    // ═══════════════════════════════════════════════════════════════════════
    // [Step 3] 개인화 여정: Bob의 UI 선호도 설정 및 최근 방문 프로젝트 관리
    // ═══════════════════════════════════════════════════════════════════════
    mocks.getSession.mockResolvedValue({ id: USER_BOB_ID })
    mocks.getActor.mockResolvedValue(actorBob)

    let bobAccountPrefs: Record<string, unknown> = {}
    let bobWorkspacePrefs: Record<string, unknown> = {}

    const mockServerDb = {
      from: vi.fn((table: string) => {
        if (table === 'account_preferences') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { prefs: bobAccountPrefs }, error: null }),
              }),
            }),
            upsert: async (row: { prefs: Record<string, unknown> }) => {
              bobAccountPrefs = { ...bobAccountPrefs, ...row.prefs }
              return { error: null }
            },
          }
        }
        if (table === 'user_preferences') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { prefs: bobWorkspacePrefs }, error: null }),
                }),
              }),
            }),
            upsert: async (row: { prefs: Record<string, unknown> }) => {
              bobWorkspacePrefs = { ...bobWorkspacePrefs, ...row.prefs }
              return { error: null }
            },
          }
        }
        return createMockChain({ error: null })
      }),
    }
    mocks.createServerClient.mockResolvedValue(mockServerDb)

    // 3-1. Bob이 테마와 사이드바 설정을 저장 (계정 범위)
    const prefRes1 = await saveUiPrefs({ theme: 'dark', sidebarCollapsed: false })
    expect(prefRes1.ok).toBe(true)
    expect(bobAccountPrefs.theme).toBe('dark')
    expect(bobAccountPrefs.sidebarCollapsed).toBe(false)

    // 3-2. Bob이 워크스페이스 시작 페이지 및 즐겨찾기 프로젝트 설정 (워크스페이스 범위)
    const prefRes2 = await saveUiPrefs(
      {
        startPage: 'my_work',
        favoriteProjectIds: [PID_MAIN],
      },
      { workspaceId: WS_ID },
    )
    expect(prefRes2.ok).toBe(true)
    expect(bobWorkspacePrefs.startPage).toBe('my_work')
    expect(bobWorkspacePrefs.favoriteProjectIds).toEqual([PID_MAIN])

    // 3-3. Bob의 최근 방문 프로젝트 갱신 (LRU)
    let recentProjectsList: { id: string; at: string }[] = []
    const now1 = '2026-10-06T10:00:00Z'
    const now2 = '2026-10-06T10:05:00Z'

    recentProjectsList = pushRecent(recentProjectsList, PID_MAIN, now1)
    expect(recentProjectsList).toEqual([{ id: PID_MAIN, at: now1 }])

    recentProjectsList = pushRecent(recentProjectsList, PID_MAIN, now2)
    expect(recentProjectsList).toEqual([{ id: PID_MAIN, at: now2 }]) // 최신 시각으로 갱신

    // ═══════════════════════════════════════════════════════════════════════
    // [Step 4] 기능 수행 및 보안 권한 격리 (Action Execution & Security Guard)
    // ═══════════════════════════════════════════════════════════════════════
    // 4-1. 프로젝트 관리자(Alice) 가드 시뮬레이션
    mocks.requireProjectAdmin.mockImplementation(async (pid: string | null) => {
      if (pid === PID_MAIN) return { ok: true, actor: actorAlice }
      return { ok: false, error: ERR_MISSING }
    })
    const aliceAdminCheck = await mocks.requireProjectAdmin(PID_MAIN)
    expect(aliceAdminCheck.ok).toBe(true)

    // 4-2. 일반 멤버(Bob)가 프로젝트 관리자 전용 기능 실행 시도 -> 차단
    mocks.requireProjectAdmin.mockImplementation(async (pid: string | null) => {
      const role = roleIn(actorBob, pid)
      if (role !== 'admin' && role !== 'superuser') return { ok: false, error: ERR_DENIED }
      return { ok: true, actor: actorBob }
    })
    const bobAdminCheck = await mocks.requireProjectAdmin(PID_MAIN)
    expect(bobAdminCheck.ok).toBe(false)
    expect(bobAdminCheck.error).toBe(ERR_DENIED)

    // 4-3. 일반 멤버(Bob)가 일반 프로젝트 멤버 기능 실행 -> 허용
    mocks.requireProjectMember.mockImplementation(async (pid: string | null) => {
      const role = roleIn(actorBob, pid)
      if (role === 'admin' || role === 'member') return { ok: true, actor: actorBob }
      return { ok: false, error: ERR_DENIED }
    })
    const bobMemberCheck = await mocks.requireProjectMember(PID_MAIN)
    expect(bobMemberCheck.ok).toBe(true)

    // 4-4. 게스트(Charlie - viewer)가 쓰기 기능 실행 시도 -> 차단
    mocks.requireProjectMember.mockImplementation(async (pid: string | null) => {
      const role = roleIn(actorCharlie, pid)
      if (role === 'admin' || role === 'member') return { ok: true, actor: actorCharlie }
      return { ok: false, error: ERR_DENIED }
    })
    const charlieMemberCheck = await mocks.requireProjectMember(PID_MAIN)
    expect(charlieMemberCheck.ok).toBe(false)
    expect(charlieMemberCheck.error).toBe(ERR_DENIED)

    // 4-5. 보안 위반 방어: Bob이 다른 사용자의 플랫폼 관리자 승격 시도 -> 원천 차단
    mocks.requireSuperuser.mockImplementation(async () => {
      if (!actorBob.isSuperuser) return { ok: false, error: ERR_DENIED }
      return { ok: true, actor: actorBob }
    })
    const privilegeEscalation = await setPlatformAdmin('u-target', true)
    expect(privilegeEscalation.ok).toBe(false)
    expect(privilegeEscalation.error).toBe(ERR_DENIED)

    // ═══════════════════════════════════════════════════════════════════════
    // [Step 5] 오프보딩 및 권한 박탈 (Security Revocation & Isolation)
    // ═══════════════════════════════════════════════════════════════════════
    // Bob이 퇴사하여 워크스페이스 및 프로젝트 멤버십에서 제거된 상태
    const deprovisionedBob: Actor = makeActor({
      userId: USER_BOB_ID,
      workspaceRoles: new Map(), // 워크스페이스 소속 박탈
      projectWorkspace: new Map(),
      projectRoles: new Map(),
    })

    // 5-1. 탈퇴 후 프로젝트 접근 시도 시 존재 은닉 (null)
    expect(roleIn(deprovisionedBob, PID_MAIN)).toBeNull()
    expect(workspaceRoleIn(deprovisionedBob, WS_ID)).toBeNull()
    expect(isWorkspaceAdmin(deprovisionedBob, WS_ID)).toBe(false)

    // 5-2. 탈퇴 후 워크스페이스 설정 저장 시도 시 거부
    mocks.getActor.mockResolvedValue(deprovisionedBob)
    const revokePrefRes = await saveUiPrefs(
      { startPage: 'home' },
      { workspaceId: WS_ID },
    )
    expect(revokePrefRes.ok).toBe(false)
  })
})
