import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const adminHolder = vi.hoisted(() => ({ admin: null as unknown }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminHolder.admin }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { runIndexWorkerOnce } from '@/lib/ai/index/worker'
import {
  createIndexJobModuleGate, enabledIndexProjectIds, gateWikiJob, keepEnabledMutations,
  type IndexJobModuleGate,
} from '@/lib/ai/index/moduleGate'
import type { ClaimedIndexJob, IndexJobWorkerQueue, KnowledgeIndex } from '@/lib/ai/index/types'
import { processMinuteWikiJob, processWikiProjectRebuildStep } from '@/lib/ai/wiki-ingest'

const P = '00000000-0000-0000-7e57-000000001471'
const W = '00000000-0000-0000-7e57-000000001472'
const job = (overrides: Partial<ClaimedIndexJob> = {}): ClaimedIndexJob => ({
  id: 7, jobKey: 'k7', operation: 'upsert', projectId: P, domain: 'wbs', entityType: 'wbs_item', entityId: 'w1',
  payload: {}, status: 'running', attempts: 0, runAfter: '2026-09-29T00:00:00.000Z',
  generation: 3, lockedAt: '2026-09-29T00:00:00.000Z', lastError: null,
  createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z', ...overrides,
})

function queue(jobs: ClaimedIndexJob[]) {
  return {
    claim: vi.fn(async () => ({ ok: true, data: jobs })),
    complete: vi.fn(async () => ({ ok: true, data: { applied: true } })),
    fail: vi.fn(async () => ({ ok: true, data: { applied: true } })),
  } as unknown as IndexJobWorkerQueue & { fail: ReturnType<typeof vi.fn> }
}
function index() {
  return { upsert: vi.fn(), delete: vi.fn() } as unknown as KnowledgeIndex & {
    upsert: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>
  }
}
const gate = (state: IndexJobModuleGate['state'], skip: IndexJobModuleGate['skip'] = vi.fn(async () => true)): IndexJobModuleGate => ({ state, skip })

function fakeDb(options: {
  minuteRow?: unknown; minuteError?: unknown; updateRows?: unknown[]; updateError?: unknown; rpc?: Record<string, unknown>
} = {}) {
  const updates: Array<{ table: string; values: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  const rpcCalls: Array<[string, Record<string, unknown>]> = []
  const from = vi.fn((table: string) => {
    const entry = { table, values: {} as Record<string, unknown>, filters: [] as Array<[string, unknown]> }
    const builder: Record<string, unknown> = {}
    builder.update = (values: Record<string, unknown>) => { entry.values = values; updates.push(entry); return builder }
    builder.eq = (column: string, value: unknown) => { entry.filters.push([column, value]); return builder }
    builder.select = () => Object.keys(entry.values).length
      ? Promise.resolve({ data: options.updateRows ?? [{ id: 1 }], error: options.updateError ?? null }) : builder
    builder.maybeSingle = async () => ({ data: options.minuteRow ?? null, error: options.minuteError ?? null })
    return builder
  })
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCalls.push([name, args])
    const result = { data: options.rpc?.[name] ?? null, error: null }
    return { maybeSingle: async () => result, single: async () => result }
  })
  return { from, rpc, updates, rpcCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  for (const fn of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(fn).mockReset()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('색인 워커 — 잡마다 모듈 판정', () => {
  it('꺼지면 skipped 로 닫고 원본·색인을 읽지 않는다', async () => {
    const q = queue([job()]); const ix = index(); const loadContent = vi.fn()
    const g = gate(async () => 'off')
    const result = await runIndexWorkerOnce({ queue: q, index: ix, loadContent, moduleGate: g })
    expect(g.skip).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }))
    expect(loadContent).not.toHaveBeenCalled()
    expect(ix.upsert).not.toHaveBeenCalled()
    expect(ix.delete).not.toHaveBeenCalled()
    expect(result).toEqual({ claimed: 1, upserted: 0, deleted: 0, failed: 0, requeued: 0, skipped: 1 })
  })

  it('설정을 모르면 CONFIG_UNAVAILABLE 로 실패시켜 재시도한다', async () => {
    const q = queue([job()]); const loadContent = vi.fn()
    const result = await runIndexWorkerOnce({ queue: q, index: index(), loadContent, moduleGate: gate(async () => 'unknown') })
    expect(q.fail).toHaveBeenCalledWith({ id: 7, generation: 3, attempts: 0 }, 'CONFIG_UNAVAILABLE', expect.any(Date))
    expect(loadContent).not.toHaveBeenCalled()
    expect(result).toMatchObject({ failed: 1, skipped: 0 })
  })

  it('판정 예외도 재시도하고, skipped 기록 0행은 다음 선점에 맡긴다', async () => {
    const failed = queue([job()])
    await runIndexWorkerOnce({ queue: failed, index: index(), loadContent: vi.fn(), moduleGate: gate(async () => { throw new Error('down') }) })
    expect(failed.fail).toHaveBeenCalledWith(expect.anything(), 'CONFIG_UNAVAILABLE', expect.any(Date))
    const result = await runIndexWorkerOnce({ queue: queue([job()]), index: index(), loadContent: vi.fn(),
      moduleGate: gate(async () => 'off', async () => false) })
    expect(result).toMatchObject({ requeued: 1, skipped: 0 })
  })
})

