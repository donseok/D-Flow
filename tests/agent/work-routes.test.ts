import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'
import { axes, credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_WS, ownerLookup } from '../fixtures/credentials'
import { requireModule } from '@/lib/modules/gate'

// 읽기 라우트의 신원은 자격증명(integration_credentials 의 agent_runner 행) 소유자다(SP7 §5.1.4 — 배포 전역 시크릿 AGENT_API_SECRET 과
// 그 `?user_email=` 신원은 삭제됐다). 멤버십 판정은 자격증명 범위로 좁힌 스냅샷(actorFromCredential + isProjectMember)이고 비멤버는 404(존재 은닉)다.
const LEGACY_SECRET = 'test-agent-secret'
const CRED = agentCredential()
// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const O_MISSING = '99999999-9999-4999-8999-999999999999'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

/** 큐에 integration_credentials 가 없으면 유효한 자격증명(CRED)으로 인증된다 — 조회 → last_used_at 갱신 두 응답. */
function useAdmin(queues: Record<string, Resp[]>, owner: ReturnType<typeof ownerLookup> | (() => Promise<unknown>) = ownerLookup()) {
  queues = { integration_credentials: CRED.queue(), ...queues }
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'order', 'limit', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    auth: { admin: { getUserById: vi.fn(owner) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
/** 루프·보조 함수 안에서 부르는 별칭 — 이름이 use 로 시작하면 훅 규칙(react-hooks/rules-of-hooks)이 오탐한다. */
const seedAdmin = useAdmin
const get = (url: string, bearer: string = CRED.token) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })
/** 토큰 소유자가 P1 의 명단 member — buildActor 4축 응답(소속은 자격증명 워크스페이스) */
const member = () => ({ ...credAxes([P1]), project_members: [roster(rosterRow(P1, 'member'))] })
/** 토큰 소유자가 다른 워크스페이스 소속 — 자격증명 워크스페이스의 P1 을 모른다 */
const outsider = () => ({ ...axes([]), project_members: [roster()] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  delete process.env.AGENT_API_SECRET
  vi.clearAllMocks()
})
afterEach(() => { delete process.env.AGENT_API_SECRET; vi.mocked(requireModule).mockReset() })

describe('GET /api/v1/agent/work', () => {
  it('게이트 닫힘 404', async () => {
    process.env.AGENT_API_ENABLED = 'false'
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
  })
  // 옛 케이스 '레거시 시크릿만 보내면 400 identity_required' 의 후신 — 시크릿 principal 이 삭제돼 신원을 묻는 단계 자체가 없다.
  it('옛 시크릿 값 Bearer 는 401 — env 에 AGENT_API_SECRET 이 설정돼 있고 ?user_email= 을 붙여도, 어느 표도 읽지 않는다', async () => {
    process.env.AGENT_API_SECRET = LEGACY_SECRET
    for (const qs of ['', `&user_email=${encodeURIComponent('dev@example.com')}`]) {
      const admin = seedAdmin({ ...member(), agent_work_orders: [{ data: [] }] })
      const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}${qs}`, LEGACY_SECRET))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: '인증이 필요합니다.', code: 'unauthorized' })
      expect(admin.from).not.toHaveBeenCalled()
    }
  })
  it('토큰 소유자가 비멤버(다른 워크스페이스 소속)면 404(존재 은닉) — 주문을 읽지 않는다', async () => {
    const admin = useAdmin({ ...outsider() })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_orders')
  })
  // 옛 케이스 '레거시 + 모르는 user_email 은 403 unknown_user' 의 후신 — 신원은 이메일이 아니라 자격증명 소유자다.
  it('자격증명 소유자 계정을 찾지 못하면 401 — 신원 없이 통과시키지 않는다(fail-closed)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const admin = useAdmin({ ...member() }, async () => ({ data: { user: null }, error: { message: 'user not found' } }))
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_orders')
    spy.mockRestore()
  })
  // 옛 케이스 '미등록 프로젝트 404(agent_projects 행 없음)' 의 후신 — 자격증명 경로의 루프 개방 원천은 agents 모듈 하나다.
  it('agents 모듈이 꺼진 프로젝트 404 — 비에이전트 프로젝트 은닉의 근거', async () => {
    const admin = useAdmin({ ...member() })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: 'disabled' })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
    expect(requireModule).toHaveBeenCalledWith({ projectId: P1 }, 'agents', { client: admin })
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_orders')
  })
  it('project_id 누락 400', async () => {
    useAdmin({})
    const res = await listGET(get('http://l/api/v1/agent/work'))
    expect(res.status).toBe(400)
  })
  it('project_id 비형식 400 — UUID 검증 실패', async () => {
    useAdmin({})
    const res = await listGET(get('http://l/api/v1/agent/work?project_id=invalid-id'))
    expect(res.status).toBe(400)
  })
  it('ready 목록 + 항목 컨텍스트 join — 신원은 토큰 소유자(멤버)', async () => {
    useAdmin({
      ...member(),
      agent_work_orders: [{ data: [
        { id: O1, status: 'ready', priority: 1, instructions: '지시', claimed_by: null, claimed_at: null, wbs_item_id: W1 },
      ] }],
      wbs_items: [{ data: [
        { id: W1, code: '1.2.3', name: '로그인 화면', biz: '설명', deliverable: '화면', planned_start: null, planned_end: null },
      ] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders[0].item.name).toBe('로그인 화면')
  })
  it('주문 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    useAdmin({
      ...member(),
      agent_work_orders: [{ data: null, error: { message: 'db down' } }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(500)
  })
})

/**
 * status 필터(2026-08-28). 종전에는 어떤 목록 엔드포인트도 approved·cancelled 를 돌려주지
 * 않아, 그 주문을 보려면 id 를 이미 알고 있어야 했다 — 알아야 볼 수 있고 보려면 알아야 하는
 * 구조라 승인 뒤 이력을 추적할 방법이 없었다.
 */
describe('GET /api/v1/agent/work — status 필터', () => {
  /** .in() 인자를 잡는 admin 목 — 필터가 실제로 걸렸는지 봐야 한다. 신원은 자격증명 소유자, 멤버십(buildActor 4축)은 그 사람이 P1 의 member. */
  function capturingAdmin(orders: unknown[] = []) {
    const captured: { statuses?: unknown } = {}
    const single: Record<string, unknown> = { integration_credentials: CRED.row }
    const many: Record<string, unknown[]> = {
      agent_work_orders: orders, workspace_members: [{ workspace_id: CRED_WS, role: 'member' }],
      projects: [{ id: P1, workspace_id: CRED_WS }], project_members: [rosterRow(P1, 'member')],
    }
    const admin = {
      from: vi.fn((table: string) => {
        const b: Record<string, unknown> = {}
        let updating = false
        for (const k of ['select', 'eq', 'order', 'limit', 'range']) b[k] = () => b
        b.update = () => { updating = true; return b }
        b.in = (col: string, vals: unknown) => { if (col === 'status') captured.statuses = vals; return b }
        b.maybeSingle = async () => ({ data: single[table] ?? null, error: null })
        b.single = b.maybeSingle
        b.then = (r: (v: unknown) => unknown) => {
          const data = updating ? null : many[table] ?? []
          return Promise.resolve({ data, error: null, count: data?.length ?? null }).then(r)
        }
        return b
      }),
      auth: { admin: { getUserById: vi.fn(ownerLookup()) } },
    }
    mocks.createAdminClient.mockReturnValue(admin)
    return captured
  }

  it('미지정이면 종전대로 ready 만 — 기존 클라이언트의 응답이 바뀌지 않는다', async () => {
    const captured = capturingAdmin()
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(200)
    expect(captured.statuses).toEqual(['ready'])
  })

  it('쉼표로 여럿 — 터미널 상태도 목록으로 볼 수 있다', async () => {
    const captured = capturingAdmin()
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}&status=approved,cancelled`))
    expect(res.status).toBe(200)
    expect(captured.statuses).toEqual(['approved', 'cancelled'])
  })

  it('공백을 다듬는다', async () => {
    const captured = capturingAdmin()
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}&status=ready,%20claimed`))
    expect(res.status).toBe(200)
    expect(captured.statuses).toEqual(['ready', 'claimed'])
  })

  // 조용히 버리면 오타가 "그 상태의 주문이 없다"로 위장한다 — 표시 = 로깅(에러 처리 3원칙).
  it('모르는 status 는 400 — 빈 목록으로 위장하지 않는다', async () => {
    capturingAdmin()
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}&status=done`))
    expect(res.status).toBe(400)
  })

  it('빈 status 는 400', async () => {
    capturingAdmin()
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}&status=`))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/agent/work/[id]', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '지시', claimed_by: 'cli', claimed_at: null, wbs_item_id: W1 }
  it('옛 시크릿 값 Bearer 는 401 — env 에 AGENT_API_SECRET 이 있어도 주문을 읽기 전에', async () => {
    process.env.AGENT_API_SECRET = LEGACY_SECRET
    const admin = useAdmin({ ...member(), agent_work_orders: [{ data: ORDER }] })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O1}?user_email=dev%40example.com`, LEGACY_SECRET), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('unauthorized')
    expect(admin.from).not.toHaveBeenCalled()
  })
  it('토큰 소유자가 비멤버면 404 — 다른 워크스페이스 주문의 지시·보고를 주지 않는다', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], ...outsider() })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O1}`), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('지시')
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_reports')
  })
  it('주문 + 보고 이력 반환 — 신원은 토큰 소유자(멤버)', async () => {
    useAdmin({
      ...member(),
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '', claimed_by: 'cli', claimed_at: null, wbs_item_id: W1 } }],
      agent_work_reports: [{ data: [{ id: 'r1', kind: 'completion', percent: 100, summary: 'done', links: [], agent: 'cli', review_action: null, review_note: null, created_at: 'x' }] }],
      wbs_items: [{ data: [{ id: W1, code: '1', name: 'n', biz: null, deliverable: null, planned_start: null, planned_end: null }] }],
    })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O1}`), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reports).toHaveLength(1)
    expect(body.order.project_id).toBeUndefined()
  })
  it('없는 주문 404 — 유효 형식 UUID 사용', async () => {
    useAdmin({ agent_work_orders: [{ data: null }] })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O_MISSING}`), { params: Promise.resolve({ id: O_MISSING }) })
    expect(res.status).toBe(404)
  })
  it('id 비형식 400 — UUID 검증 실패', async () => {
    useAdmin({})
    const res = await detailGET(get('http://l/api/v1/agent/work/invalid-id'), { params: Promise.resolve({ id: 'invalid-id' }) })
    expect(res.status).toBe(400)
  })
})
