import { describe, it, expect, vi, beforeEach } from 'vitest'

// getChangeLogs 작성자 라벨 재료 — memberships(폐기) 대신 profiles + 그 항목 프로젝트의 활성 명단 행.
const state = vi.hoisted(() => ({ client: undefined as unknown }))
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), requireSuperuser: vi.fn(),
  resolveProjectId: vi.fn(), getActor: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession, getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => state.client) }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { getChangeLogs } from '@/app/actions/wbs'

type Result = { data: unknown; error: { message: string } | null }

function client(tables: Record<string, Result>) {
  const calls: Record<string, Array<[string, unknown[]]>> = {}
  const from = vi.fn((table: string) => {
    const log = (calls[table] ??= [])
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      q[m] = vi.fn((...args: unknown[]) => { log.push([m, args]); return q })
    }
    const res = tables[table] ?? { data: null, error: { message: `unexpected table ${table}` } }
    q.maybeSingle = vi.fn(async () => res)
    q.then = (resolve: (v: Result) => unknown, reject: (r: unknown) => unknown) => Promise.resolve(res).then(resolve, reject)
    return q
  })
  state.client = { from }
  return { from, calls }
}

const LOGS: Result = {
  data: [
    { id: 3, field: 'actual_pct', old_value: '10', new_value: '30', at: '2026-09-24T03:00:00Z', user_id: 'u-admin' },
    { id: 2, field: 'weight', old_value: '1', new_value: '2', at: '2026-09-24T02:00:00Z', user_id: 'u-viewer' },
    { id: 1, field: 'weight', old_value: '0', new_value: '1', at: '2026-09-24T01:00:00Z', user_id: 'u-gone' },
  ],
  error: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 'me' })
})

describe('getChangeLogs — 작성자 팀·역할', () => {
  it('명단 행이 있으면 대표 팀·access_role, 계정만 있으면 viewer, 모르는 계정은 null', async () => {
    const { from, calls } = client({
      change_logs: LOGS,
      profiles: { data: [{ user_id: 'u-admin', display_name: '앨리스' }, { user_id: 'u-viewer', display_name: '밥' }], error: null },
      wbs_items: { data: { project_id: 'p1' }, error: null },
      project_members: {
        data: [{
          access_role: 'admin',
          people: { user_id: 'u-admin', active: true },
          project_member_teams: [
            { is_primary: false, teams: { code: 'QA' } },
            { is_primary: true, teams: { code: 'ERP' } },
          ],
        }],
        error: null,
      },
    })

    const entries = await getChangeLogs('item-1')

    expect(entries.map(e => [e.id, e.actorTeam, e.actorRole])).toEqual([
      [3, 'ERP', 'admin'],
      [2, null, 'viewer'],
      [1, null, null],
    ])
    expect(from.mock.calls.map(c => c[0])).not.toContain('memberships')
    // 명단 조회는 그 항목의 프로젝트·활성 행·활성 인물로 좁힌다(buildActor 의 역할 축과 같다).
    expect(calls.project_members).toEqual(expect.arrayContaining([
      ['eq', ['project_id', 'p1']],
      ['eq', ['active', true]],
      ['in', ['people.user_id', ['u-admin', 'u-viewer', 'u-gone']]],
      ['eq', ['people.active', true]],
    ]))
  })

  it('작성자 조회가 실패해도 이력은 보이고 라벨만 빈다(표시 전용 — 로깅)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    client({
      change_logs: LOGS,
      profiles: { data: null, error: { message: 'profiles down' } },
      wbs_items: { data: { project_id: 'p1' }, error: null },
      project_members: { data: null, error: { message: 'roster down' } },
    })

    const entries = await getChangeLogs('item-1')

    expect(entries).toHaveLength(3)
    expect(entries.every(e => e.actorTeam === null && e.actorRole === null)).toBe(true)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('작성자 계정'), 'profiles down')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('작성자 명단'), 'roster down')
    spy.mockRestore()
  })
})
