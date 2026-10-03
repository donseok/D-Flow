// 포털 로더 v1(SP3b UI-3 과제 9, 스펙 §6.1·§5.9) — SP5 A 의 범위 tz '오늘'·가시성 거르기 위에 얹는다(판정 R1).
// 요약·검토·다가오는 회의·최근 회의록·모듈 합집합·프로젝트 행 v1. 비공개(명단 밖) 프로젝트는 어디서도 새지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  many: vi.fn(), wsMods: vi.fn(), meetings: vi.fn(), prefs: vi.fn(), completion: vi.fn(),
  tzs: vi.fn(async (ids: readonly string[]) => new Map<string, string | null>(ids.map((id) => [id, 'UTC']))),
  wsCfg: vi.fn(async () => ({ calendar: { timezone: 'UTC' }, calendarError: null })),
}))
vi.mock('@/lib/modules/effectiveMany', () => ({ effectiveModulesMany: m.many }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.wsMods }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings: m.meetings }))
vi.mock('@/lib/data/wbs', () => ({ getProjectsCompletion: m.completion }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: m.prefs }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({ ...(await orig<object>()), getProjectTimezones: m.tzs }))
vi.mock('@/lib/settings/workspaceConfig', async (orig) => ({ ...(await orig<object>()), getWorkspaceConfig: m.wsCfg }))
import { fake } from './_fake'
import { makeActor } from '../fixtures/actor'
import {
  countMyReview, getMyWork, getPortalSummary, getProjectRows, getRecentDocuments, getReviewRows, getUpcomingMeetings, workspaceModuleSets,
} from '@/lib/data/portal'
import type { ModuleId } from '@/lib/modules/defaults'

const WA = '00000000-0000-0000-7e57-000000001840', WB = '00000000-0000-0000-7e57-000000001849'
const P1 = '00000000-0000-0000-7e57-000000001841', P2 = '00000000-0000-0000-7e57-000000001842', PS = '00000000-0000-0000-7e57-000000001846'
const M1 = '00000000-0000-0000-7e57-000000001843', M2 = '00000000-0000-0000-7e57-000000001844', MS = '00000000-0000-0000-7e57-000000001847'
const TODAY = '2026-10-01'
const NOW = new Date('2026-10-01T12:00:00Z')                                   // 모든 범위 tz 가 UTC — 오늘 = 2026-10-01
/** P1 관리자·P2 멤버, PS 는 같은 워크스페이스의 비공개 프로젝트 — 명단 행(memberIds)은 있으나 권한이 없다(조회 전용) → 볼 수 없다 */
const actor = makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectRoles: new Map([[P1, 'admin'], [P2, 'member']]),
  projectWorkspace: new Map([[P1, WA], [P2, WA], [PS, WA]]), memberIds: new Map([[P1, M1], [P2, M2], [PS, MS]]) })
const ON = new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings', 'issues', 'agents', 'meetings', 'minutes', 'announcements'])
const PROJECTS = [
  { id: P1, name: 'Acme', description: null, start_date: '2026-09-01', end_date: '2026-12-31', is_private: false, workspace_id: WA },
  { id: P2, name: 'Beta', description: '설명', start_date: '2026-01-01', end_date: '2026-09-30', is_private: false, workspace_id: WA },
  { id: PS, name: 'Secret', description: null, start_date: '2026-01-01', end_date: '2026-12-31', is_private: true, workspace_id: WA },
]
const wbs = (id: string, pid: string, member: string, end: string | null, pct: number | null, name: string) =>
  ({ id, name, project_id: pid, parent_id: null, assignee_member_id: member, planned_end: end, actual_pct: pct, projects: { name } })
