import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { loadPredecessorGate } from '@/lib/agent/predecessorGate'
import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, ownerLookup } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
const DEP_ID = '44444444-4444-4444-8444-444444444444'
const DEP_REF = 'MES/TSK-01-00'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자(CRED_OWNER)가 요청의 신원.
const RUNNER = agentCredential({ scopes: ['work:read', 'work:claim'] })
const PAT = { token: RUNNER.token }
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
const TARGET_ITEM = {
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: null, category: null, domain: null,
  priority: null, model: null, tags: null, depends: [DEP_REF], prd_ref: null, entry_point: null,
  acceptance: [], spec: null, assignee_member_id: null, planned_start: null, planned_end: null,
}
const ctx = { params: Promise.resolve({ id: O1 }) }

function useAdmin(queues: Record<string, Resp[]>) {
  const admin = {
    from: vi.fn((table: string) => {
      const resp: Resp = (queues[table] ?? []).shift() ?? { data: null, error: null }
      const b: Record<string, unknown> = {}
      for (const k of ['select', 'update', 'eq', 'in', 'limit', 'order', 'range']) b[k] = () => b
      b.maybeSingle = async () => ({ data: resp.data ?? null, error: resp.error ?? null })
      b.then = (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r)
      return b
    }),
    rpc: vi.fn(async () => ({ data: { ok: true, order_status: 'claimed', stage: null, actual_pct: null, stage_changed: false, actual_changed: false, reached_first: false, skipped: null }, error: null })),
    auth: {
      admin: {
        getUserById: vi.fn(ownerLookup()),
      },
    },
  }
  mocks.createAdminClient.mockReturnValue(admin)
  return admin
}

const post = (url: string, body: unknown, bearer: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('claim 선행 게이트 — 프로젝트 선행 기준 final(SP5b D21, done_when #4)', () => {
  const queues = (depRow: Record<string, unknown>, cas = false) => ({
    integration_credentials: RUNNER.queue(),
    agent_work_orders: [{ data: ORDER }, { data: null }, ...(cas ? [{ data: [{ id: O1 }] }] : [])],
    ...credAxes([P1]),
    project_members: [roster(rosterRow(P1, 'member'))],
    wbs_items: [{ data: TARGET_ITEM }, { data: [{ id: DEP_ID, external_ref: DEP_REF, ...depRow }] }],
  })
  it('선행 im → 403 dependency_not_met, 문구가 최종 승인을 말한다(code·unmet 키는 그대로)', async () => {
    vi.mocked(loadPredecessorGate).mockResolvedValueOnce('final')
    useAdmin(queues({ stage: 'im', actual_pct: 80, dev_workflow: true }))
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toMatchObject({ code: 'dependency_not_met', unmet: [{ external_ref: DEP_REF, stage: 'im' }] })
    expect(body.error).toContain('최종 승인')
  })
  it('선행 xx → 통과, depends_evidence.reached = true(키 불변)', async () => {
    vi.mocked(loadPredecessorGate).mockResolvedValueOnce('final')
    useAdmin(queues({ stage: 'xx', actual_pct: 100, dev_workflow: true }, true))
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).depends_evidence).toEqual([{ external_ref: DEP_REF, stage: 'xx', branch: null, head_sha: null, order_approved: false, actual_pct: 100, reached: true }])
  })
  it('기준 판독 실패 → 500(게이트 재료 — 기본값으로 풀지 않는다)', async () => {
    vi.mocked(loadPredecessorGate).mockRejectedValueOnce(new Error('CONFIG_INVALID'))
    useAdmin(queues({ stage: 'xx', actual_pct: 100, dev_workflow: true }))
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(500)
  })
})
