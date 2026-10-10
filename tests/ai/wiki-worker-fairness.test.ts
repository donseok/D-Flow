// 위키 워커의 워크스페이스 공정성(SP8 — 정본 §3.2.7·§5.4.4). 전역 큐를 run_after 순으로만 소비하면 큐가 깊은 워크스페이스 하나가
// 매 실행을 독차지한다. 워커는 후보를 워크스페이스끼리 번갈아 집고, 한 프로젝트의 실패가 다른 워크스페이스의 차례를 막지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))

import { interleaveByWorkspace, workspaceOfEmbed } from '@/lib/ai/wiki-fairness'
import { runWikiWorkerOnce } from '@/lib/ai/wiki-ingest'

describe('interleaveByWorkspace', () => {
  const c = (id: number, workspaceId: string | null) => ({ id, workspaceId })
  it('워크스페이스끼리 번갈아 세운다 — 안의 순서와 처음 나온 순서는 그대로', () => {
    const out = interleaveByWorkspace([c(1, 'A'), c(2, 'A'), c(3, 'A'), c(4, 'B'), c(5, 'C'), c(6, 'B')])
    expect(out.map((x) => x.id)).toEqual([1, 4, 5, 2, 6, 3])
  })
  it('한 워크스페이스뿐이면 순서가 그대로다. 빈 목록은 빈 목록', () => {
    expect(interleaveByWorkspace([c(1, 'A'), c(2, 'A')]).map((x) => x.id)).toEqual([1, 2])
    expect(interleaveByWorkspace([])).toEqual([])
  })
  it('워크스페이스를 모르는 후보는 한 묶음으로 본다(버리지 않는다)', () => {
    expect(interleaveByWorkspace([c(1, null), c(2, null), c(3, 'A')]).map((x) => x.id)).toEqual([1, 3, 2])
  })
  it('임베드 행에서 워크스페이스를 꺼낸다 — 객체·배열 둘 다, 형이 어긋나면 null', () => {
    expect(workspaceOfEmbed({ workspace_id: 'A' })).toBe('A')
    expect(workspaceOfEmbed([{ workspace_id: 'B' }])).toBe('B')
    expect(workspaceOfEmbed(null)).toBeNull()
    expect(workspaceOfEmbed({ workspace_id: 7 })).toBeNull()
  })
})

type Row = Record<string, unknown>
/**
 * 워커가 쓰는 표 셋과 RPC 를 흉내 낸다. 재구성 claim 은 steps[project] 의 다음 결과를, 회의록 claim 은 항상 null(선점 못 함)을 돌려준다 —
 * 여기서 보는 것은 "누구 차례인가"(RPC 인자 순서)뿐이다.
 */
