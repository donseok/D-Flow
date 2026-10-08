import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  revalidatePath: vi.fn(),
  ingestMinute: vi.fn(async () => {}),
  generateMinuteInsights: vi.fn(async () => {}),
  enqueueAndProcessMinuteWiki: vi.fn(async () => {}),
  enqueueMinuteWikiProcessing: vi.fn(async (args: { projectId?: string | null }) =>
    args.projectId ? 71 : null),
  processMinuteWikiJob: vi.fn(async () => ({
    created: 0, changed: 0, reaffirmed: 0, conflicted: 0,
  })),
  rebuildProjectWikiFromActiveMinutes: vi.fn(async () => {}),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  // 팀 마스터는 런타임 캐시(TTL+DB) — 테스트는 활성 목록을 직접 갈아끼운다(W1-b 검증용).
  activeTeamCodes: ['PMO', 'ERP', 'MES', '가공', 'MDM'] as string[],
  // Task 6 — 프로젝트 스코프 활성 팀 목록. 기본 구현은 beforeEach 에서 건다(초기화 시점에
  // mocks.activeTeamCodes 를 참조하면 자기 참조로 TS 순환 추론 에러가 난다).
  activeTeamCodesForProject: vi.fn<(projectId: string) => string[]>(),
  // SP2 Task 12 — meta 의 teams 는 호출자 워크스페이스들의 합집합.
  activeTeamCodesForWorkspace: vi.fn<(workspaceId: string) => string[]>(),
  // SP2 Task 16b — GET 목록의 담당 필터는 호출자가 볼 수 있는 팀(teamViewOf). 기본 구현은 beforeEach 에서 건다.
  activeTeamCodesVisibleTo: vi.fn<(view: TeamView) => string[]>(),
  // SP4 A2 — 원천 teamCodesVisibleTo 의 호출(둘째 인자 = 세션 없는 경로의 service_role)을 본다
  visibleSpy: vi.fn(),
  // 0006 — 프로젝트 없는 신규 등록의 워크스페이스 해석(actorFromUser → resolveSoleWorkspaceId).
  actorFromUser: vi.fn(),
}))
// 소속은 fixture 로 준다 — 실구현(buildActor)은 이 스위트의 테이블 큐를 소비해 버린다.
vi.mock('@/lib/authz', () => ({ actorFromUser: mocks.actorFromUser }))
// 회의 범주(B4) — 기본 어휘 프로젝트(설정 해석기 대신)
vi.mock('@/lib/settings/vocabGuard', async (importOriginal) => {
  const { defaultVocab } = await import('@/lib/settings/vocab')
  return {
    ...(await importOriginal<typeof import('@/lib/settings/vocabGuard')>()),
    loadProjectVocab: vi.fn(async (_pid: string, key: 'meetings.categories') => ({ ok: true, value: defaultVocab(key) })),
  }
})

vi.mock('@/lib/minutes/teamScope', () => ({
  activeTeamCodesForMinuteScope: async (scope: { projectId: string | null; workspaceId: string }) =>
    scope.projectId ? mocks.activeTeamCodesForProject(scope.projectId) : mocks.activeTeamCodesForWorkspace(scope.workspaceId),
  teamCodesForMinuteScope: async (scope: { projectId: string | null; workspaceId: string }) =>
    scope.projectId ? mocks.activeTeamCodesForProject(scope.projectId) : mocks.activeTeamCodesForWorkspace(scope.workspaceId),
}))
vi.mock('@/lib/teams/source', () => ({
  teamCodesVisibleTo: async (view: TeamView, opts?: unknown) => { mocks.visibleSpy(view, opts); return mocks.activeTeamCodesVisibleTo(view) },
  workspaceTeams: async (workspaceId: string) => (mocks.activeTeamCodesForWorkspace(workspaceId) as string[]).map((code, i) => ({
    id: `t-${code}`, code, name: code, color: '#6b7280', sortOrder: i, active: true, progressVisible: true, projectId: null, workspaceId })),
  // 자격증명 경로의 담당 팀 해석(resolveCredentialTeam)은 범위의 팀 행을 읽는다 — 프로젝트 범위는 프로젝트 활성 팀 목록에서 만든다
  projectTeams: async (projectId: string) => (mocks.activeTeamCodesForProject(projectId) as string[]).map((code, i) => ({
    id: `t-${code}`, code, name: code, color: '#6b7280', sortOrder: i, active: true, progressVisible: true, projectId: null, workspaceId: null })),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
// 최상위 폴더 모드(SP5 B2) — 기본 teams(v2.8 그대로). custom 분기는 아래 v2.9 절이 바꾼다
vi.mock('@/lib/minutes/rootMode', () => ({ loadRootFolders: vi.fn(async () => ({ ok: true, value: { mode: 'teams' } })) }))
// inline meeting 헬퍼(minutes/meetings.ts)가 revalidatePath 를 호출한다 — vitest(요청 스코프 밖)
// 에서는 throw 하므로 after() 와 같은 이유로 목킹한다.
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/lib/ai/minutes-ingest', () => ({ ingestMinute: mocks.ingestMinute }))
vi.mock('@/lib/ai/minutes-insights', () => ({ generateMinuteInsights: mocks.generateMinuteInsights }))
vi.mock('@/lib/ai/wiki-ingest', () => ({
  enqueueAndProcessMinuteWiki: mocks.enqueueAndProcessMinuteWiki,
  enqueueMinuteWikiProcessing: mocks.enqueueMinuteWikiProcessing,
  processMinuteWikiJob: mocks.processMinuteWikiJob,
  rebuildProjectWikiFromActiveMinutes: mocks.rebuildProjectWikiFromActiveMinutes,
}))
// after()는 요청 스코프 밖(vitest)에서 throw — 콜백을 수집해 테스트가 명시적으로 실행·단언한다.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => Promise<void> | void) => { mocks.afterCallbacks.push(cb) } }
})

import { GET, POST } from '@/app/api/v1/minutes/route'
import { teamCodesVisibleTo, type Team } from '@/lib/domain/teams'
import { POST as LINK } from '@/app/api/v1/minutes/link/route'
import { GET as META } from '@/app/api/v1/minutes/meta/route'
import { profileRowFor, type FakeAccount } from '../fixtures/profiles'
import type { Actor, ProjectRole, TeamView } from '@/lib/domain/authz'
import { makeActor as baseMakeActor, makeSuperuser as baseMakeSuperuser } from '../fixtures/actor'
import { CRED_WS, minutesCredential, type CredentialRow, type TestCredential } from '../fixtures/credentials'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { loadRootFolders } from '@/lib/minutes/rootMode'

// SP7 §5.1.4 — 인증 원천은 integration_credentials(kind='minutes_api') 행 하나뿐이다. 이 스위트의 기본 호출자는 CRED_WS 에 묶인
// 자격증명(전 프로젝트)으로 들어오고, actor fixture 의 소속 워크스페이스도 그 워크스페이스다(공용 fixture 의 'ws-1' 은 UUID 가 아니라
// resolvedRow 검사를 통과하지 못한다).
const WS = CRED_WS
/** 자격증명을 다른 워크스페이스에 묶어 보는 케이스용 — UUID 여야 한다. */
const W2_UUID = '5a000000-0000-4000-8000-000000000002'
const WS_SLUG = 'cred-ws'
const makeActor = (over: Partial<Actor> = {}) => baseMakeActor({ workspaceRoles: new Map([[WS, 'member']]), ...over })
const makeSuperuser = (over: Partial<Actor> = {}) => baseMakeSuperuser({ workspaceRoles: new Map([[WS, 'member']]), ...over })
const CRED = minutesCredential()
/** 지금 integration_credentials 표에 들어 있는 행 — useCredential 로 변형하고 beforeEach 가 되돌린다(토큰은 같다). */
let activeCred: TestCredential = CRED
function useCredential(over: Partial<CredentialRow>): TestCredential { activeCred = CRED.with(over); return activeCred }
/** 루프·보조 함수 안에서 부르는 별칭 — 이름이 use 로 시작하면 훅 규칙(react-hooks/rules-of-hooks)이 오탐한다. */
const setCredential = useCredential
/** 삭제된 옛 단일 시크릿 — 이 값을 Bearer 로 보내도 401 이어야 한다(env 에 설정돼 있어도). */
const LEGACY_SECRET = 'test-minutes-secret'
const EXTERNAL_ID = 'ddobak:0198c9f2-3a41-7c22-b1e4-9f3d2a8c1b77'
const MINUTE_UUID = '3f2b9c4e-8a1d-4c7b-9e2f-1a5d8c3b7e90'
const MEETING_UUID = '7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f'
const PROJECT_UUID = '90b95d7d-8d5c-4f8c-9915-4a07b876af27'
const OLD_PROJECT_UUID = 'e91f75a0-8a6b-4ff9-9ceb-407fa8e73de0'
const USER = { id: 'u-1', email: 'lead@example.com', user_metadata: { full_name: '팀장' } }

type QueryResponse = {
  data?: unknown
  error?: { message?: string; code?: string } | null
  count?: number | null
}

/** thenable query builder — 체인 메서드 전부 builder 반환, await 시 응답 resolve (index-worker 테스트 관례). */
function queryBuilder(response: QueryResponse | (() => QueryResponse)) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => Promise<unknown>
  } = {}
  for (const method of [
    'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq', 'is', 'not',
    'gte', 'lte', 'in', 'or', 'order', 'range', 'limit', 'maybeSingle', 'single',
  ]) builder[method] = vi.fn(() => builder)
  builder.then = (resolve, reject) => {
    const result = typeof response === 'function' ? response() : response
    return Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve, reject)
  }
  return builder
}

type FakeUser = FakeAccount

/** 테이블별 응답 큐 — from(table) 호출 순서대로 소비. builders에 호출된 빌더를 남겨 인자 단언에 쓴다. */
function fakeAdmin(
  tables: Record<string, QueryResponse[]> = {},
  users: FakeUser[] = [USER],
  opts: { usersError?: boolean } = {},
) {
  const builders: Record<string, ReturnType<typeof queryBuilder>[]> = {}
  const admin = {
    from: vi.fn((table: string) => {
      let b: ReturnType<typeof queryBuilder>
      if (table === 'profiles' && !tables.profiles) {
        // resolveUserByEmail — eq('email', 정규화 값)으로 계정 fixture 에서 찾는다(0003 profiles).
        let email: unknown
        b = queryBuilder(() => opts.usersError
          ? { error: { message: 'profiles unavailable' } }
          : { data: profileRowFor(users, email) })
        b.eq = vi.fn((col: string, val: unknown) => { if (col === 'email') email = val; return b })
      } else if (table === 'teams' && !tables.teams) {
        // 팀 루트 지연 생성(ensureTeamRoot — SP5 B2)의 팀 조회 — 큐가 없으면 그 code 의 활성 공용 팀이 하나 있다(v2.8 의 활성 팀 판정과 같은 전제)
        let code: unknown
        b = queryBuilder(() => ({ data: [{ id: `t-${String(code)}`, code, name: code, project_id: null, active: true }] }))
        b.eq = vi.fn((col: string, val: unknown) => { if (col === 'code') code = val; return b })
      } else if (table === 'integration_credentials' && !tables.integration_credentials) {
        // resolveCredential — prefix 조회(행) → last_used_at 갱신(null). prefix 가 다르면 행이 없다.
        let updating = false
        let prefix: unknown
        b = queryBuilder(() => (updating ? { data: null } : { data: prefix === activeCred.prefix ? activeCred.row : null }))
        b.update = vi.fn(() => { updating = true; return b })
        b.eq = vi.fn((col: string, val: unknown) => { if (col === 'token_prefix') prefix = val; return b })
      } else if (table === 'workspace_members' && !tables.workspace_members) {
        // isMinutesWorkspaceMember — 큐가 없으면 호출자는 자격증명 워크스페이스의 멤버다. 비멤버는 [{ data: null }] 큐로 준다.
        b = queryBuilder({ data: { role: 'member' } })
      } else if (table === 'workspaces' && !tables.workspaces) {
        // 응답 URL 의 slug(POST)·meta 의 workspace 정보 — 조회한 id 를 그대로 돌려준다
        let id: unknown
        b = queryBuilder(() => ({ data: { id, slug: WS_SLUG, name: '자격증명 워크스페이스' } }))
        b.eq = vi.fn((col: string, val: unknown) => { if (col === 'id') id = val; return b })
      } else {
        const queued = (tables[table] ?? []).shift()
        b = queryBuilder(queued ?? { data: null, error: null })
      }
      ;(builders[table] ??= []).push(b)
      return b
    }),
    // 회의록+v1 생성 및 본문+새 버전 교체는 0045 RPC 한 트랜잭션으로 수행된다.
    // 기존 fixture의 두 번째 minutes 응답을 RPC 결과로 변환해 테스트 의도는 그대로 유지한다.
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      const queued = (tables.minutes ?? []).shift() ?? { data: null, error: null }
      if (queued.error) return queryBuilder(queued)
      const row = queued.data as Record<string, unknown> | null
      if (fn === 'create_minute_with_version') {
        return queryBuilder({
          data: row
            ? {
                minute_id: row.id,
                version_id: 'mv-1',
                created_at: row.created_at,
                updated_at: row.updated_at,
                wiki_rebuild_required:
                  row.wiki_rebuild_required === true || args.p_project_id != null,
              }
            : null,
        })
      }
      if (fn === 'commit_minute_body_version') {
        return queryBuilder({
          data: row
            ? {
                version_id: 'mv-2',
                wiki_rebuild_required: row.wiki_rebuild_required === true,
              }
            : null,
        })
      }
      return queryBuilder({ data: null, error: { message: `unexpected rpc: ${fn}` } })
    }),
  }
  return { admin, builders }
}

function useAdmin(
  tables: Record<string, QueryResponse[]> = {},
  users: FakeUser[] = [USER],
  opts: { usersError?: boolean } = {},
) {
  const fake = fakeAdmin(tables, users, opts)
  mocks.createAdminClient.mockReturnValue(fake.admin)
  return fake
}
/** 루프·보조 함수 안에서 부르는 별칭 — 이름이 use 로 시작하면 훅 규칙(react-hooks/rules-of-hooks)이 오탐한다. */
const seedAdmin = useAdmin

function post(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/minutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRED.token}`, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function get(path: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${CRED.token}`, ...headers },
  })
}

