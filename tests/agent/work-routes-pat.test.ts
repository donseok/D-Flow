import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { GET as listGET } from '@/app/api/v1/agent/work/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_OWNER } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const P2 = '99999999-9999-4999-8999-999999999999'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자(CRED_OWNER)가 요청의 신원.
const CRED = agentCredential({ scopes: ['work:read'] })
const PAT = { token: CRED.token }
const LEGACY_SECRET = 'legacy-secret'

function useAdmin(queues: Record<string, Resp[]>, selects?: Record<string, string[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      // select 인자를 기록한다 — 응답 셰이프가 아니라 "어떤 컬럼을 요구했는가"를 단언하기 위해서다.
      // 목은 큐에 넣은 data 를 그대로 돌려주므로, 응답만 보면 select 누락을 잡을 수 없다.
      b.select = (cols?: unknown) => {
        if (selects && typeof cols === 'string') (selects[table] ??= []).push(cols)
        return b
      }
      for (const k of ['update', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    // 소유자 해석(resolveAgentPrincipal)과 점유자 이메일 조회가 같이 쓴다 — 물은 id 를 그대로 돌려준다.
    auth: { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: { id, email: 'dev@example.com' } }, error: null })) } },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })
/** 삭제된 옛 시크릿 호출이 쓰던 신원 쿼리 — 붙여도 통하지 않는다. */
const LEGACY_EMAIL = 'dev@example.com'
/** 유효한 자격증명 + 소유자가 P1 명단 member — 옛 시크릿 Bearer 가 이 재료를 두고도 401 임을 보이는 데 쓴다. */
const validMember = () => ({
  integration_credentials: CRED.queue(),
  ...credAxes([P1]),
  project_members: [roster(rosterRow(P1, 'member'))],
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
})

