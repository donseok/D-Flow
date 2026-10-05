// deny 하네스 — 가드·세션·supabase 를 한 상태(state.guards)로 조종하고, 전역 관문 mock 을 "한 모듈만 한 범위에서 끈" 상태로 바꾼다.
// vi.mock 팩토리는 이 파일을 동적 import 해서 아래 *Mock 객체를 돌려준다(테스트 파일 머리 참조).
// 가짜 DB 는 쓰기(insert·update·upsert·delete·rpc·storage 쓰기)를 세고, 관문이 거부한 뒤의 DB 접근을 따로 센다 — 거부 경로에서 둘 다 0 이어야
// 가드·관문이 본문을 지배한다(P17 "가드 바로 다음, 본문 앞"). 가드·범위 해석의 읽기는 관문 앞이라 세지 않는다.
import { vi } from 'vitest'
import { ERR_DENIED, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import type { ModuleId } from '@/lib/modules/defaults'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { moduleDef } from '@/lib/modules/registry'
import { makeAdminActor, makeMemberActor, WS } from '../fixtures/actor'

export const U = '00000000-0000-0000-7e57-000000001431'
export const P = '00000000-0000-0000-7e57-000000001432'
export const W = WS
export const ACTOR = makeAdminActor(P, { userId: 'u-gate', workspaceRoles: new Map([[WS, 'admin']]) })
/** 관리자가 아닌 멤버(같은 userId) — 관리자 거부 모드의 행위자. ROW.created_by 가 이 userId 라 작성자·주최자 판정이 성립한다 */
export const MEMBER_ACTOR = makeMemberActor(P, [], { userId: 'u-gate' })
/** 가드를 통과한 뒤 관문까지 가는 동안 액션이 읽는 행 — 필드는 넉넉히(관문 뒤는 거부 경로라 쓰이지 않는다) */
export const ROW: Record<string, unknown> = {
  id: U, project_id: P, workspace_id: W, wbs_item_id: U, status: 'reported', created_by: 'u-gate', enabled: true, archived_at: null,
  minute_id: U, issue_id: U, meeting_id: U, parent_id: null, name: 'Acme', title: 'Acme', claimed_by: null,
}
/** 표에 따라 달라야 가드까지 가는 행 — 워크스페이스 팀은 project_id 가 null 이다(updateTeam 이 프로젝트 팀을 ERR_MISSING 으로 거른다) */
const TABLE_ROWS: Readonly<Record<string, Record<string, unknown>>> = { teams: { project_id: null }, form_templates: { form_kind: 'weekly_report_pptx' } }

/** pass = 가드 통과, deny = 세션 없음(모든 가드·행위자·세션 거부), rank = 세션은 있고 네 등급 가드만 거부,
 *  notAdmin = 관리자 아닌 멤버(관리자 가드 셋만 거부 — requireProjectMember·행위자·세션은 통과, 행위자는 MEMBER_ACTOR) */
export type GuardMode = 'pass' | 'deny' | 'rank' | 'notAdmin'
export const state = { guards: 'pass' as GuardMode, authReads: 0, writes: 0, gateDenied: false, afterDeny: 0, guardDenied: false, afterGuardDeny: 0 }
/** 가드가 거부를 돌려준 순간부터 DB 접근을 센다 — 거부 뒤 본문이 돌면(가드 fail-open) 0 이 아니다 */
const guardSaid = <T>(denied: boolean, v: T): T => { if (denied) state.guardDenied = true; return v }

/** 어떤 체인이든 받는 가짜 supabase — single·maybeSingle 은 ROW(표별 덮어쓰기), 그 밖의 await 는 빈 목록 */
export function fakeClient(): Record<string, unknown> {
  const touch = () => { if (state.gateDenied) state.afterDeny += 1; if (state.guardDenied) state.afterGuardDeny += 1 }
  const chainFor = (table: string): Record<string, unknown> => {
    const row = { ...ROW, ...(TABLE_ROWS[table] ?? {}) }
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const k of ['select', 'eq', 'neq', 'in', 'is', 'or', 'not', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike',
      'order', 'limit', 'range', 'match', 'contains', 'filter', 'returns', 'throwOnError', 'abortSignal', 'csv']) chain[k] = self
    for (const k of ['insert', 'update', 'upsert', 'delete']) chain[k] = () => { state.writes += 1; return chain }
    chain.single = async () => ({ data: row, error: null })
    chain.maybeSingle = async () => ({ data: row, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej)
    return chain
  }
  const user = () => { state.authReads += 1; return guardSaid(state.guards === 'deny', state.guards === 'deny' ? null : { id: 'u-gate', email: 'gate@example.com' }) }   // 세션 읽기도 가드 흔적으로 센다
  const storageWrite = async () => { state.writes += 1; return { data: { path: 'x' }, error: null } }
  return {
    from: (table: string) => { touch(); return chainFor(table) },
    rpc: (fn: string) => { touch(); state.writes += 1; return chainFor(`rpc:${fn}`) },   // RPC 는 쓰기로 센다(판정·읽기 RPC 도 가드 거부·관문 거부 뒤에는 돌면 안 된다)
    auth: { getUser: async () => ({ data: { user: user() } }), getClaims: async () => ({ data: user() ? { claims: { sub: 'u-gate' } } : null }) },
    storage: { from: () => { touch(); return {
      createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }), createSignedUploadUrl: async () => ({ data: { signedUrl: 'x', token: 't', path: 'x' }, error: null }),
      remove: storageWrite, upload: storageWrite, move: storageWrite, copy: storageWrite,
    } } },
  }
}

