import { describe, expect, it, vi, beforeEach } from 'vitest'

type QueryResponse = { data: unknown; error: unknown; count?: number | null }

const responses: Record<string, QueryResponse> = {}

function queryBuilder(response: QueryResponse) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'range', 'limit', 'gt', 'or', 'maybeSingle']) {
    builder[method] = vi.fn(() => builder)
  }
  for (const method of ['insert', 'upsert', 'update', 'delete']) {
    builder[method] = vi.fn(() => { throw new Error(`write attempted: ${method}`) })
  }
  const count = response.count !== undefined ? response.count : Array.isArray(response.data) ? response.data.length : null
  builder.then = (
    resolve: (value: QueryResponse) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise.resolve({ ...response, count }).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: (table: string) => queryBuilder(responses[table] ?? { data: [], error: null }),
  }),
}))
vi.mock('@/lib/teams/source', () => ({ projectTeams: async () => [] }))
// 휴일·달력은 설정 해석기가 싣는다(SP5 A 과제 13) — 이 파일은 의존성 병합만 본다
const cfgMock = vi.hoisted(() => ({ getProjectConfig: vi.fn() }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: cfgMock.getProjectConfig }))
// React cache() 는 같은 인자로 두 번째 호출을 재사용한다 — 케이스마다 projectId 를 달리해 피한다.
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return { ...actual, cache: <T,>(fn: T) => fn }
})

import { getComputedWbs } from '@/lib/data/wbs'
import { makeProjectConfig } from '../helpers/projectConfigFixture'

function item(over: Record<string, unknown>) {
  return {
    id: 'x', project_id: 'p1', parent_id: null, code: 'A', sort_order: 1, name: '작업',
    biz: null, deliverable: null, planned_start: null, planned_end: null,
    weight: null, actual_pct: 0, is_owner_split: false,
    external_ref: null, depends: null, stage: null,
    ...over,
  }
}

describe('getComputedWbs — 의존성 두 축 병합', () => {
  beforeEach(() => {
    for (const k of Object.keys(responses)) delete responses[k]
    cfgMock.getProjectConfig.mockResolvedValue(makeProjectConfig())
    responses.item_owners = { data: [], error: null }
    responses.projects = { data: { base_date: '2026-08-28' }, error: null }
    responses.task_dependencies = { data: [], error: null }
  })

  it('depends 를 합성 의존성으로 올리고 stage 를 항목에 실어 보낸다', async () => {
    // stage 가 빠지면 spec 선행이 전부 '대기'로 굳는다 — 조용히 틀리는 자리라 읽기 경로에서 고정한다.
    responses.wbs_items = {
      data: [
        item({ id: 'i1', code: 'A', external_ref: 'mes/T1', stage: 'im' }),
        item({ id: 'i2', code: 'B', external_ref: 'mes/T2', depends: ['mes/T1'] }),
      ],
      error: null,
    }

    const { items, dependencies, unresolvedDepends } = await getComputedWbs('p1')

    expect(dependencies).toEqual([
      { id: 'spec:i1>i2', projectId: 'p1', predecessorId: 'i1', successorId: 'i2', type: 'FS', lagDays: 0, origin: 'spec' },
    ])
    expect(items.find(i => i.id === 'i1')?.stage).toBe('im')
    expect(unresolvedDepends).toEqual({})
  })

  it('해석 못 한 ref 는 평범한 객체로 실어 보낸다 — Map 은 RSC 경계를 못 넘는다', async () => {
    responses.wbs_items = {
      data: [item({ id: 'i2', code: 'B', external_ref: 'mes/T2', depends: ['mes/GONE'] })],
      error: null,
    }

    const { dependencies, unresolvedDepends } = await getComputedWbs('p2')

    expect(dependencies).toEqual([])
    expect(unresolvedDepends).toEqual({ i2: ['mes/GONE'] })
    expect(unresolvedDepends instanceof Map).toBe(false)
  })

  it('task_dependencies 실제 행에는 origin=manual 을 단다', async () => {
    responses.wbs_items = {
      data: [item({ id: 'i1', code: 'A' }), item({ id: 'i2', code: 'B' })],
      error: null,
    }
    responses.task_dependencies = {
      data: [{
        id: 'd1', project_id: 'p3', predecessor_id: 'i1', successor_id: 'i2',
        dependency_type: 'SS', lag_days: 2,
      }],
      error: null,
    }

    const { dependencies } = await getComputedWbs('p3')

    expect(dependencies).toEqual([
      { id: 'd1', projectId: 'p3', predecessorId: 'i1', successorId: 'i2', type: 'SS', lagDays: 2, origin: 'manual' },
    ])
  })

  it('task_dependencies 조회 실패는 "의존성 없음"으로 위장하지 않고 던진다', async () => {
    responses.wbs_items = { data: [], error: null }
    responses.task_dependencies = { data: null, error: { message: 'boom' } }

    await expect(getComputedWbs('p4')).rejects.toThrow('task_dependencies 조회 실패')
  })

  it('담당은 { team, kind }[] 이고 주관이 먼저다 — 끝까지 읽기로 바꿔도 WbsRow.owners 계약은 그대로(스펙 §4.8)', async () => {
    responses.wbs_items = { data: [item({ id: 'i1', code: 'A' })], error: null }
    responses.item_owners = {
      data: [
        { wbs_item_id: 'i1', team_id: 't-ops', kind: 'support', teams: { code: 'OPS' }, wbs_items: { project_id: 'p5' } },
        { wbs_item_id: 'i1', team_id: 't-res', kind: 'primary', teams: { code: 'RES' }, wbs_items: { project_id: 'p5' } },
      ],
      error: null,
    }

    const { items } = await getComputedWbs('p5')

    expect(items.find(i => i.id === 'i1')?.owners).toEqual([{ team: 'RES', kind: 'primary' }, { team: 'OPS', kind: 'support' }])
  })
})
