// 저장 충돌의 서버 계약(SPU1 — 개정 §5.8, Q05·Q10). 기대값이 서버의 현재 값과 다르면 쓰지 않고(쓰기 0) 그 현재 값을 돌려준다 — 화면이 내
// 값과 나란히 보이고 고르게 한다. 주간 셀은 값 CAS 를 새로 받는다(읽은 updated_at 을 조건으로 쓴다 — 읽기와 쓰기 사이의 끼어들기도 잡는다).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(), requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(), requireModule: vi.fn(),
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
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: () => { throw new Error('admin 없음(시험)') } }))
vi.mock('@/lib/data/snapshots', () => ({ recordProgressSnapshot: vi.fn() }))
vi.mock('@/lib/ai/ingest', () => ({ ingestProject: vi.fn(async () => ({ count: 0 })) }))

import { getWbsCellSnapshot, updateActual, updateDeliverable, updateWbsFields, updateWeight } from '@/app/actions/wbs'
import { saveWeeklyCell, saveWeeklyCells } from '@/app/actions/weekly'
import { makeAdminActor, makeMemberActor } from '../fixtures/actor'

type Row = Record<string, string | number | null>
/**
 * 조건을 실제로 따지는 세션 클라이언트 흉내 — 행 하나짜리 표들. update 는 eq 조건이 모두 맞는 행만 고치고 updated_at 을 올린다(트리거 흉내).
 * beforeUpdate: 읽기와 쓰기 사이에 끼어드는 다른 사람의 저장을 흉내 낸다.
 */
function fakeDb(tables: Record<string, Row[]>, hooks: { beforeUpdate?: (table: string, n: number) => void; failRead?: string } = {}) {
  const writes: Array<{ table: string; patch: Row; matched: number }> = []
  let tick = 0
  let updates = 0
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = []
    let patch: Row | null = null
    let insert = false
    const rows = () => (tables[table] ?? []).filter(r => filters.every(f => f(r)))
    const run = () => {
      if (insert) return { data: null, error: null }
      if (!patch) return hooks.failRead === table ? { data: null, error: { message: 'boom', code: 'XX000' } } : { data: rows().map(r => ({ ...r })), error: null }
      hooks.beforeUpdate?.(table, updates++)
      const hit = rows()
      for (const r of hit) { Object.assign(r, patch); if ('updated_at' in r && !('updated_at' in patch)) r.updated_at = `t${++tick}` }
      writes.push({ table, patch, matched: hit.length })
      return { data: hit.map(r => ({ ...r })), error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b, limit: () => b, order: () => b,
      eq: (col: string, v: unknown) => { filters.push(r => r[col] === v); return b },
      in: (col: string, vs: unknown[]) => { filters.push(r => vs.includes(r[col])); return b },
      update: (p: Row) => { patch = p; return b },
      insert: () => { insert = true; return b },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
      single: async () => { const r = run(); return r.data?.[0] ? { data: r.data[0], error: r.error } : { data: null, error: r.error ?? { code: 'PGRST116', message: 'no rows' } } },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
    }
    return b
  }
  mocks.createServerClient.mockResolvedValue({ from })
  return { writes, tables }
}
const weeklyRow = (over: Row = {}): Row => ({
  id: 'r1', project_id: 'p1', report_id: 'rep', area_id: 'a1', updated_at: 't0',
  this_content: '50', this_issue: '', next_content: '', next_issue: '', ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: makeMemberActor('p1', []) })
  mocks.requireProjectAdmin.mockResolvedValue({ ok: true, actor: makeAdminActor('p1') })
  mocks.resolveProjectId.mockResolvedValue({ ok: true, projectId: 'p1' })
  mocks.requireModule.mockResolvedValue({ ok: true })
})