function admin(opts: {
  rebuild?: Row[] | { error: { code: string } }
  pending?: (excluded: string[]) => Row[] | { error: { code: string } }
  steps?: Record<string, Array<'finished' | 'throw' | null>>
  /** 보관된 워크스페이스(0056) — workspaces 조회의 응답. 'error' 면 그 조회가 실패한다 */
  archived?: string[] | 'error'
}) {
  const rebuildClaims: Array<string | null> = []
  const minuteClaims: number[] = []
  const pendingQueries: string[][] = []
  const rebuildQueries: string[][] = []
  const from = vi.fn((table: string) => {
    let excluded: string[] = []
    const result = () => {
      if (table === 'workspaces') {
        if (opts.archived === 'error') return { data: null, error: { message: 'workspaces down' }, count: null }
        const ids = opts.archived ?? []
        return { data: ids.map((id) => ({ id })), error: null, count: ids.length }
      }
      if (table === 'wiki_project_rebuild_jobs') rebuildQueries.push(excluded)
      if (table === 'wiki_project_rebuild_jobs') return Array.isArray(opts.rebuild) ? { data: opts.rebuild, error: null } : { data: null, error: opts.rebuild?.error ?? null }
      if (table === 'wiki_processing_jobs' && pending) {
        pendingQueries.push(excluded)
        const rows = opts.pending?.(excluded) ?? []
        return Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: rows.error }
      }
      return { data: [], error: null }
    }
    let pending = false
    const b: Record<string, unknown> = {
      select: () => b, in: () => b, lt: () => b, lte: () => b, order: () => b,
      eq: (column: string, value: unknown) => { if (column === 'status' && value === 'pending') pending = true; return b },
      // 제외 목록('(a,b)')만 기록한다 — workspaces 조회의 not('archived_at', 'is', null) 은 값이 문자열이 아니다
      not: (_c: string, _op: string, value: string | null) => { if (typeof value === 'string') excluded = value.replace(/[()]/g, '').split(',').filter(Boolean); return b },
      limit: () => b, range: () => b,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    }
    return b
  })
  const rpc = vi.fn((name: string, args: Row) => {
    let data: unknown = null
    let error: { code: string; message: string } | null = null
    if (name === 'claim_wiki_project_rebuild_step') {
      const project = (args.p_project_id as string | null) ?? null
      rebuildClaims.push(project)
      const step = opts.steps?.[project ?? '*']?.shift() ?? null
      if (step === 'throw') error = { code: 'XX000', message: 'boom' }
      else if (step === 'finished') data = { claimed_project_id: project, wiki_job_id: null, finished: true }
    }
    if (name === 'claim_wiki_processing_job') minuteClaims.push(args.p_job_id as number)
    const result = { data, error }
    return { maybeSingle: async () => result, single: async () => result }
  })
  return { from, rpc, rebuildClaims, minuteClaims, pendingQueries, rebuildQueries }
}

