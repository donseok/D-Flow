import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  activeTeamCodes: ['PMO', 'ERP', 'MES', '가공', 'MDM'] as string[],
  // Task 6 — 프로젝트 스코프 활성 팀 목록. 기본 구현은 beforeEach 에서 건다(초기화 시점에
  // mocks.activeTeamCodes 를 참조하면 자기 참조로 TS 순환 추론 에러가 난다).
  activeTeamCodesForProject: vi.fn<(projectId: string) => string[]>(),
  // SP2 Task 16a — 무프로젝트 회의록의 편철 팀은 그 워크스페이스의 공용 팀이다.
  activeTeamCodesForWorkspace: vi.fn<(workspaceId: string) => string[]>(),
  // SP2 결정 8 — 배치 판정은 actorFromUser 스냅샷 + roleIn. 스냅샷은 fixture 로 준다.
  actorFromUser: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// 최상위 폴더 모드(SP5 B2) — 기본 teams(v2.8 그대로)
vi.mock('@/lib/minutes/rootMode', () => ({ loadRootFolders: vi.fn(async () => ({ ok: true, value: { mode: 'teams' } })) }))
vi.mock('@/lib/authz', () => ({ actorFromUser: mocks.actorFromUser }))
vi.mock('@/lib/minutes/teamScope', () => ({
  activeTeamCodesForMinuteScope: vi.fn(async (scope: { projectId: string | null; workspaceId: string }) =>
    scope.projectId ? mocks.activeTeamCodesForProject(scope.projectId) : mocks.activeTeamCodesForWorkspace(scope.workspaceId)),
  teamCodesForMinuteScope: async (scope: { projectId: string | null; workspaceId: string }) =>
    scope.projectId ? mocks.activeTeamCodesForProject(scope.projectId) : mocks.activeTeamCodesForWorkspace(scope.workspaceId),
}))

import { DELETE, GET, POST } from '@/app/api/v1/minutes/folder/route'
import { activeTeamCodesForMinuteScope } from '@/lib/minutes/teamScope'
import { profileRowFor, type FakeAccount } from '../fixtures/profiles'
import type { Actor, ProjectRole, WorkspaceRole } from '@/lib/domain/authz'
import { makeActor, makeAdminActor, makeSuperuser } from '../fixtures/actor'
import { CRED_ID, CRED_WS, minutesCredential } from '../fixtures/credentials'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

// SP7 — 인증 원천은 integration_credentials(kind='minutes_api') 행 하나다. 옛 배포 전역 시크릿은 이제 401 이다.
const LEGACY_SECRET = 'test-minutes-secret'
/** 기본 자격증명 — CRED_WS 의 전 프로젝트. 변형은 CRED.with({...}).queue() 를 useAdmin 의 integration_credentials 에 싣는다. */
const CRED = minutesCredential()
/** 자격증명 워크스페이스 — 이 파일의 actor·회의록·폴더 fixture 가 모두 여기에 산다(fixtures/actor 의 WS 은 UUID 가 아니다). */
const WS = CRED_WS
const WS_OTHER = '5a000000-0000-4000-8000-000000000002'
const USER = { id: 'u-1', email: 'lead@example.com', user_metadata: { full_name: '팀장' } }
const EID = (n: number) => `ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b${String(n).padStart(2, '0')}`

type QueryResponse = { data?: unknown; error?: { message?: string; code?: string } | null }

function queryBuilder(response: QueryResponse | (() => QueryResponse)) {
  const b: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (r: (v: unknown) => unknown, j: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const m of ['select', 'insert', 'update', 'eq', 'is', 'in', 'limit', 'maybeSingle', 'single']) {
    b[m] = vi.fn(() => b)
  }
  b.then = (resolve, reject) => {
    const r = typeof response === 'function' ? response() : response
    return Promise.resolve({ data: r.data ?? null, error: r.error ?? null }).then(resolve, reject)
  }
  return b
}

/**
 * 큐를 싣지 않은 표의 기본 응답 — 인증 통과(자격증명 조회 → last_used_at 갱신, 둘 다 같은 응답이면 된다)와
 * 자격증명 워크스페이스 멤버 확인(workspace_members). 한 케이스가 POST 를 여러 번 불러도 마르지 않는다.
 */
const ADMIN_DEFAULTS: Record<string, QueryResponse> = {
  integration_credentials: { data: CRED.row },
  workspace_members: { data: { role: 'member' } },
}
/** 인증·계정 게이트가 건드리는 표(순서 고정) — 그 뒤로 아무 표도 읽지 않았음을 단언할 때 쓴다. */
const GATE_TABLES = ['integration_credentials', 'integration_credentials', 'profiles', 'workspace_members']

