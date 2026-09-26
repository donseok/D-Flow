import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'
import { profileEq } from '../fixtures/profiles'
import { axes, roster, rosterRow } from '../fixtures/actorQueues'

// 레거시(AGENT_API_SECRET) 읽기는 ?user_email= 필수(SP2 최종 리뷰 F8, v1 계약 변경) — 시크릿은 배포 전역이라 워크스페이스 경계가 없다.
// 신원을 받으면 PAT 과 같은 멤버십 판정(buildActor + isProjectMember)을 하고 비멤버는 404(존재 은닉)다.
const SECRET = 'test-agent-secret'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }
const OUTSIDER = { id: 'u-9', email: 'outsider@example.com', user_metadata: {} }
// UUID 형식 테스트 픽스처
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const O_MISSING = '99999999-9999-4999-8999-999999999999'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit', 'range']) b[k] = () => b
      // resolveUserByEmail 은 profiles 를 eq('email') 로 한 건 읽는다 — 큐가 없으면 계정 fixture 에서 찾는다.
      if (table === 'profiles' && !queues.profiles) b.eq = profileEq(b, resp, [USER, OUTSIDER])
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (url: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${SECRET}` } })
/** 레거시 호출의 신원 — 멤버(USER)·외부인(OUTSIDER) */
const asUser = (url: string, email = USER.email) => get(`${url}${url.includes('?') ? '&' : '?'}user_email=${encodeURIComponent(email)}`)
/** USER 가 P1 의 명단 member — buildActor 4축 응답 */
const member = () => ({ ...axes([P1]), project_members: [roster(rosterRow(P1, 'member'))] })
/** OUTSIDER 는 다른 워크스페이스 — P1 을 모른다 */
const outsider = () => ({ ...axes([]), project_members: [roster()] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('GET /api/v1/agent/work', () => {
  it('게이트 닫힘 404', async () => {
    process.env.AGENT_API_ENABLED = 'false'
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
  })
  it('레거시 시크릿만 보내면(user_email 없음) 400 identity_required — 신원 없이 어느 워크스페이스 주문도 읽지 못한다', async () => {
    useAdmin({ agent_projects: [{ data: { project_id: P1, enabled: true } }] })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
  })
  it('레거시 + 비멤버 user_email 은 404(PAT 과 같은 존재 은닉)', async () => {
    useAdmin({ agent_projects: [{ data: { project_id: P1, enabled: true } }], ...outsider() })
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}`, OUTSIDER.email))
    expect(res.status).toBe(404)
  })
  it('레거시 + 모르는 user_email 은 403 unknown_user(쓰기 라우트와 같다)', async () => {
    useAdmin({})
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}`, 'nobody@example.com'))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('unknown_user')
  })
  it('미등록 프로젝트 404 — 비에이전트 프로젝트 은닉의 근거', async () => {
    useAdmin({ agent_projects: [{ data: null }] })
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(404)
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
  it('ready 목록 + 항목 컨텍스트 join — 레거시는 멤버 user_email 로', async () => {
    useAdmin({
      ...member(),
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_orders: [{ data: [
        { id: O1, status: 'ready', priority: 1, instructions: '지시', claimed_by: null, claimed_at: null, wbs_item_id: W1 },
      ] }],
      wbs_items: [{ data: [
        { id: W1, code: '1.2.3', name: '로그인 화면', biz: '설명', deliverable: '화면', planned_start: null, planned_end: null },
      ] }],
    })
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders[0].item.name).toBe('로그인 화면')
  })
  it('주문 조회 실패는 500 — 빈 목록으로 위장하지 않는다', async () => {
    useAdmin({
      ...member(),
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_orders: [{ data: null, error: { message: 'db down' } }],
    })
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(500)
  })
})

/**
 * status 필터(2026-08-28). 종전에는 어떤 목록 엔드포인트도 approved·cancelled 를 돌려주지
 * 않아, 그 주문을 보려면 id 를 이미 알고 있어야 했다 — 알아야 볼 수 있고 보려면 알아야 하는
 * 구조라 승인 뒤 이력을 추적할 방법이 없었다.
 */
describe('GET /api/v1/agent/work — status 필터', () => {
  /** .in() 인자를 잡는 admin 목 — 필터가 실제로 걸렸는지 봐야 한다. 신원(profiles)·멤버십(buildActor 4축)은 USER 가 P1 의 member. */
  function capturingAdmin(orders: unknown[] = []) {
    const captured: { statuses?: unknown } = {}
    const single: Record<string, unknown> = {
      agent_projects: { project_id: P1, enabled: true }, profiles: { user_id: USER.id, display_name: 'dev' },
    }
    const many: Record<string, unknown[]> = {
      agent_work_orders: orders, workspace_members: [{ workspace_id: 'ws-1', role: 'member' }],
      projects: [{ id: P1, workspace_id: 'ws-1' }], project_members: [rosterRow(P1, 'member')],
    }
    const admin = {
      from: vi.fn((table: string) => {
        const b: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'order', 'limit', 'range']) b[k] = () => b
        b.in = (col: string, vals: unknown) => { if (col === 'status') captured.statuses = vals; return b }
        b.maybeSingle = async () => ({ data: single[table] ?? null, error: null })
        b.single = b.maybeSingle
        b.then = (r: (v: unknown) => unknown) => {
          const data = many[table] ?? []
          return Promise.resolve({ data, error: null, count: data.length }).then(r)
        }
        return b
      }),
    }
    mocks.createAdminClient.mockReturnValue(admin)
    return captured
  }

  it('미지정이면 종전대로 ready 만 — 기존 클라이언트의 응답이 바뀌지 않는다', async () => {
    const captured = capturingAdmin()
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}`))
    expect(res.status).toBe(200)
    expect(captured.statuses).toEqual(['ready'])
  })

  it('쉼표로 여럿 — 터미널 상태도 목록으로 볼 수 있다', async () => {
    const captured = capturingAdmin()
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}&status=approved,cancelled`))
    expect(res.status).toBe(200)
    expect(captured.statuses).toEqual(['approved', 'cancelled'])
  })

  it('공백을 다듬는다', async () => {
    const captured = capturingAdmin()
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}&status=ready,%20claimed`))
    expect(res.status).toBe(200)
    expect(captured.statuses).toEqual(['ready', 'claimed'])
  })

  // 조용히 버리면 오타가 "그 상태의 주문이 없다"로 위장한다 — 표시 = 로깅(에러 처리 3원칙).
  it('모르는 status 는 400 — 빈 목록으로 위장하지 않는다', async () => {
    capturingAdmin()
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}&status=done`))
    expect(res.status).toBe(400)
  })

  it('빈 status 는 400', async () => {
    capturingAdmin()
    const res = await listGET(asUser(`http://l/api/v1/agent/work?project_id=${P1}&status=`))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/v1/agent/work/[id]', () => {
  const ORDER = { id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '지시', claimed_by: 'cli', claimed_at: null, wbs_item_id: W1 }
  it('레거시 시크릿만 보내면 400 identity_required — 주문을 읽기 전에', async () => {
    const admin = useAdmin({ agent_work_orders: [{ data: ORDER }], agent_projects: [{ data: { project_id: P1, enabled: true } }] })
    const res = await detailGET(get(`http://l/api/v1/agent/work/${O1}`), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('identity_required')
    expect(admin.from).not.toHaveBeenCalledWith('agent_work_orders')
  })
  it('레거시 + 비멤버 user_email 은 404 — 다른 워크스페이스 주문의 지시·보고를 주지 않는다', async () => {
    useAdmin({ agent_work_orders: [{ data: ORDER }], agent_projects: [{ data: { project_id: P1, enabled: true } }], ...outsider() })
    const res = await detailGET(asUser(`http://l/api/v1/agent/work/${O1}`, OUTSIDER.email), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(404)
    expect(await res.text()).not.toContain('지시')
  })
  it('주문 + 보고 이력 반환 — 레거시는 멤버 user_email 로', async () => {
    useAdmin({
      ...member(),
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '', claimed_by: 'cli', claimed_at: null, wbs_item_id: W1 } }],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_reports: [{ data: [{ id: 'r1', kind: 'completion', percent: 100, summary: 'done', links: [], agent: 'cli', review_action: null, review_note: null, created_at: 'x' }] }],
      wbs_items: [{ data: [{ id: W1, code: '1', name: 'n', biz: null, deliverable: null, planned_start: null, planned_end: null }] }],
    })
    const res = await detailGET(asUser(`http://l/api/v1/agent/work/${O1}`), { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reports).toHaveLength(1)
    expect(body.order.project_id).toBeUndefined()
  })
  it('없는 주문 404 — 유효 형식 UUID 사용', async () => {
    useAdmin({ agent_work_orders: [{ data: null }] })
    const res = await detailGET(asUser(`http://l/api/v1/agent/work/${O_MISSING}`), { params: Promise.resolve({ id: O_MISSING }) })
    expect(res.status).toBe(404)
  })
  it('id 비형식 400 — UUID 검증 실패', async () => {
    useAdmin({})
    const res = await detailGET(get('http://l/api/v1/agent/work/invalid-id'), { params: Promise.resolve({ id: 'invalid-id' }) })
    expect(res.status).toBe(400)
  })
})