function link(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/minutes/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRED.token}`, ...headers },
    body: JSON.stringify(body),
  })
}

const payload = {
  user_email: 'lead@example.com',
  date: '2026-07-16',
  team: 'PMO',
  title: 'PMO-주간회의_260716',
  body_markdown: '# 회의록\n\n안건 정리',
  external_id: EXTERNAL_ID,
}

const existingRow = {
  id: 'm-1',
  minute_date: '2026-07-01',
  team_code: 'PMO',
  title: '옛제목',
  body_md: '# 옛 회의록\n\n기존 본문',
  meeting_id: null,
  project_id: null,
  meeting_occurrence_date: null,
  archived_at: null,
  external_id: EXTERNAL_ID,
  // 재전송 호출자(USER)가 작성자다 — replace 는 작성자 또는 그 프로젝트 관리자만(SP2 Task 13).
  created_by: 'u-1',
  created_by_name: '원작성자',
  created_at: '2026-07-01T00:00:00+00:00',
  updated_at: '2026-07-01T00:00:00+00:00',
  workspace_id: WS,
}

async function runAfterCallbacks() {
  for (const cb of mocks.afterCallbacks) await cb()
}

/**
 * 인증(자격증명 조회 + last_used_at 갱신)만 하고 다른 표는 건드리지 않았다 — 옛 'createAdminClient 미호출(DB 접근 전)' 단언의 대응.
 * 자격증명 경로는 인증 자체가 integration_credentials 를 읽으므로 "그 밖의 표를 읽기 전"으로 본다.
 */
function expectAuthOnly(builders: Record<string, unknown[]>) {
  expect(Object.keys(builders)).toEqual(['integration_credentials'])
  expect(builders.integration_credentials).toHaveLength(2)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.afterCallbacks.length = 0
  activeCred = CRED
  mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공', 'MDM']
  // clearAllMocks 는 mockImplementation 을 지우지 않는다 — 개별 테스트의 override 가 다음
  // 테스트로 새지 않도록 기본 구현을 매번 다시 건다.
  mocks.activeTeamCodesForProject.mockImplementation(() => mocks.activeTeamCodes)
  mocks.activeTeamCodesForWorkspace.mockImplementation(() => mocks.activeTeamCodes)
  // 가시 팀 기본값 — 플랫폼 관리자는 전부, 아니면 소속 워크스페이스 공용 팀의 합집합(전용 팀은 개별 테스트가 fixture 로 본다).
  mocks.activeTeamCodesVisibleTo.mockImplementation(view => (view.all
    ? mocks.activeTeamCodes
    : [...new Set([...view.workspaceIds].flatMap(w => mocks.activeTeamCodesForWorkspace(w)))]))
  // 기본 호출자 — WS 멤버이고 PROJECT_UUID·OLD_PROJECT_UUID 의 명단 member(meeting_id 연결 자격, SP2 Task 13).
  mocks.actorFromUser.mockResolvedValue(makeActor({
    userId: USER.id,
    projectWorkspace: new Map([[PROJECT_UUID, WS], [OLD_PROJECT_UUID, WS]]),
    projectRoles: new Map<string, ProjectRole>([[PROJECT_UUID, 'member'], [OLD_PROJECT_UUID, 'member']]),
  }))
  // 킬스위치만 켠다 — 옛 시크릿(MINUTES_API_SECRET)은 설정하지 않는다(SP7: 인증에 쓰이지 않는다)
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  // W25 — folder_path 편철 스위치. 이 스위트는 켠 상태를 기본으로 검증하고,
  // 끈 상태(R1 배포 형상)는 전용 describe 에서 따로 본다.
  vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'true')
  // 후처리 rematch 래퍼의 env 가드가 확실히 잠기도록(하이라이트 경로는 이 스위트 범위 밖)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
  useAdmin()
})

describe('인증 게이트 (§3, §9.6 ①②)', () => {
  it('MINUTES_API_ENABLED 미설정이면 전 라우트 404 — 존재 은닉, DB 미접근', async () => {
    vi.stubEnv('MINUTES_API_ENABLED', 'false')
    expect((await POST(post(payload))).status).toBe(404)
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(404)
    expect((await META(get('/api/v1/minutes/meta'))).status).toBe(404)
    expect((await LINK(link({ user_email: 'a@b.c', minute_id: 'm-1', external_id: EXTERNAL_ID }))).status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('시크릿 없이 MINUTES_API_ENABLED=true 만으로 열린다 — 인증은 자격증명 행이 한다(SP7 §5.1.4)', async () => {
    vi.stubEnv('MINUTES_API_SECRET', '')
    const { admin, builders } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    expect((await POST(post(payload))).status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.any(Object))
    // 자격증명은 prefix·kind 로 한 건 읽고, 통과하면 last_used_at 을 한 번 갱신한다
    expect(builders.integration_credentials).toHaveLength(2)
    expect(builders.integration_credentials[0].eq).toHaveBeenCalledWith('token_prefix', CRED.prefix)
    expect(builders.integration_credentials[0].eq).toHaveBeenCalledWith('kind', 'minutes_api')
    expect(builders.integration_credentials[1].update).toHaveBeenCalledWith({ last_used_at: expect.any(String) })
    expect(builders.integration_credentials[1].eq).toHaveBeenCalledWith('id', CRED.row.id)
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(200)
    expect((await META(get('/api/v1/minutes/meta?user_email=lead%40example.com'))).status).toBe(200)
  })

  it('자격증명 형식이 아닌 Bearer·누락은 401 unauthorized — service_role 클라이언트도 만들지 않는다', async () => {
    const wrong = await POST(post(payload, { Authorization: 'Bearer wrong' }))
    expect(wrong.status).toBe(401)
    expect(await wrong.json()).toMatchObject({ code: 'unauthorized' })
    const missing = await GET(get('/api/v1/minutes?user_email=lead%40example.com', { Authorization: '' }))
    expect(missing.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('옛 시크릿 값 Bearer 는 이제 401 — env 에 MINUTES_API_SECRET 이 있어도 전 라우트가 거절하고 integration_credentials 를 조회하지 않는다', async () => {
    vi.stubEnv('MINUTES_API_SECRET', LEGACY_SECRET)
    const { admin, builders } = useAdmin({ minutes: [{ data: null }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }] })
    const legacy = { Authorization: `Bearer ${LEGACY_SECRET}` }
    const responses = [
      await POST(post(payload, legacy)),
      await GET(get('/api/v1/minutes?user_email=lead%40example.com', legacy)),
      await META(get('/api/v1/minutes/meta?user_email=lead%40example.com', legacy)),
      await LINK(link({ user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }, legacy)),
    ]
    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: '인증이 필요합니다.', code: 'unauthorized' })
    }
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(builders.integration_credentials).toBeUndefined()
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('자격증명 행이 없거나(다른 토큰) 회수·만료·비활성이면 401 — 인증 표 밖은 읽지 않고 last_used_at 도 갱신하지 않는다', async () => {
    const stranger = minutesCredential()   // 표에 없는 prefix
    let fake = useAdmin()
    const unknown = await POST(post(payload, { Authorization: `Bearer ${stranger.token}` }))
    expect(unknown.status).toBe(401)
    expect(Object.keys(fake.builders)).toEqual(['integration_credentials'])
    expect(fake.builders.integration_credentials).toHaveLength(1)
    for (const over of [
      { revoked_at: '2026-01-01T00:00:00Z' }, { expires_at: '2020-01-01T00:00:00Z' }, { enabled: false },
    ] as Array<Partial<CredentialRow>>) {
      setCredential(over)
      fake = seedAdmin()
      const res = await POST(post(payload))
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'unauthorized' })
      expect(Object.keys(fake.builders)).toEqual(['integration_credentials'])
      expect(fake.builders.integration_credentials).toHaveLength(1)
      expect(fake.admin.rpc).not.toHaveBeenCalled()
    }
  })

  it('호출자(user_email)가 자격증명 워크스페이스의 멤버가 아니면 전 라우트 403 unknown_user — 회의록·프로젝트를 읽지 않는다', async () => {
    const outsider = () => seedAdmin({ workspace_members: [{ data: null }] })
    let fake = outsider()
    const posted = await POST(post(payload))
    expect(posted.status).toBe(403)
    expect(await posted.json()).toMatchObject({ code: 'unknown_user' })
    expect(fake.builders.workspace_members[0].eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(fake.builders.workspace_members[0].eq).toHaveBeenCalledWith('user_id', USER.id)
    expect(fake.builders.minutes).toBeUndefined()
    expect(fake.admin.rpc).not.toHaveBeenCalled()
    fake = outsider()
    expect((await META(get('/api/v1/minutes/meta?user_email=lead%40example.com'))).status).toBe(403)
    expect(fake.builders.projects).toBeUndefined()
    fake = outsider()
    expect((await LINK(link({ user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }))).status).toBe(403)
    expect(fake.builders.minutes).toBeUndefined()
    expect(mocks.actorFromUser).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/minutes 검증 (§3.4, §6, §9.6 ③④)', () => {
  it('미지 이메일은 403 unknown_user — 레코드 미생성', async () => {
    const { builders } = useAdmin({}, [])
    const res = await POST(post(payload))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'unknown_user' })
    expect(builders.minutes).toBeUndefined()
  })

  it('삭제된 계정은 profiles 에서 사라져(cascade) 매칭되지 않아 403', async () => {
    useAdmin({}, [{ ...USER, deleted_at: '2026-01-01T00:00:00Z' }])
    const res = await POST(post(payload))
    expect(res.status).toBe(403)
  })

  it('이메일은 lower/trim 정규화 후 매칭된다', async () => {
    const { admin, builders } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-9', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, user_email: '  Lead@Example.COM ' }))
    expect(res.status).toBe(201)
    expect(builders.minutes).toHaveLength(1)
    // 계정 매칭은 profiles 한 건 조회 — 정규화된 이메일로 찾는다(전체 사용자 목록 순회 없음).
    expect(builders.profiles[0].eq).toHaveBeenCalledWith('email', 'lead@example.com')
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.any(Object))
  })

  it('user_email 누락은 400', async () => {
    const res = await POST(post({ ...payload, user_email: undefined }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
  })

  it('잘못된 JSON 바디는 400', async () => {
    expect((await POST(post('not-json{{'))).status).toBe(400)
  })

  it('필수 필드 누락(body_markdown)은 400', async () => {
    const res = await POST(post({ ...payload, body_markdown: undefined }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
  })

  it('허용 외 team은 400', async () => {
    expect((await POST(post({ ...payload, team: 'QA' }))).status).toBe(400)
  })

  it('본문 100,000자 초과는 400', async () => {
    const res = await POST(post({ ...payload, body_markdown: 'a'.repeat(100_001) }))
    expect(res.status).toBe(400)
  })

  it('external_id 빈 값/128자 초과는 400', async () => {
    expect((await POST(post({ ...payload, external_id: '' }))).status).toBe(400)
    expect((await POST(post({ ...payload, external_id: 'x'.repeat(129) }))).status).toBe(400)
  })

  it('on_conflict 허용 외 값은 400', async () => {
    expect((await POST(post({ ...payload, on_conflict: 'merge' }))).status).toBe(400)
  })

  it('meeting_id가 존재하지 않으면 404 — v2.7 부터 남의 회의와 같은 응답(존재 은닉, 종전 400)', async () => {
    useAdmin({ meetings: [{ data: null }] })
    const res = await POST(post({ ...payload, meeting_id: '00000000-0000-0000-0000-000000000000' }))
    expect(res.status).toBe(404)
  })

  it('meeting_id가 uuid 형식이 아니면 DB 조회 전에 400 (§6 형식 오류)', async () => {
    const { builders } = useAdmin()
    const res = await POST(post({ ...payload, meeting_id: 'abc' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    expect(builders.meetings).toBeUndefined()
  })

  it('계정(profiles) 조회 실패는 403이 아니라 500 — 장애를 사용자 없음으로 오귀속 금지', async () => {
    useAdmin({}, [USER], { usersError: true })
    const res = await POST(post(payload))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'internal_error' })
  })
})

describe('POST /api/v1/minutes upsert (§4, §9.6 ⑤⑥⑦⑧⑨)', () => {
  it('신규는 201 created — external_id·작성자 귀속 저장 + 후처리(ingest→insights)', async () => {
    const { admin, builders } = useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-19T01:00:00+00:00', updated_at: '2026-07-19T01:00:00+00:00' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toMatchObject({
      ok: true, id: 'm-1', action: 'created',
      title: payload.title, date: payload.date, team: 'PMO',
      external_id: EXTERNAL_ID, created_by_name: '팀장',
      // 자격증명 경로의 url 은 쓰기 대상 워크스페이스의 slug 경로다(v3) — slug 는 workspaces 를 그 id 로 읽는다
      url: `http://localhost/w/${WS_SLUG}/minutes/m-1`,
    })
    expect(builders.workspaces[0].eq).toHaveBeenCalledWith('id', WS)
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_minute_date: payload.date,
      p_team_code: 'PMO',
      p_title: payload.title,
      p_body_md: payload.body_markdown,
      p_external_id: EXTERNAL_ID,
      p_actor_id: 'u-1',
      p_actor_name: '팀장',
    }))
    expect(mocks.afterCallbacks).toHaveLength(1)
    await runAfterCallbacks()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.generateMinuteInsights).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.enqueueMinuteWikiProcessing).toHaveBeenCalledWith(expect.objectContaining({
      minuteId: 'm-1',
      minuteVersionId: 'mv-1',
      projectId: null,
      bodyMd: payload.body_markdown,
    }))
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('신규 insert는 담당 팀 루트 폴더로 자동 편철 — folder_id 세팅(0043)', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-24T01:00:00+00:00', updated_at: '2026-07-24T01:00:00+00:00' } },
      ],
      // Task 6 이후 폴백은 resolveFolderPath(path: []) 공유 구현을 태운다 — 순수 select 가
      // 아니라 스냅샷 전체 로드(loadFolderSnapshot)라 응답이 배열이다.
      minute_folders: [{ data: [{ id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version',
      expect.objectContaining({ p_folder_id: 'f-pmo' }),
    )
  })

  it('팀 루트 폴더 조회 실패는 미분류(null) 폴백 — 등록은 막지 않는다(201)', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-24T01:00:00+00:00', updated_at: '2026-07-24T01:00:00+00:00' } },
      ],
      minute_folders: [{ data: null, error: { message: 'lookup down' } }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version',
      expect.objectContaining({ p_folder_id: null }),
    )
  })

  it('W1-b: 6번째 팀을 등록하면 meta 가 노출하는 그 팀으로 POST 가 통과한다', async () => {
    // 수정 전에는 validateMinuteInput 이 @deprecated 하드코딩 5팀을 써서 전건 400 이었다.
    mocks.activeTeamCodes = ['PMO', 'ERP', 'MES', '가공', 'MDM', '신설팀']
    useAdmin({
      minutes: [
        { data: null },
        { data: { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' } },
      ],
      minute_folders: [{ data: [{ id: 'f-new', name: '신설팀', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-신설팀', team: { code: '신설팀', project_id: null }, workspace_id: WS }] }],
    })
    const res = await POST(post({ ...payload, team: '신설팀' }))
    expect(res.status).toBe(201)
  })

  it('W1-b: 활성 목록에 없는 팀은 그대로 400', async () => {
    const res = await POST(post({ ...payload, team: '없는팀' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('잘못된 담당입니다.')
  })

  it('같은 external_id 재전송(기본 replace)은 200 replaced — D3 범위만 갱신, 소유권 불변', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: existingRow },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-19T02:00:00+00:00' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true, id: 'm-1', action: 'replaced', created_by_name: '원작성자',
    })
    const commitCall = admin.rpc.mock.calls.find(
      ([fn]) => fn === 'commit_minute_body_version',
    )
    expect(commitCall).toBeDefined()
    const committed = commitCall![1]
    expect(committed).toMatchObject({
      p_minute_id: 'm-1',
      p_body_md: payload.body_markdown,
      p_actor_id: 'u-1',
      p_metadata: expect.objectContaining({
        minute_date: payload.date,
        team_code: 'PMO',
        title: payload.title,
        project_id: null,
      }),
    })
    const metadata = committed.p_metadata as Record<string, unknown>
    // §0 D3 — 소유권·멱등키는 갱신 범위 밖, meeting_id는 미전송이므로 유지(v2.2)
    expect(Object.keys(metadata)).not.toContain('created_by')
    expect(Object.keys(metadata)).not.toContain('created_by_name')
    expect(Object.keys(metadata)).not.toContain('external_id')
    expect(metadata.meeting_id).toBe(existingRow.meeting_id)
    await runAfterCallbacks()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-1', payload.body_markdown)
    expect(mocks.generateMinuteInsights).toHaveBeenCalledWith('m-1', payload.body_markdown)
  })

  it('on_conflict=skip은 200 skipped — 변경 없이 기존 레코드 반환', async () => {
    const { builders } = useAdmin({ minutes: [{ data: existingRow }] })
    const res = await POST(post({ ...payload, on_conflict: 'skip' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'skipped', title: '옛제목', date: '2026-07-01' })
    expect(builders.minutes).toHaveLength(1)
    expect(mocks.afterCallbacks).toHaveLength(0)
  })

  it('on_conflict=error는 409 conflict', async () => {
    useAdmin({ minutes: [{ data: existingRow }] })
    const res = await POST(post({ ...payload, on_conflict: 'error' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'conflict' })
  })

  it('기존 레코드가 없으면 on_conflict 값과 무관하게 항상 201 created (§4.2 보장)', async () => {
    useAdmin({ minutes: [{ data: null }, { data: { id: 'm-2', created_at: 't', updated_at: 't' } }] })
    expect((await POST(post({ ...payload, on_conflict: 'error' }))).status).toBe(201)
  })

  it('4마커 헤더가 있어도 시간(+9h) 보정을 하지 않는다 (§1.4 회귀 방지 — 필수)', async () => {
    const ddobakBody = [
      '# 주간회의_260716', '',
      '- **날짜**: 2026-07-16',
      '- **시간**: 14:00 ~ 15:10',
      '- **상태**: 완료',
      '- **생성자**: alice@example.com', '',
      '## AI 회의록',
    ].join('\n')
    const { admin } = useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-3', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, body_markdown: ddobakBody }))
    expect(res.status).toBe(201)
    const args = admin.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args.p_body_md).toBe(ddobakBody)
    expect(args.p_body_md).toContain('14:00 ~ 15:10')
  })

  it('replace 경로도 4마커 본문을 무보정으로 저장한다 (§9.6 ⑨ — 또박또박 일상 흐름은 재전송)', async () => {
    const ddobakBody = [
      '# 주간회의_260716', '',
      '- **날짜**: 2026-07-16',
      '- **시간**: 14:00 ~ 15:10',
      '- **상태**: 완료',
      '- **생성자**: alice@example.com',
    ].join('\n')
    const { admin } = useAdmin({
      minutes: [{ data: existingRow }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, body_markdown: ddobakBody }))
    expect(res.status).toBe(200)
    const args = admin.rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args.p_body_md).toBe(ddobakBody)
    expect(args.p_body_md).toContain('14:00 ~ 15:10')
  })

  it('meeting_id가 존재하면 프로젝트 ordered rebuild로 저장·응답된다', async () => {
    const { admin, builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: null }, { data: { id: 'm-5', created_at: 't', updated_at: 't' } }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    expect((await res.json()).meeting_id).toBe(MEETING_UUID)
    expect(builders.meetings[0].select).toHaveBeenCalledWith('id, project_id')
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_meeting_id: MEETING_UUID,
      p_project_id: PROJECT_UUID,
    }))
    await runAfterCallbacks()
    expect(mocks.enqueueMinuteWikiProcessing).toHaveBeenCalledWith(expect.objectContaining({
      minuteId: 'm-5',
      projectId: PROJECT_UUID,
      minuteVersionId: 'mv-1',
    }))
    expect(mocks.rebuildProjectWikiFromActiveMinutes).toHaveBeenCalledWith(PROJECT_UUID)
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('과거 시점 신규 회의록도 단일 job 선처리 대신 durable 프로젝트 rebuild를 진행한다', async () => {
    useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [
        { data: null },
        {
          data: {
            id: 'm-backdated',
            created_at: '2026-07-26T01:00:00+00:00',
            updated_at: '2026-07-26T01:00:00+00:00',
            wiki_rebuild_required: true,
          },
        },
      ],
    })

    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    await runAfterCallbacks()

    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenCalledWith(PROJECT_UUID)
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
    expect(mocks.ingestMinute).toHaveBeenCalledWith('m-backdated', payload.body_markdown)
  })

  it('replace: meeting_id 미전송은 기존 연결 유지, 명시적 null은 해제 (§0 D3 v2.2)', async () => {
    const withMeeting = { ...existingRow, meeting_id: MEETING_UUID }
    // 미전송 → 갱신 범위에서 제외 + 기존 값 echo
    let fake = useAdmin({
      minutes: [{ data: withMeeting }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    let res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect((await res.json()).meeting_id).toBe(MEETING_UUID)
    let metadata = fake.admin.rpc.mock.calls[0][1].p_metadata as Record<string, unknown>
    expect(metadata.meeting_id).toBe(MEETING_UUID)
    // 명시적 null → 해제
    fake = useAdmin({
      minutes: [{ data: withMeeting }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
    })
    res = await POST(post({ ...payload, meeting_id: null }))
    expect(res.status).toBe(200)
    expect((await res.json()).meeting_id).toBeNull()
    metadata = fake.admin.rpc.mock.calls[0][1].p_metadata as Record<string, unknown>
    expect(metadata.meeting_id).toBeNull()
  })

  it('replace로 프로젝트가 바뀌면 old/new Wiki를 모두 재구성하고 단일 job을 직접 처리하지 않는다', async () => {
    useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [
        { data: { ...existingRow, project_id: OLD_PROJECT_UUID } },
        { data: { id: 'm-1', created_at: 't', updated_at: 't' } },
      ],
    })

    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(200)
    await runAfterCallbacks()

    expect(mocks.rebuildProjectWikiFromActiveMinutes).toHaveBeenCalledTimes(2)
    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenNthCalledWith(1, OLD_PROJECT_UUID, 'm-1')
    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenNthCalledWith(2, PROJECT_UUID)
    expect(mocks.enqueueMinuteWikiProcessing).toHaveBeenCalledWith(expect.objectContaining({
      projectId: PROJECT_UUID,
      minuteId: 'm-1',
      minuteVersionId: 'mv-2',
    }))
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('replace에서 본문이 바뀌면 같은 프로젝트의 최신 회의록 버전을 시간순 재구성한다', async () => {
    useAdmin({
      minutes: [
        { data: { ...existingRow, project_id: PROJECT_UUID } },
        {
          data: {
            id: 'm-1',
            created_at: 't',
            updated_at: 't',
            wiki_rebuild_required: true,
          },
        },
      ],
    })

    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    await runAfterCallbacks()

    expect(mocks.rebuildProjectWikiFromActiveMinutes)
      .toHaveBeenCalledWith(PROJECT_UUID)
    expect(mocks.processMinuteWikiJob).not.toHaveBeenCalled()
  })

  it('동시 전송 경합(insert 23505)은 기존 레코드 기준 replace로 수렴한다', async () => {
    useAdmin({
      minutes: [
        { data: null },
        { error: { code: '23505', message: 'duplicate key' } },
        { data: existingRow },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: 'u' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'replaced' })
  })

  it('동시 전송 경합으로 생긴 행도 자격증명 범위를 다시 본다 — 다른 워크스페이스의 행이면 404(덮어쓰지 않는다)', async () => {
    const { admin } = useAdmin({
      minutes: [
        { data: null },
        { error: { code: '23505', message: 'duplicate key' } },
        { data: { ...existingRow, workspace_id: '5a000000-0000-4000-8000-0000000000ff' } },
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(404)
    expect(admin.rpc).not.toHaveBeenCalledWith('replace_minute_version', expect.anything())
  })

  it('replace 후처리: rematch(하이라이트) 복제본이 ingest보다 먼저 실행된다 (§4.5-7)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key')
    const { builders } = useAdmin({
      minutes: [{ data: existingRow }, { data: { id: 'm-1', created_at: 't', updated_at: 't' } }],
      minute_highlights: [
        {
          data: [{
            id: 'h-1', created_by: 'u-1', created_by_name: null,
            block_index: 0, block_hash: 'stale-hash', created_at: 't',
          }],
        },
        { data: null }, // 재배정 불가 행 delete
      ],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    await runAfterCallbacks()
    expect(builders.minute_highlights).toHaveLength(2)
    expect(builders.minute_highlights[1].delete).toHaveBeenCalled()
    const deleteOrder = builders.minute_highlights[1].delete.mock.invocationCallOrder[0]
    const ingestOrder = mocks.ingestMinute.mock.invocationCallOrder[0]
    expect(deleteOrder).toBeLessThan(ingestOrder)
  })
})

describe('folder_path 편철 (v2.3 §3.1~§3.3 — W3·W4·W5)', () => {
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }
  const insertQueue = [{ data: null }, { data: created }]
  // resolveFolderPath 는 폴더 전량 스냅샷 1회 + 부족분 insert 순으로 질의한다.
  const SEED_PMO = { id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }
  const snapshot = (...rs: Array<Record<string, unknown>>) => ({ data: [SEED_PMO, ...rs] })

  /** 신규 등록 경로의 minute_folders 응답 큐를 세팅한다. */
  function useInsert(folderQueue: Array<{ data?: unknown; error?: { message?: string; code?: string } }>) {
    return useAdmin({ minutes: [...insertQueue], minute_folders: folderQueue })
  }

  it('경로대로 편철하고 응답에 folder_id·folder_path 를 에코한다', async () => {
    const { admin } = useInsert([
      snapshot({ id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9', workspace_id: WS }),
      { data: { id: 'f-w' } },                                            // 주간정례 생성
    ])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질', '주간정례'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_id: 'f-w', folder_path: ['PMO', '품질', '주간정례'],
    })
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-w' }),
    )
  })

  it('자유 루트는 팀 루트 아래로 한 칸 내려 편철하고 그 경로를 에코한다(§3.2 ②)', async () => {
    useInsert([snapshot(), { data: { id: 'f-tf' } }, { data: { id: 'f-kick' } }])
    const res = await POST(post({ ...payload, folder_path: ['신규TF', '킥오프'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_id: 'f-kick', folder_path: ['PMO', '신규TF', '킥오프'],
    })
  })

  it('folder_path: [] 는 팀 루트 편철 — folder_path 에코는 [팀코드]', async () => {
    const { admin } = useInsert([snapshot()])
    const res = await POST(post({ ...payload, folder_path: [] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-pmo' }),
    )
  })

  it('키 부재는 회귀 없음 — 기존 팀 루트 편철 + 에코 [팀코드]', async () => {
    useInsert([snapshot()])
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
  })

  it('시드 루트 부재 → folder_id·folder_path 둘 다 null (E1: [] 아님), 등록은 201', async () => {
    const { admin } = useInsert([{ data: [] }])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.folder_id).toBeNull()
    expect(json.folder_path).toBeNull()          // [] 로 두면 "팀 루트 편철됨"이라는 정반대 안내가 된다
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: null }),
    )
  })

  it('v2.9 custom 모드: 루트가 지정 폴더가 아니면 미분류(unclassified·null 둘) — 팀 code 루트도 한 칸 내리지 않는다, 등록은 201', async () => {
    vi.mocked(loadRootFolders).mockResolvedValueOnce({ ok: true, value: { mode: 'custom', names: ['외부 연동'] } })
    const { admin } = useInsert([snapshot()])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: null, folder_path: null, folder_path_status: 'unclassified' })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({ p_folder_id: null }))
  })

  it('v2.9 — 모드를 못 읽으면 쓰지 않는다(500, 새 오류 code 없음)', async () => {
    vi.mocked(loadRootFolders).mockResolvedValueOnce({ ok: false })
    const { admin } = useInsert([snapshot()])
    const res = await POST(post({ ...payload, folder_path: ['PMO'] }))
    expect(res.status).toBe(500)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('6단 경로는 5단으로 절단해 편철하고 절단된 경로를 에코한다', async () => {
    useInsert([
      snapshot(),
      { data: { id: 'f-a' } }, { data: { id: 'f-b' } },
      { data: { id: 'f-c' } }, { data: { id: 'f-d' } },
    ])
    const res = await POST(post({ ...payload, folder_path: ['신규TF', 'A', 'B', 'C', 'D'] }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.folder_path).toEqual(['PMO', '신규TF', 'A', 'B', 'C'])   // 5단
    expect(json.folder_id).toBe('f-d')
  })

  it('타 팀의 팀코드가 최상위면 400 validation_failed (§3.2 ③)', async () => {
    const res = await POST(post({ ...payload, folder_path: ['ERP', '영업'] }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('validation_failed')
  })

  it('61자 폴더명은 400 — 절단하지 않는다(D3)', async () => {
    const res = await POST(post({ ...payload, folder_path: ['PMO', '가'.repeat(61)] }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('61자')
  })

  it('배열이 아니면 400', async () => {
    expect((await POST(post({ ...payload, folder_path: 'PMO/품질' }))).status).toBe(400)
    expect((await POST(post({ ...payload, folder_path: null }))).status).toBe(400)
  })

  it('동시 전송 경합(23505) 흡수 — 500 없이 재조회한 폴더로 편철', async () => {
    useInsert([
      snapshot(),
      { data: null, error: { code: '23505', message: 'dup' } },
      { data: { id: 'f-raced' } },
    ])
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-raced' })
  })

  it('자동 생성 폴더의 created_by 는 전송 사용자 — null(시드 표식) 금지(C4)', async () => {
    const { builders } = useInsert([snapshot(), { data: { id: 'f-q' } }])
    await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: '품질', parent_id: 'f-pmo', created_by: 'u-1', project_id: null,
    })
  })

  describe('replace 3값 규약 (D1=B · W5)', () => {
    /** replace 경로의 metadata 인자를 꺼낸다. */
    function metadataOf(admin: { rpc: { mock: { calls: unknown[][] } } }) {
      const call = admin.rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')
      return (call![1] as { p_metadata: Record<string, unknown> }).p_metadata
    }

    const replaceQueue = [
      { data: { ...existingRow, folder_id: 'f-old' } },
      { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-27T02:00:00+00:00' } },
    ]

    it('키 부재 → metadata 에 folder_id 키가 없다(기존 위치 유지)', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [{ data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }],  // 에코 역해석
      })
      const res = await POST(post(payload))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ folder_id: 'f-old', folder_path: ['PMO'] })
    })

    it('[] → 팀 루트로 되돌림(metadata 에 팀 루트 id)', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [snapshot()],
      })
      const res = await POST(post({ ...payload, folder_path: [] }))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-pmo' })
      expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
    })

    it('경로 → 그 경로로 이동', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [snapshot({ id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9', workspace_id: WS })],
      })
      const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-q' })
      expect(await res.json()).toMatchObject({ folder_id: 'f-q', folder_path: ['PMO', '품질'] })
    })

    it('부분 편철(중간 폴더 생성 실패)은 기존 위치를 유지한다 — 조상으로 강등하지 않는다', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [
          snapshot(),                                                   // 팀 루트만 존재
          { data: null, error: { code: '42501', message: 'denied' } },  // '품질' 생성 실패
          { data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] },  // 에코 역해석
        ],
      })
      const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(200)
      // 배치는 같은 상황을 failed(folder_error) 로 막는다 — replace 도 자리를 옮기지 않는다
      expect(metadataOf(admin)).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ folder_id: 'f-old' })
    })

    it('시드 루트 부재 → metadata 에 folder_id 키 없음 (미분류로 강등하지 않는다)', async () => {
      const { admin } = useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [
          { data: [] },                                                                 // 시드 루트 없음
          { data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] },   // 에코 역해석
        ],
      })
      const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(200)
      expect(metadataOf(admin)).not.toHaveProperty('folder_id')
      expect(await res.json()).toMatchObject({ folder_id: 'f-old' })
    })

    it('folder_id 는 v_index_content_changed 대상이 아니다 — 폴더만 바뀌면 위키 잡 없음', async () => {
      useAdmin({
        minutes: [...replaceQueue],
        minute_folders: [snapshot({ id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9', workspace_id: WS })],
      })
      await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
      expect(mocks.enqueueMinuteWikiProcessing).not.toHaveBeenCalled()
    })
  })
})

