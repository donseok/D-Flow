// 무통보 덮어쓰기 0건의 남은 구멍(SPU1 — 개정 §5.8). 담당자·순서 이동·의존성·주간 제목이 '내가 본 값'을 받아, 서버 값이 그새 달라졌으면
// 쓰지 않고(쓰기 0) conflict·latest 로 답한다. 구멍마다 넷을 본다: 맞으면 쓴다 / 다르면 안 쓴다 / 기대값 없이는 옛 동작 / 선행 조회 실패는 중단.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(), createAdminClient: vi.fn(), requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(),
  resolveProjectId: vi.fn(), requireModule: vi.fn(), applyWorkflowEvent: vi.fn(), emitNotification: vi.fn(), ensureOrder: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/authz', () => ({
  requireProjectMember: mocks.requireProjectMember, requireProjectAdmin: mocks.requireProjectAdmin,
  requireSuperuser: vi.fn(), resolveProjectId: mocks.resolveProjectId, getActor: vi.fn(),
}))
vi.mock('@/lib/modules/gate', () => ({ requireModule: mocks.requireModule, requireSessionModule: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(), getDisplayName: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: mocks.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.createAdminClient }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: () => { throw new Error('admin 없음(시험)') } }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: mocks.emitNotification }))
vi.mock('@/lib/agent/ensureOrder', () => ({ ensureOrderForWorkflowLeaf: mocks.ensureOrder }))
vi.mock('@/lib/agent/workflowEvent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent/workflowEvent')>()), applyWorkflowEvent: mocks.applyWorkflowEvent,
}))
// 의존성 추가의 달력 판정은 이 시험의 관심이 아니다 — 계획 기간에 근무일이 있다고만 답한다
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: vi.fn(async () => ({})) }))
vi.mock('@/lib/calendar/load', () => ({ requireCalendar: () => ({}) }))
vi.mock('@/lib/domain/calendar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/domain/calendar')>()), workingDaysBetween: () => 3,
}))

import { addTaskDependency, moveWbsItem, removeTaskDependency } from '@/app/actions/wbs'
import { setWbsAssignee, setWbsAssigneeCascade } from '@/app/actions/wbsAssign'
import { saveWeeklyTitle } from '@/app/actions/weekly'
import { ERR_LOOKUP, ERR_MISSING } from '@/lib/authz/errors'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'

