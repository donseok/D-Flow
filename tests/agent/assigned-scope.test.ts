import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  emitNotification: vi.fn().mockResolvedValue({ ok: true }),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))

import { myMemberIds } from '@/lib/agent/assignee'
import { GET as mineGET } from '@/app/api/v1/agent/work/mine/route'
import { POST as claimPOST } from '@/app/api/v1/agent/work/[id]/claim/route'
import { credAxes, roster, rosterRow } from '../fixtures/actorQueues'
import { agentCredential, CRED_OWNER, ownerLookup } from '../fixtures/credentials'

const P1 = '11111111-1111-4111-8111-111111111111'
const O1 = '22222222-2222-4222-8222-222222222222'
const W1 = '33333333-3333-4333-8333-333333333333'
type Resp = { data?: unknown; error?: { message: string } | null; count?: number | null }

// 인증 원천은 integration_credentials(agent_runner) 행 하나다(SP7 §5.1.4) — 소유자(CRED_OWNER)가 요청의 신원.
const RUNNER = agentCredential({ scopes: ['work:read', 'work:claim'] })
const PAT = { token: RUNNER.token }
const LEGACY_SECRET = 'legacy-secret'
const ORDER = { id: O1, project_id: P1, status: 'ready', claimed_by: null, claimed_by_user_id: null, wbs_item_id: W1 }
const ITEM_COMMON = {
  id: W1, code: 'C1', name: '항목1', external_ref: null, stage: null, category: null, domain: null,
  priority: null, model: null, tags: null, depends: null, prd_ref: null, entry_point: null,
  acceptance: [], spec: null, planned_start: null, planned_end: null,
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

const get = (url: string, bearer: string) =>
  new NextRequest(url, { headers: { Authorization: `Bearer ${bearer}` } })
const post = (url: string, body: unknown, bearer: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
  body: JSON.stringify(body),
})

beforeEach(() => {
  process.env.AGENT_API_ENABLED = 'true'
  process.env.AGENT_API_SECRET = LEGACY_SECRET // 설정돼 있어도 인증에 쓰이지 않는다(SP7)
  vi.clearAllMocks()
  mocks.emitNotification.mockResolvedValue({ ok: true })
})

describe('myMemberIds — people.user_id 한 축(이메일 폴백 없음)·활성 명단 행·활성 인물만', () => {
  /** select/eq 호출을 기록하는 전용 스텁 — DB 필터가 계약이므로 필터 호출 자체를 단언한다. */
  function rosterStub(resp: Resp) {
    const calls: Array<[string, unknown[]]> = []
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'in', 'order', 'range']) b[k] = (...args: unknown[]) => { calls.push([k, args]); return b }
    b.then = (r: (v: unknown) => unknown, j: (e: unknown) => unknown) =>
      Promise.resolve({ data: resp.data ?? null, error: resp.error ?? null, count: resp.count ?? null }).then(r, j)
    return { admin: { from: vi.fn(() => b) } as never, calls }
  }

  it('DB 필터로 내 활성 행만 읽고 id 를 중복 없이 반환한다', async () => {
    const { admin, calls } = rosterStub({ data: [{ id: 'm1' }, { id: 'm2' }, { id: 'm1' }] })
    expect(await myMemberIds(admin, { userId: 'u-1', projectId: P1 })).toEqual(['m1', 'm2'])
    expect(calls).toEqual([
      ['select', ['id, people!inner(user_id, active)']],
      ['eq', ['project_id', P1]],
      ['eq', ['people.user_id', 'u-1']],
      ['eq', ['active', true]],
      ['eq', ['people.active', true]],
    ])
    // 이메일은 판정 재료가 아니다 — select 절에도 없다.
    expect(String(calls[0][1][0])).not.toContain('email')
  })

  it('조회 실패는 throw (보안 판정 재료 — 위장 금지)', async () => {
    const { admin } = rosterStub({ error: { message: 'db down' } })
    await expect(myMemberIds(admin, { userId: 'u-1', projectId: P1 })).rejects.toThrow(/db down/)
  })
})