describe('편철 기준 트리 — 회의록 프로젝트 스코프 (0076 · Task 6)', () => {
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }
  // 같은 이름 'PMO' 시드 루트가 전역과 프로젝트에 각각 존재 — 스코프를 안 가리면 엉뚱한 쪽으로 편철된다.
  const SEED_PMO_GLOBAL = { id: 'f-pmo-global', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: WS }
  const SEED_PMO_PROJECT = {
    id: 'f-pmo-project', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: PROJECT_UUID,
  }

  it('케이스1: meetingId로 연결된 프로젝트가 있으면 그 프로젝트 트리의 시드 루트로 편철된다', async () => {
    const { admin } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [SEED_PMO_GLOBAL, SEED_PMO_PROJECT] }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID, folder_path: ['PMO'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo-project', folder_path: ['PMO'] })
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-pmo-project' }),
    )
  })

  it('케이스2: 회의 미연결 신규 등록은 전역(미지정) 트리로 편철된다', async () => {
    useAdmin({
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [SEED_PMO_GLOBAL, SEED_PMO_PROJECT] }],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo-global', folder_path: ['PMO'] })
  })

  it('케이스3: folder_path 미전송 + 프로젝트 연결 시 프로젝트 팀 루트로 편철한다(전역 루트와 안 섞인다)', async () => {
    // 폴백은 resolveFolderPath(path: []) 공유 구현을 태운다(Important 수정 — 지연 생성 포함) —
    // 전역·프로젝트 스코프에 동명 'PMO' 루트가 공존해도 프로젝트 쪽만 골라야 한다.
    useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [SEED_PMO_GLOBAL, SEED_PMO_PROJECT] }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo-project', folder_path: ['PMO'] })
  })

  it('케이스3-b: 프로젝트에 팀 루트가 아직 없으면 지연 생성한다(0076 시드 밖 — Important 수정)', async () => {
    // 0076 시드는 "회의록이 이미 있던 프로젝트"만 커버한다 — 회의록 0건 프로젝트의 첫 업로드나
    // 0076 이후 신설 팀은 시드가 없다. 순수 select 였던 예전 폴백은 이 경우 null(미분류)로
    // 떨어뜨렸지만, resolveFolderPath(path: []) 공유 구현은 프로젝트 루트를 지연 생성한다.
    const { admin, builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: null }, { data: created }],
      minute_folders: [
        { data: [] },                             // 스냅샷 — 이 프로젝트엔 아직 PMO 루트가 없다
        { data: { id: 'f-pmo-project-new' } },     // ensureProjectTeamRoot 의 insert
      ],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo-project-new', folder_path: ['PMO'] })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: 'PMO', parent_id: null, created_by: null, project_id: PROJECT_UUID, workspace_id: WS, kind: 'team_root', team_id: 't-PMO', sort: 100,
    })
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-pmo-project-new' }),
    )
  })

  it('케이스4: 재전송으로 회의 연결이 바뀌어 프로젝트가 바뀌면(folder_path 미전송) 새 프로젝트 트리로 재편철한다', async () => {
    const existingMoved = { ...existingRow, project_id: OLD_PROJECT_UUID, folder_id: 'f-old-root' }
    const { builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [
        { data: existingMoved },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: 't' } },
        { data: [{ id: 'm-1' }] },   // refileMinuteAfterProjectChange 의 CAS update
      ],
      minute_folders: [
        // refileMinuteAfterProjectChange 내부 loadFolderSnapshot — 신·구 프로젝트 루트가 모두 필요
        { data: [
          { id: 'f-old-root', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: OLD_PROJECT_UUID, workspace_id: WS },
          { id: 'f-new-root', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: PROJECT_UUID, workspace_id: WS },
        ] },
        // 응답 에코(folderPathOf)용 — existing.folder_id(로컬 변수, 갱신 전 값) 역해석
        { data: [{ id: 'f-old-root', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: OLD_PROJECT_UUID, workspace_id: WS }] },
      ],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(200)
    expect(builders.minutes[1].update).toHaveBeenCalledWith({ folder_id: 'f-new-root' })
    expect(builders.minutes[1].eq).toHaveBeenCalledWith('folder_id', 'f-old-root')
    // refile 의 activeTeamCodes 는 **새** 프로젝트 스코프여야 한다(옛 프로젝트가 아니다).
    expect(mocks.activeTeamCodesForProject).toHaveBeenCalledWith(PROJECT_UUID)
  })
})