type Row = Record<string, unknown>
interface Hooks {
  /** n번째 쓰기(update·delete) 직전 — 읽기와 쓰기 사이에 끼어드는 다른 사람의 저장 */
  beforeWrite?: (table: string, n: number) => void
  /** 그 표의 n번째 읽기를 실패시킨다 */
  failRead?: (table: string, n: number) => boolean
  insertError?: { code: string; message: string }
}
/** 조건을 실제로 따지는 클라이언트 흉내(세션·admin 공용) — update·delete 는 조건이 모두 맞는 행에만 닿는다 */
function fakeDb(tables: Record<string, Row[]>, hooks: Hooks = {}) {
  const writes: Array<{ table: string; op: 'update' | 'delete' | 'insert'; patch?: Row; matched: number }> = []
  const reads: Record<string, number> = {}
  let nWrites = 0
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    const orders: string[] = []
    let op: 'select' | 'update' | 'delete' | 'insert' = 'select'
    let patch: Row = {}
    const rows = () => {
      const hit = (tables[table] ?? []).filter(r => filters.every(f => f(r)))
      for (const col of [...orders].reverse()) hit.sort((a, b) => (a[col] as number | string) < (b[col] as number | string) ? -1 : (a[col] as number | string) > (b[col] as number | string) ? 1 : 0)
      return hit
    }
    const run = () => {
      if (op === 'insert') {
        if (hooks.insertError) return { data: null, error: hooks.insertError }
        const row = { id: `new-${tables[table]?.length ?? 0}`, ...patch }
        ;(tables[table] ??= []).push(row)
        writes.push({ table, op, patch, matched: 1 })
        return { data: [{ ...row }], error: null }
      }
      if (op === 'select') {
        const n = reads[table] = (reads[table] ?? 0) + 1
        if (hooks.failRead?.(table, n - 1)) return { data: null, error: { message: 'boom', code: 'XX000' } }
        return { data: rows().map(r => ({ ...r })), error: null }
      }
      hooks.beforeWrite?.(table, nWrites++)
      const hit = rows()
      if (op === 'update') for (const r of hit) Object.assign(r, patch)
      else tables[table] = (tables[table] ?? []).filter(r => !hit.includes(r))
      writes.push({ table, op, ...(op === 'update' ? { patch } : {}), matched: hit.length })
      return { data: hit.map(r => ({ ...r })), error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b, limit: () => b,
      order: (col: string) => { orders.push(col); return b },
      eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return b },
      is: (col: string, v: unknown) => { filters.push(r => (r[col] ?? null) === v); return b },
      in: (col: string, vs: unknown[]) => { filters.push(r => vs.includes(r[col])); return b },
      update: (p: Row) => { op = 'update'; patch = p; return b },
      delete: () => { op = 'delete'; return b },
      insert: (p: Row) => { op = 'insert'; patch = p; return b },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
      single: async () => { const r = run(); return r.data?.[0] ? { data: r.data[0], error: r.error } : { data: null, error: r.error ?? { code: 'PGRST116', message: 'no rows' } } },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    }
    return b
  }
  mocks.createServerClient.mockResolvedValue({ from })
  mocks.createAdminClient.mockReturnValue({ from })
  /** change_logs·알림을 뺀, 본 표에 닿은 쓰기 */
  const touched = (table: string) => writes.filter(w => w.table === table)
  return { writes, tables, touched }
}

const P = '11111111-1111-4111-8111-111111111111'
const I1 = '22222222-2222-4222-8222-222222222221'
const I2 = '22222222-2222-4222-8222-222222222222'
const I3 = '22222222-2222-4222-8222-222222222223'
const M1 = '44444444-4444-4444-8444-444444444441'
const M2 = '44444444-4444-4444-8444-444444444442'
const M3 = '44444444-4444-4444-8444-444444444443'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: makeMemberActor(P, []) })
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeAdminActor(P) })
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: P })
  mocks.requireModule.mockResolvedValue({ ok: true })
  mocks.applyWorkflowEvent.mockResolvedValue({ ok: true, actualChanged: false })
  mocks.emitNotification.mockResolvedValue({ ok: true, recipients: 1 })
  mocks.ensureOrder.mockResolvedValue({ ok: true, created: false })
})

