// tests/data/agent-seatmap-project.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { getProjectOffice, getSeatmap, seatmapFloorIds } from '@/lib/data/agentSeatmap'
import { AGENT_TAG } from '@/lib/domain/seatmap'
import { makeActor, makeMemberActor, WS } from '../fixtures/actor'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const NOW = Date.parse('2026-09-14T09:00:00Z')
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록. tests/data/agent-seatmap.test.ts 의 헬퍼에 maybeSingle 과 auth 를 더한 것. */
function admin(queues: Record<string, Resp[]>, calls: Record<string, unknown[][]> = {}) {
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'not', 'eq', 'or', 'gte', 'gt', 'order', 'limit', 'maybeSingle']) {
        b[k] = (...a: unknown[]) => { (calls[`${table}.${k}`] ??= []).push(a); return b }
      }
      b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'a@x.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(client)
  return client
}
// 플랫폼 관리자 — buildActor 가 전 프로젝트를 싣는다(p1~p3 = WS, px = 다른 워크스페이스). 좌석표는 그중 한 워크스페이스만(D21)
const SUPER = makeActor({ isSuperuser: true, projectWorkspace: new Map([['p1', WS], ['p2', WS], ['p3', WS], ['px', 'ws-2']]) })
const MEMBER_P1 = makeMemberActor('p1')

beforeEach(() => { vi.clearAllMocks() })
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('seatmapFloorIds', () => {
  it('projectId 없으면 그 워크스페이스의 접근 범위(슈퍼유저는 그 워크스페이스 전부), 워크스페이스도 없으면 [](전 워크스페이스로 넓히지 않는다)', () => {
    expect(seatmapFloorIds(SUPER, { workspaceId: WS })).toEqual(['p1', 'p2', 'p3'])
    expect(seatmapFloorIds(MEMBER_P1, { workspaceId: WS })).toEqual(['p1'])
    expect(seatmapFloorIds(MEMBER_P1, { workspaceId: 'ws-2' })).toEqual([])
    expect(seatmapFloorIds(SUPER, {})).toEqual([])
  })
  it('projectId 있으면 그 프로젝트의 워크스페이스 범위와 교집합 — 슈퍼유저 [id], 멤버는 목록에 있을 때만 [id], 모르는 id 는 []', () => {
    expect(seatmapFloorIds(SUPER, { projectId: 'p2' })).toEqual(['p2'])
    expect(seatmapFloorIds(SUPER, { projectId: 'p9' })).toEqual([])
    expect(seatmapFloorIds(MEMBER_P1, { projectId: 'p1' })).toEqual(['p1'])
    expect(seatmapFloorIds(MEMBER_P1, { projectId: 'p2' })).toEqual([])
  })
})

describe('getSeatmap({ projectId })', () => {
  it('범위 밖 프로젝트면 조회 없이 빈 좌석표', async () => {
    const a = admin({})
    const map = await getSeatmap(MEMBER_P1, NOW, 'all', { projectId: 'p2' })
    expect(map.floors).toEqual([])
    expect(a.from).not.toHaveBeenCalled()
  })
  it('슈퍼유저 + projectId 면 주문 조회에 그 프로젝트 필터 하나만 건다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({ agent_work_orders: [{ data: [] }] }, calls)
    await getSeatmap(SUPER, NOW, 'all', { projectId: 'p1' })
    expect(calls['agent_work_orders.in']?.[0]).toEqual(['project_id', ['p1']])
  })
})

