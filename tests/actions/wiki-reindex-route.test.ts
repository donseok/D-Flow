import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const mocks = vi.hoisted(() => ({
  requireSuperuser: vi.fn(),
  createAdminClient: vi.fn(),
  runIndexBackfill: vi.fn(),
  runIndexWorkerOnce: vi.fn(),
  runRepairOnce: vi.fn(),
  queueEnqueue: vi.fn(async () => ({ ok: true, data: { affected: 0 } })),
}))
const scope = vi.hoisted(() => ({
  enabledIndexProjectIds: vi.fn(async (): Promise<{ ok: true; ids: string[] } | { ok: false }> => ({ ok: true, ids: ['p1'] })),
}))

vi.mock('@/lib/authz', () => ({ requireSuperuser: mocks.requireSuperuser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/ai/index', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/index')>('@/lib/ai/index')
  return {
    ...actual,
    // 조립 헬퍼는 자리표시자만 반환한다 — runIndexBackfill/runIndexWorkerOnce/runRepairOnce
    // 자체를 목했으므로 실제로 이 deps 를 소비하지 않는다.
    createSupabaseIndexJobQueue: () => ({ enqueue: mocks.queueEnqueue }),
    createSupabaseIndexContentLoader: () => vi.fn(),
    createSupabaseIndexSourceLister: () => vi.fn(),
    createSupabasePgvectorKnowledgeIndex: () => ({}),
    runIndexBackfill: mocks.runIndexBackfill,
    runIndexWorkerOnce: mocks.runIndexWorkerOnce,
    runRepairOnce: mocks.runRepairOnce,
  }
})
vi.mock('@/lib/ai/index/moduleGate', async (original) => ({
  ...(await original<typeof import('@/lib/ai/index/moduleGate')>()),
  enabledIndexProjectIds: scope.enabledIndexProjectIds,
}))

import { POST } from '@/app/api/wiki/reindex/route'
import { INDEX_BACKFILL_DOMAINS } from '@/lib/ai/index'

