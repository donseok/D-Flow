// 포털 로더 v0(§5.9) — 꺼진 모듈의 원천은 조회하지 않음(D39), 원천 하나의 실패는 failedKinds, 워크스페이스 한정, 여러 프로젝트 조회는 끝까지(1,000행 넘는 픽스처).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ effectiveModulesMany: vi.fn(), getMyMeetings: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; meetings: unknown[]; exceptions: unknown[] }>>(async () => ({ ok: true, meetings: [], exceptions: [] })), getProjectsCompletion: vi.fn(async () => null),
  // '오늘'의 범위 tz(SP5 과제 32) — 기본은 모든 프로젝트·워크스페이스가 UTC(아래 beforeEach 의 시계와 함께 옛 기대값 '2026-10-01' 을 지킨다)
  getProjectTimezones: vi.fn(async (ids: readonly string[]) => new Map<string, string | null>(ids.map((id) => [id, 'UTC']))),
  getWorkspaceConfig: vi.fn<(id: string, opts?: unknown) => Promise<unknown>>(async () => ({ calendar: { timezone: 'UTC' }, calendarError: null })) }))
vi.mock('@/lib/modules/effectiveMany', () => ({ effectiveModulesMany: h.effectiveModulesMany }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings: h.getMyMeetings }))
vi.mock('@/lib/data/wbs', () => ({ getProjectsCompletion: h.getProjectsCompletion }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({ ...(await orig<object>()), getProjectTimezones: h.getProjectTimezones }))
vi.mock('@/lib/settings/workspaceConfig', async (orig) => ({ ...(await orig<object>()), getWorkspaceConfig: h.getWorkspaceConfig }))

import { countMyReview, getMyWork, getProjectRows, getWorkspaceAnnouncements, listWorkspaceProjects } from '@/lib/data/portal'
import { makeActor } from '../fixtures/actor'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import type { ModuleId } from '@/lib/modules/defaults'

const WA = '00000000-0000-0000-7e57-0000000016d1', WB = '00000000-0000-0000-7e57-0000000016d2'
const P1 = '00000000-0000-0000-7e57-0000000016d3', PB = '00000000-0000-0000-7e57-0000000016d4'
const CORE: ModuleId[] = ['dashboard', 'wbs', 'members', 'settings']
const actor = makeActor({ workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]), projectWorkspace: new Map([[P1, WA], [PB, WB]]),
  projectRoles: new Map([[P1, 'member'], [PB, 'member']]), memberIds: new Map([[P1, 'm1'], [PB, 'mb']]) })