describe('moveWbsItem — 내가 본 자리(부모·sort_order·맞바꿀 이웃)', () => {
  const sibs = (): Row[] => [
    { id: I1, project_id: P, parent_id: null, sort_order: 1 },
    { id: I2, project_id: P, parent_id: null, sort_order: 2 },
    { id: I3, project_id: P, parent_id: null, sort_order: 3 },
  ]
  const order = (db: ReturnType<typeof fakeDb>) => [...db.tables.wbs_items].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)).map(r => r.id)

  it('본 자리가 그대로면 이웃과 맞바꾼다 — 두 update 는 읽은 sort_order 를 조건으로 쓴다', async () => {
    const db = fakeDb({ wbs_items: sibs() })
    expect(await moveWbsItem(I2, 'up', { parentId: null, sortOrder: 2, neighborId: I1 })).toEqual({ ok: true })
    expect(order(db)).toEqual([I2, I1, I3])
    expect(db.writes.map(w => w.matched)).toEqual([1, 1])
  })

  it('그새 남이 순서를 바꿔 맞바꿀 이웃이 달라졌으면 옮기지 않고(쓰기 0) conflict 와 지금 자리를 돌려준다', async () => {
    // 내가 볼 때는 I1·I2·I3 이었다. 그새 남이 I3 을 맨 위로 올렸다 — I2 의 '위로'는 이제 I1 이 아니라 I3 과 바뀐다
    const rows = sibs(); rows[2].sort_order = 0; rows[0].sort_order = 1; rows[1].sort_order = 2
    const db = fakeDb({ wbs_items: [rows[2], rows[0], rows[1]] })
    const before = order(db)
    expect(await moveWbsItem(I1, 'up', { parentId: null, sortOrder: 1, neighborId: null })).toMatchObject({
      ok: false, conflict: true, latest: { parentId: null, sortOrder: 1, neighborId: I3 },
    })
    expect(db.writes).toEqual([])
    expect(order(db)).toEqual(before)
  })

  it('이 항목의 sort_order·부모가 그새 달라졌어도 conflict 다', async () => {
    const db = fakeDb({ wbs_items: sibs() })
    expect(await moveWbsItem(I2, 'down', { parentId: null, sortOrder: 5, neighborId: I3 })).toMatchObject({ ok: false, conflict: true })
    expect(await moveWbsItem(I2, 'down', { parentId: I1, sortOrder: 2, neighborId: I3 })).toMatchObject({ ok: false, conflict: true })
    expect(db.writes).toEqual([])
  })

  it('대조와 쓰기 사이에 끼어든 변경은 조건부 update 의 0행으로 잡는다 — 한쪽만 바뀐 채 남지 않는다', async () => {
    const db = fakeDb({ wbs_items: sibs() }, {
      beforeWrite: (_t, n) => { if (n === 0) db.tables.wbs_items.find(r => r.id === I2)!.sort_order = 9 },
    })
    expect(await moveWbsItem(I2, 'up', { parentId: null, sortOrder: 2, neighborId: I1 })).toMatchObject({ ok: false, conflict: true })
    expect(db.writes.map(w => w.matched)).toEqual([0])
    expect(db.tables.wbs_items.map(r => r.sort_order)).toEqual([1, 9, 3])
  })

  it('이웃(neighborId)을 싣지 않으면 부모·sort_order 만 대조한다. 경계의 이동은 쓰지 않고 성공이다', async () => {
    const db = fakeDb({ wbs_items: sibs() })
    expect(await moveWbsItem(I2, 'up', { parentId: null, sortOrder: 2 })).toEqual({ ok: true })
    expect(await moveWbsItem(I2, 'up', { parentId: null, sortOrder: 1, neighborId: null })).toEqual({ ok: true })
    expect(db.writes).toHaveLength(2)
  })

  it('기대값 없이 부르면 옛 무조건 교환이다', async () => {
    const db = fakeDb({ wbs_items: sibs() })
    expect(await moveWbsItem(I3, 'up')).toEqual({ ok: true })
    expect(order(db)).toEqual([I1, I3, I2])
  })

  it('선행 조회(항목·형제)가 실패하면 충돌로도 성공으로도 답하지 않고 중단한다(쓰기 0)', async () => {
    for (const failAt of [0, 1]) {
      const db = fakeDb({ wbs_items: sibs() }, { failRead: (t, n) => t === 'wbs_items' && n === failAt })
      const res = await moveWbsItem(I2, 'up', { parentId: null, sortOrder: 2, neighborId: I1 })
      expect(res.ok).toBe(false)
      expect(res.conflict).toBeUndefined()
      expect(db.writes).toEqual([])
    }
  })

  it('기대값의 모양이 틀리면 가드 뒤에서 거절한다 — 읽지도 쓰지도 않는다', async () => {
    const db = fakeDb({ wbs_items: sibs() })
    expect((await moveWbsItem(I2, 'up', { parentId: null, sortOrder: Number.NaN })).ok).toBe(false)
    expect(db.writes).toEqual([])
    mocks.requireProjectAdmin.mockResolvedValue({ ok: false, error: '권한 없음' })
    expect(await moveWbsItem(I2, 'up', { parentId: null, sortOrder: Number.NaN })).toEqual({ ok: false, error: '권한 없음' })
  })
})