function request(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/wiki/reindex', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

type StatusCounts = { pending: number; deadLetter: number; docs: number; chunks: number; embedded: number }

/** 워커 라우트 테스트의 목 패턴을 재사용 — count/head 쿼리와 projects 목록 쿼리를 구분해 응답한다. */
function fakeAdmin(options: {
  projects?: { data: unknown; error: { code?: string } | null }
  status?: StatusCounts
  statusError?: boolean
} = {}) {
  const from = vi.fn((table: string) => {
    const filters: { status?: string; chunkNo?: number; embeddingNotNull?: boolean; usesCount?: boolean } = {}
    const builder: Record<string, unknown> = {}
    builder.select = vi.fn((_cols: string, opts?: { count?: string; head?: boolean }) => {
      if (opts?.count) filters.usesCount = true
      return builder
    })
    builder.eq = vi.fn((col: string, val: unknown) => {
      if (col === 'status') filters.status = val as string
      if (col === 'chunk_no') filters.chunkNo = val as number
      return builder
    })
    builder.not = vi.fn((col: string) => {
      if (col === 'embedding') filters.embeddingNotNull = true
      return builder
    })
    builder.limit = vi.fn(() => builder)
    builder.then = (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) => {
      let result: unknown
      if (filters.usesCount) {
        if (options.statusError) {
          result = { data: null, error: { code: '08006' }, count: null }
        } else {
          const s = options.status ?? { pending: 0, deadLetter: 0, docs: 0, chunks: 0, embedded: 0 }
          let count = s.chunks
          if (table === 'ai_index_jobs') count = filters.status === 'pending' ? s.pending : s.deadLetter
          else if (filters.chunkNo === 0) count = s.docs
          else if (filters.embeddingNotNull) count = s.embedded
          result = { data: null, error: null, count }
        }
      } else {
        result = options.projects ?? { data: [{ id: 'p1' }], error: null }
      }
      return Promise.resolve(result).then(resolve, reject)
    }
    return builder
  })
  return { from, rpc: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CHAT_V2_ENABLED', 'true')
  scope.enabledIndexProjectIds.mockResolvedValue({ ok: true, ids: ['p1'] })
  mocks.requireSuperuser.mockResolvedValue({ ok: true, actor: { userId: 'u1', isSuperuser: true } })
  mocks.createAdminClient.mockReturnValue(fakeAdmin())
  mocks.runIndexBackfill.mockResolvedValue({
    planned: 1, enqueued: 1, batches: 1, dryRun: false, listErrorCode: null, enqueueErrorCode: null,
  })
  mocks.runIndexWorkerOnce.mockResolvedValue({ claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0, skipped: 0 })
  mocks.runRepairOnce.mockResolvedValue({ scanned: 0, repaired: 0, stillNull: 0 })
})
afterEach(() => {
  for (const fn of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(fn).mockReset()
})

describe('POST /api/wiki/reindex', () => {
  it('로그인하지 않았으면 401 — 내부 함수 미호출', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '로그인 필요' })
    const res = await POST(request({ action: 'status' }))
    expect(res.status).toBe(401)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('일반 사용자(슈퍼유저 아님)는 403 — 내부 함수 미호출', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한 없음' })
    const res = await POST(request({ action: 'status' }))
    expect(res.status).toBe(403)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(mocks.runIndexBackfill).not.toHaveBeenCalled()
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
    expect(mocks.runRepairOnce).not.toHaveBeenCalled()
  })

  it('권한 판정 자체가 실패하면(조회 불가) 503 — 401/403 으로 위장하지 않는다', async () => {
    mocks.requireSuperuser.mockResolvedValue({ ok: false, error: '권한을 확인할 수 없어 중단했습니다.' })
    const res = await POST(request({ action: 'status' }))
    expect(res.status).toBe(503)
  })

  it('알 수 없는 action 은 400', async () => {
    const res = await POST(request({ action: 'drop-everything' }))
    expect(res.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('status 는 ai_documents·ai_index_jobs 집계 형태를 돌려준다', async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin({
      status: { pending: 3, deadLetter: 1, docs: 40, chunks: 883, embedded: 651 },
    }))
    const res = await POST(request({ action: 'status' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pending: 3, deadLetter: 1, docs: 40, chunks: 883, embedded: 651 })
  })

  it('status 조회가 실패하면 503 — 빈 값으로 위장하지 않는다', async () => {
    mocks.createAdminClient.mockReturnValue(fakeAdmin({ statusError: true }))
    const res = await POST(request({ action: 'status' }))
    expect(res.status).toBe(503)
  })

  it('enqueue 는 전 도메인을 순회해 runIndexBackfill 을 호출하고 enqueued 를 합산한다', async () => {
    const res = await POST(request({ action: 'enqueue' }))
    expect(res.status).toBe(200)
    expect(mocks.runIndexBackfill).toHaveBeenCalledTimes(INDEX_BACKFILL_DOMAINS.length)
    for (const domain of INDEX_BACKFILL_DOMAINS) {
      expect(mocks.runIndexBackfill).toHaveBeenCalledWith(expect.objectContaining({ domain }))
    }
    // 기본 목은 도메인당 enqueued:1 이므로 도메인 개수만큼 합산된다.
    expect(await res.json()).toEqual({ enqueued: INDEX_BACKFILL_DOMAINS.length })
  })

  it('enqueue 중 한 도메인이라도 실패하면 503 — 부분 합계를 성공으로 위장하지 않는다', async () => {
    mocks.runIndexBackfill.mockResolvedValueOnce({
      planned: 0, enqueued: 0, batches: 0, dryRun: false, listErrorCode: 'INDEX_CONSISTENCY_READ_FAILED', enqueueErrorCode: null,
    })
    const res = await POST(request({ action: 'enqueue' }))
    expect(res.status).toBe(503)
  })

  it('step 은 batchSize 8 로 runIndexWorkerOnce 를 호출한다', async () => {
    await POST(request({ action: 'step' }))
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(1)
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledWith(expect.objectContaining({
      batchSize: 8, moduleGate: expect.objectContaining({ state: expect.any(Function), skip: expect.any(Function) }),
    }))
  })

  it('step 의 claimFailed 를 그대로 응답에 전달한다', async () => {
    mocks.runIndexWorkerOnce.mockResolvedValue({
      claimed: 0, upserted: 0, deleted: 0, failed: 0, requeued: 0, claimFailed: 'INDEX_JOB_CLAIM_FAILED',
    })
    const res = await POST(request({ action: 'step' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ claimFailed: 'INDEX_JOB_CLAIM_FAILED' })
  })

  it('repair 는 runRepairOnce 에 위임하고 결과를 그대로 반환한다', async () => {
    mocks.runRepairOnce.mockResolvedValue({ scanned: 5, repaired: 4, stillNull: 1 })
    const res = await POST(request({ action: 'repair' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scanned: 5, repaired: 4, stillNull: 1 })
    expect(mocks.runRepairOnce).toHaveBeenCalledWith(expect.anything(), 20)
  })

  it('repair 가 조회 실패를 반환하면 그 상태코드를 그대로 전달한다', async () => {
    mocks.runRepairOnce.mockResolvedValue({ error: 'null 임베딩 행을 조회하지 못했습니다.', status: 503 })
    const res = await POST(request({ action: 'repair' }))
    expect(res.status).toBe(503)
  })

  it('배포에서 챗봇을 쓸 수 없으면 step·enqueue 만 404 — repair·status 는 그 앞이라 남는다', async () => {
    // 정본 §3.2.7 규칙 2 — status·repair 는 env 404 **앞**이다. 어느 쪽이 스펙인지 이 it 가 고정한다.
    vi.stubEnv('CHAT_V2_ENABLED', 'false')
    expect((await POST(request({ action: 'step' }))).status).toBe(404)
    expect((await POST(request({ action: 'enqueue' }))).status).toBe(404)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
    expect(mocks.runIndexBackfill).not.toHaveBeenCalled()
    expect((await POST(request({ action: 'status' }))).status).toBe(200)
    // repair 는 전역 스캔이라 챗봇 env 404 에 물리지 않는다(깨진 임베딩 청크는 챗봇 모듈과 무관하다).
    expect((await POST(request({ action: 'repair' }))).status).toBe(200)
    expect(mocks.runRepairOnce).toHaveBeenCalled()
  })

  it('enqueue 는 꺼진 프로젝트의 변경을 큐에 넣지 않는다', async () => {
    vi.mocked(moduleState).mockResolvedValue('off')
    await POST(request({ action: 'enqueue' }))
    const enqueue = (mocks.runIndexBackfill.mock.calls[0][0] as { enqueue: (mutations: unknown[]) => Promise<unknown> }).enqueue
    await enqueue([{ operation: 'upsert', projectId: 'p1', domain: 'wbs', entityType: 'wbs_item', entityId: 'w1' }])
    expect(mocks.queueEnqueue).toHaveBeenCalledWith([])
  })

  it('프로젝트 스코프 조회가 실패하면 503', async () => {
    scope.enabledIndexProjectIds.mockResolvedValueOnce({ ok: false })
    expect((await POST(request({ action: 'step' }))).status).toBe(503)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('service_role 클라이언트로 켜진 프로젝트 스코프를 읽는다', async () => {
    await POST(request({ action: 'step' }))
    expect(scope.enabledIndexProjectIds).toHaveBeenCalledWith(mocks.createAdminClient.mock.results[0]?.value)
  })
})