const rankGuard = async () => guardSaid(state.guards !== 'pass', state.guards === 'pass' ? { ok: true, actor: ACTOR } : { ok: false, error: ERR_DENIED })
/** requireProjectMember — 관리자 거부 모드에서는 멤버로 통과 */
const memberGuard = async () => (state.guards === 'notAdmin' ? { ok: true, actor: MEMBER_ACTOR } : rankGuard())
const sessionOk = () => !guardSaid(state.guards === 'deny', state.guards === 'deny')
const viewer = () => (sessionOk() ? (state.guards === 'notAdmin' ? MEMBER_ACTOR : ACTOR) : null)
const admins = vi.fn(() => fakeClient())
export const authzMock = {
  requireSuperuser: vi.fn(rankGuard), requireWorkspaceAdmin: vi.fn(rankGuard), requireProjectAdmin: vi.fn(rankGuard), requireProjectMember: vi.fn(memberGuard),
  resolveProjectId: vi.fn(async () => ({ ok: true, projectId: P })),
  resolveScope: vi.fn(async () => ({ ok: true, projectId: P, workspaceId: W })),
  getActor: vi.fn(async () => viewer()),
  getActorForView: vi.fn(async () => viewer()),
  getActorViewState: vi.fn(async () => ({ actor: viewer(), degraded: false })),
  actorFromUser: vi.fn(async () => ACTOR),
}
export const authMock = {
  getSession: vi.fn(async () => (sessionOk() ? { id: 'u-gate', email: 'gate@example.com', user_metadata: { name: 'gate' } } : null)),
  getDisplayName: vi.fn(async () => 'gate'),
}
export const serverMock = { createServerClient: vi.fn(async () => fakeClient()) }
export const adminMock = { createAdminClient: admins }
export const adminForMock = { adminFor: vi.fn((s: Record<string, string>) => ({ ...s, admin: admins() })) }

const DENY = { ok: false as const, error: ERR_MODULE_DISABLED }
const listOf = (m: ModuleId | readonly ModuleId[]) => (typeof m === 'string' ? [m] : [...m])
const gateMocks = () => [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule].map((f) => vi.mocked(f))
const rankMocks = () => [authzMock.requireSuperuser, authzMock.requireWorkspaceAdmin, authzMock.requireProjectAdmin, authzMock.requireProjectMember]
/** 권한 판정의 흔적 — 가드 넷·행위자 조회·세션 조회. null 항목의 가드 거부 실행이 "가드에 닿았다"를 확인한다 */
const guardMocks = () => [...rankMocks(), authzMock.getActor, authzMock.getActorForView, authzMock.getActorViewState, authMock.getSession]

