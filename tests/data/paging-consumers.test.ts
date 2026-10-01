// 1,000행 넘는 읽기 경로의 끝까지 읽기(스펙 §4.6, D18·Q5) — A1 은 데이터 손실 경로(replace 백업, getComputedWbs 의 wbs_items·
// item_owners), A2 가 나머지 경로(task_dependencies·holidays·스냅샷·getProjectsCompletion·결재 대기·봇 리포지토리)를 잇는다.
// 서버는 한 응답을 max_rows 에서 조용히 자른다 — 작은 쪽 가짜(pagedTable)가 한 응답을 몇 행으로 잘라 그 경로가 끝까지 읽는지,
// count 불일치(읽는 사이 행이 바뀜)·조회 오류를 데이터로 위장하지 않는지 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireWorkspaceAdmin: vi.fn(),
  parseWithProfile: vi.fn(), linkByDepth: vi.fn(), resolveLegacyLevelLabels: vi.fn(), splitLeafOwners: vi.fn(),
  projectTeamRowsSync: vi.fn(), teamsForProjectSync: vi.fn(), addTeam: vi.fn(), addProjectTeam: vi.fn(),
  createServerClient: vi.fn(), createAdminClient: vi.fn(),
  recordProgressSnapshot: vi.fn(), ingestProject: vi.fn(), detectWorkbook: vi.fn(),
  getProjectConfig: vi.fn(), writeProjectSettingsInternal: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: m.requireProjectAdmin, requireWorkspaceAdmin: m.requireWorkspaceAdmin }))
vi.mock('@/lib/excel/parseWithProfile', () => ({
  parseWithProfile: m.parseWithProfile, linkByDepth: m.linkByDepth, resolveLegacyLevelLabels: m.resolveLegacyLevelLabels,
}))
vi.mock('@/lib/excel/validate', () => ({ splitLeafOwners: m.splitLeafOwners }))
vi.mock('@/lib/teams/master', () => ({ projectTeamRowsSync: m.projectTeamRowsSync, teamsForProjectSync: m.teamsForProjectSync }))
vi.mock('@/app/actions/teams', () => ({ addTeam: m.addTeam }))
vi.mock('@/app/actions/projectTeams', () => ({ addProjectTeam: m.addProjectTeam }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: m.recordProgressSnapshot }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: m.ingestProject }))
vi.mock('@/lib/excel/detect', () => ({ detectWorkbook: m.detectWorkbook }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: m.getProjectConfig }))
vi.mock('@/lib/settings/write', () => ({ writeProjectSettingsInternal: m.writeProjectSettingsInternal }))
// getComputedWbs(과제 3 의 describe)는 react cache() 로 감싸여 있다 — 케이스마다 새로 계산하게 항등으로
vi.mock('react', async () => ({ ...(await vi.importActual<typeof import('react')>('react')), cache: <T,>(fn: T) => fn }))

import { POST } from '@/app/api/import/execute/route'
import { getComputedWbs } from '@/lib/data/wbs'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { makeActor, WS } from '../fixtures/actor'

type Call = { method: string; args: unknown[] }
type Row = Record<string, unknown>
/** PostgREST 흉내 — 쿼리(make)마다 필터·정렬·쪽을 기억하고, 정렬(order 열 순)·gt·키셋 or(`a.gt.X,and(a.eq.X,b.gt.Y)`)를 실제로 적용하며,
 *  한 응답을 maxRows 에서 자르고 count 는 필터에 맞는 행 수다(count: 'exact'). eq 는 기록만 한다(가짜의 행은 모두 그 프로젝트 것).
 *  log 는 쿼리별 호출 목록 — 필터·정렬이 실제로 걸렸는지 본다. error 를 주면 그 쿼리는 조회 오류다.
 *  afterResponse(n, rows) 는 n 번째 응답을 만든 뒤 표를 바꾼다 — 쪽 사이의 동시 변경(이동·삽입·삭제)을 흉내 낸다. */