describe('W25 MINUTES_FOLDER_PATH_ENABLED = false (R1 배포 형상 · 결정 §2-A)', () => {
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }

  it('folder_path 를 키 부재와 동일하게 무시하고 팀 루트로 편철한다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: null }, { data: created }],
      // 팀 루트 폴백 경로(resolveFolderPath(path: []) 공유 구현) — 스냅샷 배열 응답.
      minute_folders: [{ data: [{ id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질', '주간정례'] }))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith(
      'create_minute_with_version', expect.objectContaining({ p_folder_id: 'f-pmo' }),
    )
    // 에코는 요청 경로가 아니라 **실제 편철 위치**(팀 루트)여야 한다
    expect(await res.json()).toMatchObject({ folder_id: 'f-pmo', folder_path: ['PMO'] })
  })

  it('검증 400 조차 내지 않는다 — 61자 폴더명·타 팀 루트가 섞여도 오늘처럼 전송된다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    // 플래그 없이 W1 만 먼저 내면 이 세 입력이 400 이 되어 오늘 정상 전송되는 회의가 실패한다.
    const queue = () => ({
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [{ id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }],
    })
    useAdmin(queue())
    expect((await POST(post({ ...payload, folder_path: ['PMO', '가'.repeat(61)] }))).status).toBe(201)
    useAdmin(queue())
    expect((await POST(post({ ...payload, folder_path: ['ERP', '영업'] }))).status).toBe(201)
    useAdmin(queue())
    expect((await POST(post({ ...payload, folder_path: 'not-an-array' }))).status).toBe(201)
  })

  it('replace 의 폴더 갱신(W5)이 일어나지 않는다 — metadata 에 folder_id 키 없음', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [
        { data: { ...existingRow, folder_id: 'f-old' } },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-27T02:00:00+00:00' } },
      ],
      minute_folders: [{ data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(200)
    const call = admin.rpc.mock.calls.find(c => c[0] === 'commit_minute_body_version')!
    expect((call[1] as { p_metadata: Record<string, unknown> }).p_metadata).not.toHaveProperty('folder_id')
  })
})

describe('folder_path_status 에코 (결정 §2-C — POST 응답)', () => {
  // 배치 results[] 쪽은 folder-batch.test.ts 가 덮지만 등록 응답은 검증이 0이었다.
  // 또박또박 ddobak-W8 배지가 이 값 하나에 걸려 있어(절단·부분편철·미분류가 보이는 유일한 경로)
  // 조용히 잘못된 값이 나가면 사용자에게 "정상 편철"로 보인다.
  const created = { id: 'm-1', created_at: '2026-07-27T01:00:00+00:00', updated_at: '2026-07-27T01:00:00+00:00' }
  const SEED_PMO = { id: 'f-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }
  const insertQueue = () => [{ data: null }, { data: created }]

  it('정상 편철 → exact', async () => {
    useAdmin({
      minutes: insertQueue(),
      minute_folders: [
        { data: [SEED_PMO, { id: 'f-q', name: '품질', parent_id: 'f-pmo', created_by: 'u-9', workspace_id: WS }] },
      ],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'f-q', folder_path_status: 'exact' })
  })

  it('깊이 5 초과 절단 → truncated (경로도 5단으로 잘려 에코)', async () => {
    useAdmin({
      minutes: insertQueue(),
      minute_folders: [
        { data: [SEED_PMO] },
        { data: { id: 'f-a' } }, { data: { id: 'f-b' } }, { data: { id: 'f-c' } }, { data: { id: 'f-d' } },
      ],
    })
    const res = await POST(post({ ...payload, folder_path: ['신규TF', 'A', 'B', 'C', 'D'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_path: ['PMO', '신규TF', 'A', 'B', 'C'],
      folder_path_status: 'truncated',
    })
  })

  it('시드 루트 부재 → unclassified (등록은 201, folder_id·folder_path 는 null)', async () => {
    useAdmin({ minutes: insertQueue(), minute_folders: [{ data: [] }] })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toMatchObject({ folder_path_status: 'unclassified' })
    expect(json.folder_id).toBeNull()
    expect(json.folder_path).toBeNull()
  })

  it('중간 폴더 생성 실패 → partial (조상에 편철하고 200/201 을 그대로 낸다 — 종전엔 완전 침묵)', async () => {
    useAdmin({
      minutes: insertQueue(),
      minute_folders: [
        { data: [SEED_PMO] },
        { error: { message: 'insert denied' } },   // '품질' 생성 실패 → 조상(f-pmo)에 떨어진다
      ],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질', '주간정례'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      folder_id: 'f-pmo', folder_path: ['PMO'], folder_path_status: 'partial',
    })
  })
})

describe('구버전 replace 의 team 불일치 (결정 §6 — 플래그와 무관하게 동작)', () => {
  // ⚠️ 이 경로는 §2-A 「플래그 표」와 계약 §4.8 의 "R1 은 POST /minutes 동작을 1비트도 바꾸지
  // 않는다"에 대한 **명시적 예외**다. folder_path 키가 없는 구버전 클라이언트가 담당만 정정해
  // 재전송하면 R1 구간에서도 폴더가 새 팀 루트로 옮겨진다. 계약 §4.5-11 이 정본.
  const replaced = { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-07-27T02:00:00+00:00' }
  const metadataOf = (admin: { rpc: { mock: { calls: unknown[][] } } }) => {
    const call = admin.rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')
    return (call![1] as { p_metadata: Record<string, unknown> }).p_metadata
  }

  it('플래그 false + folder_path 키 부재 + team 변경 → 새 팀 루트로 폴더를 옮긴다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      // 팀 루트 폴백(resolveFolderPath(path: [])) 스냅샷 → f-erp, 그다음 응답은 에코 역해석용 스냅샷
      minute_folders: [
        { data: [{ id: 'f-erp', name: 'ERP', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: WS }] },
        { data: [{ id: 'f-erp', name: 'ERP', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: WS }] },
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP' }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-erp', team_code: 'ERP' })
    expect(await res.json()).toMatchObject({ folder_id: 'f-erp', folder_path: ['ERP'] })
  })

  it('team 이 그대로면 폴더를 건드리지 않는다 (metadata 에 folder_id 키 없음)', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      minute_folders: [{ data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).not.toHaveProperty('folder_id')
  })

  it('새 팀 루트가 없으면 폴더를 유지한다 — 등록 자체는 실패시키지 않는다', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      minute_folders: [
        { data: null },                                                              // 팀 루트 조회 실패
        { data: [{ id: 'f-old', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, workspace_id: WS }] }, // 에코는 기존 위치
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP' }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).not.toHaveProperty('folder_id')
    expect(await res.json()).toMatchObject({ folder_id: 'f-old' })
  })

  it('새 팀 루트가 프로젝트에 없으면 지연 생성해서 옮긴다(Important 수정 — 0076 시드 밖)', async () => {
    // 위 "폴더를 유지한다" 테스트는 project_id 가 없어(전역 스코프) 지연 생성 대상이 아니다.
    // 이 테스트는 프로젝트가 있는 회의록의 팀 변경 — 0076 시드 밖(신설 프로젝트/팀)이면
    // resolveFolderPath(path: []) 가 프로젝트 루트를 만들어서라도 옮긴다.
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'false')
    const { admin, builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [
        { data: { ...existingRow, project_id: PROJECT_UUID, folder_id: 'f-old' } },
        { data: replaced },
      ],
      minute_folders: [
        { data: [] },                            // 스냅샷 — 이 프로젝트엔 아직 ERP 루트가 없다
        { data: { id: 'f-erp-project-new' } },    // ensureProjectTeamRoot 의 insert
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP', meeting_id: MEETING_UUID }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-erp-project-new' })
    expect(builders.minute_folders[1].insert).toHaveBeenCalledWith({
      name: 'ERP', parent_id: null, created_by: null, project_id: PROJECT_UUID, workspace_id: WS, kind: 'team_root', team_id: 't-ERP', sort: 100,
    })
    expect(await res.json()).toMatchObject({ folder_id: 'f-erp-project-new', folder_path: ['ERP'] })
  })

  it('플래그 true + folder_path 가 실려 오면 team 이동 분기를 타지 않는다 (folder_path 가 이긴다)', async () => {
    vi.stubEnv('MINUTES_FOLDER_PATH_ENABLED', 'true')
    const { admin } = useAdmin({
      minutes: [{ data: { ...existingRow, folder_id: 'f-old' } }, { data: replaced }],
      minute_folders: [
        { data: [
          { id: 'f-erp', name: 'ERP', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-ERP', team: { code: 'ERP', project_id: null }, workspace_id: WS },
          { id: 'f-sales', name: '영업', parent_id: 'f-erp', created_by: 'u-9', workspace_id: WS },
        ] },
      ],
    })
    const res = await POST(post({ ...payload, team: 'ERP', folder_path: ['ERP', '영업'] }))
    expect(res.status).toBe(200)
    expect(metadataOf(admin)).toMatchObject({ folder_id: 'f-sales' })
    expect(await res.json()).toMatchObject({ folder_id: 'f-sales', folder_path: ['ERP', '영업'] })
  })
})

describe('inline meeting — 회의 생성+연결 (v2.5 §4.2·§4.3)', () => {
  const meetingReq = {
    ...payload,
    meeting: { project_id: PROJECT_UUID, title: '킥오프 회의', date: '2026-08-06', category: 'kickoff' },
  }
  const createdMinute = {
    id: 'm-1', created_at: '2026-08-06T01:00:00+00:00', updated_at: '2026-08-06T01:00:00+00:00',
  }

  /** 회의 확보 성공 경로 큐 — (자격은 호출자 스냅샷: 기본 PROJECT_UUID 명단 member) → meetings dedup miss → insert. */
  function useMeetingAdmin(over: Record<string, QueryResponse[]> = {}) {
    return useAdmin({
      minutes: [{ data: null }, { data: createdMinute }],
      meetings: [{ data: null }, { data: { id: MEETING_UUID } }],
      ...over,
    })
  }

  it('meeting 유효 → 201 + 회의 생성(meeting_created: true) + 연결·파생은 meeting_id 전송과 동일', async () => {
    const { admin, builders } = useMeetingAdmin()
    const res = await POST(post(meetingReq))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      action: 'created', meeting_id: MEETING_UUID, meeting_created: true,
    })
    // 고정 속성 — 단발(recurrence none)·참석자 없음·작성자 귀속(§4.2)
    expect(builders.meetings[1].insert).toHaveBeenCalledWith({
      project_id: PROJECT_UUID, title: '킥오프 회의', meeting_date: '2026-08-06', category: 'kickoff',
      body: '', recurrence: 'none', recurrence_until: null,
      start_time: null, end_time: null, location: null,
      created_by: 'u-1', created_by_name: '팀장',
    })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_meeting_id: MEETING_UUID,
      p_project_id: PROJECT_UUID,
      p_meeting_occurrence_date: payload.date,
    }))
    // 내부 회의 화면 캐시 갱신 — revalidateMeetings 와 동일 경로
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/p/${PROJECT_UUID}/meetings`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/(app)/w/[slug]/meetings', 'page')   // SP3b 과제 12 — 라우트 그룹 경로(D8)
  })

  it('같은 (project, date, title) 회의는 재사용 — meeting_created: false, insert 없음 (dedup 멱등)', async () => {
    const { builders } = useMeetingAdmin({ meetings: [{ data: { id: MEETING_UUID } }] })
    const res = await POST(post({ ...meetingReq, external_id: 'ddobak:재전송-2' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ meeting_id: MEETING_UUID, meeting_created: false })
    expect(builders.meetings).toHaveLength(1)          // dedup 조회뿐 — insert 없음
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('meeting + meeting_id 동시 전송은 400 — meeting_id: null(해제)과의 조합도 거절', async () => {
    const { builders } = useAdmin()                    // 파싱 단계 거절 — 테이블 큐 소비 없음
    for (const meetingId of [MEETING_UUID, null]) {
      const res = await POST(post({ ...meetingReq, meeting_id: meetingId }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    }
    expect(builders.projects).toBeUndefined()          // DB 미접근
  })

  it('category 생략은 general 로 생성, 허용 외 값은 400', async () => {
    const { builders } = useMeetingAdmin()
    const noCategory = { project_id: PROJECT_UUID, title: '킥오프 회의', date: '2026-08-06' }
    expect((await POST(post({ ...meetingReq, meeting: noCategory }))).status).toBe(201)
    expect(builders.meetings[1].insert).toHaveBeenCalledWith(expect.objectContaining({ category: 'general' }))
    expect((await POST(post({
      ...meetingReq, meeting: { ...meetingReq.meeting, category: 'offsite' },
    }))).status).toBe(400)
  })

  it('meeting 필드 형식 오류는 400 — 비객체·비uuid project_id·빈/201자 title·잘못된 date', async () => {
    const cases: unknown[] = [
      'not-an-object',
      { ...meetingReq.meeting, project_id: 'abc' },
      { ...meetingReq.meeting, title: '  ' },
      { ...meetingReq.meeting, title: '가'.repeat(201) },
      { ...meetingReq.meeting, date: '2026/08/06' },
    ]
    useAdmin()                                         // 전부 파싱 단계 거절 — 테이블 큐 소비 없음
    for (const meeting of cases) {
      const res = await POST(post({ ...meetingReq, meeting }))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    }
  })

  it('볼 수 없는 프로젝트(미존재·다른 워크스페이스)와 권한 없는 호출자는 404 not_found — dedup 조회 이전 차단(v2.7)', async () => {
    const outsider = { ...meetingReq, meeting: { ...meetingReq.meeting, project_id: '00000000-0000-4000-8000-000000000000' } }
    const { builders } = useMeetingAdmin()
    const res = await POST(post(outsider))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found', error: '프로젝트를 찾을 수 없습니다.' })
    // 판정은 호출자 스냅샷으로 끝난다 — 프로젝트·명단을 따로 읽지 않고, 비멤버는 dedup 재사용 우회도 못 탄다.
    expect(builders.projects).toBeUndefined()
    expect(builders.project_members).toBeUndefined()
    expect(builders.meetings).toBeUndefined()
  })

  it('기존 external_id + on_conflict=skip 은 회의를 만들지 않는다 — skipped 응답에 meeting_created 없음', async () => {
    const { builders } = useAdmin({ minutes: [{ data: existingRow }] })
    const res = await POST(post({ ...meetingReq, on_conflict: 'skip' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ action: 'skipped' })
    expect(json).not.toHaveProperty('meeting_created')
    expect(builders.projects).toBeUndefined()          // 회의 확보 시도 자체가 없다
    expect(builders.meetings).toBeUndefined()
  })

  it('보관된 레코드(409 archived)도 회의를 만들지 않는다 — 실패 응답 뒤 고아 회의 방지', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: { ...existingRow, archived_at: '2026-08-01T00:00:00+00:00' } }],
    })
    const res = await POST(post(meetingReq))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'archived' })
    expect(builders.projects).toBeUndefined()
  })

  it('replace + meeting 은 회의 확보 후 연결 갱신 — metadata 에 meeting_id·project_id·occurrence 파생', async () => {
    const { admin } = useMeetingAdmin({
      minutes: [
        { data: existingRow },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-08-06T02:00:00+00:00' } },
      ],
    })
    const res = await POST(post(meetingReq))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      action: 'replaced', meeting_id: MEETING_UUID, meeting_created: true,
    })
    const call = admin.rpc.mock.calls.find(([fn]) => fn === 'commit_minute_body_version')!
    expect((call[1] as { p_metadata: Record<string, unknown> }).p_metadata).toMatchObject({
      meeting_id: MEETING_UUID,
      project_id: PROJECT_UUID,
      meeting_occurrence_date: payload.date,
    })
  })

  it('meeting 미전송 요청의 응답에는 meeting_created 키 자체가 없다 (v2.4 하위호환)', async () => {
    useAdmin({ minutes: [{ data: null }, { data: createdMinute }] })
    const createdRes = await POST(post(payload))
    expect(createdRes.status).toBe(201)
    expect(await createdRes.json()).not.toHaveProperty('meeting_created')

    useAdmin({ minutes: [{ data: existingRow }, { data: createdMinute }] })
    const replacedRes = await POST(post(payload))
    expect(replacedRes.status).toBe(200)
    expect(await replacedRes.json()).not.toHaveProperty('meeting_created')
  })

  it('회의 확보 경로의 조회·insert 실패는 500 — 실패를 없음으로 위장하지 않는다(fail-closed)', async () => {
    useMeetingAdmin({ meetings: [{ error: { message: 'down' } }] })
    expect((await POST(post(meetingReq))).status).toBe(500)
    useMeetingAdmin({ meetings: [{ data: null }, { error: { message: 'down' } }] })
    expect((await POST(post(meetingReq))).status).toBe(500)
  })
})

describe('GET /api/v1/minutes (§5.1, §9.6 ⑪)', () => {
  it('external_id 정확 일치 조회 + url 포함 응답', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [existingRow], count: 1 }] })
    const res = await GET(get(`/api/v1/minutes?user_email=lead%40example.com&external_id=${encodeURIComponent(EXTERNAL_ID)}`))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toMatchObject({ total: 1, page: 1, per_page: 20 })
    expect(json.items[0]).toMatchObject({
      id: 'm-1', title: '옛제목', date: '2026-07-01', team: 'PMO',
      external_id: EXTERNAL_ID, created_by_name: '원작성자',
      url: 'http://localhost/minutes/m-1',
    })
    expect(json.items[0]).not.toHaveProperty('body_md')
    expect(builders.minutes[0].eq).toHaveBeenCalledWith('external_id', EXTERNAL_ID)
    expect(builders.minutes[0].select).toHaveBeenCalledWith(expect.any(String), { count: 'exact' })
  })

  it('W24: 기본값은 보관분 제외 — archived_at is null 필터가 걸린다', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [existingRow], count: 1 }] })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
    expect(res.status).toBe(200)
    expect(builders.minutes[0].is).toHaveBeenCalledWith('archived_at', null)
    expect((await res.json()).items[0].archived).toBe(false)
  })

  it('W24: include_archived=true 면 보관 필터를 걸지 않고 archived: true 를 실어 준다 (§9.7 (a))', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: [{ ...existingRow, archived_at: '2026-07-20T00:00:00+00:00' }], count: 1 }],
    })
    const res = await GET(get(
      `/api/v1/minutes?user_email=lead%40example.com&external_id=${encodeURIComponent(EXTERNAL_ID)}&include_archived=true`,
    ))
    expect(res.status).toBe(200)
    expect(builders.minutes[0].is).not.toHaveBeenCalledWith('archived_at', null)
    // 또박또박이 '초기화됨'과 '보관됨'을 구분하는 근거 — 이게 없으면 복구 두 갈래가 둘 다 막힌다
    expect((await res.json()).items[0].archived).toBe(true)
  })

  it('GET 의 담당 필터는 service_role 클라이언트로 가시 팀을 읽는다(SP4 A2 — 세션이 없다)', async () => {
    mocks.activeTeamCodes = ['OPS', 'RES']
    const fake = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=OPS'))).status).toBe(200)
    expect(mocks.activeTeamCodesVisibleTo).toHaveBeenCalled()
    expect(mocks.visibleSpy).toHaveBeenCalledWith(expect.anything(), { client: fake.admin })
  })

  it('[RF2] GET 의 가시 팀 조회가 실패하면 500 — 담당 필터를 버리고 목록을 내지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.activeTeamCodesVisibleTo.mockImplementationOnce(() => { throw new Error('teams down') })
    const fake = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=OPS'))).status).toBe(500)
    expect(fake.builders.minutes).toBeUndefined()
    err.mockRestore()
  })

  it('W24: include_archived 는 true/false 만 받는다', async () => {
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&include_archived=1'))).status).toBe(400)
  })

  it('W24: 범위 초과 폴백 카운트 쿼리도 include_archived 를 존중한다', async () => {
    const { builders } = useAdmin({
      minutes: [
        { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
        { count: 7 },
      ],
    })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com&include_archived=true&page=999'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 7 })
    expect(builders.minutes[1].is).not.toHaveBeenCalledWith('archived_at', null)
  })

  it('목록 응답은 본문을 제외한다 — 행에 body_md가 있어도 유출되지 않고 select도 화이트리스트 (§5.1)', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: [{ ...existingRow, body_md: '유출검증본문' }], count: 1 }],
    })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
    expect(JSON.stringify(await res.json())).not.toContain('유출검증본문')
    expect(builders.minutes[0].select).toHaveBeenCalledWith(
      expect.not.stringContaining('body_md'), expect.anything(),
    )
  })

  it('범위 초과 페이지(PostgREST 416/PGRST103)는 500이 아니라 빈 페이지 응답', async () => {
    useAdmin({
      minutes: [
        { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } },
        { count: 27 },
      ],
    })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com&per_page=20&page=3'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ items: [], total: 27, page: 3, per_page: 20 })
  })

  it('linked=false는 external_id 없는 것만 (수동 연결 후보 검색 — §4b)', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&linked=false'))).status).toBe(200)
    expect(builders.minutes[0].is).toHaveBeenCalledWith('external_id', null)
  })

  it('linked=true는 external_id 있는 것만', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&linked=true'))).status).toBe(200)
    expect(builders.minutes[0].not).toHaveBeenCalledWith('external_id', 'is', null)
  })

  it('per_page는 최대 100으로 클램프, 페이지 오프셋 반영', async () => {
    const { builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com&per_page=500&page=2'))
    expect((await res.json()).per_page).toBe(100)
    expect(builders.minutes[0].range).toHaveBeenCalledWith(100, 199)
  })

  it('허용 외 team 필터는 400', async () => {
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=QA'))).status).toBe(400)
  })
})

describe('GET /api/v1/minutes/meta (§5.2)', () => {
  // SP2 — meta 는 호출자 신원이 없어 전 워크스페이스의 프로젝트를 내줬다. user_email(필수)로 호출자를 정하고
  // 그 사람이 볼 수 있는 프로젝트만 싣는다. SP7 — 범위는 자격증명 워크스페이스 하나다: 프로젝트·팀·모듈 판정 모두 그 워크스페이스로
  // 한정하고(호출자가 다른 워크스페이스에 속해 있어도 합치지 않는다) workspace 정보를 함께 싣는다.
  const PA = '0a000000-0000-4000-8000-00000000000a'       // 내 워크스페이스(WS)의 공개 프로젝트
  const PPRIV = '0b000000-0000-4000-8000-00000000000b'    // 내 워크스페이스의 비공개 프로젝트(명단 없음)
  const PB = '0c000000-0000-4000-8000-00000000000c'       // 다른 워크스페이스의 프로젝트
  const WS2 = 'ws-2'
  const q = (extra = '') => `/api/v1/minutes/meta?user_email=${encodeURIComponent(USER.email)}${extra}`
  beforeEach(() => {
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id,
      workspaceRoles: new Map([[WS, 'member'], [WS2, 'member']]),
      projectWorkspace: new Map([[PA, WS], [PPRIV, WS]]),
    }))
    mocks.activeTeamCodesForWorkspace.mockImplementation((wid: string) =>
      wid === WS ? ['PMO', 'ERP'] : wid === WS2 ? ['ERP', 'QA'] : ['남의팀'])
  })

  it('teams·projects·limits 반환, project_id 없으면 meetings 없음', async () => {
    useAdmin({ projects: [{ data: [{ id: PA, name: 'Acme', is_private: false, workspace_id: WS }], count: 1 }] })
    const res = await META(get(q()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.projects).toEqual([{ id: PA, name: 'Acme' }])
    expect(json.workspace).toEqual({ id: WS, slug: WS_SLUG, name: '자격증명 워크스페이스' })
    expect(json.limits).toMatchObject({
      max_body_chars: 100_000, max_request_bytes: 4_194_304,
      max_attachments: 10, max_attachment_bytes: 20_971_520,
    })
    expect(json).not.toHaveProperty('meetings')
  })

  it('다른 워크스페이스 프로젝트는 응답에 없다 — 조회를 자격증명 워크스페이스로 좁히고, 비공개는 명단이 있어야 보인다', async () => {
    // 호출자는 WS2 에도 속해 있지만(beforeEach) 조회는 자격증명 워크스페이스(WS) 하나로만 좁힌다 — WS2 의 PB 는 읽히지 않는다.
    const { admin, builders } = useAdmin({
      projects: [{ data: [
        { id: PA, name: 'A', is_private: false, workspace_id: WS },
        { id: PPRIV, name: '비공개', is_private: true, workspace_id: WS },
      ] }],
    })
    const json = await (await META(get(q()))).json()
    expect(json.projects).toEqual([{ id: PA, name: 'A' }])
    expect(json.projects).not.toContainEqual(expect.objectContaining({ id: PB }))
    expect(builders.projects).toHaveLength(1)
    expect(builders.projects[0].select).toHaveBeenCalledWith('id, name, is_private')
    expect(builders.projects[0].eq.mock.calls).toEqual([['workspace_id', WS]])
    expect(builders.projects[0].in).not.toHaveBeenCalled()
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
    expect(mocks.actorFromUser).toHaveBeenCalledWith(expect.anything(), USER.id)
  })

  it('자격증명의 project_ids 밖 프로젝트는 볼 수 있는 프로젝트여도 싣지 않고, 그 project_id 의 회의 목록은 404', async () => {
    useCredential({ project_ids: [PA] })
    const POUT = '0f000000-0000-4000-8000-00000000000f'    // 같은 워크스페이스의 공개 프로젝트 — 자격증명 범위 밖
    const rows = { data: [{ id: PA, name: 'A', is_private: false }, { id: POUT, name: '범위 밖', is_private: false }] }
    useAdmin({ projects: [rows] })
    expect((await (await META(get(q()))).json()).projects).toEqual([{ id: PA, name: 'A' }])
    const { builders } = useAdmin({ projects: [rows] })
    const res = await META(get(q(`&project_id=${POUT}`)))
    expect(res.status).toBe(404)
    expect(builders.meetings).toBeUndefined()
  })

  // 프로젝트 id 목록을 .in() 으로 URL 에 실으면 약 205개부터 게이트웨이가 414 로 거절해 meta 가 늘 500 이 된다(SP2 최종 리뷰 ERR-4).
  it('프로젝트 300개인 호출자 — id 목록 필터 없이 워크스페이스로 좁히고 메모리에서 거른다', async () => {
    const pids = Array.from({ length: 300 }, (_, i) => `0d000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, workspaceRoles: new Map([[WS, 'member']]), projectWorkspace: new Map(pids.map(pid => [pid, WS])),
    }))
    const rows = pids.map((id, i) => ({ id, name: `P${String(i).padStart(3, '0')}`, is_private: false, workspace_id: WS }))
    const { builders } = useAdmin({ projects: [{ data: rows, count: rows.length }] })
    const res = await META(get(q()))
    expect(res.status).toBe(200)
    expect((await res.json()).projects).toHaveLength(300)
    // id 목록은 어디에도 싣지 않는다 — 필터는 워크스페이스 eq 하나뿐
    expect(builders.projects[0].in).not.toHaveBeenCalled()
    expect(builders.projects[0].eq.mock.calls).toEqual([['workspace_id', WS]])
  })

  it('플랫폼 관리자도 자격증명 워크스페이스로 한정된다 — 전 워크스페이스 목록으로 넓어지지 않는다', async () => {
    mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id, projectWorkspace: new Map([[PA, WS], [PB, WS2]]) }))
    const { admin, builders } = useAdmin({ projects: [{ data: [
      { id: PA, name: 'A', is_private: false, workspace_id: WS }, { id: PPRIV, name: '비공개', is_private: true, workspace_id: WS },
    ] }] })
    const json = await (await META(get(q()))).json()
    // 비공개 프로젝트는 플랫폼 관리자에게 보인다(canSeeProject) — 단 자격증명 워크스페이스 안에서만
    expect(json.projects).toEqual([{ id: PA, name: 'A' }, { id: PPRIV, name: '비공개' }])
    expect(json.workspace).toMatchObject({ id: WS })
    expect(builders.projects[0].eq.mock.calls).toEqual([['workspace_id', WS]])
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
    expect(mocks.activeTeamCodesForWorkspace.mock.calls.map(c => c[0])).toEqual([WS])
  })

  it('teams 는 자격증명 워크스페이스의 활성 공용 팀뿐 — 호출자가 속한 다른 워크스페이스(WS2)의 팀은 합치지 않는다', async () => {
    useAdmin({ projects: [{ data: [], count: 0 }] })
    const json = await (await META(get(q()))).json()
    expect(json.teams).toEqual(['PMO', 'ERP'])
    expect(json.teams).not.toContain('QA')
    expect(mocks.activeTeamCodesForWorkspace.mock.calls.map(c => c[0])).toEqual([WS])
  })

  it('프로젝트가 없는 호출자는 빈 목록 — 조회는 자격증명 워크스페이스로 좁힌 한 번뿐', async () => {
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id }))
    const { builders } = useAdmin()
    const json = await (await META(get(q()))).json()
    expect(json.projects).toEqual([])
    expect(builders.projects).toHaveLength(1)
    expect(builders.projects[0].eq.mock.calls).toEqual([['workspace_id', WS]])
  })

  it('user_email 이 없으면 DB 접근 전에 400 — 전 프로젝트 목록으로 되돌아가지 않는다', async () => {
    const { builders } = useAdmin()
    const res = await META(get('/api/v1/minutes/meta'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('user_email 이 필요합니다.')
    expectAuthOnly(builders)
  })

  it('모르는 user_email 은 403 unknown_user — 목록을 싣지 않는다', async () => {
    const { builders } = useAdmin({}, [])
    const res = await META(get('/api/v1/minutes/meta?user_email=nobody%40example.com'))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.code).toBe('unknown_user')
    expect(json).not.toHaveProperty('projects')
    expect(builders.projects).toBeUndefined()
  })

  it('계정·권한 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    useAdmin({}, [USER], { usersError: true })
    expect((await META(get(q()))).status).toBe(500)
    useAdmin()
    mocks.actorFromUser.mockRejectedValueOnce(new Error('권한 정보를 불러오지 못했습니다'))
    expect((await META(get(q()))).status).toBe(500)
  })

  it('project_id 지정 시 해당 프로젝트 meetings 포함 — v2.5: category·recurrence 동봉', async () => {
    const { builders } = useAdmin({
      projects: [{ data: [{ id: PA, name: 'A', is_private: false, workspace_id: WS }], count: 1 }],
      meetings: [{
        data: [{
          id: 'mt-1', title: '주간 정례', meeting_date: '2026-07-14',
          category: 'routine', recurrence: 'weekly',
        }],
      }],
    })
    const res = await META(get(q(`&project_id=${PA}`)))
    const json = await res.json()
    expect(json.meetings).toEqual([{
      id: 'mt-1', title: '주간 정례', date: '2026-07-14', category: 'routine', recurrence: 'weekly',
    }])
    expect(builders.meetings[0].select).toHaveBeenCalledWith('id, title, meeting_date, category, recurrence')
    expect(builders.meetings[0].eq).toHaveBeenCalledWith('project_id', PA)
  })

  it.each([['다른 워크스페이스', PB], ['비공개(명단 없음)', PPRIV]])(
    '볼 수 없는 project_id(%s)는 404 — 회의 목록을 조회하지 않는다', async (_label, pid) => {
      const { builders } = useAdmin({
        projects: [{ data: [
          { id: PA, name: 'A', is_private: false, workspace_id: WS }, { id: PPRIV, name: '비공개', is_private: true, workspace_id: WS },
        ], count: 2 }],
      })
      const res = await META(get(q(`&project_id=${pid}`)))
      expect(res.status).toBe(404)
      expect(builders.meetings).toBeUndefined()
    })

  it('project_id가 uuid 형식이 아니면 DB 접근 전에 400', async () => {
    const { builders } = useAdmin()
    const res = await META(get(q('&project_id=abc')))
    expect(res.status).toBe(400)
    expectAuthOnly(builders)
  })
})

