// 에이전트 두 원천 AND(스펙 §4.4)와 v1 에이전트 API 관문(§4.2, §7.1 agents-gate). 판정은 @/lib/modules/gate(전역 mock) — 테스트가 거부를 준다.
// v1 per-project 핸들러 8개는 requireAgentProject 한 곳을 지난다(정적 확인). 실행 확인은 각 라우트 테스트의 케이스(wbs-structure·me-route·watch-route).
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/agent/externalApi', async (orig) => {
  const real = await orig<typeof import('@/lib/agent/externalApi')>()
  // requireAgentProject 는 진짜 — 목록 케이스용으로 멤버 판정·PAT 한정만 바꾼다(mineShared 가 이 모듈에서 두 이름을 import 한다)
  return { ...real, isAgentProjectMember: vi.fn(async () => true), patProjectAllowed: vi.fn(() => true) }
})
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { requireAgentProject } from '@/lib/agent/externalApi'
import { accessibleProjectIds } from '@/lib/agent/mineShared'
import { backfillProjectOrders, ensureAgentProject, ensureOrderForWorkflowLeaf } from '@/lib/agent/ensureOrder'

const PID = '00000000-0000-0000-7e57-000000001451', P2 = '00000000-0000-0000-7e57-000000001452'
const OFF = { ok: false as const, error: ERR_MODULE_DISABLED }

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
  it('ensureAgentProject: 모듈이 꺼지면 moduleOff·enabled false, stopped 는 사람이 멈춘 것만. 행이 없으면 자동 생성은 남는다', async () => {
    vi.mocked(requireModule).mockResolvedValue(OFF)
    expect(await ensureAgentProject(fakeAdmin({ reg: { enabled: true } }).admin, { projectId: PID, actorUserId: 'u' }))
      .toEqual({ ok: true, enabled: false, activated: false, stopped: false, moduleOff: true })
    expect(await ensureAgentProject(fakeAdmin({ reg: { enabled: false } }).admin, { projectId: PID, actorUserId: 'u' }))
      .toEqual({ ok: true, enabled: false, activated: false, stopped: true, moduleOff: true })
    const none = fakeAdmin({ reg: null })
    expect(await ensureAgentProject(none.admin, { projectId: PID, actorUserId: 'u' })).toEqual({ ok: true, enabled: false, activated: true, stopped: false, moduleOff: true })
    expect(none.writes).toEqual(['agent_projects.insert'])
  })
})

describe('목록 — 꺼진 프로젝트의 행 생략', () => {
  it('accessibleProjectIds(work/mine 재료)는 agents 가 켜진 프로젝트만', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([PID])
    const { admin } = fakeAdmin({ regs: [{ project_id: PID }, { project_id: P2 }] })
    expect(await accessibleProjectIds(admin, { kind: 'pat', userId: 'u', projectId: null } as never)).toEqual([PID])
    expect(projectsWithModule).toHaveBeenCalledWith([PID, P2], 'agents', { client: admin })
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
  it.each(V1_ROUTES.slice(0, 8))('%s — requireAgentProject 또는 loadGatedOrder* 를 지난다(모듈 꺼짐 → 404)', (m) => {
    expect(readFileSync(file(m), 'utf8')).toMatch(/requireAgentProject\(|loadGatedOrder(ForUser)?\(/)
  })
  it('me 는 목록 거르기, work/mine 은 accessibleProjectIds(위 케이스), watch 는 자기 관문', () => {
    expect(readFileSync(file(V1_ROUTES[8]), 'utf8')).toMatch(/projectsWithModule\(/)
    expect(readFileSync(file(V1_ROUTES[9]), 'utf8')).toMatch(/accessibleProjectIds\(/)
    expect(readFileSync(file(V1_ROUTES[10]), 'utf8')).toMatch(/requireModule\(/)
  })
})
