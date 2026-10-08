// 에이전트 두 원천 AND(스펙 §4.4)와 v1 에이전트 API 관문(§4.2, §7.1 agents-gate). 판정은 @/lib/modules/gate(전역 mock) — 테스트가 거부를 준다.
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
import { backfillProjectOrders, ensureAgentProject, ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'
import { loadGatedOrderForUser } from '@/lib/agent/routeShared'
import type { ProjectRole } from '@/lib/domain/authz'
import { makeActor } from '../fixtures/actor'
import { agentCredential, agentPrincipal, CRED_OWNER, CRED_WS } from '../fixtures/credentials'

const PID = '00000000-0000-0000-7e57-000000001451', P2 = '00000000-0000-0000-7e57-000000001452'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }
/** 자격증명(integration_credentials 의 agent_runner 행)으로 들어온 principal — 에이전트 API 의 유일한 신원(SP7 §5.1.4) */
const PRINCIPAL = agentPrincipal(agentCredential({ scopes: ['work:read'] }))

/** agent_projects 행·wbs_items 목록·등록 목록을 주는 가짜 admin — 쓰기는 기록만 */
function fakeAdmin(opts: { reg?: { enabled: boolean } | null; regError?: string; items?: { id: string }[]; regs?: { project_id: string }[] } = {}) {
  const writes: string[] = []
  const admin = {
    from: vi.fn((table: string) => {
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'neq', 'in', 'order', 'limit']) b[k] = () => b
      b.maybeSingle = async () => (opts.regError ? { data: null, error: { message: opts.regError } } : { data: table === 'agent_projects' ? (opts.reg ?? null) : null, error: null })
      b.insert = async () => { writes.push(`${table}.insert`); return { error: null } }
      b.update = () => ({ eq: async () => { writes.push(`${table}.update`); return { error: null } } })
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === 'wbs_items' ? (opts.items ?? []) : (opts.regs ?? []), error: null }).then(res)
      return b
    }),
  }
  return { admin: admin as never, writes, from: admin.from }
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireModule).mockReset(); vi.mocked(moduleState).mockReset(); vi.mocked(projectsWithModule).mockReset() })
// 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 관문 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('requireAgentProject — 두 원천 AND(네 조합)', () => {
  it.each([
    [true, true, true], [true, false, false], [false, true, false], [false, false, false],
  ])('행 enabled=%s · 모듈=%s → %s', async (row, mod, expected) => {
    if (!mod) vi.mocked(requireModule).mockResolvedValue(OFF)
    const { admin } = fakeAdmin({ reg: { enabled: row } })
    expect(await requireAgentProject(admin, PID)).toBe(expected)
    if (row) expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: admin })
    else expect(requireModule).not.toHaveBeenCalled()                     // 행이 꺼지면 설정을 읽지 않는다
  })
  // 위 네 조합은 principal 없이 부르는 갈래(등록 행 ∧ 모듈)다. SP7 뒤 라우트는 모두 principal 을 넘기므로 src 에 이 갈래의 호출부가 없다 —
  // agent_projects 판독 정리(다음 조각)에서 함께 사라질 자리다. 라우트가 실제로 지나는 갈래는 아래 케이스다.
  it('principal 이 있으면(라우트의 유일한 경로) 등록 행을 읽지 않고 agents 모듈만 본다', async () => {
    const on = fakeAdmin({ reg: null })   // 등록 행이 없어도
    expect(await requireAgentProject(on.admin, PID, PRINCIPAL)).toBe(true)
    expect(on.from).not.toHaveBeenCalled()
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: on.admin })
    vi.mocked(requireModule).mockResolvedValue(OFF)
    const off = fakeAdmin({ reg: { enabled: true } })   // 등록 행이 켜져 있어도 모듈이 꺼지면 닫힌다
    expect(await requireAgentProject(off.admin, PID, PRINCIPAL)).toBe(false)
    expect(off.from).not.toHaveBeenCalled()
  })
  it('행이 없으면 false, 행 조회 오류는 throw(→ 500) — 모듈 판정 실패(→ false·404)와 응답이 다르다', async () => {
    expect(await requireAgentProject(fakeAdmin({ reg: null }).admin, PID)).toBe(false)
    await expect(requireAgentProject(fakeAdmin({ regError: 'down' }).admin, PID)).rejects.toThrow('agent_projects 조회 실패')
  })
})

describe('ensureOrder — 발행 게이트', () => {
  it('ensureOrderForWorkflowLeaf: 행 enabled 여도 모듈이 꺼지면 not_agent_project, agentsOn:true 면 판정을 건너뛴다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    const { admin } = fakeAdmin({ reg: { enabled: true } })
    expect(await ensureOrderForWorkflowLeaf(admin, { projectId: PID, wbsItemId: PID, actorUserId: 'u' })).toEqual({ ok: true, created: false, reason: 'not_agent_project' })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: admin })
    vi.mocked(requireModule).mockClear()
    await ensureOrderForWorkflowLeaf(admin, { projectId: PID, wbsItemId: PID, actorUserId: 'u', agentsOn: true })
    expect(requireModule).not.toHaveBeenCalled()
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
  it('ensureAgentProject: 모듈이 꺼지면 moduleOff·enabled false, stopped 는 사람이 멈춘 것만. 행이 없으면 자동 생성은 남는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    const f1 = fakeAdmin({ reg: { enabled: true } })
    expect(await ensureAgentProject(f1.admin, { projectId: PID, actorUserId: 'u' }))
      .toEqual({ ok: true, enabled: false, activated: false, stopped: false, moduleOff: true })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: f1.admin })

    vi.mocked(requireModule).mockClear()
    const f2 = fakeAdmin({ reg: { enabled: false } })
    expect(await ensureAgentProject(f2.admin, { projectId: PID, actorUserId: 'u' }))
      .toEqual({ ok: true, enabled: false, activated: false, stopped: true, moduleOff: true })
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: f2.admin })

    vi.mocked(requireModule).mockClear()
    const none = fakeAdmin({ reg: null })
    expect(await ensureAgentProject(none.admin, { projectId: PID, actorUserId: 'u' })).toEqual({ ok: true, enabled: false, activated: true, stopped: false, moduleOff: true })
    expect(none.writes).toEqual(['agent_projects.insert'])
    expect(requireModule).toHaveBeenCalledWith({ projectId: PID }, 'agents', { client: none.admin })
  })
})

describe('목록 — 꺼진 프로젝트의 행 생략', () => {
  it('accessibleProjectIds(work/mine 재료)는 agents 가 켜진 프로젝트만', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([PID])
    // 후보는 소유자의 좁힌 스냅샷(멤버 프로젝트)이다 — 등록 행(agent_projects)이 아니다
    vi.mocked(agentActorFromPrincipal).mockResolvedValue(makeActor({
      userId: CRED_OWNER, workspaceRoles: new Map([[CRED_WS, 'member']]),
      projectWorkspace: new Map([[PID, CRED_WS], [P2, CRED_WS]]), projectRoles: new Map<string, ProjectRole>([[PID, 'member'], [P2, 'member']]),
    }))
    const { admin, from } = fakeAdmin({ regs: [{ project_id: PID }, { project_id: P2 }] })
    expect(await accessibleProjectIds(admin, PRINCIPAL)).toEqual([PID])
    expect(projectsWithModule).toHaveBeenCalledWith([PID, P2], 'agents', { client: admin })
    expect(agentActorFromPrincipal).toHaveBeenCalledWith(admin, CRED_OWNER, PRINCIPAL)
    expect(from).not.toHaveBeenCalledWith('agent_projects')
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