describe('POST /api/v1/minutes/link (§4b, §9.6 ⑩)', () => {
  const linkPayload = { user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }
  // 호출자가 작성자인 회의록 — 연결은 작성자 또는 그 프로젝트 관리자만(SP2 Task 13).
  const OWN_MINUTE = { id: MINUTE_UUID, created_by: USER.id, project_id: null, workspace_id: WS, archived_at: null }

  it('external_id null 레코드에 부여 → 200 linked (본문·메타 무변경)', async () => {
    const { builders } = useAdmin({
      minutes: [{ data: { ...OWN_MINUTE, external_id: null } }, { data: [{ id: MINUTE_UUID }] }],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, id: MINUTE_UUID, action: 'linked', external_id: EXTERNAL_ID })
    const updated = builders.minutes[1].update.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(updated)).toEqual(['external_id'])
    expect(builders.minutes[1].is).toHaveBeenCalledWith('external_id', null)
  })

  it('이미 같은 값이면 200 — 멱등 재호출 안전', async () => {
    const { builders } = useAdmin({ minutes: [{ data: { ...OWN_MINUTE, external_id: EXTERNAL_ID } }] })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'linked' })
    expect(builders.minutes).toHaveLength(1)
  })

  it('이미 다른 값이면 409 link_conflict — 기존 연결 보호', async () => {
    useAdmin({ minutes: [{ data: { ...OWN_MINUTE, external_id: 'ddobak:다른값' } }] })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'link_conflict' })
  })

  it('external_id가 타 레코드에 사용 중(23505)이면 409 link_conflict', async () => {
    useAdmin({
      minutes: [{ data: { ...OWN_MINUTE, external_id: null } }, { error: { code: '23505', message: 'duplicate' } }],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'link_conflict' })
  })

  it('link 경합: update 0행 후 재조회가 같은 값이면 200 멱등', async () => {
    useAdmin({
      minutes: [
        { data: { ...OWN_MINUTE, external_id: null } },
        { data: [] },
        { data: { external_id: EXTERNAL_ID } },
      ],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ action: 'linked' })
  })

  it('link 경합: update 0행 후 재조회가 다른 값이면 409', async () => {
    useAdmin({
      minutes: [
        { data: { ...OWN_MINUTE, external_id: null } },
        { data: [] },
        { data: { external_id: 'ddobak:다른값' } },
      ],
    })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'link_conflict' })
  })

  it('minute_id 불존재는 404 not_found', async () => {
    useAdmin({ minutes: [{ data: null }] })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found' })
  })

  it('minute_id가 uuid 형식이 아니면 DB 접근 전에 400 (§6 형식 오류)', async () => {
    const { builders } = useAdmin()
    const res = await LINK(link({ ...linkPayload, minute_id: 'm-abc' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed' })
    expectAuthOnly(builders)
  })

  it('미지 이메일은 403 unknown_user', async () => {
    useAdmin({}, [])
    expect((await LINK(link(linkPayload))).status).toBe(403)
  })

  it('계정(profiles) 조회 실패는 403이 아니라 500', async () => {
    useAdmin({}, [USER], { usersError: true })
    const res = await LINK(link(linkPayload))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'internal_error' })
  })
})

