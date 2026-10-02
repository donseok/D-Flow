import { describe, it, expect, vi, beforeEach } from 'vitest'

// addSubAct·addWbsItem 의 SUB-ACT 판별 가드(플래그 기반, Task 9)만 검증한다.
// wbs_items/teams/item_owners/change_logs 를 필터 매칭 인메모리 테이블로 모의한다
// (tests/actions/teams-actions.test.ts 의 체이너블 패턴을 select().eq().single()/
// 미종결 await/insert().select().single() 까지 지원하도록 확장).
const { db, resetDb, createServerClient, requireProjectAdmin, resolveProjectId } = vi.hoisted(() => {
  type TableName = 'wbs_items' | 'teams' | 'item_owners' | 'change_logs'
  const tables: Record<TableName, Array<Record<string, unknown>>> = {
    wbs_items: [], teams: [], item_owners: [], change_logs: [],
  }
  const db = {
    tables,
    get wbs_items() { return tables.wbs_items },
    set wbs_items(v: Array<Record<string, unknown>>) { tables.wbs_items = v },
    get teams() { return tables.teams },
    set teams(v: Array<Record<string, unknown>>) { tables.teams = v },
    inserted: {
      wbs_items: [], item_owners: [], change_logs: [],
    } as Partial<Record<TableName, Array<Record<string, unknown>>>>,
    nextId: 1,
    fromCalls: [] as string[],
  }
  const resetDb = () => {
    tables.wbs_items = []
    tables.teams = []
    tables.item_owners = []
    tables.change_logs = []
    db.inserted.wbs_items = []
    db.inserted.item_owners = []
    db.inserted.change_logs = []
    db.nextId = 1
    db.fromCalls = []
  }

  /** 체이너블 최소 모의 — select/eq/in/is/limit 는 자기 자신, single/maybeSingle 은 필터 매칭 결과.
   *  종결 메서드 없이 바로 await 되는 조회(예: 형제 목록)를 위해 체인 자체도 thenable 이다. */
  function table(name: TableName) {
    const rows = () => tables[name]
    const filters: Array<[string, unknown, 'eq' | 'in']> = []
    let limitN: number | null = null
    const matches = (r: Record<string, unknown>) =>
      filters.every(([c, v, op]) =>
        op === 'in' ? (v as unknown[]).includes(r[c]) : (r[c] ?? null) === v,
      )
    const selected = () => {
      const found = rows().filter(matches)
      return limitN != null ? found.slice(0, limitN) : found
    }
    const q: Record<string, unknown> = {}
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q }
    Object.assign(q, {
      select: chain(),
      eq: chain((c, v) => filters.push([String(c), v, 'eq'])),
      is: chain((c, v) => filters.push([String(c), v, 'eq'])),
      in: chain((c, v) => filters.push([String(c), v, 'in'])),
      // or 는 이 모의의 AND-필터 엔진으로 표현하지 않는다 — 테스트 데이터가 code 당 1행이라
      // eq('code', ...) 만으로 이미 유일하게 걸린다(스코프 우선순위는 addSubAct 쪽 find 가 담당).
      or: chain(),
      limit: chain((n) => { limitN = n as number }),
      order: chain(),
      single: async () => {
        const found = selected()
        return found.length
          ? { data: found[0], error: null }
          : { data: null, error: { code: 'PGRST116', message: '0행' } }
      },
      maybeSingle: async () => {
        const found = selected()
        return { data: found[0] ?? null, error: null }
      },
      insert: (row: Record<string, unknown>) => {
        const withId = { id: `gen-${db.nextId++}`, ...row }
        rows().push(withId)
        db.inserted[name]?.push(withId)
        return {
          select: chain(() => ({})),
          single: async () => ({ data: withId, error: null }),
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (c: string, v: unknown) => {
          const target = rows().filter(r => r[c] === v)
          target.forEach(r => Object.assign(r, patch))
          return {
            select: async () => ({ data: target.map(r => ({ id: r.id })), error: null }),
            then: (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: target, error: null }).then(resolve),
          }
        },
      }),
      delete: () => ({
        eq: async (c: string, v: unknown) => {
          const idx = rows().findIndex(r => r[c] === v)
          if (idx >= 0) rows().splice(idx, 1)
          return { error: null }
        },
      }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve({ data: selected(), error: null }).then(resolve, reject),
    })
    return q
  }

  const createServerClient = vi.fn(async () => ({
    from: (n: TableName) => { db.fromCalls.push(n); return table(n) },
  }))
  const requireProjectAdmin = vi.fn()
  const resolveProjectId = vi.fn()
  return { db, resetDb, createServerClient, requireProjectAdmin, resolveProjectId }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// after() 는 요청 스코프 밖에서 throw — 콜백을 실행하지 않는 원본 대체는 authz-gate-wbs.test.ts 관례.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})
vi.mock('@/lib/authz', () => ({ requireProjectAdmin, resolveProjectId }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
// 담당 팀의 원천 — 이 프로젝트에서 고를 수 있는 팀(projectTeams, A2 최종 리뷰 보안 P3 — FF1). 케이스마다 값을 건다
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock([]))

import { addSubAct, addWbsItem } from '@/app/actions/wbs'
import { projectTeams } from '@/lib/teams/source'
import { makeAdminActor, WS } from '../fixtures/actor'
import { teamRows } from '../helpers/teams-source-mock'

const ADMIN = { ok: true as const, actor: makeAdminActor('p1', { userId: 'u-admin' }) }
/** projectTeams 가 돌려줄 팀(활성, 워크스페이스 WS) */
const offer = (...rows: ReturnType<typeof teamRows>) => vi.mocked(projectTeams).mockResolvedValue(rows)

beforeEach(() => {
  resetDb()
  createServerClient.mockClear()
  requireProjectAdmin.mockReset()
  resolveProjectId.mockReset()
  requireProjectAdmin.mockResolvedValue(ADMIN)
  resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  vi.mocked(projectTeams).mockReset()
  vi.mocked(projectTeams).mockResolvedValue([])
})

describe('addSubAct 가드 ① — 대상은 리프여야 한다', () => {
  it('일반(비 SUB-ACT) 자식이 있는 항목에는 추가를 거부한다', async () => {
    db.wbs_items = [
      { id: 'act-1', project_id: 'p1', code: '1', name: '작업', biz: null, deliverable: null,
        planned_start: null, planned_end: null, is_owner_split: false },
      { id: 'child-1', parent_id: 'act-1', sort_order: 1, is_owner_split: false },
    ]
    const r = await addSubAct('act-1', 'PMO', 'primary')
    expect(r).toEqual({ ok: false, error: 'SUB-ACT가 아닌 하위 항목이 있는 곳에는 추가할 수 없습니다' })
    // 거부는 insert 이전 — wbs_items 는 늘지 않는다.
    expect(db.wbs_items).toHaveLength(2)
  })

  it('자식이 전부 SUB-ACT면 허용 경로로 진입한다(성공)', async () => {
    db.wbs_items = [
      { id: 'act-2', project_id: 'p1', code: '2', name: '복수 담당 작업', biz: 'PI', deliverable: '산출물',
        planned_start: '2026-01-01', planned_end: '2026-01-10', is_owner_split: false },
      { id: 'sub-1', parent_id: 'act-2', sort_order: 1, is_owner_split: true },
    ]
    offer(...teamRows(['ERP'], { id: 'team-erp', workspaceId: WS }))
    const r = await addSubAct('act-2', 'ERP', 'primary')
    expect(r.ok).toBe(true)
  })
})

describe('addSubAct — 담당 팀은 이 프로젝트에서 고를 수 있는 팀만(A2 최종 리뷰 보안 P3 — FF1)', () => {
  // 명단(X1)·초대·영역과 같은 원천 projectTeams(전용 팀이 있으면 그것만 — 전용 우선·워크스페이스 좁히기는 원천의 몫)의 활성 팀으로만 고른다.
  // 예전에는 정확한 code 로 teams 를 읽고 공용 팀으로 폴백해, 전용 'QA' 가 있는 프로젝트에 공용 'qa' 나 목록 밖 공용 팀을 붙일 수 있었다
  const act = (id: string) => ({ id, project_id: 'p1', code: '5', name: '팀 선택 작업', biz: null, deliverable: null,
    planned_start: null, planned_end: null, is_owner_split: false })

  it('projectTeams(그 항목의 프로젝트)가 돌려준 팀 id 로 담당을 넣고, teams 표를 직접 읽지 않는다', async () => {
    db.wbs_items = [act('act-5')]
    offer(...teamRows(['ERP'], { id: 't-proj', projectId: 'p1', workspaceId: WS }))
    const r = await addSubAct('act-5', 'ERP', 'primary')
    expect(r.ok).toBe(true)
    expect(projectTeams).toHaveBeenCalledWith('p1')
    expect(db.inserted.item_owners?.find(row => row.wbs_item_id === r.id)).toMatchObject({ team_id: 't-proj' })
    expect(db.fromCalls).not.toContain('teams')
  })

  it('전용 팀 QA 가 있는 프로젝트에 정규화 키만 같은 qa 를 넣으면 쓰기 전에 거절하고 고를 팀을 알려 준다', async () => {
    db.wbs_items = [act('act-6')]
    offer(...teamRows(['QA'], { id: 't-qa', projectId: 'p1', workspaceId: WS }))
    expect(await addSubAct('act-6', 'qa', 'primary')).toEqual({ ok: false, error: "'QA' 팀과 같은 낱말입니다 — 그 팀을 고르세요." })
    expect(await addSubAct('act-6', 'ＱＡ', 'primary')).toMatchObject({ ok: false })
    expect(db.inserted.wbs_items).toEqual([])
    expect(db.inserted.item_owners).toEqual([])
  })

  it('목록 밖 code(같은 워크스페이스 공용 팀이라도)·비활성 팀은 거절한다', async () => {
    db.wbs_items = [act('act-7')]
    offer(...teamRows(['QA'], { id: 't-qa', projectId: 'p1', workspaceId: WS }), ...teamRows(['OLD'], { id: 't-old', projectId: 'p1', workspaceId: WS, active: false }))
    expect(await addSubAct('act-7', 'MES', 'primary')).toEqual({ ok: false, error: '이 프로젝트에서 고를 수 있는 담당 팀이 아닙니다' })
    expect(await addSubAct('act-7', 'OLD', 'primary')).toEqual({ ok: false, error: '이 프로젝트에서 고를 수 있는 담당 팀이 아닙니다' })
    expect(db.inserted.wbs_items).toEqual([])
  })

  it('팀 원천 조회 실패는 팀 없음으로 위장하지 않고 쓰기 전에 고정 문구로 중단한다(원문은 로그로만)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.wbs_items = [act('act-8')]
    vi.mocked(projectTeams).mockRejectedValue(new Error('pg: relation teams timeout'))
    const r = await addSubAct('act-8', 'ERP', 'primary')
    expect(r).toEqual({ ok: false, error: '담당 팀을 확인하지 못했습니다 — 잠시 후 다시 시도하세요.' })
    expect(JSON.stringify(r)).not.toContain('timeout')
    expect(db.inserted.wbs_items).toEqual([])
    err.mockRestore()
  })
})

describe('addSubAct 가드 ②', () => {
  it('대상 자신이 SUB-ACT면 거부한다', async () => {
    db.wbs_items = [
      { id: 'act-3', project_id: 'p1', code: '3', name: '기존 SUB-ACT', biz: null, deliverable: null,
        planned_start: null, planned_end: null, is_owner_split: true },
    ]
    const r = await addSubAct('act-3', 'PMO', 'primary')
    expect(r).toEqual({ ok: false, error: 'SUB-ACT 아래에는 추가할 수 없습니다' })
    expect(db.wbs_items).toHaveLength(1)
  })
})

describe('addSubAct 가드 ③ — insert 페이로드', () => {
  it('성공 insert 에 is_owner_split:true 를 싣는다(level 컬럼은 더 이상 쓰지 않는다)', async () => {
    db.wbs_items = [
      { id: 'act-4', project_id: 'p1', code: '4', name: '데이터 이관', biz: '가공', deliverable: '이관 결과서',
        planned_start: '2026-02-01', planned_end: '2026-02-10', is_owner_split: false },
      { id: 'sub-4a', parent_id: 'act-4', sort_order: 1, is_owner_split: true },
    ]
    offer(...teamRows(['MES'], { id: 'team-mes', workspaceId: WS }))
    const r = await addSubAct('act-4', 'MES', 'support')
    expect(r.ok).toBe(true)
    const inserted = db.inserted.wbs_items?.find(row => row.parent_id === 'act-4')
    expect(inserted).toMatchObject({
      project_id: 'p1',
      parent_id: 'act-4',
      is_owner_split: true,
      code: '4',
      biz: '가공',
      deliverable: '이관 결과서',
      planned_start: '2026-02-01',
      planned_end: '2026-02-10',
      weight: null,
      actual_pct: null,
    })
  })
})

describe('addWbsItem 대칭 가드 — SUB-ACT 형제가 있으면 일반 항목을 거부한다', () => {
  it('부모의 기존 자식 중 is_owner_split 이 하나라도 있으면 거부', async () => {
    db.wbs_items = [
      { id: 'sib-1', project_id: 'p1', parent_id: 'parent-1', sort_order: 1, is_owner_split: true },
    ]
    const r = await addWbsItem('p1', 'parent-1', '새 항목')
    expect(r).toEqual({ ok: false, error: 'SUB-ACT 형제로는 일반 항목을 추가할 수 없습니다' })
    expect(db.wbs_items).toHaveLength(1)
  })

  it('기존 자식이 전부 일반 항목이거나 없으면 현행 동작 유지(성공)', async () => {
    db.wbs_items = [
      { id: 'sib-2', project_id: 'p1', parent_id: 'parent-2', sort_order: 1, is_owner_split: false },
    ]
    const r = await addWbsItem('p1', 'parent-2', '새 항목')
    expect(r.ok).toBe(true)
  })
})