type Row = Record<string, unknown>
/** 표마다 행 — eq/in/neq/is/or/order/range/select(count) 를 흉내 낸다. fail 이면 그 표 조회 오류. calls 에 표 이름, ins 에 in() 인자 */
function fake(tables: Record<string, Row[]>, opts: { fail?: string; calls?: string[]; ins?: [string, string, unknown[]][]; queries?: { table: string; ins: unknown[][]; ors: string[] }[] } = {}) {
  return {
    from(table: string) {
      opts.calls?.push(table)
      const rec = { table, ins: [] as unknown[][], ors: [] as string[] }
      opts.queries?.push(rec)
      // 가시성 조회(projects)는 표를 안 준 테스트에서도 같은 기본 행(비공개 PS 포함)을 읽는다
      let rows = [...(tables[table] ?? (table === 'projects' ? PROJECT_ROWS : []))]; let counted = false; let cap = Infinity
      const keys: [string, boolean][] = []
      // 정렬·상한은 가져갈 때(range/then) 적용한다 — order()·limit() 호출 순서와 무관하게 PostgREST 처럼 정렬 뒤 자른다
      const out = () => {
        const sorted = keys.length ? [...rows].sort((a, b) => { for (const [c, asc] of keys) { const x = String(get(a, c) ?? ''), y = String(get(b, c) ?? ''); if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1) } return 0 }) : rows
        return sorted.slice(0, cap)
      }
      const get = (r: Row, c: string) => c.split('.').reduce<unknown>((v, k) => (v as Row | undefined)?.[k], r)
      const q: Record<string, unknown> = {
        select: (_c: string, o?: { count?: string }) => { counted = !!o?.count; return q },
        eq: (c: string, v: unknown) => { rows = rows.filter((r) => get(r, c) === v); return q },
        neq: (c: string, v: unknown) => { rows = rows.filter((r) => get(r, c) !== v); return q },
        in: (c: string, vs: unknown[]) => { opts.ins?.push([table, c, vs]); rec.ins.push(vs); rows = rows.filter((r) => vs.includes(get(r, c))); return q },
        is: () => q, or: (f: string) => { rec.ors.push(f); return q }, order: (c: string, o?: { ascending?: boolean }) => { keys.push([c, o?.ascending !== false]); return q }, limit: (n: number) => { cap = n; return q }, lte: () => q, gte: () => q, ilike: () => q,
        range: (a: number, b: number) => Promise.resolve(opts.fail === table ? { data: null, error: { message: 'down' }, count: null } : { data: out().slice(a, b + 1), error: null, count: counted ? rows.length : null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(opts.fail === table ? { data: null, error: { message: 'down' } } : { data: out(), error: null }).then(res),
      }
      return q
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T12:00:00Z'))                         // UTC 의 오늘 2026-10-01(옛 seoulToday 목과 같은 날)
})
afterEach(() => { vi.useRealTimers() })

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

// ── U2a-5 수정 S1·S3 — 비공개 프로젝트는 홈·내 업무에서도 명단 밖 멤버에게 숨는다(0070 화면 숨김 — RLS 경계가 아니라 앱 층 규칙), 공지·프로젝트 행 로더 규칙
const PS = '00000000-0000-0000-7e57-0000000016e1'          // WA 의 비공개 프로젝트 — actor 는 명단 밖
const PROJECT_ROWS = [
  { id: P1, name: 'Apollo', start_date: '2026-09-01', end_date: '2026-12-31', is_private: false, workspace_id: WA },
  { id: PS, name: 'Secret', start_date: '2026-09-01', end_date: '2026-12-31', is_private: true, workspace_id: WA },
  { id: PB, name: 'Other', start_date: null, end_date: null, is_private: false, workspace_id: WB },
]
const ANN = (id: string, pid: string, name: string, extra: Row = {}) => ({ id, title: `공지 ${id}`, project_id: pid, is_pinned: false, created_at: '2026-10-01T00:00:00Z', projects: { name }, ...extra })
/** 비공개 PS 를 아는 화면 — PS 는 같은 워크스페이스라 projectWorkspace 에는 있지만 이 사용자는 PS 의 명단 권한이 없다(조회 전용 행만) */
const outsider = makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[P1, WA], [PS, WA]]),
  projectRoles: new Map([[P1, 'member']]), memberIds: new Map([[P1, 'm1'], [PS, 'mps']]) })
const wsAdmin = makeActor({ workspaceRoles: new Map([[WA, 'admin']]), projectWorkspace: new Map([[P1, WA], [PS, WA]]), projectRoles: new Map(), memberIds: new Map() })
const ALL_ON = (...ids: string[]) => new Map(ids.map((p) => [p, new Set([...CORE, 'announcements', 'issues'] as ModuleId[])]))

