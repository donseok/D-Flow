// deny 하네스 — 가드·세션·supabase 를 한 상태(state.guardsDeny)로 조종하고, 전역 관문 mock 을 "한 모듈만 끈" 상태로 바꾼다.
// vi.mock 팩토리는 이 파일을 동적 import 해서 아래 *Mock 객체를 돌려준다(테스트 파일 머리 참조).
import { vi } from 'vitest'
import { ERR_DENIED, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import type { ModuleId } from '@/lib/modules/defaults'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeAdminActor, WS } from '../fixtures/actor'

export const U = '00000000-0000-0000-7e57-000000001431'
export const P = '00000000-0000-0000-7e57-000000001432'
export const W = WS
export const ACTOR = makeAdminActor(P, { userId: 'u-gate', workspaceRoles: new Map([[WS, 'admin']]) })
/** 가드를 통과한 뒤 관문까지 가는 동안 액션이 읽는 행 — 필드는 넉넉히(관문 뒤는 거부 경로라 쓰이지 않는다) */
export const ROW: Record<string, unknown> = {
  id: U, project_id: P, workspace_id: W, wbs_item_id: U, status: 'reported', created_by: 'u-gate', enabled: true, archived_at: null,
  minute_id: U, issue_id: U, meeting_id: U, parent_id: null, name: 'Acme', title: 'Acme', claimed_by: null,
}
export const state = { guardsDeny: false, authReads: 0 }

/** 어떤 체인이든 받는 가짜 supabase — single·maybeSingle 은 ROW, 그 밖의 await 는 빈 목록 */
export function fakeClient(): Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const k of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'is', 'or', 'not', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike',
    'order', 'limit', 'range', 'match', 'contains', 'filter', 'returns', 'throwOnError', 'abortSignal']) chain[k] = self
  chain.single = async () => ({ data: ROW, error: null })
  chain.maybeSingle = async () => ({ data: ROW, error: null })
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res, rej)
  const user = () => { state.authReads += 1; return state.guardsDeny ? null : { id: 'u-gate', email: 'gate@example.com' } }   // 세션 읽기도 가드 흔적으로 센다
  return {
    from: () => chain, rpc: () => chain,
    auth: { getUser: async () => ({ data: { user: user() } }), getClaims: async () => ({ data: user() ? { claims: { sub: 'u-gate' } } : null }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }), remove: async () => ({ error: null }) }) },
  }
}

const guard = async () => (state.guardsDeny ? { ok: false, error: ERR_DENIED } : { ok: true, actor: ACTOR })
const admins = vi.fn(() => fakeClient())
export const authzMock = {
  requireSuperuser: vi.fn(guard), requireWorkspaceAdmin: vi.fn(guard), requireProjectAdmin: vi.fn(guard), requireProjectMember: vi.fn(guard),
  resolveProjectId: vi.fn(async () => ({ ok: true, projectId: P })),
  resolveScope: vi.fn(async () => ({ ok: true, projectId: P, workspaceId: W })),
  getActor: vi.fn(async () => (state.guardsDeny ? null : ACTOR)),
  getActorForView: vi.fn(async () => (state.guardsDeny ? null : ACTOR)),
  getActorViewState: vi.fn(async () => ({ actor: state.guardsDeny ? null : ACTOR, degraded: false })),
  actorFromUser: vi.fn(async () => ACTOR),
}
export const authMock = {
  getSession: vi.fn(async () => (state.guardsDeny ? null : { id: 'u-gate', email: 'gate@example.com', user_metadata: { name: 'gate' } })),
  getDisplayName: vi.fn(async () => 'gate'),
}
export const serverMock = { createServerClient: vi.fn(async () => fakeClient()) }
export const adminMock = { createAdminClient: admins }
export const adminForMock = { adminFor: vi.fn((s: Record<string, string>) => ({ ...s, admin: admins() })) }

const DENY = { ok: false as const, error: ERR_MODULE_DISABLED }
const listOf = (m: ModuleId | readonly ModuleId[]) => (typeof m === 'string' ? [m] : [...m])
const gateMocks = () => [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule].map((f) => vi.mocked(f))
/** 권한 판정의 흔적 — 가드 넷·행위자 조회·세션 조회. null 항목의 가드 거부 실행이 "가드에 닿았다"를 확인한다 */
const guardMocks = () => [authzMock.requireSuperuser, authzMock.requireWorkspaceAdmin, authzMock.requireProjectAdmin, authzMock.requireProjectMember,
  authzMock.getActor, authzMock.getActorForView, authzMock.getActorViewState, authMock.getSession]

export const harness = {
  /** 가드 통과·모든 모듈 켜짐, 호출 기록 비움 */
  reset(): void {
    state.guardsDeny = false
    state.authReads = 0
    admins.mockClear()
    for (const f of gateMocks()) f.mockClear()
    for (const f of guardMocks()) f.mockClear()
    vi.mocked(requireModule).mockImplementation(async () => ({ ok: true }))
    vi.mocked(requireSessionModule).mockImplementation(async () => ({ ok: true }))
    vi.mocked(moduleState).mockImplementation(async () => 'on')
    vi.mocked(projectsWithModule).mockImplementation(async (list) => [...new Set(list)])
    vi.mocked(workspacesWithModule).mockImplementation(async (list) => [...new Set(list)])
  },
  denyGuards(): void { state.guardsDeny = true },
  /** 이 모듈만 끈다 — 목록형 관문은 요청 목록에 그 모듈이 있으면 거부 */
  moduleOff(off: ModuleId): void {
    vi.mocked(requireModule).mockImplementation(async (_s, m) => (listOf(m).includes(off) ? DENY : { ok: true }))
    vi.mocked(requireSessionModule).mockImplementation(async (_p, m) => (listOf(m).includes(off) ? DENY : { ok: true }))
    vi.mocked(moduleState).mockImplementation(async (_s, m) => (listOf(m).includes(off) ? 'off' : 'on'))
    vi.mocked(projectsWithModule).mockImplementation(async (list, m) => (listOf(m).includes(off) ? [] : [...new Set(list)]))
    vi.mocked(workspacesWithModule).mockImplementation(async (list, m) => (listOf(m).includes(off) ? [] : [...new Set(list)]))
  },
  gateCalls(): number { return gateMocks().reduce((n, f) => n + f.mock.calls.length, 0) },
  guardCalls(): number { return guardMocks().reduce((n, f) => n + f.mock.calls.length, 0) + state.authReads },
  /** 관문 가운데 하나라도 이 모듈을 물었는가 */
  asked(id: ModuleId): boolean {
    return gateMocks().some((f) => f.mock.calls.some((c) => listOf(c[1] as ModuleId | readonly ModuleId[]).includes(id)))
  },
  adminCreated(): number { return admins.mock.calls.length },
}