describe('scope=assigned', () => {
  it('내 배정 항목의 활성 주문만 반환', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member')), { data: [{ id: 'm1' }] }],
      wbs_items: [
        { data: [{ id: W1 }] }, // assignee_member_id in (myMemberIds) 항목 조회
        { data: [{ id: W1, code: 'C1', name: '항목1', planned_start: null, planned_end: null }] }, // 컨텍스트
      ],
      agent_work_orders: [{ data: [
        { id: O1, project_id: P1, status: 'ready', priority: 0, instructions: '', claimed_at: null, wbs_item_id: W1, created_at: '2026-08-01T00:00:00Z' },
      ] }],
    })
    const res = await mineGET(get('http://l/api/v1/agent/work/mine?scope=assigned', PAT.token))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('assigned')
    expect(body.assigned).toHaveLength(1)
    expect(body.assigned[0].id).toBe(O1)
    expect(body.claimed).toBeUndefined()
    expect(body.available).toBeUndefined()
  })
})

describe('claim 배정 제한', () => {
  it('배정 항목 + 본인 → 200', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      ...credAxes([P1]),
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: 'm1' } }],
      project_members: [roster(rosterRow(P1, 'member')), { data: [{ id: 'm1' }] }], // myMemberIds → 내 것(DB 가 people.user_id·active 로 거른 결과)
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('claimed')
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.claimed', projectId: P1, entityType: 'agent_order', entityId: O1,
      actorUserId: CRED_OWNER, recipientMemberIds: ['m1'],
    }))
  })

  it('배정 항목 + 타인 → 403 not_assignee', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }], // 로드만 — CAS 도달 안 함
      ...credAxes([P1]),
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: 'm1' } }],
      project_members: [roster(rosterRow(P1, 'member')), { data: [] }], // m1 은 다른 사용자 — people.user_id 필터에 걸리는 내 활성 행이 없다
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('not_assignee')
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  it('무배정 항목 → 선착순 그대로 200', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, CAS
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: null } }],
      // project_members 큐는 권한 판정 1건뿐 — 무배정이면 myMemberIds 를 호출하지 않는다.
    })
    const res = await claimPOST(post(`http://l/api/v1/agent/work/${O1}/claim`, { agent: 'a' }, PAT.token), ctx)
    expect(res.status).toBe(200)
  })

  // 옛 케이스 '레거시 경로 + 배정 항목 + 타인 → 403 not_assignee(동일 게이트 적용)' 의 후신 — 시크릿 경로가 삭제돼 배정 게이트로 가는 길은
  // 위 토큰 경로 하나다. 옛 시크릿 Bearer 는 게이트에 닿기 전에 401 이다.
  it('옛 시크릿 Bearer(env 에 AGENT_API_SECRET 설정) + body user_email → 401 — 배정 판정·전이에 닿지 않는다', async () => {
    const admin = useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }],
      ...credAxes([P1]),
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: null } }],
      project_members: [roster(rosterRow(P1, 'member'))],
    })
    const res = await claimPOST(
      post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }, LEGACY_SECRET),
      ctx,
    )
    expect(res.status).toBe(401)
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
    expect(mocks.emitNotification).not.toHaveBeenCalled()
  })

  // 옛 케이스 '레거시 경로 + 무배정 항목 → 200 + 알림 actorUserId=loaded.userId' 의 후신 — 자기제외 근거(actorUserId)는 토큰 소유자다.
  it('무배정 항목 → 200 + 알림 actorUserId=토큰 소유자(자기제외 근거 — null 로 새지 않는다)', async () => {
    useAdmin({
      integration_credentials: RUNNER.queue(),
      agent_work_orders: [{ data: ORDER }, { data: [{ id: O1 }] }], // 로드, 재개 표식 정리
      ...credAxes([P1]),
      project_members: [roster(rosterRow(P1, 'member'))],
      wbs_items: [{ data: { ...ITEM_COMMON, assignee_member_id: null } }],
    })
    const res = await claimPOST(
      post(`http://l/api/v1/agent/work/${O1}/claim`, { user_email: 'dev@example.com', agent: 'claude-cli-dev1' }, PAT.token),
      ctx,
    )
    expect(res.status).toBe(200)
    expect(mocks.emitNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'work.claimed', actorUserId: CRED_OWNER,
    }))
  })
})