describe('getWorkspaceAnnouncements — S1·S2·S3', () => {
  it('S1 비공개·명단 밖 프로젝트의 공지는 홈에 없다 — 그 프로젝트 이름도 실리지 않는다(조회 인자에서 이미 빠진다)', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1, PS), failed: [] })
    const ins: [string, string, unknown[]][] = []
    const r = await getWorkspaceAnnouncements(WA, outsider, { client: fake({ projects: PROJECT_ROWS, announcements: [ANN('a1', P1, 'Apollo'), ANN('a2', PS, 'Secret')] }, { ins }) as never })
    expect(r).toMatchObject({ ok: true })
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(['a1'])
    expect(JSON.stringify(r)).not.toContain('Secret')
    expect(ins.filter(([t, c]) => t === 'announcements' && c === 'project_id').map(([, , vs]) => vs)).toEqual([[P1]])
  })
  it('S1 워크스페이스 관리자·명단자에게는 비공개 프로젝트의 공지도 보인다', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1, PS), failed: [] })
    const mk = () => fake({ projects: PROJECT_ROWS, announcements: [ANN('a1', P1, 'Apollo'), ANN('a2', PS, 'Secret')] }) as never
    const a = await getWorkspaceAnnouncements(WA, wsAdmin, { client: mk() })
    expect(a.ok && a.rows.map((x) => x.id).sort()).toEqual(['a1', 'a2'])
    const roster = makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[P1, WA], [PS, WA]]), projectRoles: new Map([[PS, 'member']]), memberIds: new Map() })
    const b = await getWorkspaceAnnouncements(WA, roster, { client: mk() })
    expect(b.ok && b.rows.map((x) => x.id)).toContain('a2')
  })
  it('S3 다른 워크스페이스 프로젝트(PB)는 인자에 없고, announcements 가 꺼진 프로젝트는 조회하지 않는다(D39)', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([[P1, new Set(CORE)]]), failed: [] })
    const calls: string[] = []
    const r = await getWorkspaceAnnouncements(WA, actor, { client: fake({ projects: PROJECT_ROWS }, { calls }) as never })
    expect(r).toEqual({ ok: true, rows: [], partial: false })
    expect(calls).not.toContain('announcements')
    expect(h.effectiveModulesMany).toHaveBeenCalledWith(WA, [P1], expect.anything())
  })
  it('S3 조회 오류는 빈 목록이 아니라 ok:false', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1), failed: [] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getWorkspaceAnnouncements(WA, actor, { client: fake({ projects: PROJECT_ROWS }, { fail: 'announcements' }) as never })
    expect(r).toMatchObject({ ok: false })
    const r2 = await getWorkspaceAnnouncements(WA, actor, { client: fake({}, { fail: 'projects' }) as never })
    expect(r2).toMatchObject({ ok: false })
    err.mockRestore()
  })
  it('S2 모듈 판정이 일부 프로젝트에서 실패하면 partial — 로그만 남기고 정상 목록처럼 보이지 않는다', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1), failed: ['x'] })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getWorkspaceAnnouncements(WA, actor, { client: fake({ projects: PROJECT_ROWS, announcements: [ANN('a1', P1, 'Apollo')] }) as never })
    expect(r).toMatchObject({ ok: true, partial: true })
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1), failed: [] })
    expect(await getWorkspaceAnnouncements(WA, actor, { client: fake({ projects: PROJECT_ROWS, announcements: [ANN('a1', P1, 'Apollo')] }) as never })).toMatchObject({ ok: true, partial: false })
    err.mockRestore()
  })
  it('S3 상한 — limit 만큼만, 고정 공지가 앞', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1), failed: [] })
    const rows = Array.from({ length: 8 }, (_, i) => ANN(`a${i}`, P1, 'Apollo', { is_pinned: i === 6, created_at: `2026-10-0${i + 1}T00:00:00Z` }))
    const r = await getWorkspaceAnnouncements(WA, actor, { limit: 3, client: fake({ projects: PROJECT_ROWS, announcements: rows }) as never })
    expect(r.ok && r.rows).toHaveLength(3)
    expect(r.ok && r.rows[0].id).toBe('a6')
  })
})

describe('getMyWork — S1 비공개·조회 전용', () => {
  it('비공개 프로젝트에 조회 전용(명단 행만) 으로 올라 담당이 걸려도 그 프로젝트의 작업·이슈·회의는 내 업무에 없다', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(P1, PS), failed: [] })
    const wbs = (id: string, pid: string, name: string, member: string) => ({ id, name, project_id: pid, planned_end: '2026-10-05', actual_pct: 0, parent_id: null, assignee_member_id: member, projects: { name } })
    const r = await getMyWork(WA, outsider, { client: fake({ projects: PROJECT_ROWS, wbs_items: [wbs('w1', P1, 'Apollo', 'm1'), wbs('w2', PS, 'Secret', 'mps')] }) as never })
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(['w1'])
    expect(JSON.stringify(r)).not.toContain('Secret')
  })
})