describe('getSeatmap — agents 모듈이 꺼진 프로젝트의 층을 뺀다(스펙 §4.2)', () => {
  /** 조회 한 번 분량의 응답 — 프로젝트마다 agent 태그 항목의 주문 하나. 태그 항목이 없으면 assembleSeatmap 이 주문을 떨어뜨려 층이 늘 비어 보인다 */
  const read = (...ps: string[]) => ({
    orders: { data: ps.map((p) => ({ id: `o-${p}`, project_id: p, wbs_item_id: `i-${p}`, status: 'approved', claimed_by_user_id: null, updated_at: '2026-09-14T08:00:00Z', created_at: '2026-09-14T08:00:00Z' })) },
    items: { data: ps.map((p) => ({ id: `i-${p}`, project_id: p, code: '1', name: `item ${p}`, parent_id: null, actual_pct: 0, assignee_member_id: null, tags: [AGENT_TAG], depends: null })) },
    projects: { data: ps.map((p) => ({ id: p, name: `proj ${p}`, workspace_id: 'w' })) },
  })
  /** 조회마다 주문·항목·프로젝트 응답 한 벌씩(그 밖의 표는 빈 응답) */
  const reads = (...rs: ReturnType<typeof read>[]) => ({
    agent_work_orders: rs.map((r) => r.orders), wbs_items: rs.map((r) => r.items), projects: rs.map((r) => r.projects),
  })
  const orderReads = (a: ReturnType<typeof admin>) => a.from.mock.calls.filter((c) => c[0] === 'agent_work_orders').length
  const floorIds = (map: { floors: Array<{ id: string }> }) => map.floors.map((f) => f.id).sort()
  /** 관문 판정에 넘긴 client 가 좌석표의 service_role 클라이언트 그 객체인지 — '뭔가 있다'가 아니라 같은 객체(F7) */
  const expectAdminClient = (a: ReturnType<typeof admin>) => {
    expect(vi.mocked(projectsWithModule).mock.calls.length).toBeGreaterThan(0)
    for (const c of vi.mocked(projectsWithModule).mock.calls) expect(c[2]?.client).toBe(a)
  }

  it('층 목록이 있는 행위자는 조회 전에 좁힌다 — 모두 꺼지면 주문을 읽지 않는다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin({}, calls)
    vi.mocked(projectsWithModule).mockResolvedValueOnce([])
    const map = await getSeatmap(MEMBER_P1, NOW, 'all', { workspaceId: WS })
    expect(map.floors).toEqual([])
    expect(projectsWithModule).toHaveBeenCalledWith(['p1'], 'agents', { client: expect.anything() })
    expectAdminClient(a)
    expect(calls['agent_work_orders.in']).toBeUndefined()
    expect(orderReads(a)).toBe(0)
  })
  it('플랫폼 관리자 — 그 워크스페이스 프로젝트로 조회 전에 좁힌다(다른 워크스페이스 층·전체 조회 없음, D21)', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin(reads(read('p1', 'p2', 'p3')), calls)
    const map = await getSeatmap(SUPER, NOW, 'all', { workspaceId: WS })
    expect(projectsWithModule).toHaveBeenCalledWith(['p1', 'p2', 'p3'], 'agents', { client: expect.anything() })
    expectAdminClient(a)
    expect(orderReads(a)).toBe(1)
    expect(calls['agent_work_orders.in']).toEqual([['project_id', ['p1', 'p2', 'p3']]])
    expect(calls['agent_work_orders.not']).toBeUndefined()
    expect(floorIds(map)).toEqual(['p1', 'p2', 'p3'])
  })
  it('플랫폼 관리자 — 꺼진 프로젝트는 조회 전에 뺀다(한 번 읽는다)', async () => {
    const calls: Record<string, unknown[][]> = {}
    const a = admin(reads(read('p1')), calls)
    vi.mocked(projectsWithModule).mockResolvedValueOnce(['p1'])
    const map = await getSeatmap(SUPER, NOW, 'all', { workspaceId: WS })
    expectAdminClient(a)
    expect(orderReads(a)).toBe(1)
    expect(calls['agent_work_orders.in']).toEqual([['project_id', ['p1']]])
    expect(floorIds(map)).toEqual(['p1'])
  })
  it('워크스페이스도 프로젝트도 없으면 조회 없이 빈 좌석표 — 플랫폼 관리자도 전 워크스페이스로 넓히지 않는다(fail-closed)', async () => {
    const a = admin({})
    const map = await getSeatmap(SUPER, NOW, 'all')
    expect(map.floors).toEqual([])
    expect(orderReads(a)).toBe(0)
  })
})

describe('getProjectOffice', () => {
  it('프로젝트 이름과 이 프로젝트 층 좌석표를 함께 돌려준다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({ projects: [{ data: { id: 'p1', name: 'proj-a' } }], agent_work_orders: [{ data: [] }] }, calls)
    const office = await getProjectOffice(MEMBER_P1, 'p1', NOW, 'all')
    expect(office.projectName).toBe('proj-a')
    expect(office.seatmap.floors).toEqual([])
    expect(calls['projects.eq']?.[0]).toEqual(['id', 'p1'])
    expect(calls['projects.maybeSingle']).toHaveLength(1)
  })
  it('프로젝트가 없으면 projectName null(페이지가 notFound 로 보낸다)', async () => {
    admin({ projects: [{ data: null }], agent_work_orders: [{ data: [] }] })
    const office = await getProjectOffice(SUPER, 'p9', NOW, 'all')
    expect(office.projectName).toBeNull()
  })
  it('프로젝트 조회가 error 면 throw', async () => {
    admin({ projects: [{ data: null, error: { message: 'boom' } }], agent_work_orders: [{ data: [] }] })
    await expect(getProjectOffice(SUPER, 'p1', NOW, 'all')).rejects.toThrow(/boom/)
  })
})