describe('의존성 — 이미 있는/이미 지워진 연결은 "그새 바뀜"이다', () => {
  const items = (): Row[] => [
    { id: I1, project_id: P, planned_start: '2026-09-01', planned_end: '2026-09-03' },
    { id: I2, project_id: P, planned_start: '2026-09-04', planned_end: '2026-09-08' },
  ]
  const dep = (): Row => ({ id: 'd1', project_id: P, predecessor_id: I1, successor_id: I2, dependency_type: 'FS', lag_days: 0 })

  it('추가 — 없던 연결이면 쓴다', async () => {
    const db = fakeDb({ wbs_items: items(), task_dependencies: [] })
    expect(await addTaskDependency(P, I1, I2, 'FS', 0)).toMatchObject({ ok: true })
    expect(db.tables.task_dependencies).toHaveLength(1)
  })

  it('추가 — 그새 남이 같은 연결을 이었으면(23505) 실패가 아니라 conflict 다. 이력도 남기지 않는다', async () => {
    const db = fakeDb({ wbs_items: items(), task_dependencies: [], change_logs: [] }, { insertError: { code: '23505', message: 'duplicate key' } })
    expect(await addTaskDependency(P, I1, I2, 'FS', 0)).toEqual({ ok: false, conflict: true, error: '이미 연결된 선행 작업입니다' })
    expect(db.writes).toEqual([])
  })

  it('추가 — 그 밖의 쓰기 오류와 선행 조회 실패는 conflict 가 아니다', async () => {
    fakeDb({ wbs_items: items(), task_dependencies: [] }, { insertError: { code: '23503', message: 'fk' } })
    const res = await addTaskDependency(P, I1, I2, 'FS', 0)
    expect(res.ok).toBe(false); expect(res.conflict).toBeUndefined()
    const db = fakeDb({ wbs_items: items(), task_dependencies: [] }, { failRead: t => t === 'task_dependencies' })
    const res2 = await addTaskDependency(P, I1, I2, 'FS', 0)
    expect(res2.ok).toBe(false); expect(res2.conflict).toBeUndefined()
    expect(db.writes).toEqual([])
  })

  it('삭제 — 있으면 지운다', async () => {
    const db = fakeDb({ task_dependencies: [dep()], change_logs: [] })
    expect(await removeTaskDependency('d1')).toEqual({ ok: true })
    expect(db.tables.task_dependencies).toEqual([])
  })

  it('삭제 — 이미 지워진 연결이면(행 없음) conflict 다. 조회 실패(ERR_LOOKUP)는 conflict 로 읽지 않는다', async () => {
    const db = fakeDb({ task_dependencies: [] })
    mocks.resolveProjectId.mockResolvedValueOnce({ ok: false, error: ERR_MISSING })
    expect(await removeTaskDependency('d1')).toEqual({ ok: false, conflict: true, error: '이미 삭제된 연결입니다.' })
    mocks.resolveProjectId.mockResolvedValueOnce({ ok: false, error: ERR_LOOKUP })
    expect(await removeTaskDependency('d1')).toEqual({ ok: false, error: ERR_LOOKUP })
    expect(db.writes).toEqual([])
    expect(mocks.requireProjectAdmin).not.toHaveBeenCalled()
  })

  it('삭제 — 소속 확인 뒤에 사라졌어도(읽기 0행·삭제 0행) conflict 다', async () => {
    fakeDb({ task_dependencies: [] })
    expect(await removeTaskDependency('d1')).toMatchObject({ ok: false, conflict: true })
    const db = fakeDb({ task_dependencies: [dep()] }, { beforeWrite: () => { db.tables.task_dependencies = [] } })
    expect(await removeTaskDependency('d1')).toMatchObject({ ok: false, conflict: true })
  })

  it('삭제 — 0행인데 행이 그대로면 권한 문구, 그 재조회가 실패하면 어느 쪽으로도 단정하지 않는다', async () => {
    const keep = dep()
    // 삭제가 닿지 않게 한다(RLS 차단 흉내) — 쓰기 직전에 id 를 바꿨다가 재조회 전에 되돌린다
    const db = fakeDb({ task_dependencies: [keep] }, { beforeWrite: () => { keep.id = 'hidden'; queueMicrotask(() => { keep.id = 'd1' }) } })
    expect(await removeTaskDependency('d1')).toEqual({ ok: false, error: '삭제 권한이 없습니다' })
    expect(db.tables.task_dependencies).toHaveLength(1)
    const keep2 = dep()
    fakeDb({ task_dependencies: [keep2] }, { beforeWrite: () => { keep2.id = 'hidden' }, failRead: (t, n) => t === 'task_dependencies' && n === 1 })
    const res = await removeTaskDependency('d1')
    expect(res.ok).toBe(false); expect(res.conflict).toBeUndefined()
  })
})

