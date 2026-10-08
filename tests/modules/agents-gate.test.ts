// 에이전트 사용 여부의 원천은 agents 모듈 하나다(스펙 §4.4 의 두 원천 AND 는 SP7·0041 에서 끝났다 — 등록 표 agent_projects 삭제)와 v1 에이전트 API 관문(§4.2, §7.1 agents-gate). 판정은 @/lib/modules/gate(전역 mock) — 테스트가 거부를 준다.
// v1 per-project 핸들러 8개는 requireAgentProject 한 곳을 지난다(정적 확인). 실행 확인은 각 라우트 테스트의 케이스(wbs-structure·me-route·watch-route).
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/agent/externalApi', async (orig) => {
  const real = await orig<typeof import('@/lib/agent/externalApi')>()
  // requireAgentProject 는 진짜 — 목록 케이스용으로 멤버 판정·PAT 한정·소유자 스냅샷만 바꾼다(mineShared 가 이 모듈에서 세 이름을 import 한다)
  return { ...real, isAgentProjectMember: vi.fn(async () => true), patProjectAllowed: vi.fn(() => true), agentActorFromPrincipal: vi.fn() }
})
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { agentActorFromPrincipal, requireAgentProject, isAgentProjectMember } from '@/lib/agent/externalApi'
import { accessibleProjectIds } from '@/lib/agent/mineShared'
import { backfillProjectOrders, ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { loadGatedOrderForUser } from '@/lib/agent/routeShared'
import type { ProjectRole } from '@/lib/domain/authz'
import { makeActor } from '../fixtures/actor'
import { agentCredential, agentPrincipal, CRED_OWNER, CRED_WS } from '../fixtures/credentials'

const PID = '00000000-0000-0000-7e57-000000001451', P2 = '00000000-0000-0000-7e57-000000001452'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }
/** 자격증명(integration_credentials 의 agent_runner 행)으로 들어온 principal — 에이전트 API 의 유일한 신원(SP7 §5.1.4) */
const PRINCIPAL = agentPrincipal(agentCredential({ scopes: ['work:read'] }))

/** wbs_items 목록을 주는 가짜 admin — 읽은 표는 from 으로, 쓰기는 기록만. 옛 등록 표(agent_projects)를 읽으면 켜진 행을 돌려준다 —
 *  코드가 그 표로 되돌아가면 "모듈이 꺼져도 열린다"로 드러나게(아래 케이스들이 from 호출도 직접 본다). */
function fakeAdmin(opts: { items?: { id: string }[] } = {}) {
  const writes: string[] = []
  const admin = {
    from: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'neq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => ({ data: table === 'agent_projects' ? { enabled: true } : null, error: null })
      b.insert = async () => { writes.push(`${table}.insert`); return { error: null } }
      b.update = () => ({ eq: async () => { writes.push(`${table}.update`); return { error: null } } })
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === 'wbs_items' ? (opts.items ?? []) : [], error: null }).then(res)
      return b
    }),
  }
  return { admin: admin as never, writes, from: admin.from }
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireModule).mockReset(); vi.mocked(moduleState).mockReset(); vi.mocked(projectsWithModule).mockReset() })
// 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 관문 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('requireAgentProject — agents 모듈 하나', () => {
  // 옮김(SP7): '두 원천 AND(네 조합)' — 행 enabled × 모듈의 네 조합 가운데 행 축이 사라졌다. "행이 꺼져 있으면/없으면 닫힘"은 "모듈이 꺼져 있으면 닫힘"으로,
  // "행이 켜져 있어도 모듈이 꺼지면 닫힘"은 그대로 남는다(가짜 admin 의 등록 표는 늘 켜진 행을 돌려준다 — 읽으면 안 된다).
  it.each([[true, true], [false, false]])('모듈=%s → %s. 등록 표는 읽지 않는다', async (mod, expected) => {
    if (!mod) vi.mocked(requireModule).mockResolvedValue(OFF)
    const { admin, from, writes } = fakeAdmin()
    expect(await requireAgentProject(admin, PID)).toBe(expected)
    expect(requireModule).toHaveBeenCalledTimes(1)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: admin })   // 세션이 없으니 admin 으로
    expect(from).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })
  // 삭제(SP7): '행이 없으면 false, 행 조회 오류는 throw(→ 500)' — 등록 행 조회가 없다. 판정 실패는 requireModule 이 로그 뒤 닫힘으로 돌려주므로
  // (tests/modules/gate.test.ts) 라우트 응답은 404 한 갈래다. 아래는 그 닫힘이 그대로 false 가 되는지(던지지 않는지)를 본다.
  it('모듈 판정 실패(닫힘)는 false — 던지지 않는다(→ 404)', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    await expect(requireAgentProject(fakeAdmin().admin, PID)).resolves.toBe(false)
  })
})

