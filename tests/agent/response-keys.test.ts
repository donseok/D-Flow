// 에이전트 프로토콜 동결(SP5b P0 — 스펙 §4.6·done_when #4, 개정 §3.7 "에이전트 응답 키 집합 스냅샷(claim·GET work)").
// SP5b 가 apply_workflow_event·선행 판정·승인 단계를 바꾸는 동안 claim·GET work 의 응답 키 집합이 바뀌지 않음을 고정한다.
// 승인 진행도는 사람 UI 전용 — 응답에 새 키를 더하지 않는다(개정 §3.4).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))

import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { GET as detailGET } from '@/app/api/v1/agent/work/[id]/route'
import { profileEq } from '../fixtures/profiles'
import { axes, roster, rosterRow } from '../fixtures/actorQueues'

const SECRET = 'test-agent-secret'
const USER = { id: 'u-1', email: 'dev@example.com', user_metadata: {} }
const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }
const RPC_OK = { ok: true, order_status: 'claimed', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: 'no_item' }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'in', 'order', 'limit', 'range']) b[k] = () => b
      if (table === 'profiles' && !queues.profiles) b.eq = profileEq(b, resp, [USER])
      b.update = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.single = b.maybeSingle
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => ({ data: RPC_OK, error: null })),
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}
const member = () => ({ ...axes([P1]), project_members: [roster(rosterRow(P1, 'member'))] })

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = SECRET
  vi.clearAllMocks()
})

describe('에이전트 응답 키 동결(SP5b P0)', () => {
  it('claim 200 — { ok, status, item, depends_evidence }', async () => {
    useAdmin({
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'ready', claimed_by: null } }],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      ...member(),
    })
    const req = new NextRequest(`http://l/api/v1/agent/work/${O1}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ user_email: USER.email, agent: 'claude-cli-dev1' }),
    })
    const res = await claimPOST(req, { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(200)
    expect(Object.keys(await res.json())).toEqual(['ok', 'status', 'item', 'depends_evidence'])
  })

  it('GET work/{id} 200(레거시) — { ok, order, reports }, order 키 집합', async () => {
    useAdmin({
      ...member(),
      agent_work_orders: [{ data: { id: O1, project_id: P1, status: 'reported', priority: 0, instructions: '', claimed_by: 'cli', claimed_at: null, wbs_item_id: W1 } }],
      agent_projects: [{ data: { project_id: P1, enabled: true } }],
      agent_work_reports: [{ data: [] }],
      wbs_items: [{ data: [{ id: W1, code: '1', name: 'n', biz: null, deliverable: null, planned_start: null, planned_end: null }] }],
    })
    const req = new NextRequest(`http://l/api/v1/agent/work/${O1}?user_email=${encodeURIComponent(USER.email)}`, {
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    const res = await detailGET(req, { params: Promise.resolve({ id: O1 }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body)).toEqual(['ok', 'order', 'reports'])
    expect(Object.keys(body.order)).toEqual(['id', 'status', 'priority', 'instructions', 'claimed_by', 'claimed_at', 'wbs_item_id', 'item', 'stale'])
  })
})
