// tests/data/agent-seatmap-project.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
import { getProjectOffice, getSeatmap, seatmapFloorIds } from '@/lib/data/agentSeatmap'
import { makeActor, makeMemberActor } from '../fixtures/actor'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const NOW = Date.parse('2026-09-14T09:00:00Z')
type Resp = { data?: unknown; error?: { message: string } | null }

/** 테이블별 응답 큐 + 호출 기록. tests/data/agent-seatmap.test.ts 의 헬퍼에 maybeSingle 과 auth 를 더한 것. */
function admin(queues: Record<string, Resp[]>, calls: Record<string, unknown[][]> = {}) {
  const client = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: [], error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'in', 'eq', 'or', 'gte', 'gt', 'order', 'limit', 'maybeSingle']) {
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
const SUPER = makeActor({ isSuperuser: true })
const MEMBER_P1 = makeMemberActor('p1')

beforeEach(() => { vi.clearAllMocks() })
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('seatmapFloorIds', () => {
  it('projectId 없으면 seatmapProjectIds 그대로(슈퍼유저 null, 멤버는 역할 목록)', () => {
    expect(seatmapFloorIds(SUPER)).toBeNull()
    expect(seatmapFloorIds(MEMBER_P1)).toEqual(['p1'])
  })
  it('projectId 있으면 접근 범위와 교집합 — 슈퍼유저 [id], 멤버는 목록에 있을 때만 [id], 없으면 []', () => {
    expect(seatmapFloorIds(SUPER, 'p2')).toEqual(['p2'])
    expect(seatmapFloorIds(MEMBER_P1, 'p1')).toEqual(['p1'])
    expect(seatmapFloorIds(MEMBER_P1, 'p2')).toEqual([])
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
  it('층 목록이 있는 행위자는 조회 전에 좁힌다 — 모두 꺼지면 주문을 읽지 않는다', async () => {
    const calls: Record<string, unknown[][]> = {}
    admin({}, calls)
    vi.mocked(projectsWithModule).mockResolvedValueOnce([])
    const map = await getSeatmap(MEMBER_P1, NOW, 'all')
    expect(map.floors).toEqual([])
    expect(projectsWithModule).toHaveBeenCalledWith(['p1'], 'agents', { client: expect.anything() })
    expect(calls['agent_work_orders.in']).toBeUndefined()
  })
  it('플랫폼 관리자(전체)는 꺼진 프로젝트가 섞였을 때만 켜진 목록으로 다시 읽는다', async () => {
    const calls: Record<string, unknown[][]> = {}
    const order = (id: string, p: string) => ({ id, project_id: p, wbs_item_id: null, status: 'approved', updated_at: '2026-09-14T08:00:00Z', created_at: '2026-09-14T08:00:00Z' })
    admin({
      agent_work_orders: [{ data: [order('o1', 'p1'), order('o2', 'p2')] }, { data: [order('o1', 'p1')] }],
      projects: [{ data: [{ id: 'p1', name: 'a', workspace_id: 'w' }, { id: 'p2', name: 'b', workspace_id: 'w' }] }, { data: [{ id: 'p1', name: 'a', workspace_id: 'w' }] }],
    }, calls)
    vi.mocked(projectsWithModule).mockResolvedValueOnce(['p1'])
    await getSeatmap(SUPER, NOW, 'all')
    expect(projectsWithModule).toHaveBeenCalledWith(['p1', 'p2'], 'agents', { client: expect.anything() })
    expect(calls['agent_work_orders.in']).toEqual([['project_id', ['p1']]])
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