describe('saveWeeklyCell — 값 CAS(기대값)', () => {
  it('기대값이 서버 값과 같으면 쓴다 — 조건은 읽은 updated_at 이다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow()] })
    expect(await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')).toEqual({ ok: true })
    expect(db.writes).toEqual([{ table: 'weekly_report_rows', patch: { this_content: '60' }, matched: 1 }])
    expect(db.tables.weekly_report_rows[0].this_content).toBe('60')
  })

  it('Q05 — 그새 다른 사람이 70 으로 바꿨으면 쓰지 않고(쓰기 0) 충돌과 그 값을 돌려준다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow({ this_content: '70' })] })
    expect(await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')).toMatchObject({ ok: false, conflict: true, latest: '70' })
    expect(db.writes).toEqual([])
    expect(db.tables.weekly_report_rows[0].this_content).toBe('70')
  })

  it('DB 의 null 은 빈 문자열과 같다 — 빈 칸을 기대한 저장이 거짓 충돌하지 않는다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow({ this_issue: null })] })
    expect(await saveWeeklyCell('p1', 'r1', 'this_issue', '메모', '')).toEqual({ ok: true })
    expect(db.writes).toHaveLength(1)
  })

  it('읽기와 쓰기 사이에 그 칸이 바뀌면(끼어든 저장) 0행 → 다시 읽어 충돌로 답한다. 남의 값은 그대로다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow()] }, {
      beforeUpdate: (_t, n) => { if (n === 0) Object.assign(db.tables.weekly_report_rows[0], { this_content: '70', updated_at: 'other' }) },
    })
    expect(await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')).toMatchObject({ ok: false, conflict: true, latest: '70' })
    expect(db.writes.map(w => w.matched)).toEqual([0])
    expect(db.tables.weekly_report_rows[0].this_content).toBe('70')
  })

  it('같은 행의 다른 칸만 그새 바뀌었으면(내 다른 칸 저장 포함) 한 번 더 읽고 쓴다 — 거짓 충돌 없음', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow()] }, {
      beforeUpdate: (_t, n) => { if (n === 0) Object.assign(db.tables.weekly_report_rows[0], { next_issue: '남의 메모', updated_at: 'other' }) },
    })
    expect(await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')).toEqual({ ok: true })
    expect(db.writes.map(w => w.matched)).toEqual([0, 1])
    expect(db.tables.weekly_report_rows[0]).toMatchObject({ this_content: '60', next_issue: '남의 메모' })
  })

  it('행이 계속 바뀌어 끝내 쓰지 못하면 성공으로 답하지 않는다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow()] }, {
      beforeUpdate: (_t, n) => { db.tables.weekly_report_rows[0].updated_at = `race${n}` },
    })
    const res = await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')
    expect(res.ok).toBe(false)
    expect(res.conflict).toBeUndefined()
    expect(db.tables.weekly_report_rows[0].this_content).toBe('50')
  })

  it('행이 사라졌으면 gone, 쓰기 전 읽기가 실패하면 중단(쓰기 0)', async () => {
    fakeDb({ weekly_report_rows: [] })
    expect(await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')).toMatchObject({ ok: false, gone: true })
    const db = fakeDb({ weekly_report_rows: [weeklyRow()] }, { failRead: 'weekly_report_rows' })
    expect((await saveWeeklyCell('p1', 'r1', 'this_content', '60', '50')).ok).toBe(false)
    expect(db.writes).toEqual([])
  })

  it('기대값 없이 부르면 옛 무조건 저장이다(화면은 항상 기대값을 싣는다 — tests/ui/weekly-cell-conflict)', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow({ this_content: '70' })] })
    expect(await saveWeeklyCell('p1', 'r1', 'this_content', '60')).toEqual({ ok: true })
    expect(db.writes).toHaveLength(1)
  })
})

