// 색인 큐 어댑터가 잡 행의 워크스페이스를 다룬다(SP8 — 0036·0038): 선점한 잡에 workspace_id 를 싣고(관문이 프로젝트 없는 잡을 그 워크스페이스로
// 판정한다), 프로젝트 없는 변경은 workspace_id 를 실어 등록한다. 워크스페이스끼리의 공정 분배는 선점 SQL 의 몫이다(RLS 테스트).
import { describe, expect, it, vi } from 'vitest'
import { createSupabaseIndexJobQueue } from '@/lib/ai/index/pgvector'

const NOW = new Date('2026-10-09T03:00:00.000Z')

describe('큐 어댑터 — 잡 행의 워크스페이스 열', () => {
  type Call = { table: string; values: Record<string, unknown>; filters: Array<[string, string, unknown]> }
  function client(opts: { rpcData?: unknown; updateError?: { code: string } | null; rows?: unknown[] } = {}) {
    const calls: Call[] = []
    const from = vi.fn((table: string) => {
      const call: Call = { table, values: {}, filters: [] }
      const result = () => Promise.resolve({ data: opts.rows ?? [{ id: 1 }, { id: 2 }], error: opts.updateError ?? null })
      const b: Record<string, unknown> = {
        update: (values: Record<string, unknown>) => { call.values = values; calls.push(call); return b },
        in: (c: string, v: unknown) => { call.filters.push(['in', c, v]); return b },
        eq: (c: string, v: unknown) => { call.filters.push(['eq', c, v]); return b },
        lte: (c: string, v: unknown) => { call.filters.push(['lte', c, v]); return b },
        select: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => result().then(res, rej),
      }
      return b
    })
    const rpc = vi.fn(async () => ({ data: opts.rpcData ?? null, error: null }))
    return { from, rpc, calls }
  }
  const W1 = '11111111-1111-4111-8111-111111111111'

  it('claim 은 잡 행의 workspace_id 를 싣는다 — 없으면 null', async () => {
    const row = {
      id: 1, job_key: 'k', operation: 'upsert', project_id: 'p1', workspace_id: W1, domain: 'wbs', entity_type: 'wbs_item', entity_id: 'w1',
      payload: {}, status: 'running', attempts: 0, run_after: NOW.toISOString(), locked_at: NOW.toISOString(), last_error: null,
      created_at: NOW.toISOString(), updated_at: NOW.toISOString(), generation: 0,
    }
    const { workspace_id: _omit, ...legacy } = row
    void _omit
    const queue = createSupabaseIndexJobQueue(client({ rpcData: [row, { ...legacy, id: 2 }] }) as never, { allowedProjectIds: ['p1'] })
    const claimed = await queue.claim(10, 300)
    expect(claimed.ok && claimed.data.map((j) => j.workspaceId)).toEqual([W1, null])
  })

  it('enqueue 는 워크스페이스를 준 변경에만 workspace_id 를 싣는다 — 프로젝트 없는 변경이 등록되려면 필요하다(0038)', async () => {
    const c = client({ rpcData: 2 })
    const queue = createSupabaseIndexJobQueue(c as never, { allowedProjectIds: ['p1'], allowGlobal: true })
    await queue.enqueue([
      { operation: 'upsert', projectId: 'p1', domain: 'wbs', entityType: 'wbs_item', entityId: 'w1' },
      { operation: 'upsert', projectId: null, workspaceId: W1, domain: 'minutes', entityType: 'minute', entityId: 'm1' },
    ])
    const rows = (c.rpc.mock.calls[0] as unknown as [string, { p_jobs: Array<Record<string, unknown>> }])[1].p_jobs
    expect('workspace_id' in rows[0]).toBe(false)
    expect(rows[1]).toMatchObject({ project_id: null, workspace_id: W1, domain: 'minutes' })
  })
})