const tables = (over: Record<string, unknown[]> = {}) => ({
  projects: PROJECTS,
  wbs_items: [wbs('w1', P1, M1, TODAY, 10, 'Acme'), wbs('w2', P2, M2, '2026-09-20', null, 'Beta'), wbs('ws1', PS, MS, TODAY, 0, 'Secret')],
  issue_assignees: [
    { issue_id: 'i1', project_id: P1, member_id: M1, issues: { id: 'i1', title: '이슈', status: 'open', due_date: '2026-10-09', project_id: P1, projects: { name: 'Acme' } } },
    { issue_id: 'is', project_id: PS, member_id: MS, issues: { id: 'is', title: '비밀 이슈', status: 'open', due_date: TODAY, project_id: PS, projects: { name: 'Secret' } } },
  ],
  agent_work_orders: [{ id: 'o1', project_id: P1, wbs_item_id: 'w1', claimed_by_user_id: null, created_at: '2026-09-30T00:00:00Z', status: 'reported', wbs_items: { name: '오늘 마감 작업' }, projects: { name: 'Acme' } }],
  minutes: [
    { id: 'mn1', title: 'Acme 회의록', minute_date: '2026-09-30', project_id: P1, meeting_id: null, workspace_id: WA, updated_at: '2026-09-30T09:00:00Z', projects: { name: 'Acme' } },
    { id: 'mn2', title: '전사 회의록', minute_date: '2026-09-29', project_id: null, meeting_id: null, workspace_id: WA, updated_at: '2026-09-29T09:00:00Z', projects: null },
    { id: 'mn3', title: '비밀 회의록', minute_date: '2026-10-01', project_id: PS, meeting_id: null, workspace_id: WA, updated_at: '2026-10-01T09:00:00Z', projects: { name: 'Secret' } },
    { id: 'mn4', title: '비밀 회의 연결록', minute_date: '2026-10-01', project_id: null, meeting_id: 'mt-s', workspace_id: WA, updated_at: '2026-10-01T08:00:00Z', projects: null, meetings: { project_id: PS } },
    { id: 'mn5', title: '연결 회의록', minute_date: '2026-09-28', project_id: null, meeting_id: 'mt-1', workspace_id: WA, updated_at: '2026-09-28T09:00:00Z', projects: null, meetings: { project_id: P1, projects: { name: 'Acme' } } },
    { id: 'mn6', title: '다른 워크스페이스', minute_date: '2026-10-01', project_id: null, meeting_id: null, workspace_id: WB, updated_at: '2026-10-01T10:00:00Z', projects: null },
    { id: 'mn7', title: '보관됨', minute_date: '2026-10-01', project_id: P1, meeting_id: null, workspace_id: WA, archived_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T11:00:00Z', projects: { name: 'Acme' } },
  ],
  ...over,
})
const mtg = (id: string, projectId: string, meetingDate: string, startTime: string | null, isMine: boolean, title = id) => ({ id, projectId, projectName: projectId, title, meetingDate, startTime,
  endTime: null, location: null, category: 'general', body: '', recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null, createdAt: '', updatedAt: '', attendeeIds: [], isMine })
let err: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  err = vi.spyOn(console, 'error').mockImplementation(() => {})
  m.many.mockResolvedValue({ sets: new Map([[P1, ON], [P2, ON], [PS, ON]]), failed: [] })
  m.wsMods.mockResolvedValue(new Set<ModuleId>(['dashboard', 'wbs', 'members', 'settings', 'minutes', 'meetings', 'issues', 'agents', 'announcements']))
  m.prefs.mockResolvedValue({ favoriteProjectIds: [P2] })
  m.meetings.mockResolvedValue({ ok: true, exceptions: [], meetings: [
    mtg('s1', P1, '2026-10-03', '10:00', true, '주간'),
    mtg('s2', P1, '2026-10-03', null, true, '킥오프'),
    mtg('s3', P2, '2026-10-02', '09:00', false, '남의 회의'),
    mtg('s4', PS, '2026-10-02', '09:00', true, '비밀 회의'),
    mtg('s5', P1, '2026-11-05', '09:00', true, '먼 회의'),
    mtg('s6', P1, '2026-10-02', '15:00', true, '내일 회의'),
  ] })
})
afterEach(() => { err.mockRestore() })

