// 포털 로더 v0(§5.9) — 꺼진 모듈의 원천은 조회하지 않음(D39), 원천 하나의 실패는 failedKinds, 워크스페이스 한정, 여러 프로젝트 조회는 끝까지(1,000행 넘는 픽스처).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ effectiveModulesMany: vi.fn(), getMyMeetings: vi.fn(async () => ({ ok: true, meetings: [], exceptions: [] })), seoulToday: vi.fn(() => '2026-10-01') }))
vi.mock('@/lib/modules/effectiveMany', () => ({ effectiveModulesMany: h.effectiveModulesMany }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings: h.getMyMeetings }))
vi.mock('@/lib/domain/dates', async (orig) => ({ ...(await orig<object>()), seoulToday: h.seoulToday }))

import { countMyReview, getMyWork, listWorkspaceProjects } from '@/lib/data/portal'
import { makeActor } from '../fixtures/actor'
import type { ModuleId } from '@/lib/modules/defaults'

const WA = '00000000-0000-0000-7e57-0000000016d1', WB = '00000000-0000-0000-7e57-0000000016d2'
const P1 = '00000000-0000-0000-7e57-0000000016d3', PB = '00000000-0000-0000-7e57-0000000016d4'
const CORE: ModuleId[] = ['dashboard', 'wbs', 'members', 'settings']
const actor = makeActor({ workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]), projectWorkspace: new Map([[P1, WA], [PB, WB]]),
  projectRoles: new Map([[P1, 'member'], [PB, 'member']]), memberIds: new Map([[P1, 'm1'], [PB, 'mb']]) })

type Row = Record<string, unknown>
/** 표마다 행 — eq/in/neq/is/or/order/range/select(count) 를 흉내 낸다. fail 이면 그 표 조회 오류. calls 에 표 이름, ins 에 in() 인자 */
function fake(tables: Record<string, Row[]>, opts: { fail?: string; calls?: string[]; ins?: [string, string, unknown[]][] } = {}) {
  return {
    from(table: string) {
      opts.calls?.push(table)
      let rows = [...(tables[table] ?? [])]; let counted = false
      const get = (r: Row, c: string) => c.split('.').reduce<unknown>((v, k) => (v as Row | undefined)?.[k], r)
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { counted = !!o?.count; return q },
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => get(r, c) === v); return q },
        neq: (c: string, v: unknown) => { rows = rows.filter((r) => get(r, c) !== v); return q },
        in: (c: string, vs: unknown[]) => { opts.ins?.push([table, c, vs]); rows = rows.filter((r) => vs.includes(get(r, c))); return q },
        is: () => q, or: () => q, order: () => q, limit: () => q, lte: () => q, gte: () => q, ilike: () => q,
        range: (a: number, b: number) => Promise.resolve(opts.fail === table ? { data: null, error: { message: 'down' }, count: null } : { data: rows.slice(a, b + 1), error: null, count: counted ? rows.length : null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(opts.fail === table ? { data: null, error: { message: 'down' } } : { data: rows, error: null }).then(res),
      }
      return q
    },
  }
}

beforeEach(() => { vi.clearAllMocks() })