const job = (id: number, workspace_id: string) => ({ id, projects: { workspace_id } })
const rebuild = (project_id: string, workspace_id: string) => ({ project_id, projects: { workspace_id } })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('WIKI_SERVICE_ENABLED', 'true')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('runWikiWorkerOnce — 워크스페이스 번갈아 돌기', () => {
  it('대기 잡: 앞을 다 차지한 워크스페이스가 있어도 다른 워크스페이스의 잡이 같은 실행에서 차례를 받는다', async () => {
    const a = admin({ pending: () => [job(1, 'A'), job(2, 'A'), job(3, 'A'), job(4, 'A'), job(5, 'B'), job(6, 'C')] })
    mocks.createAdminClient.mockReturnValue(a)
    expect(await runWikiWorkerOnce(4)).toEqual({ attempted: 4, completed: 0 })
    expect(a.minuteClaims).toEqual([1, 5, 6, 2])        // run_after 순(옛 동작)이면 1·2·3·4 — B·C 는 밀린다
  })

  it('대기 잡: 한 창이 한 워크스페이스로 가득 차면 그 워크스페이스를 빼고 다시 읽는다(큐가 깊어도 뒤가 보인다)', async () => {
    const deepA = Array.from({ length: 100 }, (_, i) => job(i + 1, 'A'))
    const a = admin({ pending: (excluded) => (excluded.includes('A') ? [job(500, 'B')] : deepA) })
    mocks.createAdminClient.mockReturnValue(a)
    expect(await runWikiWorkerOnce(3)).toEqual({ attempted: 3, completed: 0 })
    expect(a.pendingQueries).toEqual([[], ['A']])
    expect(a.minuteClaims).toEqual([1, 500, 2])
  })

  it('대기 잡 조회 실패는 던진다 — "잡 없음"으로 읽지 않는다', async () => {
    mocks.createAdminClient.mockReturnValue(admin({ pending: () => ({ error: { code: '57014' } }) }))
    await expect(runWikiWorkerOnce(3)).rejects.toThrow('JOB_LIST:57014')
  })

  it('재구성: 프로젝트를 워크스페이스끼리 번갈아 한 단계씩 돌린다', async () => {
    const a = admin({
      rebuild: [rebuild('pA1', 'A'), rebuild('pA2', 'A'), rebuild('pB1', 'B')],
      steps: { pA1: ['finished'], pA2: ['finished'], pB1: ['finished'] },
    })
    mocks.createAdminClient.mockReturnValue(a)
    expect(await runWikiWorkerOnce(2)).toEqual({ attempted: 2, completed: 2 })
    expect(a.rebuildClaims).toEqual(['pA1', 'pB1'])     // 몫이 둘뿐이어도 B 가 차례를 받는다(옛 동작은 RPC 가 고른 순서대로)
  })

  it('재구성: 한 프로젝트의 단계가 던져도 다른 워크스페이스는 돈다 — 오류는 끝에서 다시 던진다(실패를 감추지 않는다)', async () => {
    const a = admin({
      rebuild: [rebuild('pA1', 'A'), rebuild('pB1', 'B')],
      steps: { pA1: ['throw'], pB1: ['finished'] },
      pending: () => [job(9, 'C')],
    })
    mocks.createAdminClient.mockReturnValue(a)
    await expect(runWikiWorkerOnce(5)).rejects.toThrow('PROJECT_REBUILD_CLAIM:XX000')
    expect(a.rebuildClaims).toEqual(['pA1', 'pB1'])
    expect(a.minuteClaims).toEqual([9])                 // 뒤의 회의록 잡까지 돌고 나서 던진다
  })

  // 워크스페이스 보관(0056) — 선점 RPC 가 보관된 워크스페이스의 잡을 집지 않는다(행은 그대로 — 복원하면 이어진다). 워커는 후보에서도 빼서
  // 집히지 않을 잡이 이번 실행의 몫과 후보 창을 차지하지 않게 한다.
  it('보관된 워크스페이스의 잡은 후보에서 뺀다 — 대기 잡·재구성 둘 다, 첫 조회부터', async () => {
    const a = admin({
      archived: ['X'],
      rebuild: [rebuild('pA1', 'A')], steps: { pA1: ['finished'] },
      pending: (excluded) => (excluded.includes('X') ? [job(1, 'A'), job(2, 'B')] : [job(90, 'X'), job(91, 'X'), job(1, 'A'), job(2, 'B')]),
    })
    mocks.createAdminClient.mockReturnValue(a)
    expect(await runWikiWorkerOnce(3)).toEqual({ attempted: 3, completed: 1 })
    expect(a.rebuildQueries).toEqual([['X']])
    expect(a.pendingQueries[0]).toEqual(['X'])
    expect(a.minuteClaims).toEqual([1, 2])              // 보관된 워크스페이스의 잡(90·91)은 선점을 시도하지도 않는다 — 몫을 쓰지 않았다
  })

  it('보관된 워크스페이스가 없으면 후보 조회에 제외 조건을 붙이지 않는다', async () => {
    const a = admin({ archived: [], rebuild: [], pending: () => [job(1, 'A')] })
    mocks.createAdminClient.mockReturnValue(a)
    await runWikiWorkerOnce(2)
    expect(a.rebuildQueries).toEqual([[]])
    expect(a.pendingQueries).toEqual([[]])
  })

  it('보관된 워크스페이스 목록을 못 읽어도 워커는 돈다 — 후보에서 빼지 못했을 뿐이고(로그), 집지 않는 것은 선점 RPC 가 지킨다', async () => {
    const a = admin({ archived: 'error', pending: () => [job(90, 'X'), job(1, 'A')] })
    mocks.createAdminClient.mockReturnValue(a)
    expect(await runWikiWorkerOnce(2)).toEqual({ attempted: 2, completed: 0 })
    expect(a.pendingQueries).toEqual([[]])
    expect(a.minuteClaims).toEqual([90, 1])             // RPC 가 90 을 돌려주지 않는다(tests/rls/workspace-archive.test.ts 가 고정)
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).includes('보관된 워크스페이스 조회 실패'))).toBe(true)
  })

  it('재구성 후보를 읽지 못하면 옛 전역 선점으로 돈다(처리는 멈추지 않는다)', async () => {
    const a = admin({ rebuild: { error: { code: 'PGRST200' } }, steps: { '*': ['finished'] } })
    mocks.createAdminClient.mockReturnValue(a)
    expect(await runWikiWorkerOnce(3)).toEqual({ attempted: 1, completed: 1 })
    expect(a.rebuildClaims).toEqual([null, null])
  })
})