describe('getPortalSummary — 칸마다 독립 실패, 행의 프로젝트 오늘(R1)', () => {
  it('내 담당 = 작업 둘 + 이슈 하나, 검토 대기 하나, 오늘 마감 = 기한이 그 프로젝트의 오늘인 작업·이슈 — 비공개 PS 는 세지 않는다', async () => {
    expect(await getPortalSummary(WA, actor, { client: fake(tables()) as never, now: NOW })).toEqual({
      mine: { ok: true, count: 3 }, review: { ok: true, count: 1 }, dueToday: { ok: true, count: 1 } })
  })
  it('오늘 마감은 프로젝트마다 그 tz 의 오늘 — 같은 순간 서울은 다음 날이라 오늘 마감이 아니다', async () => {
    m.tzs.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, id === P1 ? 'Asia/Seoul' : 'UTC'])))
    const late = new Date('2026-10-01T16:00:00Z')                                // 서울 10-02 01:00, UTC 10-01
    const s = await getPortalSummary(WA, actor, { client: fake(tables()) as never, now: late })
    expect(s.dueToday).toEqual({ ok: true, count: 0 })
  })
  it('이슈 원천 실패 → 내 담당·오늘 마감은 실패(사유), 검토 대기는 수', async () => {
    const s = await getPortalSummary(WA, actor, { client: fake(tables(), { fail: 'issue_assignees' }) as never, now: NOW })
    expect(s.mine).toEqual({ ok: false, reason: '일부 항목(이슈)을 불러오지 못했습니다' })
    expect(s.dueToday.ok).toBe(false); expect(s.review).toEqual({ ok: true, count: 1 })
  })
  it('여러 프로젝트 판정이 던지면 세 칸 모두 같은 사유로 실패', async () => {
    m.many.mockRejectedValue(new Error('down'))
    const s = await getPortalSummary(WA, actor, { client: fake(tables()) as never, now: NOW })
    expect([s.mine.ok, s.review.ok, s.dueToday.ok]).toEqual([false, false, false])
  })
  it('가시성(비공개 판정) 조회가 실패해도 세 칸 모두 실패 — 숨길 것을 못 숨기느니 막는다', async () => {
    const s = await getPortalSummary(WA, actor, { client: fake(tables(), { fail: 'projects' }) as never, now: NOW })
    expect([s.mine.ok, s.review.ok, s.dueToday.ok]).toEqual([false, false, false])
  })
})

describe('getMyWork·getReviewRows·countMyReview', () => {
  it('dueToday — 작업·이슈 가운데 기한이 그 프로젝트의 오늘인 행만(W7)', async () => {
    const r = await getMyWork(WA, actor, { client: fake(tables()) as never, dueToday: true, limit: 50, now: NOW })
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(['w1'])
  })
  it('kinds 로 거르고 원천 실패는 요청한 종류와의 교집합만 알린다', async () => {
    const r = await getMyWork(WA, actor, { client: fake(tables(), { fail: 'issue_assignees' }) as never, kinds: ['approval'], now: NOW })
    expect(r).toMatchObject({ ok: true, failedKinds: [] }); expect(r.ok && r.rows.map((x) => x.id)).toEqual(['o1'])
  })
  it('검토 행 = 승인할 수 있는 보고된 주문(D40)', async () => {
    const r = await getReviewRows(WA, actor, { client: fake(tables()) as never, now: NOW })
    expect(r.ok && r.rows.map((x) => [x.kind, x.id])).toEqual([['approval', 'o1']])
  })
  it('검토 원천 실패는 ok:false(0건으로 위장하지 않는다)', async () => {
    expect(await getReviewRows(WA, actor, { client: fake(tables(), { fail: 'agent_work_orders' }) as never, now: NOW })).toMatchObject({ ok: false })
  })
  it('countMyReview 는 셸 배지용 가벼운 판(원천 하나) 그대로 — 작업·이슈를 읽지 않는다', async () => {
    const c = fake(tables())
    expect(await countMyReview(WA, actor, { client: c as never })).toBe(1)
    expect(c.calls.map((x) => x.table)).not.toContain('issue_assignees')
  })
})