/** 모듈 판정의 대상 — project: 인자의 프로젝트 P, row: 대상 행(행의 프로젝트 P·워크스페이스 W), session: 행 없는 세션 판정(유일 워크스페이스 W),
 *  workspace: 워크스페이스 인자를 받는 액션(인자 W — 프로젝트 층 모듈도 그 워크스페이스 W 에서 꺼진다, 계획 V10) */
export type Target = 'project' | 'row' | 'session' | 'workspace'
type Scope = { projectId: string } | { workspaceId: string }
type GateCall = { fn: string; scope: Scope | string | null; modules: ModuleId[]; denied: boolean }
/**
 * 어디서 꺼졌는가(판정 F3) — 틀린 범위로 묻는 관문은 켜진 대상을 만나 통과해 본문이 돈다(거부 값·관문 뒤 접근 단언이 FAIL).
 * - 프로젝트 층(scope project·both)·대상 project/row: 프로젝트 P 에서만 꺼짐 — { workspaceId }·세션 유일 워크스페이스·다른 프로젝트는 켜짐
 * - 대상 session: 유일 워크스페이스 W 에서 꺼짐(W 안의 P 도 꺼짐)
 * - 워크스페이스 층·대상 project/row: 행·프로젝트의 워크스페이스 W 가 꺼짐 — 행위자의 유일 워크스페이스는 켜진 다른 곳(행 판정을 세션 판정으로 바꾸면 FAIL)
 */
type Off = { module: ModuleId; projects: ReadonlySet<string>; workspaces: ReadonlySet<string>; session: boolean }
function offFor(module: ModuleId, target: Target): Off {
  const workspaceLayer = moduleDef(module).scope === 'workspace'
  if (target === 'session') return { module, projects: new Set([P]), workspaces: new Set([W]), session: true }
  if (target === 'workspace') return { module, projects: new Set([P]), workspaces: new Set([W]), session: false }
  return workspaceLayer ? { module, projects: new Set([P]), workspaces: new Set([W]), session: false } : { module, projects: new Set([P]), workspaces: new Set(), session: false }
}
const log: GateCall[] = []