/** 테이블별 응답 큐 — from(table) 호출 순서대로 소비. */
function useAdmin(tables: Record<string, QueryResponse[]> = {}, users: FakeAccount[] = [USER]) {
  const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      let b: ReturnType<typeof queryBuilder>
      if (table === 'profiles' && !tables.profiles) {
        // resolveUserByEmail — eq('email', 정규화 값)으로 계정 fixture 에서 찾는다.
        let email: unknown
        b = queryBuilder(() => ({ data: profileRowFor(users, email) }))
        b.eq = vi.fn((col: string, val: unknown) => { if (col === 'email') email = val; return b })
      } else {
        // 자격증명 경로가 새로 읽는 표는 기본 응답을 준다(profiles 특례와 같은 이유) — 케이스가 큐를 실으면 그 큐만 쓴다.
        b = queryBuilder(tables[table]
          ? (tables[table].shift() ?? { data: null, error: null })
          : (ADMIN_DEFAULTS[table] ?? { data: null, error: null }))
      }
      ;(builders[table] ??= []).push(b)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return { admin, builders }
}

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/minutes/folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRED.token}`, ...headers },
    body: JSON.stringify(body),
  })
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

/** 자격증명 워크스페이스의 멤버(관리자 아님, 아는 프로젝트 없음). */
const wsMember = (over: Partial<Actor> = {}) =>
  makeActor({ userId: USER.id, workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'member']]), ...over })
/** 자격증명 워크스페이스의 관리자. */
const wsAdmin = (over: Partial<Actor> = {}) =>
  wsMember({ workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'admin']]), ...over })
/** 자격증명 워크스페이스의 멤버이면서 그 워크스페이스 프로젝트 pid 의 명단 관리자. */
const projectAdmin = (pid: string, over: Partial<Actor> = {}) =>
  makeAdminActor(pid, {
    userId: USER.id, workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'member']]),
    projectWorkspace: new Map([[pid, WS]]), ...over,
  })

const SEED_MES = { id: 'f-mes', name: 'MES', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, workspace_id: WS }
const SEED_ERP = { id: 'f-erp', name: 'ERP', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: WS }
const F_QUALITY = { id: 'f-q', name: '품질', parent_id: 'f-mes', created_by: 'u-9', workspace_id: WS }
const F_WEEKLY = { id: 'f-w', name: '주간정례', parent_id: 'f-q', created_by: 'u-9', workspace_id: WS }
const TREE = [SEED_MES, SEED_ERP, F_QUALITY, F_WEEKLY]

/** minutes 행 — 배치가 조회하는 컬럼만. project_id 기본 null(전역 트리, 기존 동작). */
const minute = (n: number, over: Partial<Record<string, unknown>> = {}) => ({
  id: `m-${n}`, external_id: EID(n), team_code: 'MES', project_id: null,
  folder_id: 'f-mes', archived_at: null, workspace_id: WS, ...over,
})

/** 폴더 스냅샷 + 대상 회의록 조회 응답을 세팅한다(배치의 고정 선두 2질의). */
function useBatch(rows: Array<Record<string, unknown>>, extraMinutes: QueryResponse[] = []) {
  return useAdmin({
    minute_folders: [{ data: TREE }],
    minutes: [{ data: rows }, ...extraMinutes],
  })
}

const body = (over: Record<string, unknown> = {}) => ({
  user_email: 'lead@example.com', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공', 'MDM']
  // clearAllMocks 는 mockImplementation 을 지우지 않는다 — 개별 테스트의 override 가 다음
  // 테스트로 새지 않도록 기본 구현을 매번 다시 건다.
  mocks.activeTeamCodesForProject.mockImplementation(() => mocks.activeTeamCodes)
  mocks.activeTeamCodesForWorkspace.mockImplementation(() => mocks.activeTeamCodes)
  // 배치는 관리자 이상 전용(결정 §2-H) — 명시하지 않으면 자격증명 워크스페이스의 관리자로 깐다
  // (자격증명 경로는 narrowActor 가 플랫폼 관리자 권한을 떼므로 플랫폼 관리자만으로는 통과하지 못한다).
  mocks.actorFromUser.mockResolvedValue(wsAdmin())
  // 킬스위치만 켠다 — MINUTES_API_SECRET 은 두지 않는다(SP7: 시크릿 없이 열린다).
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  vi.stubEnv('MINUTES_API_SECRET', undefined)
  useAdmin()
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('게이트·봉투 검증 (§4c)', () => {
  it('플래그 미설정이면 404 — 존재 은닉, DB 미접근(유효한 자격증명이어도)', async () => {
    vi.stubEnv('MINUTES_API_ENABLED', 'false')
    mocks.createAdminClient.mockClear()
    expect((await POST(post(body({ items: [] })))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('킬스위치는 MINUTES_API_ENABLED 하나다 — MINUTES_API_SECRET 없이 자격증명만으로 열린다(SP7)', async () => {
    expect(process.env.MINUTES_API_SECRET).toBeUndefined()
    const { builders } = useAdmin()
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(200)
    // 조회는 prefix + kind 로 한 건, 통과하면 last_used_at 을 그 행에만 갱신한다.
    expect(builders.integration_credentials).toHaveLength(2)
    expect(builders.integration_credentials[0].eq).toHaveBeenCalledWith('token_prefix', CRED.prefix)
    expect(builders.integration_credentials[0].eq).toHaveBeenCalledWith('kind', 'minutes_api')
    expect(builders.integration_credentials[1].update).toHaveBeenCalledWith({ last_used_at: expect.any(String) })
    expect(builders.integration_credentials[1].eq).toHaveBeenCalledWith('id', CRED_ID)
    expect(builders.integration_credentials[1].eq).toHaveBeenCalledWith('workspace_id', WS)
  })

  it('자격증명 형식이 아닌 Bearer 는 401 — service_role 클라이언트도 만들지 않는다', async () => {
    mocks.createAdminClient.mockClear()
    const req = new NextRequest('http://localhost/api/v1/minutes/folder', {
      method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}',
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('옛 시크릿 값 Bearer 는 이제 401 — env 에 MINUTES_API_SECRET 이 남아 있어도 통하지 않는다(SP7)', async () => {
    vi.stubEnv('MINUTES_API_SECRET', LEGACY_SECRET)
    mocks.createAdminClient.mockClear()
    const res = await POST(post(body({ dry_run: true, items: [] }), { Authorization: `Bearer ${LEGACY_SECRET}` }))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('Authorization 헤더가 없으면 401', async () => {
    const req = new NextRequest('http://localhost/api/v1/minutes/folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body({ items: [] })),
    })
    expect((await POST(req)).status).toBe(401)
  })

  it('자격증명 행이 없거나·회수됐거나·해시가 다르면 401 — 계정·회의록을 읽지 않는다', async () => {
    const probe = () => POST(post(body({ dry_run: true, items: [] })))
    // 행 없음
    let h = useAdmin({ integration_credentials: [{ data: null }] })
    expect((await probe()).status).toBe(401)
    expect(h.admin.from.mock.calls.map(c => c[0])).toEqual(['integration_credentials'])
    // 회수
    h = useAdmin({ integration_credentials: CRED.with({ revoked_at: '2026-01-01T00:00:00Z' }).queue() })
    expect((await probe()).status).toBe(401)
    expect(h.admin.from.mock.calls.map(c => c[0])).toEqual(['integration_credentials'])
    // 꺼짐
    h = useAdmin({ integration_credentials: CRED.with({ enabled: false }).queue() })
    expect((await probe()).status).toBe(401)
    // 만료
    h = useAdmin({ integration_credentials: CRED.with({ expires_at: '2000-01-01T00:00:00Z' }).queue() })
    expect((await probe()).status).toBe(401)
    // 같은 prefix 행인데 해시가 다른 토큰의 것
    h = useAdmin({ integration_credentials: CRED.with({ token_hash: minutesCredential().row.token_hash }).queue() })
    expect((await probe()).status).toBe(401)
    expect(h.admin.from.mock.calls.map(c => c[0])).toEqual(['integration_credentials'])
    expect(mocks.actorFromUser).not.toHaveBeenCalled()
  })

  it('미정의 메서드는 404', async () => {
    expect((await GET()).status).toBe(404)
    expect((await DELETE()).status).toBe(404)
  })

  it('user_email 이 없으면 400', async () => {
    expect((await POST(post({ items: [] }))).status).toBe(400)
  })

  it('items 가 배열이 아니면 400', async () => {
    expect((await POST(post(body({ items: 'x' })))).status).toBe(400)
  })

  it('201건이면 400 (상한 200)', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ external_id: EID(i), folder_path: [] }))
    const res = await POST(post(body({ items })))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('200')
  })

  it('200건은 통과한다(경계)', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ external_id: EID(i), folder_path: [] }))
    useBatch([])
    expect((await POST(post(body({ items })))).status).toBe(200)
  })

  it('dry_run·overwrite_manual 이 boolean 이 아니면 400', async () => {
    expect((await POST(post(body({ dry_run: 'yes', items: [] })))).status).toBe(400)
    expect((await POST(post(body({ overwrite_manual: 1, items: [] })))).status).toBe(400)
  })
})

describe('ACTOR_EMAIL 프로브 (요건 9 · 게이트 순서)', () => {
  it('items: [] + dry_run 은 200 OK + 전 카운트 0 — 400 이 아니다', async () => {
    const { admin } = useAdmin()
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: true, dry_run: true,
      summary: { total: 0, moved: 0, already_correct: 0, skipped: 0, not_found: 0, failed: 0 },
      results: [],
    })
    // 인증(자격증명 조회·갱신)·계정 매칭(profiles)·워크스페이스 멤버 확인·권한 스냅샷 외에는 아무것도 건드리지 않는다 — 폴더·회의록 조회 0.
    const touched = admin.from.mock.calls.map(c => c[0])
    expect(touched).toEqual(GATE_TABLES)
    expect(mocks.actorFromUser).toHaveBeenCalledWith(admin, USER.id)
  })

  it('관리자가 아니면 403 forbidden_role — ACTOR_EMAIL 오타를 첫 프로브에서 잡는다(§2-H)', async () => {
    // 플랫폼 관리자 아님 + 워크스페이스 멤버 + 어느 프로젝트에도 명단 admin 권한 없음
    mocks.actorFromUser.mockResolvedValue(wsMember())
    useAdmin()
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
  })

  it('권한 조회 실패는 500 — 권한 없음(403)으로 위장하지 않는다(SP2, 계약 v2.7)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.actorFromUser.mockRejectedValue(new Error('권한 정보를 불러오지 못했습니다'))
    useAdmin()
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('internal_error')
    spy.mockRestore()
  })

  it('어느 프로젝트든 명단 관리자면 프로브를 통과한다 — 플랫폼 관리자가 아니어도', async () => {
    mocks.actorFromUser.mockResolvedValue(projectAdmin('p-1'))
    useAdmin()
    expect((await POST(post(body({ dry_run: true, items: [] })))).status).toBe(200)
  })

  it('워크스페이스 관리자는 명단 없이 프로브를 통과한다(승계 — SP2 결정 8)', async () => {
    mocks.actorFromUser.mockResolvedValue(wsAdmin())
    useAdmin()
    expect((await POST(post(body({ dry_run: true, items: [] })))).status).toBe(200)
  })

  it('호출자가 자격증명 워크스페이스의 멤버가 아니면 403 unknown_user — 권한 스냅샷이 관리자여도(v3 §5.2.2 ④)', async () => {
    const { admin, builders } = useAdmin({ workspace_members: [{ data: null }] })
    const res = await POST(post(body({ dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('unknown_user')
    expect(builders.workspace_members[0].eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(builders.workspace_members[0].eq).toHaveBeenCalledWith('user_id', USER.id)
    expect(admin.from.mock.calls.map(c => c[0])).toEqual(GATE_TABLES)   // 폴더·회의록 조회 이전
    expect(workspacesWithModule).not.toHaveBeenCalled()
  })

  it('워크스페이스 멤버 조회 실패는 500 — 멤버 아님(403)으로 위장하지 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({ workspace_members: [{ data: null, error: { message: 'boom' } }] })
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('internal_error')
    spy.mockRestore()
  })

  it('플랫폼 관리자여도 자격증명 워크스페이스의 관리자가 아니면 403 forbidden_role — 플랫폼 권한이 멤버십을 대신하지 않는다', async () => {
    mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id, workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'member']]) }))
    useAdmin()
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
  })

  it('다른 워크스페이스에서의 관리자 권한은 통하지 않는다 — 403 forbidden_role(워크스페이스 격리)', async () => {
    // 자격증명 워크스페이스에서는 평멤버, 다른 워크스페이스의 관리자이자 그쪽 프로젝트의 명단 관리자.
    mocks.actorFromUser.mockResolvedValue(makeAdminActor('p-far', {
      userId: USER.id, projectWorkspace: new Map([['p-far', WS_OTHER]]),
      workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'member'], [WS_OTHER, 'admin']]),
    }))
    useAdmin()
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
  })

  it('자격증명이 허용하지 않는 프로젝트의 관리자 권한만으로는 403 forbidden_role', async () => {
    const PA = '5a000000-0000-4000-8000-0000000000b1'
    const PB = '5a000000-0000-4000-8000-0000000000b2'
    mocks.actorFromUser.mockResolvedValue(projectAdmin(PB))
    useAdmin({ integration_credentials: CRED.with({ project_ids: [PA] }).queue() })
    const res = await POST(post(body({ dry_run: true, items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    // 대조 — 허용 프로젝트의 관리자면 통과한다
    mocks.actorFromUser.mockResolvedValue(projectAdmin(PA))
    useAdmin({ integration_credentials: CRED.with({ project_ids: [PA] }).queue() })
    expect((await POST(post(body({ dry_run: true, items: [] })))).status).toBe(200)
  })

  it('권한 게이트는 실제 이동 요청도 막는다 — 폴더·회의록 조회 이전에', async () => {
    mocks.actorFromUser.mockResolvedValue(wsMember())
    const { admin } = useAdmin({
      minute_folders: [{ data: TREE }],
      minutes: [{ data: [minute(1)] }],
    })
    const res = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    expect(admin.from.mock.calls.map(c => c[0])).toEqual(GATE_TABLES)
  })

  it("등록되지 않은 user_email + items: [] 는 403 — 계정 게이트가 페이로드 검증보다 먼저", async () => {
    useAdmin({}, [])
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('unknown_user')
  })

  it('계정 게이트는 봉투 오류(items 누락)보다도 먼저다', async () => {
    useAdmin({}, [])
    expect((await POST(post(body({}))))?.status).toBe(403)
  })
})

describe('dry run 기본값 (요건 8)', () => {
  it('dry_run 필드 없이 호출하면 아무것도 이동하지 않는다', async () => {
    const { builders } = useBatch([minute(1)])
    const res = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    const json = await res.json()
    expect(json.dry_run).toBe(true)
    expect(json.summary).toMatchObject({ total: 1, moved: 1 })
    // minutes 는 대상 조회 1회뿐 — update 없음
    expect(builders.minutes).toHaveLength(1)
    expect(builders.minutes[0].update).not.toHaveBeenCalled()
  })

  it('dry run 은 폴더도 만들지 않는다 — 없는 경로는 folder_id: null 로 보고', async () => {
    const { builders } = useBatch([minute(1)])
    const res = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '신규', '킥오프'] }],
    })))
    const json = await res.json()
    expect(json.results[0]).toMatchObject({
      status: 'moved', to: ['MES', '신규', '킥오프'], folder_id: null,
    })
    expect(builders.minute_folders).toHaveLength(1)     // 스냅샷 1회, insert 0
  })
})

describe('판정 (§8.3 · 요건 6·10)', () => {
  it('이미 목표 위치면 already_correct — moved 에 섞지 않는다', async () => {
    useBatch([minute(1, { folder_id: 'f-q' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'already_correct', folder_id: 'f-q' })
    expect(json.summary).toMatchObject({ moved: 0, already_correct: 1, skipped: 0 })
  })

  it('already_correct 가 manual_placement 판정보다 먼저다 — APPLY 후 재실행 dry-run 회귀', async () => {
    // 1차 APPLY 로 f-w(3단)에 옮긴 건. folder_id 만 보면 하위 폴더라 manual_placement 로 보인다.
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질', '주간정례'] }],
    })))
    const json = await r.json()
    expect(json.results[0].status).toBe('already_correct')
    expect(json.summary.skipped).toBe(0)               // 판단 근거가 오염되면 안 된다
  })

  it('팀 루트에 있고 목표도 팀 루트면 already_correct (moved 아님)', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: [] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'already_correct', folder_id: 'f-mes' })
  })

  it('미분류(folder_id null)는 이동한다', async () => {
    useBatch([minute(1, { folder_id: null })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', from: null, to: ['MES', '품질'] })
  })

  it('팀 루트(자동 편철 자리)에 있으면 이동한다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'moved', from: ['MES'], to: ['MES', '품질'], folder_id: 'f-q',
    })
  })

  it('하위 폴더에 있고 목표와 다르면 skipped(manual_placement)', async () => {
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'skipped', reason: 'manual_placement', from: ['MES', '품질', '주간정례'],
    })
  })

  it('overwrite_manual: true 면 그것도 이동한다', async () => {
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({
      overwrite_manual: true,
      items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q' })
  })

  it('자격증명 워크스페이스의 minutes_integration 이 꺼졌으면 요청 전체 409 — 옮기지 않는다(과제 21)', async () => {
    const { builders, admin } = useBatch([minute(1), minute(2)], [{ data: [{ id: 'm-1' }] }])
    vi.mocked(workspacesWithModule).mockImplementation(async (ids) => ids.filter((w) => w !== WS))
    const res = await POST(post(body({ dry_run: false, items: [
      { external_id: EID(1), folder_path: ['MES', '품질'] }, { external_id: EID(2), folder_path: ['MES', '품질'] },
    ] })))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(workspacesWithModule).toHaveBeenLastCalledWith([WS], 'minutes_integration', { client: admin })
    expect(builders.minutes).toBeUndefined()                            // 대상 조회조차 하지 않는다 — update 없음
    expect(builders.minute_folders).toBeUndefined()
  })
  it('모듈 판정은 자격증명 워크스페이스 하나만 본다 — 꺼진 다른 워크스페이스의 회의록은 not_found, 내 것은 옮긴다(과제 21 · 격리)', async () => {
    const { builders, admin } = useBatch([minute(1), minute(2, { workspace_id: WS_OTHER })], [{ data: [{ id: 'm-1' }] }])
    vi.mocked(workspacesWithModule).mockImplementation(async (ids) => ids.filter((w) => w !== WS_OTHER))
    const res = await POST(post(body({ dry_run: false, items: [
      { external_id: EID(1), folder_path: ['MES', '품질'] }, { external_id: EID(2), folder_path: ['MES', '품질'] },
    ] })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ external_id: EID(1), status: 'moved', folder_id: 'f-q' })
    expect(json.results[1]).toEqual({ external_id: EID(2), status: 'not_found' })
    expect(json.summary).toMatchObject({ total: 2, moved: 1, not_found: 1, failed: 0 })
    expect(workspacesWithModule).toHaveBeenCalledTimes(1)
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
    // update 는 내 워크스페이스 회의록 한 건뿐
    expect(builders.minutes).toHaveLength(2)
    expect(builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-q' })
    expect(builders.minutes[1].eq).toHaveBeenCalledWith('id', 'm-1')
  })
  it('자격증명 워크스페이스가 켜져 있으면 옮긴다(대조)', async () => {
    const { builders } = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    vi.mocked(workspacesWithModule).mockImplementation(async (ids) => ids.filter((w) => w === WS))
    const res = await POST(post(body({ dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect(res.status).toBe(200)
    expect((await res.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q' })
    expect(builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-q' })
  })
  it('프로브(items: [])는 자격증명 워크스페이스가 꺼졌으면 409 — 연동 설정 오류를 첫 호출에서 드러낸다(과제 21)', async () => {
    mocks.actorFromUser.mockResolvedValue(projectAdmin('p-1'))
    const { admin } = useAdmin()
    vi.mocked(workspacesWithModule).mockResolvedValueOnce([])
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
  })
  it('프로브: 플랫폼 관리자여도 자격증명 워크스페이스가 꺼졌으면 409 — 자격증명 경로에는 플랫폼 관리자 예외가 없다(SP7, 옛 P24 반전)', async () => {
    mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id, workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'admin']]) }))
    useAdmin()
    vi.mocked(workspacesWithModule).mockResolvedValue([])
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
  })
  it('관리자가 아니면 모듈 판정 전에 403 — 권한 게이트가 먼저다(과제 21)', async () => {
    mocks.actorFromUser.mockResolvedValue(wsMember())
    useAdmin()
    const res = await POST(post(body({ items: [] })))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('forbidden_role')
    expect(workspacesWithModule).not.toHaveBeenCalled()
  })
})

describe('건별 실패 사유 (요건 11 status 값 집합)', () => {
  it('없는 external_id 는 not_found', async () => {
    useBatch([])
    const r = await POST(post(body({ items: [{ external_id: EID(9), folder_path: [] }] })))
    expect((await r.json()).results[0]).toEqual({ external_id: EID(9), status: 'not_found' })
  })

  it('archived 는 skipped(archived)', async () => {
    useBatch([minute(1, { archived_at: '2026-07-20T00:00:00+00:00' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: [] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'archived' })
  })

  it('items[].team 이 기존 team_code 와 다르면 failed(team_mismatch) — 이동 안 됨', async () => {
    const { builders } = useBatch([minute(1)])
    const r = await POST(post(body({
      dry_run: false,
      items: [{ external_id: EID(1), team: 'ERP', folder_path: ['ERP'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'failed', reason: 'team_mismatch' })
    expect(builders.minutes).toHaveLength(1)           // update 없음
  })

  it('items[].team 생략은 기존 team_code 로 편철된다', async () => {
    useBatch([minute(1, { folder_id: null })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['품질'] }] })))
    // team=MES 로 판정 → 자유 루트 '품질'이 한 칸 내려 MES/품질
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', to: ['MES', '품질'] })
  })

  it('61자 폴더명은 failed(folder_name_too_long)', async () => {
    useBatch([minute(1)])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '가'.repeat(61)] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'failed', reason: `folder_name_too_long: ${'가'.repeat(61)}(61자)`,
    })
  })

  it('타 팀 루트는 failed(validation_failed)', async () => {
    useBatch([minute(1)])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['ERP', '영업'] }] })))
    expect((await r.json()).results[0].reason).toContain('validation_failed')
  })

  it('시드 루트 부재는 failed(no_team_root) — folder_id 를 건드리지 않고 moved 로 집계하지 않는다', async () => {
    // 스냅샷에 가공 팀 루트가 없다
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }],
      minutes: [{ data: [minute(1, { team_code: '가공', folder_id: 'f-mes' })] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['가공', '품질'] }],
    })))
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'failed', reason: 'no_team_root' })
    expect(json.results[0].folder_id).toBeUndefined()  // 이동하지 않았음을 형태로 드러낸다
    expect(json.summary).toMatchObject({ moved: 0, failed: 1 })
    expect(builders.minutes).toHaveLength(1)           // update 없음
  })

  it('부분 실패는 전체를 롤백하지 않는다 — 건별 results 로 보고', async () => {
    useBatch([minute(1, { folder_id: null }), minute(2, { archived_at: 'x' })])
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: ['MES', '품질'] },
        { external_id: EID(2), folder_path: ['MES', '품질'] },
        { external_id: EID(3), folder_path: ['MES', '품질'] },
      ],
    })))
    const json = await r.json()
    expect(json.summary).toEqual({
      total: 3, moved: 1, already_correct: 0, skipped: 1, not_found: 1, failed: 0,
    })
  })

  it('같은 범위의 회의록이 여럿이어도 팀은 범위마다 한 번 읽는다(SP4 A2 — service_role 로)', async () => {
    const { admin } = useBatch([minute(1, { folder_id: null }), minute(2, { folder_id: null }), minute(3, { folder_id: null })])
    const r = await POST(post(body({
      items: [1, 2, 3].map((n) => ({ external_id: EID(n), folder_path: ['MES', '품질'] })),
    })))
    expect(r.status).toBe(200)
    expect(vi.mocked(activeTeamCodesForMinuteScope)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(activeTeamCodesForMinuteScope)).toHaveBeenCalledWith({ projectId: null, workspaceId: WS }, { client: admin })
  })
})

describe('APPLY 실행 (요건 2·3)', () => {
  it('folder_id 만 갱신한다 — updated_at 을 건드리지 않는다', async () => {
    const { builders } = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q' })
    expect(builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-q' })
    expect(builders.minutes[1].update).not.toHaveBeenCalledWith(
      expect.objectContaining({ updated_at: expect.anything() }),
    )
  })

  it('버전 append 없음 — commit_minute_body_version 을 경유하지 않는다', async () => {
    const { admin } = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    // 가짜 클라이언트에 rpc 가 아예 없다 — 라우트가 RPC 를 부르면 TypeError 로 즉시 실패한다.
    expect(admin).not.toHaveProperty('rpc')
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0].status).toBe('moved')
  })

  it('APPLY 는 부족한 폴더를 만들고 created_by 에 실행 계정을 넣는다(C4)', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }, { data: { id: 'f-new' } }],
      minutes: [{ data: [minute(1)] }, { data: [{ id: 'm-1' }] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'moved', folder_id: 'f-new', to: ['MES', '신규'],
    })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: '신규', parent_id: 'f-mes', created_by: 'u-1', project_id: null,
    })
  })

  it('APPLY 중 폴더 생성 실패는 failed(folder_error) — 조상에 떨구고 moved 로 위장하지 않는다', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }, { data: null, error: { code: '42501', message: 'denied' } }],
      minutes: [{ data: [minute(1)] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'failed' })
    expect(json.results[0].reason).toContain('folder_error')
    expect(builders.minutes).toHaveLength(1)           // update 없음
  })

  it('update 가 0행이면 failed — 조용한 no-op 을 성공으로 위장하지 않는다', async () => {
    useBatch([minute(1)], [{ data: [] }])
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'failed' })
  })

  it('멱등 — 같은 요청을 두 번 실행하면 두 번째는 already_correct', async () => {
    useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const first = await (await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))).json()
    expect(first.summary).toMatchObject({ moved: 1 })

    useBatch([minute(1, { folder_id: 'f-q' })])
    const second = await (await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }],
    })))).json()
    expect(second.summary).toMatchObject({ moved: 0, already_correct: 1 })
  })

  it('같은 external_id 가 한 요청에 두 번 오면 두 번째는 already_correct', async () => {
    useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const r = await POST(post(body({
      dry_run: false,
      items: [
        { external_id: EID(1), folder_path: ['MES', '품질'] },
        { external_id: EID(1), folder_path: ['MES', '품질'] },
      ],
    })))
    const json = await r.json()
    expect(json.summary).toMatchObject({ moved: 1, already_correct: 1 })
  })
})

describe('조상 규칙 (§4c.5 · 결정 §2-J)', () => {
  it('현재 위치가 목표의 조상이면 이동 — 더 깊게 넣는 것은 사람의 정리를 훼손하지 않는다', async () => {
    // 현재 MES/품질, 목표 MES/품질/주간정례 → 조상이므로 이동
    useBatch([minute(1, { folder_id: 'f-q' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질', '주간정례'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({
      status: 'moved', from: ['MES', '품질'], to: ['MES', '품질', '주간정례'],
    })
  })

  it('얕은 쪽으로 되돌리는 이동은 skip — 배치가 트리를 평평하게 만들지 않는다', async () => {
    // 현재 MES/품질/주간정례, 목표 MES/품질 → 조상이 아니라 자손이다
    useBatch([minute(1, { folder_id: 'f-w' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'manual_placement' })
  })

  it('다른 가지로 옮겨 둔 건은 계속 보호된다', async () => {
    const tree = [...TREE, { id: 'f-etc', name: '기타', parent_id: 'f-mes', created_by: 'u-9', workspace_id: WS }]
    useAdmin({
      minute_folders: [{ data: tree }],
      minutes: [{ data: [minute(1, { folder_id: 'f-etc' })] }],
    })
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'manual_placement' })
  })

  it('팀 루트는 조상 규칙의 특수 케이스로 흡수된다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', '품질', '주간정례'] }],
    })))
    expect((await r.json()).results[0].status).toBe('moved')
  })
})

describe('건별 검증 실패 (계약 v2.4 ⑥ — 요청 전체 400 금지)', () => {
  it('folder_path 타입 오류는 그 건만 failed, 나머지는 정상 처리된다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' }), minute(2, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: 'MES/품질' },        // 타입 오류
        { external_id: EID(2), folder_path: ['MES', '품질'] },   // 정상
      ],
    })))
    expect(r.status).toBe(200)                                   // 400 이 아니다
    const json = await r.json()
    expect(json.results[0]).toMatchObject({ status: 'failed' })
    expect(json.results[0].reason).toContain('validation_failed')
    expect(json.results[1].status).toBe('moved')
    expect(json.summary).toMatchObject({ total: 2, moved: 1, failed: 1 })
  })

  it('60자 초과도 건별 failed', async () => {
    useBatch([minute(1), minute(2, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: ['MES', '가'.repeat(61)] },
        { external_id: EID(2), folder_path: ['MES', '품질'] },
      ],
    })))
    const json = await r.json()
    expect(json.results[0].reason).toContain('folder_name_too_long')
    expect(json.results[1].status).toBe('moved')
  })
})

describe('폴더 생성 시점 — 판정 전에 만들지 않는다(리뷰 지적)', () => {
  it('APPLY 에서 skip 될 건의 목표 트리를 미리 만들지 않는다 — 빈 고아 폴더 방지', async () => {
    // 현재 MES/기타(다른 가지) → 목표 MES/품질/신규. 조상이 아니라 skip 되어야 하고,
    // 그 과정에서 '신규' 폴더가 만들어지면 아무도 안 쓰는 ACTOR 명의 폴더가 트리에 남는다.
    const tree = [...TREE, { id: 'f-etc', name: '기타', parent_id: 'f-mes', created_by: 'u-9', workspace_id: WS }]
    const { builders } = useAdmin({
      minute_folders: [{ data: tree }],
      minutes: [{ data: [minute(1, { folder_id: 'f-etc' })] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'skipped', reason: 'manual_placement' })
    // 스냅샷 조회 1회뿐 — insert 가 한 번도 일어나지 않았다
    expect(builders.minute_folders).toHaveLength(1)
  })

  it('이동이 확정된 건에 대해서는 APPLY 가 폴더를 만든다', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE }, { data: { id: 'f-new' } }],
      minutes: [{ data: [minute(1, { folder_id: 'f-q' })] }, { data: [{ id: 'm-1' }] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-new' })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '신규', parent_id: 'f-q', created_by: 'u-1' }),
    )
  })
})

describe('folder_path_status (결정 §2-C)', () => {
  it('정상 편철은 exact', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect((await r.json()).results[0].folder_path_status).toBe('exact')
  })

  it('한 칸 내림도 exact — 정상 동작이지 품질 저하가 아니다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['자유루트'] }] })))
    const res = (await r.json()).results[0]
    expect(res.to).toEqual(['MES', '자유루트'])
    expect(res.folder_path_status).toBe('exact')
  })

  it('깊이 5 초과 절단은 truncated — 침묵하면 APPLY 후 영영 already_correct 가 된다', async () => {
    useBatch([minute(1, { folder_id: 'f-mes' })])
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MES', 'A', 'B', 'C', 'D', 'E'] }],
    })))
    const res = (await r.json()).results[0]
    expect(res.to).toHaveLength(5)
    expect(res.folder_path_status).toBe('truncated')
  })

  it('APPLY 중 생성 실패는 partial 이 아니라 failed 로 막는다(리포트와 트리 불일치 방지)', async () => {
    useAdmin({
      minute_folders: [{ data: TREE }, { data: null, error: { code: '42501', message: 'denied' } }],
      minutes: [{ data: [minute(1, { folder_id: 'f-mes' })] }],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    expect((await r.json()).results[0].status).toBe('failed')
  })
})

describe('summary 항등식 (§4c.2 응답 계약)', () => {
  it('total = moved + already_correct + skipped + not_found + failed — 혼합 케이스', async () => {
    useAdmin({
      minute_folders: [{ data: TREE }],
      minutes: [{ data: [
        minute(1, { folder_id: 'f-mes' }),                       // → moved
        minute(2, { folder_id: 'f-q' }),                         // → already_correct
        minute(3, { folder_id: 'f-w' }),                         // → skipped(manual_placement)
        minute(4, { folder_id: 'f-mes', archived_at: 'x' }),     // → skipped(archived)
        minute(5, { folder_id: 'f-mes' }),                       // → failed(team_mismatch)
      ] }],
    })
    const r = await POST(post(body({
      items: [
        { external_id: EID(1), folder_path: ['MES', '품질'] },
        { external_id: EID(2), folder_path: ['MES', '품질'] },
        { external_id: EID(3), folder_path: ['MES', '품질'] },
        { external_id: EID(4), folder_path: ['MES', '품질'] },
        { external_id: EID(5), team: 'ERP', folder_path: ['MES', '품질'] },
        { external_id: EID(9), folder_path: ['MES', '품질'] },   // → not_found
      ],
    })))
    const json = await r.json()
    const s = json.summary
    expect(s.total).toBe(6)
    expect(s.moved + s.already_correct + s.skipped + s.not_found + s.failed).toBe(s.total)
    expect(s).toEqual({ total: 6, moved: 1, already_correct: 1, skipped: 2, not_found: 1, failed: 1 })
    // results 는 요청 items 순서를 보존한다 — 또박또박이 인덱스로 대조한다
    expect(json.results.map((x: { status: string }) => x.status)).toEqual(
      ['moved', 'already_correct', 'skipped', 'skipped', 'failed', 'not_found'],
    )
  })
})

describe('비활성 팀 시나리오 (§3.2 ① 단독 조건)', () => {
  it('team_code 가 비활성이어도 루트 세그먼트가 중복되지 않는다', async () => {
    mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공']        // MDM 비활성
    useAdmin({
      minute_folders: [{ data: [...TREE, { id: 'f-mdm', name: 'MDM', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-MDM', team: { code: 'MDM', project_id: null }, workspace_id: WS }] }],
      minutes: [{ data: [minute(1, { team_code: 'MDM', folder_id: 'f-mdm' })] }],
    })
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['MDM', '품질'] }],
    })))
    // ①이 캐시를 봤다면 ②로 떨어져 ["MDM","MDM","품질"]가 된다
    expect((await r.json()).results[0].to).toEqual(['MDM', '품질'])
  })
})

describe('편철 팀 목록 — 무프로젝트 회의록은 그 워크스페이스의 팀 (SP2 Task 16a)', () => {
  it('다른 워크스페이스의 팀 이름은 이 회의록 트리의 팀 루트가 아니다 — 한 칸 내림(②)으로 편철한다', async () => {
    // ERP 는 다른 워크스페이스의 팀일 뿐이다. 전 워크스페이스 목록으로 보면 ③(다른 팀 루트)으로 거절됐다.
    mocks.activeTeamCodesForWorkspace.mockImplementation((wid: string) => (wid === WS ? ['PMO', 'MES'] : ['ERP']))
    useBatch([minute(1)])
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: ['ERP', '품질'] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', to: ['MES', 'ERP', '품질'] })
    expect(mocks.activeTeamCodesForWorkspace).toHaveBeenCalledWith(WS)
  })

  it('팀 캐시를 못 채웠으면 500 — 한 건도 옮기기 전에 멈춘다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.activeTeamCodesForWorkspace.mockImplementation(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    const { builders } = useBatch([minute(1)])
    const r = await POST(post(body({ dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '품질'] }] })))
    expect(r.status).toBe(500)
    expect(builders.minutes).toHaveLength(1)   // 대상 조회뿐 — update 없음
    spy.mockRestore()
  })
})

describe('편철 기준 트리 — 회의록 프로젝트 스코프 (0076 · Task 6)', () => {
  const PROJECT_UUID = '90b95d7d-8d5c-4f8c-9915-4a07b876af27'
  // 같은 이름 'MES' 루트가 전역(f-mes)과 프로젝트(f-mes-p)에 각각 존재 — 스코프를 안 가리면
  // 전역 루트와 뒤섞인다.
  const SEED_MES_PROJECT = { id: 'f-mes-p', name: 'MES', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, project_id: PROJECT_UUID, workspace_id: WS }
  const TREE_WITH_PROJECT = [...TREE, SEED_MES_PROJECT]
  // 워크스페이스 관리자의 승계는 권한 스냅샷이 아는 프로젝트에만 닿는다 — 이 프로젝트를 자격증명 워크스페이스 소속으로 싣는다
  // (없으면 건별 판정이 forbidden_project 로 막는다 — 아래 '대상 회의록마다 관리자 판정' 참고).
  beforeEach(() => { mocks.actorFromUser.mockResolvedValue(wsAdmin({ projectWorkspace: new Map([[PROJECT_UUID, WS]]) })) })

  it('회의록의 project_id 스코프 루트를 기준으로 판정한다 — 전역 루트와 혼동하지 않는다', async () => {
    useAdmin({
      minute_folders: [{ data: TREE_WITH_PROJECT }],
      minutes: [{ data: [minute(1, { project_id: PROJECT_UUID, folder_id: 'f-mes-p' })] }],
    })
    // 목표는 팀 루트([]) — 전역 스코프로 해석하면 f-mes 가 되어 row.folder_id(f-mes-p)와
    // 어긋나 manual_placement 로 skip 된다. 프로젝트 스코프로 바르게 해석하면 already_correct.
    const r = await POST(post(body({ items: [{ external_id: EID(1), folder_path: [] }] })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'already_correct', folder_id: 'f-mes-p' })
  })

  it('APPLY 도 회의록의 프로젝트 트리 안에서 폴더를 만든다', async () => {
    const { builders } = useAdmin({
      minute_folders: [{ data: TREE_WITH_PROJECT }, { data: { id: 'f-new-p' } }],
      minutes: [
        { data: [minute(1, { project_id: PROJECT_UUID, folder_id: 'f-mes-p' })] },
        { data: [{ id: 'm-1' }] },
      ],
    })
    const r = await POST(post(body({
      dry_run: false, items: [{ external_id: EID(1), folder_path: ['MES', '신규'] }],
    })))
    expect((await r.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-new-p' })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: '신규', parent_id: 'f-mes-p', created_by: 'u-1', project_id: PROJECT_UUID,
    })
  })

  it('활성 팀 목록도 회의록의 프로젝트 스코프로 조회한다', async () => {
    mocks.activeTeamCodesForProject.mockImplementation((projectId: string) =>
      projectId === PROJECT_UUID ? ['PMO', 'ERP', 'MES', '가공', 'MDM', '신설팀'] : mocks.activeTeamCodes)
    const tree = [...TREE_WITH_PROJECT, {
      id: 'f-newteam-p', name: '신설팀', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-신설팀', team: { code: '신설팀', project_id: null }, project_id: PROJECT_UUID,
    }]
    useAdmin({
      minute_folders: [{ data: tree }],
      minutes: [{ data: [minute(1, {
        project_id: PROJECT_UUID, team_code: '신설팀', folder_id: 'f-newteam-p',
      })] }],
    })
    const r = await POST(post(body({
      items: [{ external_id: EID(1), folder_path: ['신설팀', '품질'] }],
    })))
    const json = await r.json()
    // 전역 activeTeamCodes 만 봤다면 '신설팀'이 활성 팀 아님 취급되어 한 칸 내려 중복된다
    // (["신설팀","신설팀","품질"]).
    expect(json.results[0].to).toEqual(['신설팀', '품질'])
    expect(mocks.activeTeamCodesForProject).toHaveBeenCalledWith(PROJECT_UUID)
  })
})

// 삭제(SP7): tests/minutes/batch-authorized.test.ts(6 케이스) — 순수 판정 isBatchAuthorized 는 src 호출부가 없는 export 라 함수와 함께 지웠다
// (정본 §5.1.3 — roleIn(자격증명으로 좁힌 스냅샷)이 대체). 같은 규칙은 라우트가 실제로 지나는 건별 판정으로 이 describe 가 본다:
// 둘 중 하나만 관리자 → 그 건만 failed / 무프로젝트는 워크스페이스 관리자만 / 자격증명 범위 밖 프로젝트 → failed. 워크스페이스 관리자 승계와
// 다른 워크스페이스(→ not_found·403)는 위 'ACTOR_EMAIL 프로브'·'판정' describe 에 있다. '빈 대상은 false' 는 라우트에서 뜻이 다르다(items: [] 는 유효한 프로브).
describe('대상 회의록마다 관리자 판정 — 건별 forbidden_project (SP2 결정 8 · v3 §5.2.3)', () => {
  const P1 = '5a000000-0000-4000-8000-0000000000b1'
  const P2 = '5a000000-0000-4000-8000-0000000000b2'
  const item = (n: number) => ({ external_id: EID(n), folder_path: ['MES', '품질'] })
  // 프로젝트마다 자기 트리(MES 루트 + 품질)가 있다.
  const projectTree = (pid: string, tag: string) => [
    { id: `f-mes-${tag}`, name: 'MES', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-MES', team: { code: 'MES', project_id: null }, project_id: pid, workspace_id: WS },
    { id: `f-q-${tag}`, name: '품질', parent_id: `f-mes-${tag}`, created_by: 'u-9', project_id: pid, workspace_id: WS },
  ]
  const TREE_P = [...TREE, ...projectTree(P1, 'p1'), ...projectTree(P2, 'p2')]
  const useProjectBatch = (rows: Array<Record<string, unknown>>, extra: QueryResponse[] = [], more: Record<string, QueryResponse[]> = {}) =>
    useAdmin({ minute_folders: [{ data: TREE_P }], minutes: [{ data: rows }, ...extra], ...more })
  const pMinute = (n: number, pid: string, tag: string) => minute(n, { project_id: pid, folder_id: `f-mes-${tag}` })

  it('대상 둘 중 하나의 프로젝트만 관리자면 그 건만 옮기고, 권한 없는 건은 failed(forbidden_project) — 옮기지 않는다', async () => {
    // P1 관리자, P2 는 같은 워크스페이스의 명단 member — "어느 프로젝트든 관리자"로 프로브는 통과하는 경우다.
    mocks.actorFromUser.mockResolvedValue(projectAdmin(P1, {
      projectWorkspace: new Map([[P1, WS], [P2, WS]]),
      projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'member']]),
    }))
    const { builders } = useProjectBatch([pMinute(1, P1, 'p1'), pMinute(2, P2, 'p2')], [{ data: [{ id: 'm-1' }] }])
    const res = await POST(post(body({ dry_run: false, items: [item(1), item(2)] })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ external_id: EID(1), status: 'moved', folder_id: 'f-q-p1' })
    expect(json.results[1]).toEqual({ external_id: EID(2), status: 'failed', reason: 'forbidden_project', from: ['MES'] })
    expect(json.summary).toEqual({ total: 2, moved: 1, already_correct: 0, skipped: 0, not_found: 0, failed: 1 })
    // 대상 조회 + 권한 있는 한 건의 update 뿐 — 권한 없는 회의록(m-2)은 건드리지 않는다
    expect(builders.minutes).toHaveLength(2)
    expect(builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-q-p1' })
    expect(builders.minutes[1].eq).toHaveBeenCalledWith('id', 'm-1')
    expect(builders.minutes[1].eq).not.toHaveBeenCalledWith('id', 'm-2')
  })

  it('대상 프로젝트 모두 관리자면 통과한다', async () => {
    mocks.actorFromUser.mockResolvedValue(wsMember({
      projectWorkspace: new Map([[P1, WS], [P2, WS]]),
      projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'admin']]),
    }))
    useProjectBatch([pMinute(1, P1, 'p1'), pMinute(2, P2, 'p2')])
    const res = await POST(post(body({ items: [item(1), item(2)] })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.summary).toMatchObject({ total: 2, moved: 2, not_found: 0, failed: 0 })
    expect(json.results.map((r: { folder_id: string }) => r.folder_id)).toEqual(['f-q-p1', 'f-q-p2'])
  })

  it('자격증명이 허용하지 않는 프로젝트의 회의록은 그 프로젝트 관리자여도 failed(forbidden_project)', async () => {
    mocks.actorFromUser.mockResolvedValue(wsMember({
      projectWorkspace: new Map([[P1, WS], [P2, WS]]),
      projectRoles: new Map<string, ProjectRole>([[P1, 'admin'], [P2, 'admin']]),
    }))
    const { builders } = useProjectBatch(
      [pMinute(1, P1, 'p1'), pMinute(2, P2, 'p2')], [{ data: [{ id: 'm-1' }] }],
      { integration_credentials: CRED.with({ project_ids: [P1] }).queue() },
    )
    const res = await POST(post(body({ dry_run: false, items: [item(1), item(2)] })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q-p1' })
    expect(json.results[1]).toMatchObject({ external_id: EID(2), status: 'failed', reason: 'forbidden_project' })
    expect(builders.minutes).toHaveLength(2)
    expect(builders.minutes[1].eq).toHaveBeenCalledWith('id', 'm-1')
  })

  it('무프로젝트 회의록은 그 워크스페이스 관리자만 — 프로젝트 관리자만으로는 failed(forbidden_project), 옮기지 않는다', async () => {
    mocks.actorFromUser.mockResolvedValue(projectAdmin(P1))
    const denied = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const res = await POST(post(body({ dry_run: false, items: [item(1)] })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0]).toEqual({ external_id: EID(1), status: 'failed', reason: 'forbidden_project', from: ['MES'] })
    expect(json.summary).toMatchObject({ total: 1, moved: 0, failed: 1 })
    expect(denied.builders.minutes).toHaveLength(1)   // 대상 조회뿐 — update 없음

    mocks.actorFromUser.mockResolvedValue(wsAdmin())
    const allowed = useBatch([minute(1)], [{ data: [{ id: 'm-1' }] }])
    const ok = await POST(post(body({ dry_run: false, items: [item(1)] })))
    expect(ok.status).toBe(200)
    expect((await ok.json()).results[0]).toMatchObject({ status: 'moved', folder_id: 'f-q' })
    expect(allowed.builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-q' })
  })

  it('다른 워크스페이스 회의록은 not_found 로 보고한다 — 존재를 드러내지 않고 옮기지 않는다', async () => {
    // 그 워크스페이스에서도 관리자인 호출자다 — 그래도 자격증명 워크스페이스 밖은 보이지 않는다.
    mocks.actorFromUser.mockResolvedValue(wsMember({
      workspaceRoles: new Map<string, WorkspaceRole>([[WS, 'admin'], [WS_OTHER, 'admin']]),
    }))
    const { builders } = useBatch([minute(1, { workspace_id: WS_OTHER, project_id: 'p-foreign' })])
    const res = await POST(post(body({ dry_run: false, items: [item(1)] })))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.results[0]).toEqual({ external_id: EID(1), status: 'not_found' })
    expect(builders.minutes).toHaveLength(1)
  })
})