describe('setWbsAssignee — 내가 본 담당자(expectedAssignee)', () => {
  const item = (assignee: string | null): Row => ({ id: I1, project_id: P, parent_id: null, name: '작업', assignee_member_id: assignee, external_ref: null })
  const roster = (): Row[] => [M1, M2, M3].map(id => ({ id, project_id: P, active: true, 'people.active': true }))

  it('본 값 그대로면 쓴다 — 쓰기 조건에 그 값이 실린다', async () => {
    const db = fakeDb({ wbs_items: [item(M1)], project_members: roster() })
    expect(await setWbsAssignee(I1, M2, undefined, M1)).toEqual({ ok: true })
    expect(db.tables.wbs_items[0].assignee_member_id).toBe(M2)
    expect(mocks.emitNotification).toHaveBeenCalledTimes(1)
  })

  it('미지정(null)을 본 것도 기대값이다', async () => {
    const db = fakeDb({ wbs_items: [item(null)], project_members: roster() })
    expect(await setWbsAssignee(I1, M2, undefined, null)).toEqual({ ok: true })
    expect(db.tables.wbs_items[0].assignee_member_id).toBe(M2)
  })

  it('그새 남이 다른 사람으로 바꿨으면 쓰지 않고(쓰기 0·알림 0·전이 0) conflict 와 그 담당자를 돌려준다', async () => {
    const db = fakeDb({ wbs_items: [item(M3)], project_members: roster() })
    expect(await setWbsAssignee(I1, M2, undefined, M1)).toMatchObject({ ok: false, conflict: true, latest: M3 })
    expect(db.touched('wbs_items')).toEqual([])
    expect(db.tables.wbs_items[0].assignee_member_id).toBe(M3)
    expect(mocks.emitNotification).not.toHaveBeenCalled()
    expect(mocks.applyWorkflowEvent).not.toHaveBeenCalled()
  })

  it('남이 해제했어도(null) conflict 다 — latest 는 null', async () => {
    fakeDb({ wbs_items: [item(null)], project_members: roster() })
    const res = await setWbsAssignee(I1, M2, undefined, M1)
    expect(res).toMatchObject({ ok: false, conflict: true })
    expect(res.latest).toBeNull()
  })

  it('이미 내가 고른 값이면 덮을 것이 없다 — 충돌이 아니라 성공(쓰기 0)', async () => {
    const db = fakeDb({ wbs_items: [item(M2)], project_members: roster() })
    expect(await setWbsAssignee(I1, M2, undefined, M1)).toEqual({ ok: true })
    expect(db.touched('wbs_items')).toEqual([])
  })

  it('대조와 쓰기 사이에 끼어든 변경은 조건부 update 의 0행 → 다시 읽어 conflict. 그 재조회가 실패하면 충돌로 단정하지 않는다', async () => {
    const db = fakeDb({ wbs_items: [item(M1)], project_members: roster() }, {
      beforeWrite: () => { db.tables.wbs_items[0].assignee_member_id = M3 },
    })
    expect(await setWbsAssignee(I1, M2, undefined, M1)).toMatchObject({ ok: false, conflict: true, latest: M3 })
    expect(db.touched('wbs_items').map(w => w.matched)).toEqual([0])
    const db2 = fakeDb({ wbs_items: [item(M1)], project_members: roster() }, {
      beforeWrite: () => { db2.tables.wbs_items[0].assignee_member_id = M3 },
      failRead: (t, n) => t === 'wbs_items' && n === 1,
    })
    const res = await setWbsAssignee(I1, M2, undefined, M1)
    expect(res.ok).toBe(false); expect(res.conflict).toBeUndefined()
    expect(db2.tables.wbs_items[0].assignee_member_id).toBe(M3)
  })

  it('기대값 없이 부르면 옛 무조건 저장이다', async () => {
    const db = fakeDb({ wbs_items: [item(M3)], project_members: roster() })
    expect(await setWbsAssignee(I1, M2)).toEqual({ ok: true })
    expect(db.tables.wbs_items[0].assignee_member_id).toBe(M2)
  })

  it('선행 조회(항목)가 실패하면 중단한다. 기대값의 모양이 틀리면 거절한다', async () => {
    const db = fakeDb({ wbs_items: [item(M1)], project_members: roster() }, { failRead: t => t === 'wbs_items' })
    const res = await setWbsAssignee(I1, M2, undefined, M1)
    expect(res.ok).toBe(false); expect(res.conflict).toBeUndefined()
    expect(db.writes).toEqual([])
    const db2 = fakeDb({ wbs_items: [item(M1)], project_members: roster() })
    expect(await setWbsAssignee(I1, M2, undefined, 'not-a-uuid')).toEqual({ ok: false, error: '잘못된 요청입니다.' })
    expect(db2.writes).toEqual([])
  })
})