describe('ensureOrder — 발행 게이트', () => {
  it('ensureOrderForWorkflowLeaf: 모듈이 꺼지면 not_agent_project(등록 표를 읽지 않는다), agentsOn:true 면 판정을 건너뛴다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    const { admin, from } = fakeAdmin()
    expect(await ensureOrderForWorkflowLeaf(admin, { projectId: PID, wbsItemId: PID, actorUserId: 'u' })).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: admin })
    expect(from).not.toHaveBeenCalled()
    vi.mocked(requireModule).mockClear()
    await ensureOrderForWorkflowLeaf(admin, { projectId: PID, wbsItemId: PID, actorUserId: 'u', agentsOn: true })
    expect(requireModule).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalledWith('agent_projects')
  })
  it("backfillProjectOrders: 시작에서 한 번 moduleState — 'off' 면 발행 0, 'unknown' 이면 오류(조용히 0건이 되지 않게)", async () => {
    const a = fakeAdmin({ items: [{ id: 'i1' }, { id: 'i2' }] })
    vi.mocked(moduleState).mockResolvedValueOnce('off')
    expect(await backfillProjectOrders(a.admin, { projectId: PID, actorUserId: 'u' })).toEqual({ ok: true, created: 0, failed: [] })
    expect(moduleState).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: a.admin })
    vi.mocked(moduleState).mockResolvedValueOnce('unknown')
    expect(await backfillProjectOrders(a.admin, { projectId: PID, actorUserId: 'u' })).toMatchObject({ ok: false })
    expect(a.from).not.toHaveBeenCalled()                                // 판정이 항목 조회보다 앞 — 꺼짐·판정 불가에서 후보를 읽지 않는다
  })
  it("backfillProjectOrders: 'on' 이면 후보를 조회하고 requireModule 은 재호출하지 않는다 (agentsOn 전달)", async () => {
    const a = fakeAdmin({ items: [{ id: 'i1' }, { id: 'i2' }] })
    vi.mocked(moduleState).mockResolvedValueOnce('on')
    expect(await backfillProjectOrders(a.admin, { projectId: PID, actorUserId: 'u' })).toMatchObject({ ok: true, created: 0 })
    expect(a.from).toHaveBeenCalledWith('wbs_items')
    expect(requireModule).not.toHaveBeenCalled()
  })
  // 삭제(SP7): 'ensureAgentProject: 모듈이 꺼지면 moduleOff·enabled false, stopped 는 사람이 멈춘 것만. 행이 없으면 자동 생성은 남는다' —
  // 함수(자동 등록·stopped/activated 보고)가 없어졌다. "모듈이 꺼지면 발행하지 않고 안내한다"는 호출부 테스트가 본다:
  // tests/actions/wbs-spec-delegation-right.test.ts(위임)·tests/actions/wbs-markdown-upload.test.ts(업로드 agentStopped).
  it("backfillProjectOrders: 'on' 이어도 등록 표를 읽거나 만들지 않는다(자동 등록 없음)", async () => {
    const a = fakeAdmin({ items: [] })
    vi.mocked(moduleState).mockResolvedValueOnce('on')
    expect(await backfillProjectOrders(a.admin, { projectId: PID, actorUserId: 'u' })).toEqual({ ok: true, created: 0, failed: [] })
    expect(a.from).not.toHaveBeenCalledWith('agent_projects')
    expect(a.writes).toEqual([])
  })
})

describe('목록 — 꺼진 프로젝트의 행 생략', () => {
  it('accessibleProjectIds(work/mine 재료)는 agents 가 켜진 프로젝트만', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([PID])
    // 후보는 소유자의 좁힌 스냅샷(멤버 프로젝트)이다 — 등록 표는 없다. 모듈은 자격증명 워크스페이스로 한 번에 판정한다(프로젝트마다 설정을 읽지 않는다)
    vi.mocked(agentActorFromPrincipal).mockResolvedValue(makeActor({
      userId: CRED_OWNER, workspaceRoles: new Map([[CRED_WS, 'member']]),
      projectWorkspace: new Map([[PID, CRED_WS], [P2, CRED_WS]]), projectRoles: new Map<string, ProjectRole>([[PID, 'member'], [P2, 'member']]),
    }))
    const { admin, from } = fakeAdmin()
    expect(await accessibleProjectIds(admin, PRINCIPAL)).toEqual([PID])
    expect(projectsWithModule).toHaveBeenCalledTimes(1)
    expect(projectsWithModule).toHaveBeenCalledWith([PID, P2], 'agents', { client: admin, workspaceId: CRED_WS })
    expect(agentActorFromPrincipal).toHaveBeenCalledWith(admin, CRED_OWNER, PRINCIPAL)
    expect(from).not.toHaveBeenCalled()
  })
})