describe('GET /agent/work — PAT 멤버십 게이트', () => {
  it('PAT + 멤버 → 200 (integration_credentials → last_used → 멤버십 → 주문)', async () => {
    useAdmin({
      integration_credentials: CRED.queue(), // 조회, last_seen update
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_orders: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(200)
  })
  it('PAT + 비멤버 → 404 (존재 은닉)', async () => {
    useAdmin({
      integration_credentials: CRED.queue(),
      ...credAxes([P1]),
      project_members: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(404)
  })
  it('PAT project_id 한정 위반 → 404', async () => {
    useAdmin({
      integration_credentials: CRED.with({ project_ids: [P2] }).queue(),
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(404)
  })
  it('PAT 스코프 부족 → 403 insufficient_scope', async () => {
    useAdmin({
      integration_credentials: CRED.with({ scopes: [] }).queue(),
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}`, PAT.token))
    expect(res.status).toBe(403)
  })
  // 옛 케이스 '레거시 시크릿 + 멤버 user_email → v1 동작(200)' 의 후신 — 시크릿 principal 이 삭제됐다(SP7 §5.1.4).
  it('옛 시크릿 Bearer + 멤버 user_email → 401 — env 에 시크릿이 있어도 어느 표도 읽지 않는다', async () => {
    const admin = useAdmin({
      ...validMember(),
      agent_work_orders: [{ data: [] }],
    })
    const res = await listGET(get(`http://l/api/v1/agent/work?project_id=${P1}&user_email=${LEGACY_EMAIL}`, LEGACY_SECRET))
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalled()
  })
})

const detail = (bearer: string) =>
  detailGET(get(`http://l/api/v1/agent/work/${O1}${bearer === LEGACY_SECRET ? `?user_email=${LEGACY_EMAIL}` : ''}`, bearer),
    { params: Promise.resolve({ id: O1 }) })

describe('GET /agent/work/[id] — PAT 멤버십 게이트', () => {
  it('PAT + 멤버 → 200 (integration_credentials → last_used → 주문 → 멤버십 검사)', async () => {
    useAdmin({
      integration_credentials: CRED.queue(),
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_reports: [{ data: [] }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
  })
  it('PAT + 비멤버 → 404 (존재 은닉)', async () => {
    useAdmin({
      integration_credentials: CRED.queue(),
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
      ...credAxes([P1]),
      project_members: [{ data: [] }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(404)
  })
  it('PAT project_id 한정 위반 → 404 (주문의 project_id 로 판정)', async () => {
    useAdmin({
      integration_credentials: CRED.with({ project_ids: [P2] }).queue(),
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(404)
  })
  // 옛 케이스 '레거시 시크릿 + 멤버 user_email → v1 동작(200)' 의 후신.
  it('옛 시크릿 Bearer + 멤버 user_email → 401 — 주문을 읽지 않는다', async () => {
    const admin = useAdmin({
      ...validMember(),
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
          claimed_by: null, claimed_at: null, wbs_item_id: null,
        },
      }],
      agent_work_reports: [{ data: [] }],
    })
    const res = await detail(LEGACY_SECRET)
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalled()
  })
  it('PAT — claimed_by_user_email 은 게이팅 없이 타인 점유에도 노출된다(계약 원문)', async () => {
    useAdmin({
      integration_credentials: CRED.queue(),
      agent_work_orders: [{
        data: {
          id: O1, project_id: P1, status: 'claimed', priority: 0, instructions: '',
          claimed_by: 'other-cli', claimed_by_user_id: 'u-2', claimed_at: null, wbs_item_id: null,
        },
      }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_reports: [{ data: [] }],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.mine).toBe(false) // 토큰 소유자(호출자) != u-2(점유자)
    expect(body.order.claimed_by_user_email).toBe('dev@example.com') // 타인 점유라도 노출
  })

  it('PAT — 좌석 신호(heartbeat·재개 요청)를 응답에 싣는다', async () => {
    const seatSignals = {
      last_heartbeat_at: '2026-09-18T00:10:00.000Z', heartbeat_phase: 'build',
      resume_requested_at: '2026-09-18T00:20:00.000Z', resume_requested_host: 'agent-host-1',
    }
    const orderRow = {
      id: O1, project_id: P1, status: 'claimed', priority: 0, instructions: '',
      claimed_by: 'claude-agent-host-1', claimed_by_user_id: CRED_OWNER, claimed_at: null, wbs_item_id: null, ...seatSignals,
    }
    useAdmin({
      integration_credentials: CRED.queue(),
      agent_work_orders: [{ data: orderRow }],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_reports: [{ data: [] }],
    })
    const body = await (await detail(PAT.token)).json()
    // 이 넷이 없어서 팀장은 다른 PC 팀원의 생사를 판정하지 못했다(2026-09-18).
    expect(body.order).toMatchObject(seatSignals)
    expect(body.order.mine).toBe(true) // 점유자 = 토큰 소유자
    // (삭제) 후반의 '레거시 응답은 v1 그대로(좌석 신호 없음)' 단언 — 시크릿 principal 과 함께 v1 응답 셰이프가 사라졌다(SP7 §5.1.4).
  })

  it('PAT + wbs_item_id 있음 → item 이 ITEM_DETAIL_COLUMNS 로 확장 + depends_evidence 포함', async () => {
    const W1 = '33333333-3333-4333-8333-333333333333'
    const DEP_ID = '44444444-4444-4444-8444-444444444444'
    const DEP_REF = 'MES/TSK-01-00'
    const ITEM = {
      id: W1, code: 'C1', name: '항목1', external_ref: 'MES/TSK-02-00', stage: 'fp',
      category: 'dev', domain: 'd', priority: 'high', model: 'm', tags: ['t'], depends: [DEP_REF],
      prd_ref: 'p', entry_point: 'e', acceptance: [], spec: 's', assignee_member_id: 'm1',
      planned_start: null, planned_end: null,
    }
    useAdmin({
      integration_credentials: CRED.queue(),
      agent_work_orders: [
        {
          data: {
            id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
            claimed_by: null, claimed_by_user_id: null, claimed_at: null, wbs_item_id: W1,
          },
        }, // 주문 로드
        { data: null }, // loadDependsInfo — 선행의 approved 주문 없음
      ],
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      agent_work_reports: [{ data: [] }],
      wbs_items: [
        { data: [ITEM] }, // ITEM_DETAIL_COLUMNS 로드(.in('id', [wbs_item_id]))
        { data: [{ id: DEP_ID, external_ref: DEP_REF, stage: 'im' }] }, // loadDependsInfo 의 선행 조회
      ],
    })
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.item).toEqual(ITEM) // ITEM_DETAIL_COLUMNS 전 필드 — v1(id,code,name,biz,deliverable,planned_*)보다 확장됨
    expect(body.depends_evidence).toEqual([{ external_ref: DEP_REF, stage: 'im', branch: null, head_sha: null, order_approved: false, actual_pct: null, reached: true }])
  })

  // (삭제) '레거시 시크릿 + wbs_item_id 있음 → item 은 v1 컬럼 그대로, depends_evidence 없음(회귀 기준선)' — 레거시 전용 응답 셰이프
  // (LEGACY_ITEM_COLUMNS·depends_evidence 생략)가 시크릿 principal 과 함께 삭제됐다. 남은 응답은 위 ITEM_DETAIL_COLUMNS 케이스 하나다.
})

// 저장된 evidence 를 클라이언트가 확인할 길이 없어서, 완료 보고가 증적을 실었는지조차
// DB 직접 조회 없이는 못 봤다(실제 추적이 여기서 막혔다).
// depends_evidence 와 같이 응답에 얹는다(SP7 — 레거시 v1 응답 셰이프는 시크릿 principal 과 함께 삭제됐다).
describe('GET /agent/work/[id] — reports[].evidence', () => {
  const ORDER_ROW = {
    data: {
      id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '',
      claimed_by: null, claimed_at: null, wbs_item_id: null,
    },
  }
  const memberQueues = () => ({
    integration_credentials: CRED.queue(),
    agent_work_orders: [ORDER_ROW],
    ...credAxes([P1]),
    project_members: [roster(rosterRow(P1, 'member'))],
    agent_work_reports: [{ data: [] }],
  })

  it('PAT 응답은 evidence 컬럼을 요구한다', async () => {
    const selects: Record<string, string[]> = {}
    useAdmin(memberQueues(), selects)
    const res = await detail(PAT.token)
    expect(res.status).toBe(200)
    expect(selects.agent_work_reports?.[0]).toContain('evidence')
  })

  // (삭제) '레거시 시크릿 응답은 evidence 를 요구하지 않는다(v1 회귀 기준선)' — 그 응답 셰이프가 없어졌다. 옛 시크릿 Bearer 는 401 이다.
  it('옛 시크릿 Bearer 는 보고 이력에 닿지 못한다 — 401, select 없음', async () => {
    const selects: Record<string, string[]> = {}
    useAdmin({ ...validMember(), agent_work_orders: [ORDER_ROW], agent_work_reports: [{ data: [] }] }, selects)
    const res = await detail(LEGACY_SECRET)
    expect(res.status).toBe(401)
    expect(selects.agent_work_reports).toBeUndefined()
  })
})