describe('getMyWork', () => {
  it('어떤 프로젝트에서도 effective 가 아닌 모듈의 원천은 조회하지 않는다(D39)', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set(CORE)]]), failed: [] })
    const calls: string[] = []
    const r = await getMyWork(WA, actor, { client: fake({ wbs_items: [] }, { calls }) as never })
    expect(r).toMatchObject({ ok: true, failedKinds: [] })
    expect(calls).not.toContain('issue_assignees')
    expect(calls).not.toContain('agent_work_orders')
    expect(h.getMyMeetings).not.toHaveBeenCalled()
  })
  it('워크스페이스 한정 — 다른 워크스페이스 프로젝트(PB)는 판정·조회 대상이 아니다', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set([...CORE, 'issues'] as ModuleId[])]]), failed: [] })
    const ins: [string, string, unknown[]][] = []
    await getMyWork(WA, actor, { client: fake({}, { ins }) as never })
    expect(h.effectiveModulesMany).toHaveBeenCalledWith(WA, [P1], expect.anything())
    for (const [, col, vs] of ins.filter(([, c]) => c === 'project_id')) expect(vs, col).toEqual([P1])
    for (const [, , vs] of ins.filter(([, c]) => c === 'assignee_member_id' || c === 'member_id')) expect(vs).toEqual(['m1'])
  })
  it('원천 하나의 실패는 전체 실패가 아니라 failedKinds', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set([...CORE, 'issues'] as ModuleId[])]]), failed: [] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getMyWork(WA, actor, { client: fake({ wbs_items: [] }, { fail: 'issue_assignees' }) as never })
    expect(r).toMatchObject({ ok: true, failedKinds: ['issue'] })
    err.mockRestore()
  })
  it('모듈 판정이 일부 프로젝트에서 실패하면 비core 원천은 빠졌을 수 있다고 알리고, core(WBS)는 판정 없이 읽는다', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map(), failed: [P1] })
    const calls: string[] = []
    const r = await getMyWork(WA, actor, { client: fake({ wbs_items: [] }, { calls }) as never })
    expect(r).toMatchObject({ ok: true, rows: [] })
    expect(r.ok && [...r.failedKinds].sort()).toEqual(['approval', 'issue', 'meeting'])
    expect(calls).toContain('wbs_items')
    expect(calls).not.toContain('issue_assignees')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(countMyReview(WA, actor, { client: fake({}) as never })).resolves.toBeNull()
    err.mockRestore()
  })
  it('WBS 원천은 1,000행을 넘어도 끝까지 읽는다(D51) — 리프 판정의 하위 조회도 id 를 나눠 묻는다', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set(CORE)]]), failed: [] })
    const many = Array.from({ length: 1205 }, (_, i) => ({ id: `w${String(i).padStart(4, '0')}`, name: `작업 ${i}`, project_id: P1, planned_end: '2026-10-05', actual_pct: 0, parent_id: i === 7 ? 'w0003' : null, assignee_member_id: 'm1' }))
    const ins: [string, string, unknown[]][] = []
    const r = await getMyWork(WA, actor, { limit: 50, client: fake({ wbs_items: many }, { ins }) as never })
    expect(r.ok && r.rows).toHaveLength(50)
    expect(r.ok && r.nextCursor).not.toBeNull()
    expect(r.ok && r.rows.map((x) => x.id)).not.toContain('w0003')                     // 자식이 있는 행은 리프가 아니다
    const parentIns = ins.filter(([, c]) => c === 'parent_id')
    expect(parentIns.length).toBeGreaterThan(1)
    expect(Math.max(...parentIns.map(([, , vs]) => vs.length))).toBeLessThanOrEqual(200)
  })
  it('지난 기한은 overdueDays, 행 링크는 프로젝트 화면', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set(CORE)]]), failed: [] })
    const r = await getMyWork(WA, actor, { client: fake({ wbs_items: [
      { id: 'w1', name: '늦음', project_id: P1, planned_end: '2026-09-28', actual_pct: null, parent_id: null, assignee_member_id: 'm1', projects: { name: 'Apollo' } },
    ] }) as never })
    expect(r.ok && r.rows[0]).toMatchObject({ kind: 'wbs', overdueDays: 3, projectName: 'Apollo', status: '미착수', href: `/p/${P1}/wbs?focus=w1` })
  })
})

describe('countMyReview·listWorkspaceProjects', () => {
  it('검토 대기 조회 실패는 0 이 아니라 null(D34)', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set([...CORE, 'agents'] as ModuleId[])]]), failed: [] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(countMyReview(WA, actor, { client: fake({}, { fail: 'agent_work_orders' }) as never })).resolves.toBeNull()
    err.mockRestore()
  })
  it('검토 대기 — 조회 전용(명단 행은 있으나 access_role 없음) 프로젝트의 주문은 승인 대상이 아니다(결재 배지와 같은 축)', async () => {
    const PV = '00000000-0000-0000-7e57-0000000016d5'
    const viewer = makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[P1, WA], [PV, WA]]),
      projectRoles: new Map([[P1, 'member']]), memberIds: new Map([[P1, 'm1'], [PV, 'mv']]) })
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set([...CORE, 'agents'] as ModuleId[])], [PV, new Set([...CORE, 'agents'] as ModuleId[])]]), failed: [] })
    const tree = (pid: string, me: string) => [
      { id: `${pid}-root`, parent_id: null, assignee_member_id: me, name: '상위', project_id: pid, projects: { name: pid } },
      { id: `${pid}-leaf`, parent_id: `${pid}-root`, assignee_member_id: 'someone', name: '리프', project_id: pid, projects: { name: pid } },
    ]
    const client = fake({
      agent_work_orders: [P1, PV].map((pid) => ({ id: `o-${pid}`, project_id: pid, wbs_item_id: `${pid}-leaf`, claimed_by_user_id: null, created_at: 'x', status: 'reported' })),
      wbs_items: [...tree(P1, 'm1'), ...tree(PV, 'mv')],
    })
    await expect(countMyReview(WA, viewer, { client: client as never })).resolves.toBe(1)
  })
  it('셸 목록 — 그 워크스페이스 프로젝트, 비공개는 볼 수 있는 것만, 관리자 여부', async () => {
    const r = await listWorkspaceProjects(WA, actor, { client: fake({ projects: [
      { id: P1, name: 'Apollo', start_date: null, end_date: null, is_private: false, workspace_id: WA },
      { id: '00000000-0000-0000-7e57-0000000016d9', name: 'Secret', start_date: null, end_date: null, is_private: true, workspace_id: WA },
      { id: PB, name: 'Other', start_date: null, end_date: null, is_private: false, workspace_id: WB },
    ] }) as never })
    expect(r).toEqual({ ok: true, rows: [{ id: P1, name: 'Apollo', status: 'ready', isAdmin: false }] })
  })
})