export const harness = {
  /** 가드 통과·모든 모듈 켜짐, 호출 기록·계수 비움 */
  reset(): void {
    Object.assign(state, { guards: 'pass', authReads: 0, writes: 0, gateDenied: false, afterDeny: 0, guardDenied: false, afterGuardDeny: 0 })
    log.length = 0
    admins.mockClear()
    serverMock.createServerClient.mockClear()
    for (const f of gateMocks()) f.mockClear()
    for (const f of guardMocks()) f.mockClear()
    const pass = (fn: string, scope: Scope | string | null, m: ModuleId | readonly ModuleId[]) => { log.push({ fn, scope, modules: listOf(m), denied: false }) }
    vi.mocked(requireModule).mockImplementation(async (s, m) => { pass('requireModule', s, m); return { ok: true } })
    vi.mocked(requireSessionModule).mockImplementation(async (p, m) => { pass('requireSessionModule', p, m); return { ok: true } })
    vi.mocked(moduleState).mockImplementation(async (s, m) => { pass('moduleState', s, m); return 'on' })
    vi.mocked(projectsWithModule).mockImplementation(async (list, m) => { pass('projectsWithModule', null, m); return [...new Set(list)] })
    vi.mocked(workspacesWithModule).mockImplementation(async (list, m) => { pass('workspacesWithModule', null, m); return [...new Set(list)] })
  },
  /** 세션 없음 — 모든 가드·행위자·세션이 거부 */
  denyGuards(): void { state.guards = 'deny' },
  /** 세션은 있고 네 등급 가드만 거부 — 인증을 먼저 보고 등급 가드를 나중에 부르는 액션도 등급 가드까지 간다(F6) */
  denyRanks(): void { state.guards = 'rank' },
  /** 관리자가 아닌 멤버 — 관리자 가드(프로젝트·워크스페이스·플랫폼)만 거부. '관리자 또는 작성자·주최자' 헬퍼의 작성자 분기로 간다(B5 F1-14·F1-15) */
  denyAdmin(): void { state.guards = 'notAdmin' },
  /** 이 모듈을 target 에 맞는 범위에서만 끈다(offFor). 목록형은 꺼진 대상을 뺀다 */
  moduleOff(off: ModuleId, target: Target): void {
    const o = offFor(off, target)
    const hit = (m: ModuleId | readonly ModuleId[]) => listOf(m).includes(off)
    const scoped = (s: Scope) => ('projectId' in s ? o.projects.has(s.projectId) : o.workspaces.has(s.workspaceId))
    const record = (fn: string, scope: Scope | string | null, m: ModuleId | readonly ModuleId[], denied: boolean) => {
      log.push({ fn, scope, modules: listOf(m), denied })
      if (denied) state.gateDenied = true
      return denied
    }
    vi.mocked(requireModule).mockImplementation(async (s, m) => (record('requireModule', s, m, hit(m) && scoped(s)) ? DENY : { ok: true }))
    vi.mocked(requireSessionModule).mockImplementation(async (p, m) => (record('requireSessionModule', p, m, hit(m) && (p ? o.projects.has(p) : o.session)) ? DENY : { ok: true }))
    vi.mocked(moduleState).mockImplementation(async (s, m) => (record('moduleState', s, m, hit(m) && scoped(s)) ? 'off' : 'on'))
    vi.mocked(projectsWithModule).mockImplementation(async (list, m) => { log.push({ fn: 'projectsWithModule', scope: null, modules: listOf(m), denied: false }); return [...new Set(list)].filter((x) => !(hit(m) && o.projects.has(x))) })
    vi.mocked(workspacesWithModule).mockImplementation(async (list, m) => { log.push({ fn: 'workspacesWithModule', scope: null, modules: listOf(m), denied: false }); return [...new Set(list)].filter((x) => !(hit(m) && o.workspaces.has(x))) })
  },
  gateCalls(): number { return gateMocks().reduce((n, f) => n + f.mock.calls.length, 0) },
  /** 관문 함수(requireModule·requireSessionModule) 호출 수 — 목록형·moduleState 는 빼고 */
  requireCalls(): number { return vi.mocked(requireModule).mock.calls.length + vi.mocked(requireSessionModule).mock.calls.length },
  guardCalls(): number { return guardMocks().reduce((n, f) => n + f.mock.calls.length, 0) + state.authReads },
  /** 네 등급 가드 가운데 하나가 불렸는가 */
  rankCalls(): number { return rankMocks().reduce((n, f) => n + f.mock.calls.length, 0) },
  /** 관리자 가드 셋(requireProjectAdmin·requireWorkspaceAdmin·requireSuperuser) 호출 수 */
  adminGuardCalls(): number { return [authzMock.requireSuperuser, authzMock.requireWorkspaceAdmin, authzMock.requireProjectAdmin].reduce((n, f) => n + f.mock.calls.length, 0) },
  /** 관문 가운데 하나라도 이 모듈을 물었는가 */
  asked(id: ModuleId): boolean { return log.some((c) => c.modules.includes(id)) },
  /** 이 모듈을 물은 관문이 기대 범위에서 거부했는가 — 틀린 범위로 물으면 거짓 */
  deniedBy(id: ModuleId): boolean { return log.some((c) => c.denied && c.modules.includes(id)) },
  /** 관문 호출 기록(메시지용) */
  gateLog(): string { return log.map((c) => `${c.fn}(${JSON.stringify(c.scope)}, ${c.modules.join('+')})${c.denied ? '=거부' : ''}`).join(' · ') || '(관문 호출 없음)' },
  writes(): number { return state.writes },
  /** 관문이 거부한 뒤의 DB 접근(from·rpc·storage) — 결과를 버리거나 거부 뒤에도 본문이 돌면 0 이 아니다 */
  afterDeny(): number { return state.afterDeny },
  /** 가드(등급 가드·행위자·세션)가 거부한 뒤의 DB 접근 — 가드가 새서 본문이 돌면 0 이 아니다 */
  afterGuardDeny(): number { return state.afterGuardDeny },
  adminCreated(): number { return admins.mock.calls.length },
  /** 세션 클라이언트(RLS) 생성 수 */
  sessionClients(): number { return serverMock.createServerClient.mock.calls.length },
}