describe('색인 잡의 범위와 skipped 쓰기', () => {
  it('프로젝트 잡은 그 프로젝트로, 프로젝트 없는 회의록 잡은 회의록 워크스페이스로 판정한다', async () => {
    const db = fakeDb({ minuteRow: { workspace_id: W } })
    vi.mocked(moduleState).mockResolvedValue('on')
    const g = createIndexJobModuleGate(db as never)
    expect(await g.state(job())).toBe('on')
    expect(await g.state(job({ projectId: null, domain: 'minutes', entityType: 'minute', entityId: 'minute-1' }))).toBe('on')
    expect(moduleState).toHaveBeenCalledWith({ projectId: P }, 'chatbot', { client: db })
    expect(moduleState).toHaveBeenCalledWith({ workspaceId: W }, 'chatbot', { client: db })
  })

  it('회의록 조회 실패는 unknown, 삭제된 회의록은 청크 삭제를 위해 on', async () => {
    expect(await createIndexJobModuleGate(fakeDb({ minuteError: { message: 'down' } }) as never)
      .state(job({ projectId: null, domain: 'minutes' }))).toBe('unknown')
    expect(await createIndexJobModuleGate(fakeDb() as never).state(job({ projectId: null, domain: 'minutes' }))).toBe('on')
    expect(await createIndexJobModuleGate(fakeDb() as never).state(job({ projectId: null, domain: 'wbs' }))).toBe('unknown')
  })

  it('skipped 는 id 와 running 상태를 함께 조건으로 쓴다', async () => {
    const db = fakeDb()
    expect(await createIndexJobModuleGate(db as never).skip(job())).toBe(true)
    expect(db.updates[0]).toMatchObject({ table: 'ai_index_jobs', values: expect.objectContaining({ status: 'skipped', last_error: 'module_disabled' }) })
    expect(db.updates[0].filters).toEqual([['id', 7], ['status', 'running']])
    expect(await createIndexJobModuleGate(fakeDb({ updateRows: [] }) as never).skip(job())).toBe(false)
    await expect(createIndexJobModuleGate(fakeDb({ updateError: { code: '42501' } }) as never).skip(job()))
      .rejects.toThrow('INDEX_JOB_SKIP_FAILED')
  })

  it('백필 변경은 프로젝트마다 한 번 판정하고 켜진 것만 남긴다', async () => {
    const state = vi.fn(async (reference: { projectId: string | null }) => reference.projectId === P ? 'on' as const : 'off' as const)
    const mutation = (projectId: string, entityId: string) => ({ operation: 'upsert' as const, projectId, domain: 'wbs' as const, entityType: 'wbs_item' as const, entityId })
    const kept = await keepEnabledMutations(gate(state), [mutation(P, 'a'), mutation('other', 'b'), mutation(P, 'c')])
    expect(kept.map((item) => item.entityId)).toEqual(['a', 'c'])
    expect(state).toHaveBeenCalledTimes(2)
  })

  it('프로젝트 없는 회의록 변경은 회의록마다 한 번씩 판정한다', async () => {
    const state = vi.fn(async () => 'on' as const)
    const mutation = (entityId: string) => ({ operation: 'delete' as const, projectId: null, domain: 'minutes' as const, entityType: 'minute' as const, entityId })
    expect(await keepEnabledMutations(gate(state), [mutation('m1'), mutation('m1'), mutation('m2')])).toHaveLength(3)
    expect(state).toHaveBeenCalledTimes(2)
  })
})

