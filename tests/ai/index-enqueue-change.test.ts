// 증분 색인 등록 도우미(SP8 — 정본 §5.4.5). 쓰기 액션이 성공 뒤에 부른다: 배포에서 챗봇을 못 쓰면 아무것도 하지 않고,
// 켜진 범위의 변경만 등록 RPC 로 넣고, 어떤 실패도 던지지 않는다(업무 쓰기를 막지 않는다 — 로그는 남긴다).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  moduleState: vi.fn(),
  after: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/modules/gate', () => ({ moduleState: mocks.moduleState, projectsWithModule: vi.fn(), workspacesWithModule: vi.fn() }))

import {
  enqueueIndexChange, enqueueMinuteIndexChange, enqueueProjectIndexChange, enqueueTeamRenameIndexChange, enqueueWeeklyAreaIndexChange, enqueueWeeklyRowIndexChange,
  TEAM_RENAME_REINDEX_MAX,
} from '@/lib/ai/index/enqueueChange'

const P = '11111111-1111-4111-8111-111111111111'
const P2 = '22222222-2222-4222-8222-222222222222'
const W = '33333333-3333-4333-8333-333333333333'

type Rows = Record<string, Array<Record<string, unknown>>>
/** 표 읽기(select·eq·in·order·range·maybeSingle)와 등록 RPC 만 흉내 낸다 */
function admin(opts: { rows?: Rows; readError?: string; rpcError?: { code: string } | null; rpcThrows?: boolean } = {}) {
  const jobs: Array<Record<string, unknown>> = []
  const reads: string[] = []
  const from = vi.fn((table: string) => {
    reads.push(table)
    const filters: Array<(r: Record<string, unknown>) => boolean> = []
    const result = () => opts.readError
      ? { data: null, error: { message: opts.readError } }
      : { data: (opts.rows?.[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null }
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b },
      order: () => b,
      range: async () => result(),
      maybeSingle: async () => { const r = result(); return { data: r.data?.[0] ?? null, error: r.error } },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej),
    }
    return b
  })
  const rpc = vi.fn(async (name: string, args: { p_jobs: Array<Record<string, unknown>> }) => {
    if (opts.rpcThrows) throw new Error('network down')
    if (opts.rpcError) return { data: null, error: opts.rpcError }
    if (name === 'upsert_ai_index_jobs') jobs.push(...args.p_jobs)
    return { data: args.p_jobs.length, error: null }
  })
  return { from, rpc, jobs, reads }
}