describe('setWbsAssigneeCascade — 본인 항목의 기대값', () => {
  const tree = (rootAssignee: string | null): Row[] => [
    { id: I1, project_id: P, parent_id: null, name: '상위', assignee_member_id: rootAssignee },
    { id: I2, project_id: P, parent_id: I1, name: '하위', assignee_member_id: null },
  ]
  const roster = (): Row[] => [M1, M2, M3].map(id => ({ id, project_id: P, active: true, 'people.active': true }))

  it('본 값 그대로면 본인·미지정 하위를 쓴다', async () => {
    const db = fakeDb({ wbs_items: tree(M1), project_members: roster() })
    expect(await setWbsAssigneeCascade(I1, M2, M1)).toMatchObject({ ok: true, count: 2 })
    expect(db.tables.wbs_items.map(r => r.assignee_member_id)).toEqual([M2, M2])
  })

  it('본인 항목의 담당이 그새 달라졌으면 하위까지 통째로 쓰지 않는다', async () => {
    const db = fakeDb({ wbs_items: tree(M3), project_members: roster() })
    expect(await setWbsAssigneeCascade(I1, M2, M1)).toMatchObject({ ok: false, conflict: true, latest: M3 })
    expect(db.touched('wbs_items')).toEqual([])
    expect(db.tables.wbs_items.map(r => r.assignee_member_id)).toEqual([M3, null])
  })

  it('트리를 읽은 뒤 끼어든 변경(본인 update 0행)도 하위에 손대기 전에 멈춘다', async () => {
    const db = fakeDb({ wbs_items: tree(M1), project_members: roster() }, {
      beforeWrite: (_t, n) => { if (n === 0) db.tables.wbs_items[0].assignee_member_id = M3 },
    })
    expect(await setWbsAssigneeCascade(I1, M2, M1)).toMatchObject({ ok: false, conflict: true, latest: M3 })
    expect(db.touched('wbs_items').map(w => w.matched)).toEqual([0])
    expect(db.tables.wbs_items[1].assignee_member_id).toBeNull()
  })

  it('기대값 없이 부르면 옛 동작(본인 무조건) — 트리 조회 실패는 중단', async () => {
    const db = fakeDb({ wbs_items: tree(M3), project_members: roster() })
    expect(await setWbsAssigneeCascade(I1, M2)).toMatchObject({ ok: true, count: 2 })
    expect(db.tables.wbs_items[0].assignee_member_id).toBe(M2)
    const db2 = fakeDb({ wbs_items: tree(M1), project_members: roster() }, { failRead: t => t === 'wbs_items' })
    const res = await setWbsAssigneeCascade(I1, M2, M1)
    expect(res.ok).toBe(false); expect(res.conflict).toBeUndefined()
    expect(db2.writes).toEqual([])
  })
})