describe('saveWeeklyCells — 칸별 값 CAS', () => {
  it('어긋난 칸만 쓰지 않고 그 현재 값을 돌려준다. 같은 행의 다른 칸과 다른 행은 저장된다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow({ this_content: '70' }), weeklyRow({ id: 'r2', this_content: 'x' })] })
    const res = await saveWeeklyCells('p1', [
      { rowId: 'r1', cellKey: 'this_content', content: '60', expected: '50' },
      { rowId: 'r1', cellKey: 'this_issue', content: '이슈', expected: '' },
      { rowId: 'r2', cellKey: 'this_content', content: 'y', expected: 'x' },
    ])
    expect(res).toEqual({ ok: true, conflicts: [{ rowId: 'r1', cellKey: 'this_content', latest: '70' }] })
    expect(db.tables.weekly_report_rows[0]).toMatchObject({ this_content: '70', this_issue: '이슈' })
    expect(db.tables.weekly_report_rows[1].this_content).toBe('y')
  })

  it('되돌리기의 역명령(§5.8.6) — "지금 서버 값 = 내가 쓴 값"이 아니면 덮지 않는다', async () => {
    const db = fakeDb({ weekly_report_rows: [weeklyRow({ this_content: '70' })] })
    const res = await saveWeeklyCells('p1', [{ rowId: 'r1', cellKey: 'this_content', content: '50', expected: '60' }])
    expect(res).toEqual({ ok: true, conflicts: [{ rowId: 'r1', cellKey: 'this_content', latest: '70' }] })
    expect(db.writes).toEqual([])
  })

  it('충돌이 없으면 종전과 같은 답이다', async () => {
    fakeDb({ weekly_report_rows: [weeklyRow()] })
    expect(await saveWeeklyCells('p1', [{ rowId: 'r1', cellKey: 'this_content', content: '60', expected: '50' }])).toEqual({ ok: true })
  })
})

describe('WBS 셀 — 충돌은 서버의 현재 값을 같이 준다', () => {
  const item = (over: Row = {}): Row => ({ id: 'w1', project_id: 'p1', actual_pct: 70, weight: 0.7, custom: null, dev_workflow: 0, parent_id: null, ...over })

  it('updateActual — 기대값(50)과 다르면(70) 쓰지 않고 latest 70', async () => {
    const db = fakeDb({ wbs_items: [item()] })
    mocks.requireProjectMember.mockResolvedValueOnce({ ok: true, actor: makeAdminActor('p1') })   // 담당 판정은 이 시험의 대상이 아니다
    expect(await updateActual('w1', 60, 50)).toMatchObject({ ok: false, conflict: true, latest: 70 })
    expect(db.writes).toEqual([])
  })

  it('updateActual — 서버 값이 비어 있으면 latest null(0 으로 꾸미지 않는다)', async () => {
    fakeDb({ wbs_items: [item({ actual_pct: null })] })
    mocks.requireProjectMember.mockResolvedValueOnce({ ok: true, actor: makeAdminActor('p1') })
    expect(await updateActual('w1', 60, 50)).toMatchObject({ ok: false, conflict: true, latest: null })
  })

  it('updateWeight — 기대값(0.4)과 다르면(0.7) 쓰지 않고 latest 0.7', async () => {
    const db = fakeDb({ wbs_items: [item()] })
    expect(await updateWeight('w1', 0.6, 0.4)).toMatchObject({ ok: false, conflict: true, latest: 0.7 })
    expect(db.writes).toEqual([])
  })

  it('getWbsCellSnapshot(Q10 결과 조회) — 멤버 가드 뒤에 현재 값을 읽는다. 쓰지 않는다', async () => {
    const db = fakeDb({ wbs_items: [item({ actual_pct: '60', weight: null, custom: { qty: 7 } as never })] })
    expect(await getWbsCellSnapshot('w1')).toEqual({ ok: true, actualPct: 60, weight: null, custom: { qty: 7 } })
    expect(mocks.requireProjectMember).toHaveBeenCalledWith('p1')
    expect(db.writes).toEqual([])
  })

  it('getWbsCellSnapshot — 가드 거부·행 없음·조회 실패는 값이 아니라 실패다(fail-closed)', async () => {
    fakeDb({ wbs_items: [item()] })
    mocks.requireProjectMember.mockResolvedValueOnce({ ok: false, error: 'denied' })
    expect(await getWbsCellSnapshot('w1')).toEqual({ ok: false, error: 'denied' })
    mocks.resolveProjectId.mockResolvedValueOnce({ ok: false, error: 'no project' })
    expect(await getWbsCellSnapshot('w1')).toEqual({ ok: false, error: 'no project' })
    fakeDb({ wbs_items: [] })
    expect((await getWbsCellSnapshot('w1')).ok).toBe(false)
    fakeDb({ wbs_items: [item()] }, { failRead: 'wbs_items' })
    const failed = await getWbsCellSnapshot('w1')
    expect(failed.ok).toBe(false)
    expect(JSON.stringify(failed)).not.toContain('boom')
  })
})