function pagedTable(initial: readonly Row[], opts: {
  maxRows?: number; count?: number; error?: { message: string }; afterResponse?: (n: number, rows: Row[]) => Row[] | void
} = {}) {
  let rows: Row[] = [...initial]
  const log: Call[][] = []
  const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)
  const make = () => {
    const calls: Call[] = []
    log.push(calls)
    const orders: string[] = []
    const filters: Array<(r: Row) => boolean> = []
    let window: [number, number] = [0, Number.MAX_SAFE_INTEGER]
    const q: Record<string, unknown> = {}
    const rec = (method: string, args: unknown[]) => { calls.push({ method, args }); return q }
    for (const method of ['select', 'eq', 'in', 'is', 'not']) q[method] = (...args: unknown[]) => rec(method, args)
    q.order = (col: string) => { orders.push(col); return rec('order', [col]) }
    q.gt = (col: string, v: unknown) => { filters.push((r) => cmp(r[col], v) > 0); return rec('gt', [col, v]) }
    q.or = (expr: string) => {
      const m = /^(\w+)\.gt\.([^,]+),and\((\w+)\.eq\.([^,]+),(\w+)\.gt\.([^)]+)\)$/.exec(expr)
      if (!m || m[1] !== m[3] || m[2] !== m[4]) throw new Error(`가짜가 모르는 or: ${expr}`)
      const [, a, x, , , b, y] = m
      filters.push((r) => cmp(r[a], x) > 0 || (cmp(r[a], x) === 0 && cmp(r[b], y) > 0))
      return rec('or', [expr])
    }
    q.range = (from: number, to: number) => { window = [from, to]; return rec('range', [from, to]) }
    q.limit = (n: number) => { window = [0, n - 1]; return rec('limit', [n]) }
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (opts.error) return Promise.resolve({ data: null, error: opts.error, count: null }).then(resolve, reject)
      const hit = rows.filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => { for (const c of orders) { const d = cmp(a[c], b[c]); if (d) return d } return 0 })
      const data = hit.slice(window[0], Math.min(window[1] + 1, window[0] + (opts.maxRows ?? 1000))).map((r) => ({ ...r }))
      const res = { data, error: null, count: opts.count ?? hit.length }
      const next = opts.afterResponse?.(log.length, rows.map((r) => ({ ...r })))
      if (next) rows = next
      return Promise.resolve(res).then(resolve, reject)
    }
    return q
  }
  return { make, log }
}

const PROJECT_ID = '11111111-1111-4111-8111-111111111111'
// 합성 양식(계층 2열 + 팀 열 RES) — 옛 5팀 양식 상수를 쓰지 않는다(그 상수는 A2 가 fixture 로 옮긴다)
const PROFILE = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 0, hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: null, start: null, end: null, weight: null, actualPct: null },
  teamColumns: [[2, 'RES']], ownerMarks: { '●': 'primary', '△': 'support' },
}
const ROW = { depth: 0, code: null, name: 'x', extraAxis: null, deliverable: null, plannedStart: null, plannedEnd: null,
  weight: null, actualPct: null, owners: [{ team: 'RES', kind: 'primary' as const }], excelRow: 2 }
const ITEM = { tempId: 't0', parentTempId: null, level: 'activity' as const, code: '1', sortOrder: 0, name: 'x', biz: null,
  deliverable: null, plannedStart: null, plannedEnd: null, weight: null, actualPct: null,
  owners: [{ team: 'RES', kind: 'primary' as const }], isOwnerSplit: false }
const ERR_BACKUP = '교체 전 백업을 만들지 못해 가져오기를 멈췄습니다. 잠시 후 다시 시도하세요.'

function replaceRequest(): Parameters<typeof POST>[0] {
  const form = new FormData()
  for (const [k, v] of Object.entries({
    file: new Blob(['x']), projectId: PROJECT_ID, profile: JSON.stringify(PROFILE), mode: 'replace', saveProfile: 'false', registerTeams: 'false',
  })) form.append(k, v)
  return { formData: async () => form } as unknown as Parameters<typeof POST>[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  m.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeActor({ projectWorkspace: new Map([[PROJECT_ID, WS]]) }) })
  m.parseWithProfile.mockReturnValue({ ok: true, rows: [ROW], holidays: [] })
  m.resolveLegacyLevelLabels.mockReturnValue(false)
  m.linkByDepth.mockReturnValue({ ok: true, items: [ITEM] })
  m.splitLeafOwners.mockImplementation((items: unknown) => items)
  m.projectTeamRowsSync.mockReturnValue([{ code: 'RES', projectId: PROJECT_ID }])
  m.teamsForProjectSync.mockReturnValue([{ code: 'RES' }])
  m.recordProgressSnapshot.mockResolvedValue(undefined)
  m.ingestProject.mockResolvedValue({ count: 0 })
  m.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'core.level_labels': ['단계', '작업'] }))
})
afterEach(() => { vi.restoreAllMocks() })