describe('미정의 메서드 은닉 (§3.4 보강 — 405로 존재가 드러나지 않게)', () => {
  it('PUT/DELETE/PATCH/OPTIONS 전부 404', async () => {
    const routes = [
      await import('@/app/api/v1/minutes/route'),
      await import('@/app/api/v1/minutes/meta/route'),
      await import('@/app/api/v1/minutes/link/route'),
    ]
    for (const mod of routes) {
      for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
        const handler = (mod as Record<string, unknown>)[method]
        expect(handler, `${method} 핸들러 누락`).toBeTypeOf('function')
        const res = await (handler as () => Response | Promise<Response>)()
        expect(res.status).toBe(404)
      }
    }
  })
})

describe('워크스페이스 스코프 미지정 트리 (0006 · 2 워크스페이스)', () => {
  const W2 = W2_UUID
  const created = { id: 'm-1', created_at: '2026-09-26T01:00:00+00:00', updated_at: '2026-09-26T01:00:00+00:00' }
  // 두 워크스페이스에 동명 'PMO' 미지정 루트가 공존한다 — rootKey 가 워크스페이스를 안 보면 뒤엣것이 이긴다.
  const W1_PMO = { id: 'w1-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: WS }
  const W2_PMO = { id: 'w2-pmo', name: 'PMO', parent_id: null, created_by: null, kind: 'team_root', team_id: 't-PMO', team: { code: 'PMO', project_id: null }, project_id: null, workspace_id: W2 }
  const W2_Q = { id: 'w2-q', name: '품질', parent_id: 'w2-pmo', created_by: 'u-9', project_id: null, workspace_id: W2 }

  it('프로젝트 없는 신규 등록은 자격증명 워크스페이스를 p_workspace_id 로 넘기고 그 워크스페이스 루트에 편철한다', async () => {
    const { admin } = useAdmin({
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [W1_PMO, W2_PMO] }],
    })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'w1-pmo', folder_path: ['PMO'] })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_project_id: null, p_workspace_id: WS, p_folder_id: 'w1-pmo',
    }))
    expect(mocks.actorFromUser).toHaveBeenCalledWith(admin, USER.id)
  })

  it('자격증명이 W2 에 묶여 있으면 folder_path 도 W2 트리에서 해석한다', async () => {
    const PW2 = '0e000000-0000-4000-8000-00000000000e'   // W2 의 프로젝트 — 작성자는 그 명단 member(W2 에 역할이 있다)
    useCredential({ workspace_id: W2 })
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, workspaceRoles: new Map([[W2, 'member']]),
      projectWorkspace: new Map([[PW2, W2]]), projectRoles: new Map<string, ProjectRole>([[PW2, 'member']]),
    }))
    const { admin, builders } = useAdmin({
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [W1_PMO, W2_PMO, W2_Q] }],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'w2-q', folder_path: ['PMO', '품질'] })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_workspace_id: W2, p_folder_id: 'w2-q',
    }))
    // 멤버 확인·모듈 판정도 자격증명 워크스페이스(W2)로 한다
    expect(builders.workspace_members[0].eq).toHaveBeenCalledWith('workspace_id', W2)
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: W2 }, 'minutes_integration', { client: admin })
  })

  // 세션 createMinute 은 프로젝트 없는 회의록에 그 워크스페이스의 역할(명단 권한·워크스페이스 관리자)을 요구한다 — 외부 POST 도 같다
  // (SP2 최종 리뷰 AUTHZ-7). 조회 전용이 만든 회의록은 본인도 다시 보낼 수 없었다(canEditMinute 가 404).
  it('프로젝트 없는 신규 등록 — 그 워크스페이스에 역할이 없는 멤버(조회 전용)는 404, RPC 미도달', async () => {
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id }))   // WS member, 명단 권한 없음
    const { admin } = useAdmin({ minutes: [{ data: null }, { data: created }], minute_folders: [{ data: [W1_PMO] }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('프로젝트 없는 신규 등록 — 워크스페이스 관리자는 명단 없이도 201', async () => {
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, workspaceRoles: new Map([[WS, 'admin']]) }))
    const { admin } = useAdmin({ minutes: [{ data: null }, { data: created }], minute_folders: [{ data: [W1_PMO] }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({ p_project_id: null, p_workspace_id: WS }))
  })

  it('작성자 소속이 둘이어도 자격증명 워크스페이스에 넣는다 — 소속으로 추측하지 않는다', async () => {
    // 옛 시크릿 경로는 유일 소속으로 워크스페이스를 골라 소속이 둘이면 400 이었다. 자격증명 경로는 자격증명이 워크스페이스를 정한다.
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, workspaceRoles: new Map([[WS, 'admin'], [W2, 'admin']]),
    }))
    const { admin } = useAdmin({ minutes: [{ data: null }, { data: created }], minute_folders: [{ data: [W1_PMO, W2_PMO] }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ folder_id: 'w1-pmo', folder_path: ['PMO'] })
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_project_id: null, p_workspace_id: WS, p_folder_id: 'w1-pmo',
    }))
  })

  it('자격증명에 기본 프로젝트가 있으면 프로젝트 없는 신규 등록은 그 프로젝트로 간다 — p_workspace_id 는 null', async () => {
    useCredential({ default_project_id: PROJECT_UUID })
    const { admin } = useAdmin({ minutes: [{ data: null }, { data: created }], minute_folders: [{ data: [] }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(201)
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_project_id: PROJECT_UUID, p_workspace_id: null, p_meeting_id: null,
    }))
    expect(requireModule).toHaveBeenCalledWith({ projectId: PROJECT_UUID }, 'minutes_integration', { client: admin })
  })

  it('자격증명의 기본 프로젝트라도 그 프로젝트의 멤버가 아니면 404, RPC 미도달 — 세션 createMinute 과 같은 자격(AUTHZ-7)', async () => {
    useCredential({ default_project_id: PROJECT_UUID })
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id }))   // WS member, 명단 권한 없음
    const { admin } = useAdmin({ minutes: [{ data: null }, { data: created }], minute_folders: [{ data: [] }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'not_found' })
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('작성자 권한 조회 실패는 500 — 소속 없음으로 위장하지 않는다', async () => {
    mocks.actorFromUser.mockRejectedValue(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { admin } = useAdmin({ minutes: [{ data: null }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(500)
    expect(admin.rpc).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('프로젝트가 있으면 작성자 소속을 보지 않고 p_workspace_id 는 null — RPC 가 프로젝트에서 얻는다', async () => {
    const { admin } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: null }, { data: created }],
      minute_folders: [{ data: [] }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(201)
    // 스냅샷은 회의 연결 자격 판정에 한 번 쓴다(SP2 Task 13) — 소속으로 워크스페이스를 고르지는 않는다.
    expect(mocks.actorFromUser).toHaveBeenCalledTimes(1)
    expect(admin.rpc).toHaveBeenCalledWith('create_minute_with_version', expect.objectContaining({
      p_project_id: PROJECT_UUID, p_workspace_id: null,
    }))
  })

  it('replace: 미지정 회의록의 folder_path 는 그 회의록의 워크스페이스(W2) 트리에서 해석한다', async () => {
    // 작성자는 W1·W2 양쪽에 역할이 있다(W2 는 워크스페이스 관리자) — 트리는 회의록의 워크스페이스에서 나와야 한다.
    // W2 에 역할이 없으면 작성자라도 고칠 수 없다(canEditMinute, SP2 Task 16a). 자격증명은 그 회의록의 워크스페이스(W2)에 묶여 있다.
    useCredential({ workspace_id: W2 })
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, workspaceRoles: new Map([[WS, 'member'], [W2, 'admin']]),
    }))
    const { admin } = useAdmin({
      minutes: [
        { data: { ...existingRow, folder_id: 'w2-pmo', workspace_id: W2 } },
        { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: '2026-09-26T02:00:00+00:00' } },
      ],
      minute_folders: [{ data: [W1_PMO, W2_PMO, W2_Q] }],
    })
    const res = await POST(post({ ...payload, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(200)
    const call = admin.rpc.mock.calls.find(c => c[0] === 'commit_minute_body_version')!
    expect((call[1] as { p_metadata: Record<string, unknown> }).p_metadata).toMatchObject({ folder_id: 'w2-q' })
    // 스냅샷은 편집 자격 판정에만 쓴다 — 기존 회의록은 자기 워크스페이스를 안다(작성자의 소속 수와 무관).
    expect(mocks.actorFromUser).toHaveBeenCalledTimes(1)
  })

  it('replace: 자격증명 워크스페이스 밖(W2)의 회의록은 편집 자격이 있어도 404 — 갱신하지 않고 폴더도 건드리지 않는다', async () => {
    // 위와 같은 작성자·회의록이지만 자격증명은 WS 에 묶여 있다 — 호출자 권한만으로는 다른 워크스페이스에 닿지 못한다.
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, workspaceRoles: new Map([[WS, 'member'], [W2, 'admin']]),
    }))
    for (const onConflict of ['replace', 'skip', 'error'] as const) {
      const { admin, builders } = seedAdmin({
        minutes: [{ data: { ...existingRow, folder_id: 'w2-pmo', workspace_id: W2 } }],
        minute_folders: [{ data: [W1_PMO, W2_PMO, W2_Q] }],
      })
      const res = await POST(post({ ...payload, on_conflict: onConflict, folder_path: ['PMO', '품질'] }))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: '회의록을 찾을 수 없습니다.', code: 'not_found' })
      expect(admin.rpc).not.toHaveBeenCalled()
      expect(builders.minute_folders).toBeUndefined()
      expect(requireModule).not.toHaveBeenCalled()
    }
  })
})