describe('getProjectRows — S3', () => {
  it('워크스페이스 한정·status active 필터·비공개 거르기, 조회 오류는 ok:false', async () => {
    const rows = [
      ...PROJECT_ROWS,
      { id: '00000000-0000-0000-7e57-0000000016e2', name: 'Old', start_date: '2020-01-01', end_date: '2020-02-01', is_private: false, workspace_id: WA },
    ]
    const r = await getProjectRows(WA, outsider, { status: 'active', client: fake({ projects: rows }) as never })
    expect(r.ok && r.rows.map((x) => x.name)).toEqual(['Apollo'])                         // Secret(비공개)·Other(다른 워크스페이스)·Old(종료) 제외
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await getProjectRows(WA, outsider, { client: fake({}, { fail: 'projects' }) as never })).toMatchObject({ ok: false })
    err.mockRestore()
  })
  it('이름 검색의 와일드카드(% _ \\ *)는 글자로 취급한다(S4)', async () => {
    const likes: string[] = []
    const client = fake({ projects: PROJECT_ROWS }) as { from: (t: string) => Record<string, unknown> }
    const orig = client.from.bind(client)
    client.from = (t: string) => { const q = orig(t); const il = q.ilike as (c: string, v: string) => unknown; q.ilike = (c: string, v: string) => { likes.push(v); return il(c, v) }; return q }
    await getProjectRows(WA, outsider, { q: 'a*b%c_d\\e', client: client as never })
    expect(likes).toEqual(['%a\\*b\\%c\\_d\\\\e%'])
  })
})

describe('프로젝트가 많은 워크스페이스 — in() 목록을 나눠 묻는다(S4, 요청 URL 길이)', () => {
  it('450 프로젝트: 가시성·작업·공지 조회 어디서도 in() 인자가 200 을 넘지 않는다', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `00000000-0000-0000-7e57-${String(800000 + i).padStart(12, '0')}`)
    const big = makeActor({ workspaceRoles: new Map([[WA, 'admin']]), projectWorkspace: new Map(ids.map((p) => [p, WA])), projectRoles: new Map(ids.map((p) => [p, 'member'])), memberIds: new Map(ids.map((p, i) => [p, `m${i}`])) })
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map(ids.map((p) => [p, new Set([...CORE, 'announcements'] as ModuleId[])])), failed: [] })
    const projects = ids.map((id) => ({ id, name: id, start_date: null, end_date: null, is_private: false, workspace_id: WA }))
    const wbs = ids.map((id, i) => ({ id: `w${i}`, name: `작업 ${i}`, project_id: id, planned_end: null, actual_pct: 0, parent_id: null, assignee_member_id: `m${i}`, projects: { name: id } }))
    const ins: [string, string, unknown[]][] = []
    const client = fake({ projects, wbs_items: wbs, announcements: ids.slice(0, 3).map((id, i) => ANN(`a${i}`, id, id)) }, { ins }) as never
    const w = await getMyWork(WA, big, { limit: 50, client })
    expect(w.ok && w.rows.length).toBe(50)
    const a = await getWorkspaceAnnouncements(WA, big, { client })
    expect(a.ok && a.rows.map((x) => x.id).sort()).toEqual(['a0', 'a1', 'a2'])
    expect(ins.length).toBeGreaterThan(3)
    expect(Math.max(...ins.map(([, , vs]) => vs.length))).toBeLessThanOrEqual(200)
  })
})