describe('워커 접근 스코프', () => {
  function scopeDb(options: { workspacesError?: unknown; projectsError?: unknown } = {}) {
    const queried: Array<[string, number]> = []
    const from = vi.fn((table: string) => {
      let workspaceId = ''
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = (_column: string, value: string) => { workspaceId = value; return builder }
      builder.limit = (count: number) => { queried.push([workspaceId, count]); return builder }
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(table === 'workspaces'
        ? { data: options.workspacesError ? null : [{ id: 'w1' }, { id: 'w2' }], error: options.workspacesError ?? null }
        : { data: options.projectsError ? null : workspaceId === 'w1' ? [{ id: 'p1' }, { id: 'p2' }] : [{ id: 'p3' }],
            error: options.projectsError ?? null }).then(resolve)
      return builder
    })
    return { from, queried }
  }

  it('꺼진 워크스페이스는 프로젝트를 읽지 않고 켜진 프로젝트만 스코프에 넣는다', async () => {
    const db = scopeDb()
    vi.mocked(workspacesWithModule).mockResolvedValueOnce(['w1'])
    vi.mocked(projectsWithModule).mockResolvedValueOnce(['p2'])
    expect(await enabledIndexProjectIds(db as never)).toEqual({ ok: true, ids: ['p2'] })
    expect(db.queried).toEqual([['w1', 100]])
    expect(workspacesWithModule).toHaveBeenCalledWith(['w1', 'w2'], 'chatbot', { client: db })
    expect(projectsWithModule).toHaveBeenCalledWith(['p1', 'p2'], 'chatbot', { client: db })
  })

  it('두 워크스페이스는 각각 100개 상한으로 읽는다', async () => {
    const db = scopeDb()
    expect(await enabledIndexProjectIds(db as never)).toEqual({ ok: true, ids: ['p1', 'p2', 'p3'] })
    expect(db.queried).toEqual([['w1', 100], ['w2', 100]])
  })

  it('워크스페이스 또는 프로젝트 조회 실패를 빈 스코프로 위장하지 않는다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await enabledIndexProjectIds(scopeDb({ workspacesError: { message: 'down' } }) as never)).toEqual({ ok: false })
    expect(await enabledIndexProjectIds(scopeDb({ projectsError: { message: 'down' } }) as never)).toEqual({ ok: false })
  })
})

describe('위키 잡', () => {
  beforeEach(() => { vi.stubEnv('WIKI_SERVICE_ENABLED', 'true') })
  it('wiki 모듈이 꺼지면 선점한 잡만 skipped 로 닫는다', async () => {
    const db = fakeDb()
    vi.mocked(moduleState).mockResolvedValueOnce('off')
    expect(await gateWikiJob(db as never, { table: 'wiki_processing_jobs', id: 11, projectId: P, lockedBy: 'worker-1' })).toBe('skipped')
    expect(db.updates[0]).toMatchObject({ table: 'wiki_processing_jobs', values: expect.objectContaining({ status: 'skipped', last_error: 'module_disabled' }) })
    expect(db.updates[0].filters).toEqual([['id', 11], ['status', 'running'], ['locked_by', 'worker-1']])
    expect(moduleState).toHaveBeenCalledWith({ projectId: P }, 'wiki', { client: db })
  })

  it('설정 판정 예외는 unknown 으로 돌려 재시도 경로를 사용한다', async () => {
    const db = fakeDb()
    vi.mocked(moduleState).mockRejectedValueOnce(new Error('down'))
    expect(await gateWikiJob(db as never, { table: 'wiki_processing_jobs', id: 11, projectId: P, lockedBy: 'worker-1' })).toBe('unknown')
    expect(db.updates).toHaveLength(0)
  })

  it('회의록 잡은 선점 직후 꺼진 모듈을 skipped 로 닫고 원본을 읽지 않는다', async () => {
    const db = fakeDb({ rpc: { claim_wiki_processing_job: { id: 11, project_id: P, minute_id: 'minute-1', locked_by: 'worker-1' } } })
    adminHolder.admin = db
    vi.mocked(moduleState).mockResolvedValueOnce('off')
    expect(await processMinuteWikiJob(11)).toBeNull()
    expect(db.updates[0].table).toBe('wiki_processing_jobs')
    expect(db.from).not.toHaveBeenCalledWith('minutes')
    expect(db.rpcCalls.map(([name]) => name)).toEqual(['claim_wiki_processing_job'])
  })

  it('회의록 잡의 설정을 모르면 CONFIG_UNAVAILABLE 로 실패 처리한다', async () => {
    const db = fakeDb({ rpc: { claim_wiki_processing_job: { id: 11, project_id: P, minute_id: 'minute-1', locked_by: 'worker-1', attempts: 1 } } })
    adminHolder.admin = db
    vi.mocked(moduleState).mockResolvedValueOnce('unknown')
    expect(await processMinuteWikiJob(11)).toBeNull()
    expect(db.rpcCalls).toContainEqual(['finish_wiki_processing_job', expect.objectContaining({
      p_succeeded: false, p_last_error: 'CONFIG_UNAVAILABLE',
    })])
    expect(db.updates).toHaveLength(0)
  })

  it('재구성 잡은 꺼진 모듈이면 skipped 로 닫고 회의록 잡을 선점하지 않는다', async () => {
    const db = fakeDb({ rpc: { claim_wiki_project_rebuild_step: { claimed_project_id: P, wiki_job_id: 11, finished: false } } })
    adminHolder.admin = db
    vi.mocked(moduleState).mockResolvedValueOnce('off')
    expect(await processWikiProjectRebuildStep()).toEqual({ attempted: true, completed: false, finished: false })
    expect(db.updates[0].table).toBe('wiki_project_rebuild_jobs')
    expect(db.rpcCalls.map(([name]) => name)).toEqual(['claim_wiki_project_rebuild_step'])
  })
})