describe('SP2 Task 13 — 외부 회의록 API 를 호출자(user_email) 권한으로 좁힌다', () => {
  const OTHER_PROJECT = '5d1c9b0e-2f4a-4e6b-8c7d-9a0b1c2d3e4f'   // 다른 워크스페이스 프로젝트(호출자 스냅샷에 없음)
  const W2 = 'ws-2'
  const linkPayload = { user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }
  const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {})

  describe('GET /minutes (목록) — user_email 필수, 볼 수 있는 회의록만', () => {
    it('user_email 이 없으면 400 — 전 워크스페이스 목록으로 되돌아가지 않는다', async () => {
      const { builders } = useAdmin()
      const res = await GET(get('/api/v1/minutes'))
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'validation_failed' })
      expectAuthOnly(builders)
    })
    it('모르는 user_email 은 403 unknown_user — 목록을 조회하지 않는다', async () => {
      const { builders } = useAdmin({}, [])
      const res = await GET(get('/api/v1/minutes?user_email=nobody%40example.com'))
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ code: 'unknown_user' })
      expect(builders.minutes).toBeUndefined()
    })
    it('자격증명 워크스페이스로 좁히고, 볼 수 없는 비공개 프로젝트의 회의록을 뺀다(무프로젝트 회의록은 남긴다)', async () => {
      // PROJECT_UUID 는 비공개이고 호출자는 명단이 없다 → 숨김. OLD_PROJECT_UUID 는 명단 member 라 보인다.
      mocks.actorFromUser.mockResolvedValue(makeActor({
        userId: USER.id,
        projectWorkspace: new Map([[PROJECT_UUID, WS], [OLD_PROJECT_UUID, WS]]),
        projectRoles: new Map<string, ProjectRole>([[OLD_PROJECT_UUID, 'member']]),
      }))
      const { builders } = useAdmin({
        projects: [{ data: [{ id: PROJECT_UUID, is_private: true }, { id: OLD_PROJECT_UUID, is_private: true }] }],
        minutes: [{ data: [existingRow], count: 1 }],
      })
      const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
      expect(res.status).toBe(200)
      expect(builders.projects[0].eq.mock.calls).toEqual([['workspace_id', WS]])
      expect(builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)
      expect(builders.minutes[0].in).not.toHaveBeenCalled()
      expect(builders.minutes[0].or).toHaveBeenCalledWith(`project_id.is.null,project_id.not.in.(${PROJECT_UUID})`)
    })
    it('자격증명의 project_ids 밖 프로젝트의 회의록도 뺀다 — 호출자가 볼 수 있는 프로젝트여도', async () => {
      useCredential({ project_ids: [OLD_PROJECT_UUID] })
      const { builders } = useAdmin({
        projects: [{ data: [{ id: PROJECT_UUID, is_private: false }, { id: OLD_PROJECT_UUID, is_private: false }] }],
        minutes: [{ data: [existingRow], count: 1 }],
      })
      expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(200)
      expect(builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)
      expect(builders.minutes[0].or).toHaveBeenCalledWith(`project_id.is.null,project_id.not.in.(${PROJECT_UUID})`)
    })
    it('범위 초과 폴백 카운트도 같은 호출자 스코프를 건다', async () => {
      mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, projectWorkspace: new Map([[PROJECT_UUID, WS]]) }))
      const { builders } = useAdmin({
        projects: [{ data: [{ id: PROJECT_UUID, is_private: true }] }],
        minutes: [{ error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }, { count: 3 }],
      })
      const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com&page=9'))
      expect(await res.json()).toMatchObject({ items: [], total: 3 })
      expect(builders.minutes[1].eq).toHaveBeenCalledWith('workspace_id', WS)
      expect(builders.minutes[1].or).toHaveBeenCalledWith(`project_id.is.null,project_id.not.in.(${PROJECT_UUID})`)
    })
    it('자격증명 워크스페이스의 멤버가 아니면 403 unknown_user — 회의록·프로젝트를 조회하지 않는다', async () => {
      // 옛 시크릿 경로는 소속 워크스페이스가 없는 호출자에게 빈 목록(200)을 줬다. 자격증명 경로는 멤버 확인에서 닫는다.
      mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, workspaceRoles: new Map() }))
      const { builders } = useAdmin({ workspace_members: [{ data: null }] })
      const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
      expect(res.status).toBe(403)
      const json = await res.json()
      expect(json).toMatchObject({ code: 'unknown_user' })
      expect(json).not.toHaveProperty('items')
      expect(builders.minutes).toBeUndefined()
      expect(builders.projects).toBeUndefined()
    })
    it('멤버 확인 조회가 실패하면 500 — 비멤버(403)로 위장하지 않는다', async () => {
      const spy = errSpy()
      const { builders } = useAdmin({ workspace_members: [{ error: { message: 'down' } }] })
      const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
      expect(res.status).toBe(500)
      expect(builders.minutes).toBeUndefined()
      spy.mockRestore()
    })
    it('플랫폼 관리자도 자격증명 워크스페이스로 한정된다 — 워크스페이스 목록을 읽어 전부로 넓히지 않는다', async () => {
      mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id }))
      const { admin, builders } = useAdmin({ minutes: [{ data: [], count: 0 }] })
      expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(200)
      expect(builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)
      expect(builders.workspaces).toBeUndefined()
      expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
      expect(builders.minutes[0].or).not.toHaveBeenCalled()
    })
    it('권한·프로젝트 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
      const spy = errSpy()
      mocks.actorFromUser.mockRejectedValueOnce(new Error('db down'))
      expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(500)
      useAdmin({ projects: [{ error: { message: 'down' } }] })
      expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(500)
      spy.mockRestore()
    })
  })

  describe('POST /minutes/link — 작성자 또는 그 프로젝트 관리자만, 아니면 404', () => {
    it('다른 워크스페이스 회의록은 404 not_found — 존재를 드러내지 않고 갱신하지 않는다', async () => {
      const { builders } = useAdmin({
        minutes: [{ data: { id: MINUTE_UUID, external_id: null, created_by: 'u-9', project_id: OTHER_PROJECT, workspace_id: W2, archived_at: null } }],
      })
      const res = await LINK(link(linkPayload))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: '회의록을 찾을 수 없습니다.', code: 'not_found' })
      expect(builders.minutes).toHaveLength(1)
    })
    it('같은 워크스페이스라도 작성자가 아닌 명단 member 는 404(보관 여부도 드러내지 않는다)', async () => {
      const { builders } = useAdmin({
        minutes: [{ data: { id: MINUTE_UUID, external_id: null, created_by: 'u-9', project_id: PROJECT_UUID, workspace_id: WS, archived_at: '2026-09-01T00:00:00Z' } }],
      })
      const res = await LINK(link(linkPayload))
      expect(res.status).toBe(404)
      expect(builders.minutes).toHaveLength(1)
    })
    it('프로젝트 없는 남의 회의록은 워크스페이스 관리자도 404 — 세션 판정(checkOwner)과 같다', async () => {
      mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, workspaceRoles: new Map([[WS, 'admin']]) }))
      useAdmin({ minutes: [{ data: { id: MINUTE_UUID, external_id: null, created_by: 'u-9', project_id: null, workspace_id: WS, archived_at: null } }] })
      expect((await LINK(link(linkPayload))).status).toBe(404)
    })
    it('그 프로젝트의 관리자(워크스페이스 관리자 승계)는 남의 회의록도 연결한다', async () => {
      mocks.actorFromUser.mockResolvedValue(makeActor({
        userId: USER.id, workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[PROJECT_UUID, WS]]),
      }))
      useAdmin({
        minutes: [
          { data: { id: MINUTE_UUID, external_id: null, created_by: 'u-9', project_id: PROJECT_UUID, workspace_id: WS, archived_at: null } },
          { data: [{ id: MINUTE_UUID }] },
        ],
      })
      expect((await LINK(link(linkPayload))).status).toBe(200)
    })
    it('권한 조회 실패는 500', async () => {
      const spy = errSpy()
      mocks.actorFromUser.mockRejectedValueOnce(new Error('db down'))
      useAdmin({ minutes: [{ data: { id: MINUTE_UUID, external_id: null, created_by: USER.id, project_id: null, workspace_id: WS, archived_at: null } }] })
      expect((await LINK(link(linkPayload))).status).toBe(500)
      spy.mockRestore()
    })
  })

  describe('POST /minutes — meeting_id 는 그 프로젝트 멤버만, external_id 기존 회의록은 편집 자격이 있어야', () => {
    it('다른 워크스페이스 회의에 연결하려 하면 404 — 등록하지 않는다', async () => {
      const { admin } = useAdmin({ meetings: [{ data: { id: MEETING_UUID, project_id: OTHER_PROJECT } }], minutes: [{ data: null }] })
      const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ code: 'not_found' })
      expect(admin.rpc).not.toHaveBeenCalled()
    })
    it('같은 워크스페이스라도 명단 권한이 없는(조회 전용) 프로젝트의 회의는 404', async () => {
      mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, projectWorkspace: new Map([[PROJECT_UUID, WS]]) }))
      const { admin } = useAdmin({ meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }], minutes: [{ data: null }] })
      expect((await POST(post({ ...payload, meeting_id: MEETING_UUID }))).status).toBe(404)
      expect(admin.rpc).not.toHaveBeenCalled()
    })
    it('없는 회의도 같은 404 — 남의 회의와 구별되지 않는다', async () => {
      useAdmin({ meetings: [{ data: null }] })
      const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ code: 'not_found' })
    })
    it('다른 워크스페이스 회의록의 external_id 로 replace 하면 404 — 덮어쓰지 않는다', async () => {
      const foreign = { ...existingRow, created_by: 'u-9', project_id: OTHER_PROJECT, workspace_id: W2 }
      const { admin } = useAdmin({ minutes: [{ data: foreign }] })
      const res = await POST(post(payload))
      expect(res.status).toBe(404)
      expect(await res.json()).toMatchObject({ code: 'not_found' })
      expect(admin.rpc).not.toHaveBeenCalled()
    })
    it('skip·error 도 편집 자격이 없으면 404 — 남의 external_id 존재를 409·skipped 로 드러내지 않는다', async () => {
      const foreign = { ...existingRow, created_by: 'u-9', project_id: OTHER_PROJECT, workspace_id: W2 }
      useAdmin({ minutes: [{ data: foreign }] })
      expect((await POST(post({ ...payload, on_conflict: 'skip' }))).status).toBe(404)
      useAdmin({ minutes: [{ data: foreign }] })
      expect((await POST(post({ ...payload, on_conflict: 'error' }))).status).toBe(404)
    })
    it('같은 프로젝트 명단 member 라도 남의 회의록은 replace 404', async () => {
      const { admin } = useAdmin({ minutes: [{ data: { ...existingRow, created_by: 'u-9', project_id: PROJECT_UUID } }] })
      expect((await POST(post(payload))).status).toBe(404)
      expect(admin.rpc).not.toHaveBeenCalled()
    })
    it('그 프로젝트 관리자는 남의 회의록도 replace 한다', async () => {
      mocks.actorFromUser.mockResolvedValue(makeActor({
        userId: USER.id, projectWorkspace: new Map([[PROJECT_UUID, WS]]),
        projectRoles: new Map<string, ProjectRole>([[PROJECT_UUID, 'admin']]),
      }))
      const { admin } = useAdmin({
        minutes: [
          { data: { ...existingRow, created_by: 'u-9', project_id: PROJECT_UUID } },
          { data: { id: 'm-1', created_at: existingRow.created_at, updated_at: 't' } },
        ],
        minute_folders: [{ data: [] }],
      })
      expect((await POST(post(payload))).status).toBe(200)
      expect(admin.rpc).toHaveBeenCalledWith('commit_minute_body_version', expect.anything())
    })
    it('inline meeting 을 만들기 전에 판정한다 — 편집 자격이 없으면 고아 회의를 남기지 않는다', async () => {
      const foreign = { ...existingRow, created_by: 'u-9', project_id: OTHER_PROJECT, workspace_id: W2 }
      const { builders } = useAdmin({ minutes: [{ data: foreign }] })
      const res = await POST(post({ ...payload, meeting: { project_id: PROJECT_UUID, title: '회의', date: '2026-08-06' } }))
      expect(res.status).toBe(404)
      expect(builders.meetings).toBeUndefined()
    })
    it('동시 전송 경합(23505) 뒤 재조회한 행도 같은 판정을 거친다', async () => {
      const foreign = { ...existingRow, created_by: 'u-9', project_id: OTHER_PROJECT, workspace_id: W2 }
      const { admin } = useAdmin({
        minutes: [{ data: null }, { error: { code: '23505', message: 'duplicate' } }, { data: foreign }],
        minute_folders: [{ data: [] }],
      })
      const res = await POST(post(payload))
      expect(res.status).toBe(404)
      expect(admin.rpc).not.toHaveBeenCalledWith('commit_minute_body_version', expect.anything())
    })
    describe('inline meeting — meeting_id 와 같은 판정(isProjectMember), 없음·못 봄은 같은 404', () => {
      const meetingReq = { ...payload, meeting: { project_id: PROJECT_UUID, title: '회의', date: '2026-08-06' } }
      const created = { id: 'm-1', created_at: 't', updated_at: 't' }

      it('권한 없는 명단 행(조회 전용)은 회의를 만들지도 재사용하지도 못한다 — 404', async () => {
        mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, projectWorkspace: new Map([[PROJECT_UUID, WS]]) }))
        const { builders, admin } = useAdmin({
          minutes: [{ data: null }, { data: created }],
          projects: [{ data: { id: PROJECT_UUID } }],
          project_members: [{ data: [{ id: 'pm-1' }] }],   // 활성 명단 행은 있다(access_role null)
          meetings: [{ data: { id: MEETING_UUID } }],
        })
        const res = await POST(post(meetingReq))
        expect(res.status).toBe(404)
        expect(await res.json()).toMatchObject({ code: 'not_found' })
        expect(builders.meetings).toBeUndefined()
        expect(admin.rpc).not.toHaveBeenCalled()
      })
      it('명단 행 없는 워크스페이스 관리자는 회의를 만든다(승계)', async () => {
        mocks.actorFromUser.mockResolvedValue(makeActor({
          userId: USER.id, workspaceRoles: new Map([[WS, 'admin']]), projectWorkspace: new Map([[PROJECT_UUID, WS]]),
        }))
        useAdmin({
          minutes: [{ data: null }, { data: created }],
          projects: [{ data: { id: PROJECT_UUID } }],
          project_members: [{ data: [] }],
          meetings: [{ data: null }, { data: { id: MEETING_UUID } }],
          minute_folders: [{ data: [] }],
        })
        const res = await POST(post(meetingReq))
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({ meeting_id: MEETING_UUID, meeting_created: true })
      })
      it('다른 워크스페이스 프로젝트와 없는 프로젝트는 같은 404 — 존재를 드러내지 않는다', async () => {
        const foreign = { ...meetingReq, meeting: { ...meetingReq.meeting, project_id: OTHER_PROJECT } }
        useAdmin({ minutes: [{ data: null }], projects: [{ data: { id: OTHER_PROJECT } }], project_members: [{ data: [] }] })
        const a = await POST(post(foreign))
        useAdmin({ minutes: [{ data: null }], projects: [{ data: null }] })
        const b = await POST(post({ ...meetingReq, meeting: { ...meetingReq.meeting, project_id: '00000000-0000-4000-8000-000000000000' } }))
        expect(a.status).toBe(404)
        expect(b.status).toBe(404)
        expect(await a.json()).toEqual(await b.json())
      })
    })

    it('호출자 권한 조회 실패는 500 — 판정 전에 쓰지 않는다', async () => {
      const spy = errSpy()
      mocks.actorFromUser.mockRejectedValueOnce(new Error('db down'))
      const { admin } = useAdmin({ minutes: [{ data: existingRow }] })
      expect((await POST(post(payload))).status).toBe(500)
      expect(admin.rpc).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})