// ── SP5 과제 32 — 포털의 '오늘'은 그 데이터가 속한 범위의 tz(merge 리뷰 P2). 옛 판은 서울 고정 네 줄이라 LA 프로젝트에서 셸 공지 배지(프로젝트 tz)·
// 전체 프로젝트 화면의 상태 배지(워크스페이스 tz)와 같은 순간에 다른 판정을 냈다. 프로젝트 데이터(작업·이슈 기한·회의·공지 게시 기간) = 프로젝트 tz,
// 프로젝트 상태(셸 전환기·홈의 프로젝트 행) = 워크스페이스 tz. 달력을 못 읽은 범위는 오늘을 지어내지 않는다(3원칙 ①).
describe("포털의 '오늘' = 범위 tz(SP5 과제 32)", () => {
  // 2026-10-02T23:00Z — LA 10-02(16:00 PDT)·서울 10-03(08:00 KST)·UTC 10-02. 서울 고정이면 LA 프로젝트가 하루 앞당겨진다
  const NOW = new Date('2026-10-02T23:00:00Z')
  const PL = '00000000-0000-0000-7e57-0000000019a1', PK = '00000000-0000-0000-7e57-0000000019a2', PX = '00000000-0000-0000-7e57-0000000019a3'
  const two = makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[PL, WA], [PK, WA], [PX, WA]]),
    projectRoles: new Map([[PL, 'member'], [PK, 'member'], [PX, 'member']]), memberIds: new Map([[PL, 'ml'], [PK, 'mk'], [PX, 'mx']]) })
  const ROWS = [PL, PK, PX].map((id) => ({ id, name: id, start_date: '2026-09-01', end_date: '2026-10-02', is_private: false, workspace_id: WA }))
  const tzs = (m: Record<string, string | null>) => h.getProjectTimezones.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, id in m ? m[id] : 'UTC'])))

  it('공지 게시 기간 — 프로젝트마다 그 tz 의 오늘로 묻는다(셸 공지 배지와 같은 판정), tz 를 못 읽은 프로젝트는 빼고 partial', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: ALL_ON(PL, PK, PX), failed: [] })
    tzs({ [PL]: 'America/Los_Angeles', [PK]: 'Asia/Seoul', [PX]: null })
    const queries: { table: string; ins: unknown[][]; ors: string[] }[] = []
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getWorkspaceAnnouncements(WA, two, { now: NOW, client: fake({ projects: ROWS, announcements: [ANN('a1', PL, 'L'), ANN('a2', PK, 'K'), ANN('a3', PX, 'X')] }, { queries }) as never })
    const ann = queries.filter((q) => q.table === 'announcements').map((q) => ({ ids: q.ins[0], ors: q.ors }))
    expect(ann).toEqual(expect.arrayContaining([
      { ids: [PL], ors: ['publish_from.is.null,publish_from.lte.2026-10-02', 'publish_to.is.null,publish_to.gte.2026-10-02'] },
      { ids: [PK], ors: ['publish_from.is.null,publish_from.lte.2026-10-03', 'publish_to.is.null,publish_to.gte.2026-10-03'] },
    ]))
    expect(ann).toHaveLength(2)                                                      // PX(tz 모름)는 묻지 않는다
    expect(r).toMatchObject({ ok: true, partial: true })
    expect(r.ok && r.rows.map((x) => x.id).sort()).toEqual(['a1', 'a2'])
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('내 업무 — 지연 일수는 프로젝트 tz 의 오늘, 오늘 회의는 프로젝트마다 그 날짜만, tz 를 못 읽은 프로젝트의 원천은 failedKinds', async () => {
    h.effectiveModulesMany.mockResolvedValue({ sets: new Map([PL, PK, PX].map((p) => [p, new Set([...CORE, 'meetings'] as ModuleId[])])), failed: [] })
    tzs({ [PL]: 'America/Los_Angeles', [PK]: 'Asia/Seoul', [PX]: null })
    const mtg = (id: string, projectId: string, meetingDate: string) => ({ id, projectId, projectName: projectId, title: id, meetingDate, startTime: '10:00', endTime: null, location: null,
      category: 'general', body: '', recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null, createdAt: '', updatedAt: '', attendeeIds: [], isMine: true })
    h.getMyMeetings.mockResolvedValue({ ok: true, meetings: [mtg('m-l2', PL, '2026-10-02'), mtg('m-l3', PL, '2026-10-03'), mtg('m-k3', PK, '2026-10-03'), mtg('m-x2', PX, '2026-10-02')], exceptions: [] })
    const wbs = (id: string, pid: string, member: string) => ({ id, name: id, project_id: pid, planned_end: '2026-10-01', actual_pct: null, parent_id: null, assignee_member_id: member, projects: { name: pid } })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await getMyWork(WA, two, { now: NOW, client: fake({ projects: ROWS, wbs_items: [wbs('w-l', PL, 'ml'), wbs('w-k', PK, 'mk'), wbs('w-x', PX, 'mx')] }) as never })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const by = Object.fromEntries(r.rows.map((x) => [x.id, x]))
    expect(by['w-l'].overdueDays).toBe(1)                                           // LA 오늘 10-02 − 기한 10-01
    expect(by['w-k'].overdueDays).toBe(2)                                           // 서울 오늘 10-03 − 기한 10-01
    expect(by['w-x']).toBeUndefined()                                               // tz 모름 — 지연 일수를 지어내지 않는다
    expect(h.getMyMeetings).toHaveBeenCalledWith(WA, '2026-10-02', '2026-10-03')    // 범위 = 아는 오늘들의 최소·최대
    expect(r.rows.filter((x) => x.kind === 'meeting').map((x) => x.id).sort()).toEqual(['m-k3:2026-10-03', 'm-l2:2026-10-02'])
    expect([...r.failedKinds].sort()).toEqual(['meeting', 'wbs'])
    err.mockRestore()
  })

  it('프로젝트 상태 — 워크스페이스 tz 의 오늘(전체 프로젝트 화면의 상태 배지와 같은 판정): 종료일 10-02 가 LA 에서는 진행, 서울에서는 아니다', async () => {
    const one = [ROWS[0]]
    h.getWorkspaceConfig.mockResolvedValue({ calendar: { timezone: 'America/Los_Angeles' }, calendarError: null })
    expect((await getProjectRows(WA, two, { now: NOW, status: 'active', client: fake({ projects: one }) as never }))).toMatchObject({ ok: true, rows: [{ id: PL, status: 'active' }] })
    expect(await listWorkspaceProjects(WA, two, { now: NOW, client: fake({ projects: one }) as never })).toMatchObject({ ok: true, rows: [{ id: PL, status: 'active' }] })
    h.getWorkspaceConfig.mockResolvedValue({ calendar: { timezone: 'Asia/Seoul' }, calendarError: null })
    expect((await getProjectRows(WA, two, { now: NOW, status: 'active', client: fake({ projects: one }) as never }))).toEqual({ ok: true, rows: [], nextCursor: null })
    expect(h.getWorkspaceConfig).toHaveBeenCalledWith(WA, expect.anything())
  })

  it('워크스페이스 달력을 못 읽으면 상태는 모름 — 셸 목록은 unknown, 상태로 거르는 홈 행은 빈 목록이 아니라 ok:false(3원칙 ①)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getWorkspaceConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone') })
    expect(await listWorkspaceProjects(WA, two, { now: NOW, client: fake({ projects: [ROWS[0]] }) as never })).toMatchObject({ ok: true, rows: [{ id: PL, status: 'unknown' }] })
    expect(await getProjectRows(WA, two, { now: NOW, status: 'active', client: fake({ projects: [ROWS[0]] }) as never })).toMatchObject({ ok: false })
    expect(await getProjectRows(WA, two, { now: NOW, client: fake({ projects: [ROWS[0]] }) as never })).toMatchObject({ ok: true, rows: [{ id: PL, status: 'unknown' }] })
    h.getWorkspaceConfig.mockRejectedValue(new ConfigUnavailableError('설정 조회 실패'))
    expect(await listWorkspaceProjects(WA, two, { now: NOW, client: fake({ projects: [ROWS[0]] }) as never })).toMatchObject({ ok: true, rows: [{ id: PL, status: 'unknown' }] })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
