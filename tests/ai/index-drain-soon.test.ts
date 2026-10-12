// 변경 등록 직후의 즉시 소비(2026-10-12 UAT WIKI-05) — 워커 플래그가 켜진 배포에서만 돌고, 한 번에 하나만 돌며, 실패를 던지지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runIndexWorkerOnce: vi.fn(),
  enabledIndexProjectIds: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/index/worker', () => ({ runIndexWorkerOnce: mocks.runIndexWorkerOnce }))
vi.mock('@/lib/ai/index/moduleGate', () => ({ enabledIndexProjectIds: mocks.enabledIndexProjectIds, createIndexJobModuleGate: () => ({}) }))
vi.mock('@/lib/ai/index/content', () => ({ createSupabaseIndexContentLoader: () => vi.fn() }))
vi.mock('@/lib/ai/index/pgvector', () => ({ createSupabaseIndexJobQueue: () => ({}), createSupabasePgvectorKnowledgeIndex: () => ({}) }))

import { drainIndexQueueSoon } from '@/lib/ai/index/drainSoon'

const db = {} as Parameters<typeof drainIndexQueueSoon>[0]
const summary = (claimed: number) => ({ claimed, upserted: claimed, deleted: 0, failed: 0, requeued: 0, skipped: 0 })

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', 'true')
  mocks.enabledIndexProjectIds.mockResolvedValue({ ok: true, ids: ['p1'] })
  mocks.runIndexWorkerOnce.mockResolvedValue(summary(1))
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); errors.mockRestore() })

describe('drainIndexQueueSoon', () => {
  it('워커 플래그가 꺼져 있으면 아무것도 하지 않는다 — 범위도 읽지 않는다', async () => {
    vi.stubEnv('CHAT_V2_INDEX_WORKER_ENABLED', '')
    await drainIndexQueueSoon(db)
    expect(mocks.enabledIndexProjectIds).not.toHaveBeenCalled()
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('켜져 있으면 한 배치를 소비한다 — 배치가 차지 않으면 한 번으로 끝난다', async () => {
    await drainIndexQueueSoon(db)
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(1)
  })

  it('배치가 가득 차면 이어서 돌되 상한에서 멈춘다', async () => {
    mocks.runIndexWorkerOnce.mockResolvedValue(summary(25))
    await drainIndexQueueSoon(db)
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(4)
  })

  it('범위를 읽지 못하면 선점하지 않는다', async () => {
    mocks.enabledIndexProjectIds.mockResolvedValue({ ok: false })
    await drainIndexQueueSoon(db)
    expect(mocks.runIndexWorkerOnce).not.toHaveBeenCalled()
  })

  it('도는 동안 들어온 요청은 겹쳐 돌지 않고 한 번 더로 접힌다', async () => {
    let release!: () => void
    mocks.runIndexWorkerOnce.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(summary(1)) }))
    const first = drainIndexQueueSoon(db)
    await vi.waitFor(() => expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(1))
    await drainIndexQueueSoon(db)   // 도는 중 — 바로 돌아온다
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(2)
  })

  it('워커가 던져도 호출자에게 던지지 않고, 다음 호출은 다시 돈다', async () => {
    mocks.runIndexWorkerOnce.mockRejectedValueOnce(new Error('boom'))
    await expect(drainIndexQueueSoon(db)).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalled()
    await drainIndexQueueSoon(db)
    expect(mocks.runIndexWorkerOnce).toHaveBeenCalledTimes(2)
  })
})