describe('SP2 Task 16a — 쓰기 대상의 워크스페이스·담당 팀을 쓰기 전에 확정한다', () => {
  const W2 = W2_UUID
  const W2_PROJECT = '6e2d0c1f-3a5b-4f7c-9d8e-0b1c2d3e4f5a'
  const W2_MEETING = '8a9b0c1d-2e3f-4a5b-8c7d-9e0f1a2b3c4d'
  const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {})
  // 호출자는 WS·W2 양쪽 프로젝트의 명단 member — 두 프로젝트의 회의 모두 연결 자격이 있다(교차 판정만 남는다).
  const inBoth = () => makeActor({
    userId: USER.id, workspaceRoles: new Map([[WS, 'member'], [W2, 'member']]),
    projectWorkspace: new Map([[PROJECT_UUID, WS], [W2_PROJECT, W2]]),
    projectRoles: new Map<string, ProjectRole>([[PROJECT_UUID, 'member'], [W2_PROJECT, 'member']]),
  })
  // 워크스페이스마다 공용 팀이 다르다 — WS 는 PMO, W2 는 ERP(옛 전역 접근자는 둘 다 통과시켰다).
  const splitTeams = () => {
    mocks.activeTeamCodesForWorkspace.mockImplementation((wid: string) => (wid === WS ? ['PMO'] : ['ERP']))
    mocks.activeTeamCodesForProject.mockImplementation((pid: string) => (pid === W2_PROJECT ? ['ERP'] : ['PMO']))
  }

  // 교차 워크스페이스 연결의 400 은 "회의록의 워크스페이스 ≠ 연결할 프로젝트의 워크스페이스"다. 자격증명 경로에서는 연결할 프로젝트가
  // 자격증명 워크스페이스 밖이면 그보다 먼저 404 로 닫힌다(아래 두 케이스의 후반) — 400 은 프로젝트가 자격증명 워크스페이스 안일 때 닿는다.
  it('replace: W2 회의록을 WS 회의에 연결하면 400 — 상대 트리에 폴더를 만들거나 RPC 에 닿지 않는다', async () => {
    mocks.actorFromUser.mockResolvedValue(inBoth())
    const { admin, builders } = useAdmin({
      meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }],
      minutes: [{ data: { ...existingRow, workspace_id: W2 } }],
      minute_folders: [{ data: [] }],
    })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID, folder_path: ['PMO', '품질'] }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed', error: expect.stringContaining('다른 워크스페이스') })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(builders.minute_folders).toBeUndefined()
  })

  it('replace: WS 회의록을 자격증명 워크스페이스 밖(W2) 회의에 연결하면 404 — 상대 트리에 폴더를 만들거나 RPC 에 닿지 않는다', async () => {
    mocks.actorFromUser.mockResolvedValue(inBoth())
    const { admin, builders } = useAdmin({
      meetings: [{ data: { id: W2_MEETING, project_id: W2_PROJECT } }],
      minutes: [{ data: existingRow }],
      minute_folders: [{ data: [] }],
    })
    const res = await POST(post({ ...payload, team: 'ERP', meeting_id: W2_MEETING, folder_path: ['ERP', '품질'] }))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: '프로젝트를 찾을 수 없습니다.', code: 'not_found' })
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(builders.minute_folders).toBeUndefined()
    expect(requireModule).not.toHaveBeenCalled()
  })

  it('replace: inline meeting 으로 다른 워크스페이스 프로젝트에 연결해도 400(자격증명 밖이면 404) — 회의를 만들지 않는다', async () => {
    mocks.actorFromUser.mockResolvedValue(inBoth())
    // W2 회의록 → WS(자격증명 워크스페이스) 프로젝트: 교차 400
    const cross = useAdmin({ minutes: [{ data: { ...existingRow, workspace_id: W2 } }], meetings: [{ data: null }, { data: { id: MEETING_UUID } }] })
    const res = await POST(post({
      ...payload, meeting: { project_id: PROJECT_UUID, title: '정례', date: '2026-09-26' },
    }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed', error: expect.stringContaining('다른 워크스페이스') })
    expect(cross.builders.meetings).toBeUndefined()
    expect(cross.admin.rpc).not.toHaveBeenCalled()
    // WS 회의록 → W2(자격증명 밖) 프로젝트: 404
    const outside = useAdmin({ minutes: [{ data: existingRow }], meetings: [{ data: null }, { data: { id: W2_MEETING } }] })
    const res2 = await POST(post({
      ...payload, team: 'ERP', meeting: { project_id: W2_PROJECT, title: '정례', date: '2026-09-26' },
    }))
    expect(res2.status).toBe(404)
    expect(await res2.json()).toEqual({ error: '프로젝트를 찾을 수 없습니다.', code: 'not_found' })
    expect(outside.builders.meetings).toBeUndefined()
    expect(outside.admin.rpc).not.toHaveBeenCalled()
  })

  it('신규: 자격증명 project_ids 밖 프로젝트의 회의(meeting_id·inline)는 403 project_not_allowed — 회의·회의록을 만들지 않는다', async () => {
    useCredential({ project_ids: [OLD_PROJECT_UUID] })   // 호출자는 PROJECT_UUID 의 명단 member 지만 자격증명 범위 밖이다
    const byId = useAdmin({ meetings: [{ data: { id: MEETING_UUID, project_id: PROJECT_UUID } }], minutes: [{ data: null }] })
    const res = await POST(post({ ...payload, meeting_id: MEETING_UUID }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'project_not_allowed' })
    expect(byId.admin.rpc).not.toHaveBeenCalled()
    const inline = useAdmin({ minutes: [{ data: null }], meetings: [{ data: null }, { data: { id: MEETING_UUID } }] })
    const res2 = await POST(post({ ...payload, meeting: { project_id: PROJECT_UUID, title: '정례', date: '2026-09-26' } }))
    expect(res2.status).toBe(403)
    expect(await res2.json()).toMatchObject({ code: 'project_not_allowed' })
    expect(inline.builders.meetings).toBeUndefined()
    expect(inline.admin.rpc).not.toHaveBeenCalled()
  })

  it('replace: 판정 뒤 경합으로 커밋이 WORKSPACE_SCOPE_MISMATCH 를 내면 500 이 아니라 400', async () => {
    const spy = errSpy()
    useAdmin({ minutes: [{ data: existingRow }, { error: { message: 'WORKSPACE_SCOPE_MISMATCH' } }] })
    const res = await POST(post(payload))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed', error: expect.stringContaining('다른 워크스페이스') })
    spy.mockRestore()
  })

  it('무프로젝트 신규(WS)에 W2 의 팀 코드는 400 — WS 의 팀은 통과', async () => {
    splitTeams()
    const denied = useAdmin({ minutes: [{ data: null }] })
    const res = await POST(post({ ...payload, team: 'ERP' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'validation_failed', error: '잘못된 담당입니다.' })
    expect(denied.admin.rpc).not.toHaveBeenCalled()
    useAdmin({
      minutes: [{ data: null }, { data: { id: 'm-1', created_at: '2026-09-26T01:00:00+00:00', updated_at: '2026-09-26T01:00:00+00:00' } }],
      minute_folders: [{ data: [] }],
    })
    expect((await POST(post({ ...payload, team: 'PMO' }))).status).toBe(201)
  })

  it('replace: 기존 회의록의 워크스페이스 팀으로 본다 — 행의 범위가 기준', async () => {
    splitTeams()
    const { admin } = useAdmin({ minutes: [{ data: existingRow }] })   // existingRow 는 WS 의 무프로젝트 회의록
    const res = await POST(post({ ...payload, team: 'ERP' }))
    expect(res.status).toBe(400)
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('팀 캐시를 못 채웠으면 500 — 빈 목록(전건 400)으로 위장하지 않는다', async () => {
    const spy = errSpy()
    mocks.activeTeamCodesForWorkspace.mockImplementation(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    const { admin } = useAdmin({ minutes: [{ data: null }] })
    expect((await POST(post(payload))).status).toBe(500)
    expect(admin.rpc).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('inline meeting: 같은 워크스페이스라도 비멤버 프로젝트는 팀 판정 전에 404 — 400/404 차이로 팀 구성을 떠볼 수 없다', async () => {
    // 호출자 워크스페이스(WS)의 프로젝트지만 명단 역할이 없다(비공개 프로젝트 가정). 그 프로젝트의 팀은 ERP 뿐이다.
    const PRIVATE_PROJECT = '4c3b2a19-0f8e-4d7c-b6a5-9e8d7c6b5a49'
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, projectWorkspace: new Map([[PROJECT_UUID, WS], [PRIVATE_PROJECT, WS]]),
      projectRoles: new Map<string, ProjectRole>([[PROJECT_UUID, 'member']]),
    }))
    mocks.activeTeamCodesForProject.mockImplementation((pid: string) => (pid === PRIVATE_PROJECT ? ['ERP'] : ['PMO']))
    const meeting = { project_id: PRIVATE_PROJECT, title: '정례', date: '2026-09-26' }
    // 팀이 틀리든(PMO) 맞든(ERP) 같은 404 — 응답이 갈리면 그 차이로 팀 구성이 샌다.
    const wrong = useAdmin({ minutes: [{ data: null }] })
    const resWrong = await POST(post({ ...payload, team: 'PMO', meeting }))
    const right = useAdmin({ minutes: [{ data: null }] })
    const resRight = await POST(post({ ...payload, team: 'ERP', meeting }))
    for (const [res, fake] of [[resWrong, wrong], [resRight, right]] as const) {
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: '프로젝트를 찾을 수 없습니다.', code: 'not_found' })
      expect(fake.builders.meetings).toBeUndefined()
      expect(fake.admin.rpc).not.toHaveBeenCalled()
    }
    // 기존 회의록의 skip 도 같다 — 연결 자격 없는 inline 프로젝트는 skip 응답(200)으로 흘리지 않는다.
    useAdmin({ minutes: [{ data: existingRow }] })
    const skip = await POST(post({ ...payload, on_conflict: 'skip', meeting }))
    expect(skip.status).toBe(404)
  })

  it('GET 목록의 team 필터는 호출자 워크스페이스의 팀만 — 다른 워크스페이스 팀 코드는 400', async () => {
    splitTeams()
    useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=ERP'))).status).toBe(400)
    useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=PMO'))).status).toBe(200)
  })

  it('GET team 필터는 볼 수 있는 프로젝트의 전용 팀도 받고, 숨은 비공개 프로젝트의 전용 팀은 400(SP2 16b)', async () => {
    const PRIV = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a'
    const t = (code: string, workspaceId: string, projectId: string | null = null): Team =>
      ({ id: `${workspaceId}-${code}`, code, name: code, color: '#6b7280', sortOrder: 0, active: true, progressVisible: true, projectId, workspaceId })
    const teams = [t('PMO', WS), t('ERP', 'ws-2'), t('MES', WS, PROJECT_UUID), t('QA', WS, PRIV)]
    mocks.activeTeamCodesVisibleTo.mockImplementation(view => teamCodesVisibleTo(teams, view))
    mocks.actorFromUser.mockResolvedValue(makeActor({
      userId: USER.id, projectWorkspace: new Map([[PROJECT_UUID, WS], [PRIV, WS]]),
      projectRoles: new Map<string, ProjectRole>([[PROJECT_UUID, 'member']]),
    }))
    const privateRows = { data: [{ id: PRIV, is_private: true }] }
    useAdmin({ projects: [privateRows], minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=MES'))).status).toBe(200)
    useAdmin({ projects: [privateRows], minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=QA'))).status).toBe(400)
    useAdmin({ projects: [privateRows], minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=ERP'))).status).toBe(400)
  })

  it('GET team 필터 — 플랫폼 관리자는 전 워크스페이스의 팀으로 본다(항상 400 이 아니다), 단 자격증명 워크스페이스 멤버가 아니면 403', async () => {
    splitTeams()
    mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id, workspaceRoles: new Map() }))
    const member = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=ERP'))).status).toBe(200)
    expect(member.builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)   // 팀 필터가 넓어도 목록은 자격증명 워크스페이스뿐
    // 플랫폼 관리자 권한은 멤버십을 대신하지 않는다
    const outsider = useAdmin({ workspace_members: [{ data: null }], minutes: [{ data: [], count: 0 }] })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com&team=ERP'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'unknown_user' })
    expect(outsider.builders.minutes).toBeUndefined()
  })
})

// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('minutes_integration 관문 — 409 module_disabled(과제 21)', () => {
  it('POST: 대상 워크스페이스가 꺼지면 409 이고 회의록을 쓰지 않는다 — 판정은 admin 으로', async () => {
    const { admin } = useAdmin({ minutes: [{ data: null }] })          // external_id 선조회 — 새 회의록
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(post(payload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'minutes_integration', { client: admin })
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('POST: 기존 회의록(skip·보관 분기 포함)도 그 행의 워크스페이스로 먼저 판정한다 — 회의·폴더를 만들지 않는다', async () => {
    const { admin, builders } = useAdmin({ minutes: [{ data: { ...existingRow, archived_at: '2026-07-02T00:00:00Z' } }] })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await POST(post({ ...payload, meeting: { project_id: PROJECT_UUID, title: '회의', date: '2026-08-06' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'minutes_integration', { client: admin })
    expect(builders.meetings).toBeUndefined()
    expect(builders.minute_folders).toBeUndefined()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
  it('POST: 담당 팀·교차 워크스페이스 400 은 관문보다 먼저다(resolveWriteTarget — 계약 유지)', async () => {
    useAdmin({ minutes: [{ data: null }] })
    const res = await POST(post({ ...payload, team: 'NOPE' }))
    expect(res.status).toBe(400)
    expect(requireModule).not.toHaveBeenCalled()
  })
  it('POST: 동시 전송 경합(23505) 뒤 재조회한 행의 워크스페이스도 판정한다 — 꺼졌으면 409 이고 갱신하지 않는다', async () => {
    const { admin } = useAdmin({
      minutes: [{ data: null }, { error: { code: '23505', message: 'duplicate key' } }, { data: existingRow }],
    })
    vi.mocked(requireModule)
      .mockResolvedValueOnce({ ok: true })                                // 새 회의록 대상(자격증명 워크스페이스)
      .mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })   // 경합으로 생긴 행
    const res = await POST(post(payload))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledTimes(2)
    expect(requireModule).toHaveBeenLastCalledWith({ workspaceId: existingRow.workspace_id }, 'minutes_integration', { client: admin })
    expect(admin.rpc).not.toHaveBeenCalledWith('commit_minute_body_version', expect.anything())
  })
  it('GET 목록: 허용된 워크스페이스가 없으면 409 — 회의록을 읽지 않는다', async () => {
    const { builders, admin } = useAdmin({ projects: [{ data: [] }] })  // 자격증명 워크스페이스의 프로젝트 조회
    vi.mocked(workspacesWithModule).mockResolvedValueOnce([])
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
    expect(builders.minutes).toBeUndefined()
  })
  it('GET 목록: 자격증명 워크스페이스가 꺼지면 409 — 프로젝트·회의록을 읽지 않는다(판정은 admin 으로)', async () => {
    const { builders, admin } = useAdmin({ projects: [{ data: [] }], minutes: [{ data: [], count: 0 }] })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'minutes_integration', { client: admin })
    expect(builders.projects).toBeUndefined()
    expect(builders.minutes).toBeUndefined()
  })
  it('GET 목록: 호출자 소속이 여럿이어도 자격증명 워크스페이스 하나만 판정하고 그 워크스페이스로 좁힌다', async () => {
    // 옛 시크릿 경로는 소속 워크스페이스들 중 허용된 것으로 in 을 걸었다. 자격증명 경로는 다른 소속(ws-off)을 후보에 넣지 않는다.
    mocks.actorFromUser.mockResolvedValue(makeActor({ userId: USER.id, workspaceRoles: new Map([[WS, 'member'], ['ws-off', 'member']]) }))
    const { builders, admin } = useAdmin({ projects: [{ data: [] }], minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(200)
    expect(workspacesWithModule).toHaveBeenCalledTimes(1)
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
    expect(builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(builders.minutes[0].in).not.toHaveBeenCalled()
  })
  it('GET 목록: 플랫폼 관리자도 워크스페이스 목록을 읽지 않고 자격증명 워크스페이스만 판정한다 — 꺼져 있으면 409', async () => {
    mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id }))
    const { builders, admin } = useAdmin({ minutes: [{ data: [], count: 0 }] })
    expect((await GET(get('/api/v1/minutes?user_email=lead%40example.com'))).status).toBe(200)
    expect(workspacesWithModule).toHaveBeenCalledWith([WS], 'minutes_integration', { client: admin })
    expect(builders.workspaces).toBeUndefined()
    expect(builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)
    const off = useAdmin({ minutes: [{ data: [], count: 0 }] })
    vi.mocked(workspacesWithModule).mockResolvedValueOnce([])
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com'))
    expect(res.status).toBe(409)
    expect(off.builders.minutes).toBeUndefined()
  })
  it('GET 목록: 범위 초과 페이지(PGRST103)의 카운트도 자격증명 워크스페이스로 좁힌다 — 본 조회와 total 이 같다', async () => {
    mocks.actorFromUser.mockResolvedValue(makeSuperuser({ userId: USER.id }))
    const { builders } = useAdmin({
      minutes: [{ error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }, { count: 2 }],
    })
    const res = await GET(get('/api/v1/minutes?user_email=lead%40example.com&page=9'))
    expect(await res.json()).toMatchObject({ items: [], total: 2 })
    expect(builders.minutes[0].eq).toHaveBeenCalledWith('workspace_id', WS)
    expect(builders.minutes[1].eq).toHaveBeenCalledWith('workspace_id', WS)   // 카운트도 같은 범위
  })
  it('link: 대상 회의록의 워크스페이스가 꺼지면 409 이고 갱신하지 않는다', async () => {
    const { builders, admin } = useAdmin({ minutes: [{ data: { id: MINUTE_UUID, created_by: USER.id, project_id: null, workspace_id: WS, archived_at: null, external_id: null } }] })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await LINK(link({ user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'minutes_integration', { client: admin })
    expect(builders.minutes).toHaveLength(1)                            // 대상 조회 1회뿐 — update 없음
  })
  it('link: 보관됨 ∧ 연동 꺼짐이면 관문이 먼저다 — archived 409 가 아니라 module_disabled(과제 21 · B7 T21-I1)', async () => {
    const { builders, admin } = useAdmin({ minutes: [{ data: { id: MINUTE_UUID, created_by: USER.id, project_id: null, workspace_id: WS, archived_at: '2026-09-01T00:00:00Z', external_id: null } }] })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    const res = await LINK(link({ user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }))
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WS }, 'minutes_integration', { client: admin })
    expect(builders.minutes).toHaveLength(1)                            // 대상 조회 1회뿐 — update 없음
  })
  it('link: 편집 자격이 없는 회의록은 모듈 판정 전에 404 — 존재 은닉이 먼저다', async () => {
    useAdmin({ minutes: [{ data: { id: MINUTE_UUID, created_by: 'u-9', project_id: null, workspace_id: 'ws-9', archived_at: null, external_id: null } }] })
    const res = await LINK(link({ user_email: 'lead@example.com', minute_id: MINUTE_UUID, external_id: EXTERNAL_ID }))
    expect(res.status).toBe(404)
    expect(requireModule).not.toHaveBeenCalled()
  })
})