describe('상세 패널 저장(updateWbsFields·updateDeliverable) — 폼을 열 때 본 값이 기대값', () => {
  const item = (over: Row = {}): Row => ({ id: 'w1', project_id: 'p1', name: '설계 검토', planned_start: '2026-08-31', planned_end: '2026-09-02', deliverable: '초안', biz: null, updated_at: 't0', ...over })
  const SEEN = { name: '설계 검토', plannedStart: '2026-08-31', plannedEnd: '2026-09-02', deliverable: '초안' }

  it('본 값 그대로면 고친 칸만 쓴다', async () => {
    const db = fakeDb({ wbs_items: [item()], task_dependencies: [], change_logs: [] })
    expect(await updateWbsFields('w1', { ...SEEN, name: '설계 검토 v2' }, SEEN)).toEqual({ ok: true })
    expect(db.writes.map(w => Object.keys(w.patch).sort())).toEqual([['name', 'updated_at']])
  })

  it('Q05 — 내가 고친 칸을 다른 사람이 먼저 바꿨으면 쓰지 않고 충돌과 그 값을 돌려준다', async () => {
    const db = fakeDb({ wbs_items: [item({ name: '남이 바꾼 이름' })], task_dependencies: [], change_logs: [] })
    expect(await updateWbsFields('w1', { ...SEEN, name: '설계 검토 v2' }, SEEN)).toMatchObject({ ok: false, conflict: true, latest: { name: '남이 바꾼 이름' } })
    expect(db.writes).toEqual([])
  })

  it('내가 고치지 않은 칸을 다른 사람이 바꿨으면 그 칸은 건드리지 않는다 — 낡은 폼 값으로 남의 변경을 되돌리지 않는다', async () => {
    const db = fakeDb({ wbs_items: [item({ planned_end: '2026-09-09', deliverable: '남의 산출물' })], task_dependencies: [], change_logs: [] })
    expect(await updateWbsFields('w1', { ...SEEN, name: '설계 검토 v2' }, SEEN)).toEqual({ ok: true })
    expect(db.tables.wbs_items[0]).toMatchObject({ name: '설계 검토 v2', planned_end: '2026-09-09', deliverable: '남의 산출물' })
  })

  it('기대값 없이 부르면 옛 동작이다(AI 제안 적용 — 남은 무조건 저장 경로, 보고 목록)', async () => {
    const db = fakeDb({ wbs_items: [item({ planned_end: '2026-09-09' })], task_dependencies: [], change_logs: [] })
    expect(await updateWbsFields('w1', { plannedEnd: '2026-09-05' })).toEqual({ ok: true })
    expect(db.tables.wbs_items[0].planned_end).toBe('2026-09-05')
  })

  it('updateDeliverable — 본 값과 다르면 쓰지 않고 latest, 같으면 쓴다. 이미 내 값이면 충돌이 아니다', async () => {
    mocks.requireProjectMember.mockResolvedValue({ ok: true, actor: makeAdminActor('p1') })
    let db = fakeDb({ wbs_items: [item({ deliverable: '남의 산출물' })], change_logs: [] })
    expect(await updateDeliverable('w1', '최종본', '초안')).toMatchObject({ ok: false, conflict: true, latest: '남의 산출물' })
    expect(db.writes).toEqual([])
    db = fakeDb({ wbs_items: [item()], change_logs: [] })
    expect(await updateDeliverable('w1', '최종본', '초안')).toEqual({ ok: true })
    expect(db.tables.wbs_items[0].deliverable).toBe('최종본')
    db = fakeDb({ wbs_items: [item({ deliverable: '최종본' })], change_logs: [] })
    expect(await updateDeliverable('w1', '최종본', '초안')).toEqual({ ok: true })
    expect(db.writes).toEqual([])
  })
})
