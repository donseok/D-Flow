import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 조회 실패 은폐 사고의 재발 가드.
 *
 * REST 장애로 권한·프로젝트 조회가 전부 실패했을 때 화면이 그 사실을 숨기고 '게스트 +
 * 등록된 프로젝트 없음' 으로 그렸다. 데이터는 멀쩡했는데(is_superuser=true, 두 프로젝트
 * admin) 로그인 실패로 신고됐다. 조회 실패는 **데이터 없음으로 위장하지 않는다**(에러 처리
 * 3원칙 ①). 그 계약을 lib 층에서 고정한다.
 */

const mocks = vi.hoisted(() => ({
  getClaims: vi.fn(),
  platformAdmins: vi.fn(),
  workspaceMembers: vi.fn(),
  projectMembers: vi.fn(),
  projects: vi.fn(),
  session: vi.fn(),
}))

// buildActor 의 4축(platform_admins·workspace_members·projects·project_members)만 응답한다.
// 다른 표를 읽으면 응답이 없어 TypeError 로 열화하는데, 아래 실패 케이스는 로그의 원인 문자열('timeout')까지
// 확인하므로 '엉뚱한 이유로 degraded' 가 초록으로 통과하지 못한다.
function table(name: string) {
  const resp = name === 'platform_admins' ? mocks.platformAdmins
    : name === 'workspace_members' ? mocks.workspaceMembers
      : name === 'project_members' ? mocks.projectMembers
        : name === 'projects' ? mocks.projects
          // 플랫폼 관리자만 읽는 "있는 워크스페이스" 축(0056) — 보관 아닌 w1 하나
          : name === 'workspaces' ? () => ({ data: [{ id: 'w1', archived_at: null }], error: null })
            : () => undefined
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'range']) q[m] = vi.fn(() => q)
  q.maybeSingle = vi.fn(() => resp())
  // buildActor 의 projects 는 페이지 + count 총합 대조(fetchAllPages) — 배열 응답에는 count 를 싣는다
  q.then = (res: (v: unknown) => unknown, rej: (r: unknown) => unknown) => {
    const r = resp() as { data?: unknown } | undefined
    return Promise.resolve(r && Array.isArray(r.data) ? { ...r, count: r.data.length } : r).then(res, rej)
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    auth: { getClaims: mocks.getClaims },
    from: (n: string) => table(n),
  }),
}))
vi.mock('@/lib/auth', () => ({ getSession: mocks.session, getDisplayName: vi.fn() }))

import { getActorViewState, getActorForView } from '@/lib/authz'

const USER = { id: 'u1' }
const FAIL = { data: null, error: { message: 'timeout' } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: USER.id } } })
  mocks.session.mockResolvedValue(USER)
  // 기본값: 워크스페이스 w1 의 member, 프로젝트 p1 하나, 명단 행 없음 — 네 축 모두 정상.
  mocks.platformAdmins.mockReturnValue({ data: null, error: null })
  mocks.workspaceMembers.mockReturnValue({ data: [{ workspace_id: 'w1', role: 'member' }], error: null })
  mocks.projects.mockReturnValue({ data: [{ id: 'p1', workspace_id: 'w1' }], error: null })
  mocks.projectMembers.mockReturnValue({ data: [], error: null })
})

/** 열화 로그가 이 축의 실패('timeout') 때문인지 — TypeError 같은 엉뚱한 원인이면 false. */
function degradedBecauseOfTimeout(spy: { mock: { calls: unknown[][] } }): boolean {
  return spy.mock.calls.some((args: unknown[]) => args.some((a: unknown) => typeof a === 'string' && a.includes('timeout')))
}

describe('getActorViewState — 조회 실패를 권한 없음으로 위장하지 않는다', () => {
  it('정상 조회: degraded=false, actor 조립', async () => {
    mocks.platformAdmins.mockReturnValue({ data: { user_id: USER.id }, error: null })
    mocks.projectMembers.mockReturnValue({
      data: [{ id: 'm1', project_id: 'p1', access_role: 'admin', project_member_teams: [] }], error: null,
    })
    const s = await getActorViewState()
    expect(s.degraded).toBe(false)
    expect(s.actor?.isSuperuser).toBe(true)
    expect(s.actor?.projectRoles.get('p1')).toBe('admin')
  })

  it.each([
    ['platform_admins', () => mocks.platformAdmins.mockReturnValue(FAIL)],
    ['workspace_members', () => mocks.workspaceMembers.mockReturnValue(FAIL)],
    ['projects', () => mocks.projects.mockReturnValue(FAIL)],
    ['project_members', () => mocks.projectMembers.mockReturnValue(FAIL)],
  ])('%s 조회 실패: actor=null 이면서 degraded=true — 둘을 구분할 수 있어야 한다', async (_axis, breakAxis) => {
    breakAxis()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = await getActorViewState()
    expect(s.actor).toBeNull()
    expect(s.degraded).toBe(true)
    expect(degradedBecauseOfTimeout(spy)).toBe(true)
    spy.mockRestore()
  })

  it('비로그인은 degraded 가 아니다 — 정상 흐름에 경고를 붙이면 안 된다', async () => {
    mocks.getClaims.mockResolvedValue({ data: null })
    const s = await getActorViewState()
    expect(s.actor).toBeNull()
    expect(s.degraded).toBe(false)
  })

  it('getActorForView 는 기존 계약(Actor|null) 그대로 — 호출부 24곳이 안 깨진다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.platformAdmins.mockReturnValue(FAIL)
    expect(await getActorForView()).toBeNull()
    spy.mockRestore()

    mocks.platformAdmins.mockReturnValue({ data: { user_id: USER.id }, error: null })
    expect((await getActorForView())?.isSuperuser).toBe(true)
  })
})