describe('가져오기 replace 백업 — 끝까지 읽는다(교체 전 원본의 유일한 사본, D18·Q5)', () => {
  it('1,000행을 넘는 트리(서버가 한 응답을 3행으로 자른다)도 백업에 전부 실린다 — id 정렬·count 로 끝까지', async () => {
    const tree = Array.from({ length: 1003 }, (_, i) => ({ id: `w${String(i).padStart(4, '0')}`, project_id: PROJECT_ID, name: `항목 ${i}` }))
    const t = pagedTable(tree, { maxRows: 3 })
    const rpc = vi.fn(async () => ({ data: 1, error: null }))
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => t.make()), rpc })
    const res = await POST(replaceRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.backup.rows).toHaveLength(1003)
    expect(body.backup.rows[1002]).toEqual(tree[1002])
    expect(t.log).toHaveLength(Math.ceil(1003 / 3) + 1)   // 마지막은 빈 쪽 — 짧은 쪽을 끝으로 믿지 않는다(서버 상한)
    expect(t.log[0]).toEqual([
      { method: 'select', args: ['*', { count: 'exact' }] }, { method: 'eq', args: ['project_id', PROJECT_ID] },
      { method: 'order', args: ['id'] }, { method: 'limit', args: [1000] },
    ])
    expect(t.log[1]).toEqual([
      { method: 'select', args: ['*', { count: 'exact' }] }, { method: 'eq', args: ['project_id', PROJECT_ID] },
      { method: 'gt', args: ['id', 'w0002'] }, { method: 'order', args: ['id'] }, { method: 'limit', args: [1000] },
    ])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('[K2] 첫 쪽을 읽은 직후 앞 구간 id 로 행이 삽입돼도(총합이 쪽 크기의 배수) 백업에 중복·누락이 없다 — 키셋', async () => {
    const tree = Array.from({ length: 2000 }, (_, i) => ({ id: `w${String(i).padStart(4, '0')}`, project_id: PROJECT_ID }))
    const t = pagedTable(tree, { afterResponse: (n, rows) => (n === 1 ? [...rows, { id: 'w0500a', project_id: PROJECT_ID }] : undefined) })
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => t.make()), rpc: vi.fn(async () => ({ data: 1, error: null })) })
    const res = await POST(replaceRequest())
    expect(res.status).toBe(200)
    const ids = (await res.json()).backup.rows.map((r: { id: string }) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(tree.map((r) => r.id))
  })

  it('[RF5] 쪽을 읽는 사이 행 수가 바뀌면(count 불일치) 500 고정 문구 — 원문·건수를 싣지 않고 RPC 를 부르지 않는다', async () => {
    const t = pagedTable([{ id: 'w1' }, { id: 'w2' }], { count: 3 })
    const rpc = vi.fn()
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => t.make()), rpc })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(replaceRequest())
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: ERR_BACKUP })
    expect(text).not.toMatch(/\d+\/\d+건/)
    expect(rpc).not.toHaveBeenCalled()
    expect(err.mock.calls.some((c) => c.some((x) => String(x).includes('2/3건')))).toBe(true)   // 원문은 서버 로그로만
  })

  it('조회 오류도 같은 고정 문구 — PostgREST 원문을 응답에 싣지 않고 RPC 를 부르지 않는다', async () => {
    const t = pagedTable([], { error: { message: 'permission denied for table wbs_items' } })
    const rpc = vi.fn()
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => t.make()), rpc })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await POST(replaceRequest())
    expect(res.status).toBe(500)
    const text = await res.text()
    expect(text).not.toContain('permission denied')
    expect(JSON.parse(text)).toEqual({ error: ERR_BACKUP })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('getComputedWbs — 데이터 손실 경로를 끝까지(wbs_items·item_owners, D18·Q5)', () => {
  const PID = '22222222-2222-4222-8222-222222222222'
  const wbsRow = (i: number) => ({
    id: `i${String(i).padStart(4, '0')}`, project_id: PID, parent_id: null, code: String(i), sort_order: i, name: `항목 ${i}`,
    biz: null, deliverable: null, planned_start: null, planned_end: null, weight: null, actual_pct: 0, is_owner_split: false,
    external_ref: null, depends: null, stage: null,
  })
  const ownerOf = (r: { id: string }) => ({ wbs_item_id: r.id, team_id: 't-res', kind: 'primary', teams: { code: 'RES' }, wbs_items: { project_id: PID } })
  /** select·eq·maybeSingle 체인 하나로 끝나는 표(holidays·projects·task_dependencies — A2 가 끝까지 읽기로 바꾼다) */
  const simple = (data: unknown) => {
    const q: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'maybeSingle']) q[k] = () => q
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res, rej)
    return q
  }
  const client = (wbs: ReturnType<typeof pagedTable>, owners: ReturnType<typeof pagedTable>) => ({
    from: (t: string) => t === 'wbs_items' ? wbs.make() : t === 'item_owners' ? owners.make()
      : t === 'projects' ? simple({ base_date: '2026-09-01' }) : simple([]),
  })
  beforeEach(() => { m.teamsForProjectSync.mockReturnValue([]) })

  it('두 표가 한 응답의 상한(여기서는 2행)을 넘어도 끝까지 읽힌다 — 담당이 빠지지 않는다', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => wbsRow(i))
    const wbs = pagedTable(rows, { maxRows: 2 })
    const own = pagedTable(rows.map(ownerOf), { maxRows: 2 })
    m.createServerClient.mockResolvedValue(client(wbs, own))
    const { items } = await getComputedWbs(PID)
    expect(items).toHaveLength(5)
    expect(items.every((n) => n.owners.length === 1 && n.owners[0].team === 'RES')).toBe(true)
    expect([wbs.log.length, own.log.length]).toEqual([4, 4])   // 2·2·1 + 빈 쪽
  })

  it('[K1] 쪽 사이에 형제 순서를 바꿔도(sort_order 교환) 항목이 두 번·0번 읽히지 않는다 — id 키셋, 형제 정렬은 computeTree', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => wbsRow(i))
    const swap = (n: number, cur: Row[]) => n === 1
      ? cur.map((r) => (r.id === 'i0001' ? { ...r, sort_order: 4 } : r.id === 'i0004' ? { ...r, sort_order: 1 } : r)) : undefined
    const wbs = pagedTable(rows, { maxRows: 2, afterResponse: swap })
    m.createServerClient.mockResolvedValue(client(wbs, pagedTable(rows.map(ownerOf))))
    const { items } = await getComputedWbs(PID)
    expect(items.map((n) => n.id).sort()).toEqual(rows.map((r) => r.id))
  })

  it('[K1] item_owners 도 PK 키셋 — 쪽 사이 앞 구간 삽입이 이미 있던 담당을 밀어내지 않는다', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => wbsRow(i))
    const owners = rows.map(ownerOf)
    const own = pagedTable(owners, {
      maxRows: 2,
      afterResponse: (n, cur) => (n === 1 ? [...cur, { ...ownerOf(rows[0]), team_id: 't-aaa', teams: { code: 'AAA' } }] : undefined),
    })
    m.createServerClient.mockResolvedValue(client(pagedTable(rows), own))
    const { items } = await getComputedWbs(PID)
    expect(items.map((n) => n.owners.map((o) => o.team))).toEqual([['RES'], ['RES'], ['RES'], ['RES']])
    expect(own.log[1]).toContainEqual({ method: 'or', args: ['wbs_item_id.gt.i0001,and(wbs_item_id.eq.i0001,team_id.gt.t-res)'] })
  })

  it('[K3] wbs_items 조회 오류는 throw — 빈 트리로 위장하지 않는다', async () => {
    m.createServerClient.mockResolvedValue(client(pagedTable([], { error: { message: 'down' } }), pagedTable([])))
    await expect(getComputedWbs(PID)).rejects.toThrow('[getComputedWbs] wbs_items 조회 실패: down')
  })

  it('[K3] item_owners 조회 오류도 throw — 담당 없음으로 위장하지 않는다', async () => {
    m.createServerClient.mockResolvedValue(client(pagedTable([wbsRow(1)]), pagedTable([], { error: { message: 'down' } })))
    await expect(getComputedWbs(PID)).rejects.toThrow('[getComputedWbs] item_owners 조회 실패: down')
  })

  it('[K3] wbs_items 행 수가 count 와 다르면 throw', async () => {
    m.createServerClient.mockResolvedValue(client(pagedTable([wbsRow(1), wbsRow(2)], { count: 3 }), pagedTable([])))
    await expect(getComputedWbs(PID)).rejects.toThrow('[getComputedWbs] wbs_items 목록을 끝까지 읽지 못했습니다(2/3건)')
  })

  it('item_owners 는 이 프로젝트 항목의 담당만 묻고(wbs_items!inner + 프로젝트 필터) 유일 키로 정렬한다 — wbs_items 는 바뀌지 않는 id 하나로', async () => {
    const wbs = pagedTable([wbsRow(1)])
    const own = pagedTable([])
    m.createServerClient.mockResolvedValue(client(wbs, own))
    await getComputedWbs(PID)
    expect(own.log[0]).toEqual([
      { method: 'select', args: ['wbs_item_id, team_id, kind, teams(code), wbs_items!inner(project_id)', { count: 'exact' }] },
      { method: 'eq', args: ['wbs_items.project_id', PID] },
      { method: 'order', args: ['wbs_item_id'] }, { method: 'order', args: ['team_id'] }, { method: 'limit', args: [1000] },
    ])
    expect(wbs.log[0]).toEqual([
      { method: 'select', args: ['*', { count: 'exact' }] }, { method: 'eq', args: ['project_id', PID] },
      { method: 'order', args: ['id'] }, { method: 'limit', args: [1000] },
    ])
  })

  it('쪽 사이에 행 수가 바뀌면(count 불일치) throw — 잘린 담당을 데이터로 위장하지 않는다', async () => {
    const rows = [wbsRow(1), wbsRow(2)]
    m.createServerClient.mockResolvedValue(client(pagedTable(rows), pagedTable(rows.map(ownerOf), { count: 3 })))
    await expect(getComputedWbs(PID)).rejects.toThrow('[getComputedWbs] item_owners 목록을 끝까지 읽지 못했습니다(2/3건)')
  })
})
