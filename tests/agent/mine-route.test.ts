import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as mineGET } from '@/app/api/v1/agent/work/mine/route'
import { accessibleProjectIds } from '@/lib/agent/mineShared'
import { axes, credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, agentPrincipal, ownerLookup } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자가 요청의 신원이고, 후보 프로젝트는
// 자격증명 범위로 좁힌 스냅샷(한 번 조립)의 멤버 프로젝트다. 옛 원천(agent_projects 등록 행·프로젝트별 판정)은 읽지 않는다.
const RUNNER = agentCredential({ scopes: ['work:read'] })
const PAT = { token: RUNNER.token }
const LEGACY_SECRET = 'legacy-secret'

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
})

describe('GET /agent/work/mine', () => {
  it('scope 기본(available) — 멤버 프로젝트의 ready 주문만, priority desc 정렬', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      ...credAxes([P1, P2]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('available')
    expect(body.available).toHaveLength(1)
    expect(body.claimed).toBeUndefined()
  })

  it('scope=claimed — 본인 점유(claimed_by_user_id) 주문만', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      ...credAxes([P1, P2]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_orders: [{ data: [
        { id: 'o-2', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: '2026-08-01T00:00:00Z', wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=claimed', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('claimed')
    expect(body.claimed).toHaveLength(1)
    expect(body.available).toBeUndefined()
  })

  it('scope=all — claimed → assigned → available 순으로 구획을 채운다', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      ...credAxes([P1, P2]),
      agent_work_orders: [
        { data: [{ id: 'o-2', project_id: P1, status: 'claimed', priority: 0, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' }] },
        { data: [{ id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' }] },
      ],
      project_members: [roster(rosterRow(P1, 'member')), { data: [] }], // myMemberIdsAcrossProjects — 배정 없음
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=all', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['ok', 'scope', 'claimed', 'assigned', 'available'])
    expect(body.claimed).toHaveLength(1)
    expect(body.assigned).toHaveLength(0)
    expect(body.available).toHaveLength(1)
  })

  it('지원하지 않는 scope → 400 unsupported_scope', async () => {
    useAdmin({ integration_credentials: RUNNER.queue() })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=bogus', PAT.token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unsupported_scope')
  })

  // 옛 케이스 'legacy 호출 400 identity_required' 의 후신 — 시크릿 principal 이 삭제돼 PAT 전용 안내(400) 대신 인증 실패다.
  it('옛 시크릿 값 Bearer 는 401 — env 에 AGENT_API_SECRET 이 설정돼 있어도, 어느 표도 읽지 않는다', async () => {
    const admin = useAdmin({ integration_credentials: RUNNER.queue(), ...credAxes([P1]), project_members: [roster(rosterRow(P1, 'member'))] })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', LEGACY_SECRET))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(admin.from).not.toHaveBeenCalled()
  })

  it('limit 상한 100 초과 → 400', async () => {
    useAdmin({ integration_credentials: RUNNER.queue() })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?limit=999', PAT.token))
    expect(res.status).toBe(400)
  })

  // accessibleProjectIds 교차(intersection) 회귀 테스트
  it('워크스페이스 프로젝트 P1·P2, PAT 소유자 P1만 멤버 → P1 주문만, P2 배제', async () => {
    const admin = useAdmin({
      integration_credentials: RUNNER.queue(),
      ...credAxes([P1, P2]), // 스냅샷 1회 — 명단 행은 P1 뿐(P2 는 조회 전용이라 배제)
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toHaveLength(1)
    expect(body.available[0].id).toBe('o-1')
    expect(body.available[0].project_id).toBe(P1)
    expect(admin.from).not.toHaveBeenCalledWith('agent_projects')
    expect(admin.from).not.toHaveBeenCalledWith('agent_runners')
  })

  it('PAT project_id 한정 P1 → P2 멤버여도 patProjectAllowed 에서 배제', async () => {
    const RUNNER_P1 = RUNNER.with({ project_ids: [P1] }) // P1로만 제한됨
    useAdmin({
      integration_credentials: RUNNER_P1.queue(),
      ...credAxes([P1, P2]),
      project_members: [roster(rosterRow(P1, 'member'), rosterRow(P2, 'member'))], // 둘 다 멤버 — 배제는 자격증명 범위가 한다
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.available).toHaveLength(1)
    expect(body.available[0].id).toBe('o-1')
  })

  // 옛 원천은 프로젝트마다 따로 판정해 실패한 프로젝트만 뺐다. 자격증명 경로는 스냅샷을 한 번 조립하므로 그 조회가 실패하면
  // 부분 목록을 주지 않고 500 이다 — 조회 실패를 '프로젝트 없음'으로 위장하지 않는다(에러 3원칙). 주문은 읽지 않는다(fail-closed).
  it('fail-closed: 권한 스냅샷 조회 실패 시 500 — 주문을 읽지 않고 빈 목록으로 위장하지도 않는다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const admin = useAdmin({
      integration_credentials: RUNNER.queue(),
      ...credAxes([P1, P2]),
      platform_admins: [{ error: { message: 'DB error' } }],
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_orders: [{ data: [
        { id: 'o-1', project_id: P1, status: 'ready', priority: 5, instructions: '', claimed_at: null, wbs_item_id: null, created_at: '2026-08-01T00:00:00Z' },
      ] }],
      wbs_items: [{ data: [] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine', PAT.token))
    expect(res.status).toBe(500)
    expect(await res.json()).not.toHaveProperty('available')
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_orders')
    spy.mockRestore()
  })
})

describe('accessibleProjectIds — 직접 단위 테스트', () => {
  const patPrincipal = agentPrincipal(RUNNER)

  it('(a) 워크스페이스 프로젝트 P1·P2, PAT 소유자 P1만 멤버 → ["P1"] (P2 부재 직접 단언)', async () => {
    useAdmin({
      ...credAxes([P1, P2]),
      project_members: [roster(rosterRow(P1, 'member'))], // P2 는 명단에 없다(조회 전용)
    })
    const admin = mocks.createAdminClient()
    const result = await accessibleProjectIds(admin, patPrincipal)
    expect(result).toEqual([P1])
    expect(result).not.toContain(P2)
    expect(admin.from).not.toHaveBeenCalledWith('agent_projects')
  })

  it('(b) PAT project_ids 한정 P1 → ["P1"] (P2 멤버여도 patProjectAllowed 배제)', async () => {
    const patP1Scoped = agentPrincipal(RUNNER.with({ project_ids: [P1] }))
    useAdmin({
      ...credAxes([P1, P2]),
      project_members: [roster(rosterRow(P1, 'member'), rosterRow(P2, 'member'))],
    })
    const admin = mocks.createAdminClient()
    const result = await accessibleProjectIds(admin, patP1Scoped)
    expect(result).toEqual([P1])
    expect(result).not.toContain(P2)
  })

  // 옛 (c) 'P2 멤버십 조회 실패 → ["P1"](그 프로젝트만 배제)' 의 후신 — 스냅샷은 한 번 조립하므로 실패는 전체 실패다(부분 목록 없음).
  it('(c) 권한 스냅샷 조회 실패 → throw (fail-closed — 부분 목록으로 위장하지 않는다)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    useAdmin({
      ...credAxes([P1, P2]),
      platform_admins: [{ error: { message: 'DB error' } }],
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const admin = mocks.createAdminClient()
    await expect(accessibleProjectIds(admin, patPrincipal)).rejects.toThrow()
    spy.mockRestore()
  })

  it('(d) 다른 워크스페이스 소속의 프로젝트는 멤버여도 빠진다 — 자격증명 워크스페이스로 좁힌다', async () => {
    useAdmin({
      ...axes([P1, P2]), // 소속·프로젝트가 자격증명 워크스페이스가 아닌 기본 WS('ws-1')
      project_members: [roster(rosterRow(P1, 'member'), rosterRow(P2, 'member'))],
    })
    const admin = mocks.createAdminClient()
    expect(await accessibleProjectIds(admin, patPrincipal)).toEqual([])
  })
})