describe('saveWeeklyTitle — 내가 본 제목(expected)', () => {
  const report = (title: string): Row => ({ id: 'rep', project_id: P, title })

  it('본 제목 그대로면 쓴다 — 조건에 그 제목이 실린다', async () => {
    const db = fakeDb({ weekly_reports: [report('7월 2주')] })
    expect(await saveWeeklyTitle(P, 'rep', ' 7월 2주 보고 ', '7월 2주')).toEqual({ ok: true })
    expect(db.tables.weekly_reports[0].title).toBe('7월 2주 보고')
  })

  it("기본 제목('')을 본 것도 기대값이다", async () => {
    const db = fakeDb({ weekly_reports: [report('')] })
    expect(await saveWeeklyTitle(P, 'rep', '새 제목', '')).toEqual({ ok: true })
    expect(db.tables.weekly_reports[0].title).toBe('새 제목')
  })

  it('그새 남이 제목을 바꿨으면 쓰지 않고 conflict 와 그 제목을 돌려준다', async () => {
    const db = fakeDb({ weekly_reports: [report('남이 바꾼 제목')] })
    expect(await saveWeeklyTitle(P, 'rep', '내 제목', '7월 2주')).toMatchObject({ ok: false, conflict: true, latest: '남이 바꾼 제목' })
    expect(db.writes.map(w => w.matched)).toEqual([0])
    expect(db.tables.weekly_reports[0].title).toBe('남이 바꾼 제목')
  })

  it('이미 같은 제목이면(남이 같은 값으로·응답을 잃은 내 앞선 저장) 충돌이 아니라 성공이다', async () => {
    fakeDb({ weekly_reports: [report('내 제목')] })
    expect(await saveWeeklyTitle(P, 'rep', '내 제목', '7월 2주')).toEqual({ ok: true })
  })

  it('0행의 재조회가 실패하면 충돌로도 성공으로도 답하지 않는다. 회차가 없으면 그 문구다', async () => {
    fakeDb({ weekly_reports: [report('남이 바꾼 제목')] }, { failRead: t => t === 'weekly_reports' })
    const res = await saveWeeklyTitle(P, 'rep', '내 제목', '7월 2주')
    expect(res.ok).toBe(false); expect(res.conflict).toBeUndefined()
    fakeDb({ weekly_reports: [] })
    expect(await saveWeeklyTitle(P, 'rep', '내 제목', '7월 2주')).toEqual({ ok: false, error: '대상 회차를 찾을 수 없습니다.' })
  })

  it('기대값 없이 부르면 옛 무조건 저장이다. 남의 프로젝트 회차에는 닿지 않는다', async () => {
    const db = fakeDb({ weekly_reports: [report('남이 바꾼 제목')] })
    expect(await saveWeeklyTitle(P, 'rep', '내 제목')).toEqual({ ok: true })
    expect(db.tables.weekly_reports[0].title).toBe('내 제목')
    const other = fakeDb({ weekly_reports: [{ id: 'rep', project_id: 'other', title: 'x' }] })
    expect(await saveWeeklyTitle(P, 'rep', '내 제목', 'x')).toEqual({ ok: false, error: '대상 회차를 찾을 수 없습니다.' })
    expect(other.tables.weekly_reports[0].title).toBe('x')
  })

  it('가드·모듈 관문이 기대값 검증보다 먼저다', async () => {
    const db = fakeDb({ weekly_reports: [report('7월 2주')] })
    mocks.requireModule.mockResolvedValueOnce({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect(await saveWeeklyTitle(P, 'rep', '내 제목', 'x'.repeat(300))).toEqual({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect((await saveWeeklyTitle(P, 'rep', '내 제목', 'x'.repeat(300))).ok).toBe(false)
    expect(db.writes).toEqual([])
  })
})