describe('workspaceModuleSets(W10, R9 ③)', () => {
  it('판정이 던지면 ok:false — 합집합을 비우지 않는다', async () => {
    m.many.mockRejectedValue(new Error('down'))
    expect((await workspaceModuleSets(WA, actor, fake(tables()) as never)).ok).toBe(false)
  })
  it('워크스페이스 범위 판정이 던져도 ok:false', async () => {
    m.wsMods.mockRejectedValue(new Error('down'))
    expect((await workspaceModuleSets(WA, actor, fake(tables()) as never)).ok).toBe(false)
  })
  it('프로젝트 일부 실패 → partial, 그 프로젝트의 모듈은 합집합에 없다', async () => {
    m.many.mockResolvedValue({ sets: new Map([[P1, new Set<ModuleId>(['wbs'])], [P2, new Set<ModuleId>(['wbs', 'meetings'])]]), failed: [P2] })
    m.wsMods.mockResolvedValue(new Set<ModuleId>(['wbs']))
    const r = await workspaceModuleSets(WA, actor, fake(tables()) as never)
    expect(r.ok && [...r.union]).toEqual(['wbs']); expect(r.ok && r.partial).toBe(true)
  })
  it('비공개(볼 수 없는) 프로젝트의 모듈은 합집합·sets 에 없다', async () => {
    m.many.mockResolvedValue({ sets: new Map([[P1, new Set<ModuleId>(['wbs'])], [P2, new Set<ModuleId>(['wbs'])], [PS, new Set<ModuleId>(['wbs', 'meetings'])]]), failed: [] })
    m.wsMods.mockResolvedValue(new Set<ModuleId>(['wbs']))
    const r = await workspaceModuleSets(WA, actor, fake(tables()) as never)
    expect(r.ok && [...r.union]).toEqual(['wbs']); expect(r.ok && [...r.sets.keys()].sort()).toEqual([P1, P2].sort())
  })
  it('R9 ③ — 워크스페이스 층 모듈(회의록)은 워크스페이스 범위로 판정한다: 접근 가능한 프로젝트가 0개여도 합집합에 든다(회의록 화면 관문과 같은 판정)', async () => {
    const lone = makeActor({ workspaceRoles: new Map([[WA, 'member']]) })
    m.wsMods.mockResolvedValue(new Set<ModuleId>(['wbs', 'minutes', 'meetings']))
    const r = await workspaceModuleSets(WA, lone, fake(tables()) as never)
    expect(r.ok && [...r.union]).toEqual(['minutes'])                               // 프로젝트 층 모듈(meetings)은 프로젝트가 있어야 든다
    expect(m.wsMods).toHaveBeenCalledWith({ workspaceId: WA }, expect.anything())
    m.wsMods.mockResolvedValue(new Set<ModuleId>(['wbs']))
    const off = await workspaceModuleSets(WA, lone, fake(tables()) as never)
    expect(off.ok && off.union.has('minutes')).toBe(false)
  })
})

describe('getUpcomingMeetings(W9 — 내 회차, 그 프로젝트의 오늘부터 30일)', () => {
  it('내 회차만, 날짜 → 종일 먼저 → 시각 순, 비공개·30일 밖·남의 회차 제외', async () => {
    const r = await getUpcomingMeetings(WA, actor, { client: fake(tables()) as never, now: NOW })
    expect(m.meetings).toHaveBeenCalledWith(WA, TODAY, '2026-10-31')
    expect(r.ok && r.rows.map((x) => x.title)).toEqual(['내일 회의', '킥오프', '주간'])
    expect(JSON.stringify(r)).not.toContain('비밀')
  })
  it('limit', async () => {
    const r = await getUpcomingMeetings(WA, actor, { client: fake(tables()) as never, now: NOW, limit: 2 })
    expect(r.ok && r.rows).toHaveLength(2)
  })
  it('원천 실패는 ok:false', async () => {
    m.meetings.mockResolvedValue({ ok: false, error: 'down' })
    expect((await getUpcomingMeetings(WA, actor, { client: fake(tables()) as never, now: NOW })).ok).toBe(false)
  })
  it('회의가 켜진 프로젝트가 없으면 원천을 읽지 않고 빈 목록', async () => {
    m.many.mockResolvedValue({ sets: new Map([[P1, new Set<ModuleId>(['wbs'])], [P2, new Set<ModuleId>(['wbs'])]]), failed: [] })
    expect(await getUpcomingMeetings(WA, actor, { client: fake(tables()) as never, now: NOW })).toEqual({ ok: true, rows: [], partial: false })
    expect(m.meetings).not.toHaveBeenCalled()
  })
})

describe('getRecentDocuments', () => {
  it('그 워크스페이스·보관 안 됨, 워크스페이스 회의록·볼 수 있는 프로젝트의 회의록(회의로 연결된 옛 행 포함)만 — 비공개는 새지 않는다', async () => {
    const c = fake(tables())
    const r = await getRecentDocuments(WA, actor, { client: c as never })
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(['mn1', 'mn2', 'mn5'])
    expect(r.ok && r.rows.map((x) => x.projectName)).toEqual(['Acme', null, 'Acme'])
    expect(JSON.stringify(r)).not.toContain('비밀')
    const mins = c.calls.filter((x) => x.table === 'minutes')
    expect(mins.length).toBeGreaterThan(0)
    for (const call of mins) expect(call.filters).toEqual(expect.arrayContaining([['eq', 'workspace_id', WA], ['is', 'archived_at', null]]))
    for (const call of mins) expect(JSON.stringify(call.filters)).not.toContain(PS)
  })
  it('워크스페이스에서 회의록이 꺼져 있으면 읽지 않고 빈 목록', async () => {
    m.wsMods.mockResolvedValue(new Set<ModuleId>(['wbs']))
    m.many.mockResolvedValue({ sets: new Map([[P1, new Set<ModuleId>(['wbs'])], [P2, new Set<ModuleId>(['wbs'])]]), failed: [] })
    const c = fake(tables())
    expect(await getRecentDocuments(WA, actor, { client: c as never })).toEqual({ ok: true, rows: [] })
    expect(c.calls.map((x) => x.table)).not.toContain('minutes')
  })
  it('프로젝트가 0개여도 워크스페이스 회의록은 보인다(R9 ③)', async () => {
    const lone = makeActor({ workspaceRoles: new Map([[WA, 'member']]) })
    const r = await getRecentDocuments(WA, lone, { client: fake(tables()) as never })
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(['mn2'])
  })
  it('조회 실패는 ok:false', async () => {
    expect(await getRecentDocuments(WA, actor, { client: fake(tables(), { fail: 'minutes' }) as never })).toMatchObject({ ok: false })
  })
})