let errors: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CHAT_V2_ENABLED', 'true')
  // 요청 범위 밖 — after 가 던지면 도우미가 그 자리에서 돈다
  mocks.after.mockImplementation(() => { throw new Error('outside request scope') })
  mocks.moduleState.mockResolvedValue('on')
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('enqueueIndexChange', () => {
  it('배포에서 챗봇을 쓸 수 없으면 아무것도 하지 않는다 — service_role 클라이언트도 만들지 않는다', async () => {
    vi.stubEnv('CHAT_V2_ENABLED', '')
    await enqueueIndexChange({ domain: 'wbs', projectId: P, entityId: 'w1' })
    await enqueueMinuteIndexChange('m1')
    await enqueueWeeklyRowIndexChange(P, ['r1'])
    await enqueueProjectIndexChange(P, 'wbs')
    await enqueueWeeklyAreaIndexChange(P, 'area-1')
    await enqueueTeamRenameIndexChange('team-1')
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
  })

  it('켜진 프로젝트의 변경을 등록 RPC 로 넣는다 — 식별자만, 본문은 싣지 않는다', async () => {
    const a = admin()
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueIndexChange([
      { domain: 'wbs', projectId: P, entityId: 'w1' },
      { domain: 'issues', projectId: P, entityId: 'i1', operation: 'delete' },
    ])
    expect(mocks.moduleState).toHaveBeenCalledWith({ projectId: P }, 'chatbot', { client: a })
    expect(a.rpc).toHaveBeenCalledOnce()
    expect(a.jobs).toEqual([
      { job_key: `v1:${P}:wbs:wbs_item:w1`, operation: 'upsert', project_id: P, domain: 'wbs', entity_type: 'wbs_item', entity_id: 'w1', payload: {}, run_after: null },
      { job_key: `v1:${P}:issues:issue:i1`, operation: 'delete', project_id: P, domain: 'issues', entity_type: 'issue', entity_id: 'i1', payload: {}, run_after: null },
    ])
  })

  it.each(['off', 'unknown'] as const)('모듈이 %s 인 프로젝트의 변경은 넣지 않는다(다른 프로젝트의 것은 넣는다)', async (state) => {
    const a = admin()
    mocks.createAdminClient.mockReturnValue(a)
    mocks.moduleState.mockImplementation(async (scope: { projectId?: string }) => (scope.projectId === P ? state : 'on'))
    await enqueueIndexChange([{ domain: 'wbs', projectId: P, entityId: 'w1' }, { domain: 'wbs', projectId: P2, entityId: 'w2' }])
    expect(a.jobs.map((j) => j.entity_id)).toEqual(['w2'])

    const none = admin()
    mocks.createAdminClient.mockReturnValue(none)
    await enqueueIndexChange({ domain: 'wbs', projectId: P, entityId: 'w1' })
    expect(none.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['RPC 가 오류를 돌려줘도', { rpcError: { code: '57014' } }],
    ['RPC 가 던져도', { rpcThrows: true }],
  ])('%s 던지지 않고 로그를 남긴다 — 사용자 쓰기를 실패시키지 않는다', async (_name, opts) => {
    mocks.createAdminClient.mockReturnValue(admin(opts))
    await expect(enqueueIndexChange({ domain: 'wbs', projectId: P, entityId: 'w1' })).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalled()
  })

  it('클라이언트를 만들지 못해도(env 누락) 던지지 않고 로그를 남긴다', async () => {
    mocks.createAdminClient.mockImplementation(() => { throw new Error('SERVICE_ROLE_MISSING') })
    await expect(enqueueIndexChange({ domain: 'wbs', projectId: P, entityId: 'w1' })).resolves.toBeUndefined()
    expect(errors).toHaveBeenCalled()
  })

  it('모듈 판정이 던지면 그 변경은 모름으로 보고 넣지 않는다', async () => {
    const a = admin()
    mocks.createAdminClient.mockReturnValue(a)
    mocks.moduleState.mockRejectedValue(new Error('config down'))
    await expect(enqueueIndexChange({ domain: 'wbs', projectId: P, entityId: 'w1' })).resolves.toBeUndefined()
    expect(a.rpc).not.toHaveBeenCalled()
  })

  it('요청 범위 안에서는 응답 뒤(after)로 미룬다 — 예약만 하고 돌아온다', async () => {
    const a = admin()
    mocks.createAdminClient.mockReturnValue(a)
    let deferred: (() => Promise<void>) | undefined
    mocks.after.mockImplementation((run: () => Promise<void>) => { deferred = run })
    await enqueueIndexChange({ domain: 'announcements', projectId: P, entityId: 'a1' })
    expect(a.rpc).not.toHaveBeenCalled()
    await deferred!()
    expect(a.jobs.map((j) => j.entity_id)).toEqual(['a1'])
  })

  it('빈 id 는 버리고, 넣을 것이 없으면 아무것도 하지 않는다', async () => {
    await enqueueIndexChange([{ domain: 'wbs', projectId: P, entityId: '' }])
    await enqueueIndexChange([])
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('프로젝트를 주지 않은 변경은 원본 행에서 범위를 읽는다 — 행이 없으면 넣지 않는다', async () => {
    const a = admin({ rows: { issues: [{ id: 'i1', project_id: P }] } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueIndexChange([{ domain: 'issues', entityId: 'i1' }, { domain: 'issues', entityId: 'gone' }])
    expect(a.jobs).toEqual([expect.objectContaining({ project_id: P, entity_id: 'i1' })])
  })

  it('범위 조회가 실패하면 넣지 않고 로그를 남긴다(없는 범위를 짐작하지 않는다)', async () => {
    const a = admin({ readError: 'read down' })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueIndexChange({ domain: 'issues', entityId: 'i1' })
    expect(a.rpc).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
  })
})

describe('회의록·주간 행·프로젝트 전체', () => {
  it('회의록의 범위는 회의록의 프로젝트, 없으면 연결된 회의의 프로젝트다(색인 로더와 같은 규칙)', async () => {
    const a = admin({ rows: { minutes: [
      { id: 'm1', project_id: P, workspace_id: W, meetings: null },
      { id: 'm2', project_id: null, workspace_id: W, meetings: { project_id: P2 } },
    ] } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueMinuteIndexChange('m1')
    await enqueueMinuteIndexChange('m2')
    expect(a.jobs.map((j) => [j.entity_id, j.project_id, j.job_key])).toEqual([
      ['m1', P, `v1:${P}:minutes:minute:m1`], ['m2', P2, `v1:${P2}:minutes:minute:m2`],
    ])
  })

  it('프로젝트 없는 회의록은 워크스페이스를 실어 넣는다 — 없으면 등록 RPC 가 거부한다(0038)', async () => {
    const a = admin({ rows: { minutes: [{ id: 'm3', project_id: null, workspace_id: W, meetings: null }] } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueMinuteIndexChange('m3')
    expect(mocks.moduleState).toHaveBeenCalledWith({ workspaceId: W }, 'chatbot', { client: a })
    expect(a.jobs).toEqual([expect.objectContaining({ project_id: null, workspace_id: W, job_key: 'v1:global:minutes:minute:m3', domain: 'minutes' })])
  })

  it('주간 행 변경은 그 행의 주간 문서를 넣는다(행마다가 아니라 문서마다 한 번)', async () => {
    const a = admin({ rows: { weekly_report_rows: [
      { id: 'r1', project_id: P, report_id: 'rep1' }, { id: 'r2', project_id: P, report_id: 'rep1' }, { id: 'r3', project_id: P2, report_id: 'other' },
    ] } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueWeeklyRowIndexChange(P, ['r1', 'r2', 'r3'])
    expect(a.jobs.map((j) => [j.domain, j.entity_type, j.entity_id])).toEqual([['weekly', 'weekly_report', 'rep1']])
  })

  it('주간 영역 개명 — 그 영역의 행이 든 주간 문서만, 문서당 한 번 넣는다(다른 영역·다른 프로젝트의 문서는 넣지 않는다)', async () => {
    const a = admin({ rows: { weekly_report_rows: [
      { id: 'r1', project_id: P, area_id: 'area-1', report_id: 'rep1' }, { id: 'r2', project_id: P, area_id: 'area-1', report_id: 'rep2' },
      { id: 'r3', project_id: P, area_id: 'area-1', report_id: 'rep1' }, { id: 'r4', project_id: P, area_id: 'area-2', report_id: 'rep3' },
      { id: 'r5', project_id: P2, area_id: 'area-1', report_id: 'other' },
    ] } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueWeeklyAreaIndexChange(P, 'area-1')
    expect(a.jobs.map((j) => [j.domain, j.entity_type, j.entity_id, j.operation])).toEqual([
      ['weekly', 'weekly_report', 'rep1', 'upsert'], ['weekly', 'weekly_report', 'rep2', 'upsert'],
    ])
  })

  it('주간 영역 개명 — 행 조회가 실패해도 던지지 않고 로그만 남긴다', async () => {
    const a = admin({ readError: 'down' })
    mocks.createAdminClient.mockReturnValue(a)
    await expect(enqueueWeeklyAreaIndexChange(P, 'area-1')).resolves.toBeUndefined()
    expect(a.rpc).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
  })

  it('팀 개명 — 그 팀이 담당인 WBS 항목(항목당 한 번)과 그 팀의 회의록을 넣는다. 범위는 원본 행에서 읽는다(공용 팀은 여러 프로젝트에 걸린다)', async () => {
    const a = admin({ rows: {
      item_owners: [
        { wbs_item_id: 'w1', team_id: 'team-1', kind: 'primary' }, { wbs_item_id: 'w1', team_id: 'team-1', kind: 'support' },
        { wbs_item_id: 'w2', team_id: 'team-1', kind: 'support' }, { wbs_item_id: 'w3', team_id: 'team-2', kind: 'primary' },
      ],
      wbs_items: [{ id: 'w1', project_id: P }, { id: 'w2', project_id: P2 }, { id: 'w3', project_id: P }],
      minutes: [
        { id: 'm1', team_id: 'team-1', project_id: P, workspace_id: W, meetings: null },
        { id: 'm2', team_id: 'team-2', project_id: P, workspace_id: W, meetings: null },
      ],
    } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueTeamRenameIndexChange('team-1')
    expect(a.jobs.map((j) => [j.domain, j.entity_type, j.entity_id, j.project_id, j.operation])).toEqual([
      ['wbs', 'wbs_item', 'w1', P, 'upsert'], ['wbs', 'wbs_item', 'w2', P2, 'upsert'], ['minutes', 'minute', 'm1', P, 'upsert'],
    ])
  })

  it('팀 개명 — 상한(도메인마다)까지만 넣고 넘으면 경고를 남긴다. 한 도메인의 조회가 실패해도 다른 도메인은 넣고, 던지지 않는다', async () => {
    const many = Array.from({ length: TEAM_RENAME_REINDEX_MAX + 1000 }, (_, i) => ({ wbs_item_id: `w${i}`, team_id: 'team-1' }))
    const a = admin({ rows: { item_owners: many, wbs_items: many.map((r) => ({ id: r.wbs_item_id, project_id: P })), minutes: [] } })
    // 이 모의의 range 는 쪽을 자르지 않는다 — 쪽 크기만큼씩 돌려주게 덮는다
    const from = a.from
    a.from = vi.fn((table: string) => {
      const b = from(table) as Record<string, unknown>
      if (table !== 'item_owners') return b
      return { ...b, select: () => ({ eq: () => ({ order: () => ({ range: async (lo: number, hi: number) => ({ data: many.slice(lo, hi + 1), error: null }) }) }) }) }
    }) as typeof a.from
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueTeamRenameIndexChange('team-1')
    expect(a.jobs.filter((j) => j.domain === 'wbs')).toHaveLength(TEAM_RENAME_REINDEX_MAX)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('상한'))).toBe(true)

    const failing = admin({ readError: 'down' })
    mocks.createAdminClient.mockReturnValue(failing)
    await expect(enqueueTeamRenameIndexChange('team-1')).resolves.toBeUndefined()
    expect(failing.rpc).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
  })

  it('프로젝트 전체 — 그 프로젝트의 원본 id 를 전부 넣는다', async () => {
    const a = admin({ rows: { wbs_items: [{ id: 'w1', project_id: P }, { id: 'w2', project_id: P }, { id: 'x', project_id: P2 }] } })
    mocks.createAdminClient.mockReturnValue(a)
    await enqueueProjectIndexChange(P, 'wbs')
    expect(a.jobs.map((j) => j.entity_id)).toEqual(['w1', 'w2'])
  })
})