/** 위임 확인(deny.routes.test.ts)이 이 파일에서 각 라우트의 import 경로 문자열을 찾는다 — 11개 */
const V1_ROUTES = [
  '@/app/api/v1/agent/work/route', '@/app/api/v1/agent/work/[id]/route', '@/app/api/v1/agent/work/[id]/claim/route',
  '@/app/api/v1/agent/work/[id]/heartbeat/route', '@/app/api/v1/agent/work/[id]/release/route', '@/app/api/v1/agent/work/[id]/report/route',
  '@/app/api/v1/wbs/import/route', '@/app/api/v1/wbs/structure/route', '@/app/api/v1/agent/me/route', '@/app/api/v1/agent/work/mine/route',
  '@/app/api/v1/agent/watch/route',
] as const

// 판정 호출의 자리(정적). 여덟 per-project 핸들러와 work/mine 은 HEAD 에서 이미 참이다 — 과제 18 의 변경은 requireAgentProject 안이라
// 여기서는 자리가 옮겨지지 않게 고정만 한다(회귀 방지). me·watch 줄은 과제 18 이 더하는 호출이라 구현 전에 FAIL 이다.
// 실행 확인은 세 라우트 테스트(wbs-structure 404·me-route 행 생략·watch-route 404)의 새 케이스가, 핸들러별 판정 호출은 deny.routes 의
// AST(MODULE_ROUTE_GATES)가 맡는다. V1_ROUTES 의 경로 문자열 11개는 deny.routes 의 delegatedStatic 확인이 이 파일에서 찾는다
describe('v1 에이전트 핸들러 11 — 관문의 자리', () => {
  const file = (m: string) => `src/${m.slice(2)}.ts`
  it.each(V1_ROUTES.slice(0, 8))('%s — requireAgentProject 또는 loadGatedOrderForUser 를 지난다(모듈 꺼짐 → 404)', (m) => {
    expect(readFileSync(file(m), 'utf8')).toMatch(/requireAgentProject\(|loadGatedOrderForUser\(/)
  })
  it('me 는 목록 거르기, work/mine 은 accessibleProjectIds(위 케이스), watch 는 자기 관문', () => {
    expect(readFileSync(file(V1_ROUTES[8]), 'utf8')).toMatch(/projectsWithModule\(/)
    expect(readFileSync(file(V1_ROUTES[9]), 'utf8')).toMatch(/accessibleProjectIds\(/)
    expect(readFileSync(file(V1_ROUTES[10]), 'utf8')).toMatch(/requireModule\(/)
  })
})

describe('loadGatedOrderForUser', () => {
  // 옛 케이스의 전반(레거시 loadGatedOrder — 시크릿 + user_email 경로)은 함수와 함께 삭제됐다(SP7 §5.1.4). 쓰기 라우트의 주문 로드는 이 함수 하나다.
  it('requireModule 이 거부하면 404 — 등록 행(agent_projects)이 켜져 있어도, 그 표는 읽지도 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    vi.mocked(isAgentProjectMember).mockResolvedValue(true)

    const from = vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'neq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => {
        if (table === 'agent_projects') return { data: { enabled: true }, error: null }
        if (table === 'agent_work_orders') return { data: { id: 'o1', project_id: PID }, error: null }
        return { data: null, error: null }
      }
      return b
    })
    const admin = { from } as unknown as Parameters<typeof loadGatedOrderForUser>[0]

    const res = await loadGatedOrderForUser(admin, 'o1', CRED_OWNER, 'test@test.com', PRINCIPAL)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.res.status).toBe(404)
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: admin })
    expect(isAgentProjectMember).toHaveBeenCalledWith(admin, CRED_OWNER, PID, PRINCIPAL)
    expect(from).not.toHaveBeenCalledWith('agent_projects')
  })
})