describe('getProjectRows v1(W5·W6, R1)', () => {
  it('진척·근거·다음 기한·즐겨찾기(늘 읽음)·설명, 잎 조회는 워크스페이스의 볼 수 있는 프로젝트로 좁힌다(전역 완료 조회를 쓰지 않는다)', async () => {
    const c = fake(tables())
    const r = await getProjectRows(WA, actor, { client: c as never, now: NOW })
    const beta = r.ok ? r.rows.find((x) => x.id === P2)! : null
    expect(beta).toMatchObject({ isFavorite: true, status: 'overdue', progress: { done: 0, total: 1 }, statusReason: '종료일 지남 · 미완료 1', description: '설명', nextDue: null })
    const acme = r.ok ? r.rows.find((x) => x.id === P1)! : null
    expect(acme).toMatchObject({ isFavorite: false, status: 'active', progress: { done: 0, total: 1 }, statusReason: '완료 0/1', nextDue: TODAY })
    expect(r.ok && r.rows.map((x) => x.id)).not.toContain(PS)
    const leafCalls = c.calls.filter((x) => x.table === 'wbs_items')
    expect(leafCalls.length).toBeGreaterThan(0)
    for (const call of leafCalls) {
      const ids = call.filters.find(([op, col]) => op === 'in' && col === 'project_id')?.[2] as string[] | undefined
      expect(ids).toBeDefined(); expect(ids).not.toContain(PS)
    }
    expect(m.completion).not.toHaveBeenCalled()
  })
  it('잎이 1,000행을 넘어도 끝까지 센다(.range — D51, 서버 max_rows 흉내)', async () => {
    const leaves = Array.from({ length: 1_500 }, (_, i) => ({ id: `x${String(i).padStart(4, '0')}`, parent_id: null, project_id: P1, actual_pct: i < 300 ? 100 : 0, planned_end: '2026-11-30' }))
    const r = await getProjectRows(WA, actor, { client: fake(tables({ wbs_items: leaves }), { maxRows: 1_000 }) as never, now: NOW })
    expect(r.ok && r.rows.find((x) => x.id === P1)?.progress).toEqual({ done: 300, total: 1_500 })
  })
  it('잎 조회 실패 → 진척 null, 종료일 지난 프로젝트는 unknown(완료로 위장하지 않는다)', async () => {
    const r = await getProjectRows(WA, actor, { client: fake(tables(), { fail: 'wbs_items' }) as never, now: NOW })
    expect(r.ok && r.rows.find((x) => x.id === P2)).toMatchObject({ status: 'unknown', progress: null, statusReason: '진척을 확인하지 못했습니다' })
  })
  it('워크스페이스 오늘을 모르면 상태는 unknown, 근거는 시간대 사유, 진척 수는 남긴다', async () => {
    m.wsCfg.mockRejectedValue(new Error('down'))
    const r = await getProjectRows(WA, actor, { client: fake(tables()) as never, now: NOW })
    expect(r.ok && r.rows.find((x) => x.id === P1)).toMatchObject({ status: 'unknown', progress: { done: 0, total: 1 }, nextDue: null, statusReason: '오늘 날짜(워크스페이스 시간대)를 확인하지 못했습니다' })
  })
  it('즐겨찾기만 — 개인 설정을 못 읽으면 빈 목록이 아니라 ok:false', async () => {
    m.prefs.mockRejectedValue(new Error('down'))
    expect(await getProjectRows(WA, actor, { client: fake(tables()) as never, now: NOW, favoritesOnly: true })).toMatchObject({ ok: false })
    const r = await getProjectRows(WA, actor, { client: fake(tables()) as never, now: NOW })
    expect(r.ok && r.rows.every((x) => !x.isFavorite)).toBe(true)
  })
})
