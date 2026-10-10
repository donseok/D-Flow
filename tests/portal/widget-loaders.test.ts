// 위젯 강화(2026-10-10)로 더한 홈 위젯의 로더 — 원천 공유·모듈·가시성(비공개)·'내 프로젝트' 범위·부분 실패·건수 상한
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  many: vi.fn(), wsMods: vi.fn(), meetings: vi.fn(), prefs: vi.fn(), cals: vi.fn(), vocabs: vi.fn(), wsCfg: vi.fn(),
}))
vi.mock('@/lib/modules/effectiveMany', () => ({ effectiveModulesMany: m.many }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: m.wsMods }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings: m.meetings }))
vi.mock('@/lib/data/wbs', () => ({ getProjectsCompletion: vi.fn() }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: m.prefs }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({
  ...(await orig<object>()), getProjectCalendars: m.cals, getProjectVocabs: m.vocabs,
  getProjectTimezones: async (ids: readonly string[]) => new Map([...(await m.cals(ids))].map(([id, c]: [string, { timezone: string } | null]) => [id, c ? c.timezone : null])),
}))
vi.mock('@/lib/settings/workspaceConfig', async (orig) => ({ ...(await orig<object>()), getWorkspaceConfig: m.wsCfg }))
import { fake } from './_fake'
import { makeActor } from '../fixtures/actor'
import {
  getAgentsStatus, getAttendanceToday, getDueWork, getMyIssues, getProjectProgress, getRecentChanges, getWeekSchedule, getWeeklyReportStatus, getWikiRecent,
} from '@/lib/data/portalWidgets'
import { getProjectRows } from '@/lib/data/portal'
import type { ModuleId } from '@/lib/modules/defaults'
import { DEFAULT_ATTENDANCE_TYPES } from '@/lib/settings/vocab'

const WA = '00000000-0000-0000-7e57-000000001940'
const P1 = '00000000-0000-0000-7e57-000000001941', P2 = '00000000-0000-0000-7e57-000000001942', PS = '00000000-0000-0000-7e57-000000001946', PV = '00000000-0000-0000-7e57-000000001948'
const M1 = '00000000-0000-0000-7e57-000000001943', M2 = '00000000-0000-0000-7e57-000000001944', MS = '00000000-0000-0000-7e57-000000001947'
const NOW = new Date('2026-10-01T12:00:00Z')                                   // 목요일. 모든 범위 tz 가 UTC — 오늘 = 2026-10-01, 일요일 시작 주 = 09-27 ~ 10-03
/** P1 관리자·P2 멤버, PS 는 명단 밖 비공개(볼 수 없다), PV 는 같은 워크스페이스의 공개 프로젝트지만 명단에 없다(조회 전용 — '내 프로젝트'가 아니다) */
const actor = makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectRoles: new Map([[P1, 'admin'], [P2, 'member']]),
  projectWorkspace: new Map([[P1, WA], [P2, WA], [PS, WA], [PV, WA]]), memberIds: new Map([[P1, M1], [P2, M2], [PS, MS]]) })
const ALL: ModuleId[] = ['dashboard', 'wbs', 'members', 'settings', 'issues', 'agents', 'meetings', 'minutes', 'announcements', 'attendance', 'weekly', 'wiki']
const ON = new Set<ModuleId>(ALL)
const PROJECTS = [
  { id: P1, name: 'Acme', description: null, start_date: '2026-09-01', end_date: '2026-12-31', is_private: false, workspace_id: WA },
  { id: P2, name: 'Beta', description: null, start_date: '2026-01-01', end_date: '2026-12-31', is_private: false, workspace_id: WA },
  { id: PS, name: 'Secret', description: null, start_date: '2026-01-01', end_date: '2026-12-31', is_private: true, workspace_id: WA },
  { id: PV, name: 'Viewer', description: null, start_date: '2026-01-01', end_date: '2026-12-31', is_private: false, workspace_id: WA },
]
const NAME: Record<string, string> = { [P1]: 'Acme', [P2]: 'Beta', [PS]: 'Secret', [PV]: 'Viewer' }
const wbs = (id: string, pid: string, member: string | null, end: string | null, pct: number | null) =>
  ({ id, name: `작업 ${id}`, project_id: pid, parent_id: null, assignee_member_id: member, planned_end: end, actual_pct: pct, projects: { name: NAME[pid] } })
const issue = (id: string, pid: string, member: string, due: string | null, severity: string, status = 'open') =>
  ({ issue_id: id, project_id: pid, member_id: member, issues: { id, title: `이슈 ${id}`, status, severity, due_date: due, project_id: pid, projects: { name: NAME[pid] } } })
const tables = (over: Record<string, unknown[]> = {}) => ({
  projects: PROJECTS,
  wbs_items: [
    wbs('w-late', P1, M1, '2026-09-20', 10), wbs('w-today', P1, M1, '2026-10-01', 0), wbs('w-soon', P2, M2, '2026-10-08', null), wbs('w-far', P2, M2, '2026-10-20', 0),
    wbs('w-nodue', P1, M1, null, 0), wbs('w-done', P1, M1, '2026-09-01', 100), wbs('w-secret', PS, MS, '2026-09-01', 0), wbs('w-view', PV, null, '2026-09-01', 0),
  ],
  issue_assignees: [issue('i-low', P1, M1, '2026-10-02', 'low'), issue('i-high', P2, M2, null, 'high'), issue('i-mid', P1, M1, '2026-09-25', 'medium'),
    issue('i-custom', P1, M1, '2026-10-30', 'blocker'), issue('i-secret', PS, MS, '2026-09-01', 'high')],
  agent_work_orders: [], ...over,
})
const mtg = (id: string, projectId: string, meetingDate: string, startTime: string | null, isMine = true) => ({ id, projectId, projectName: NAME[projectId], title: `회의 ${id}`, meetingDate, startTime,
  endTime: null, location: null, category: 'general', body: '', recurrence: 'none', recurrenceUntil: null, createdBy: null, createdByName: null, createdAt: '', updatedAt: '', attendeeIds: [], isMine })
const cal = { timezone: 'UTC', weekStart: [{ day: 'sunday', from: null }], workingDays: new Set([1, 2, 3, 4, 5]) }
const client = (t = tables(), opts?: Parameters<typeof fake>[1]) => fake(t as never, opts) as never
let err: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  err = vi.spyOn(console, 'error').mockImplementation(() => {})
  m.many.mockResolvedValue({ sets: new Map([[P1, ON], [P2, ON], [PS, ON], [PV, ON]]), failed: [] })
  m.wsMods.mockResolvedValue(new Set<ModuleId>(ALL))
  m.prefs.mockResolvedValue({ favoriteProjectIds: [P2] })
  m.meetings.mockResolvedValue({ ok: true, exceptions: [], meetings: [] })
  m.cals.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, cal])))
  m.vocabs.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, [...DEFAULT_ATTENDANCE_TYPES]])))
  m.wsCfg.mockResolvedValue({ calendar: cal, calendarError: null })
})
afterEach(() => { err.mockRestore() })
const okOf = <T extends { ok: boolean }>(r: T) => { if (!r.ok) throw new Error(JSON.stringify(r)); return r as Extract<T, { ok: true }> }

describe('getDueWork — 지연·임박', () => {
  it('기한이 지났거나 7일 안인 내 작업·이슈만 — 지연(오래된 순) → 임박(가까운 순). 완료·기한 없음·먼 기한·비공개는 없다', async () => {
    const r = okOf(await getDueWork(WA, actor, { client: client(), now: NOW }))
    expect(r.rows.map((x) => [x.id, x.dueKind])).toEqual([['w-late', 'overdue'], ['i-mid', 'overdue'], ['w-today', 'soon'], ['i-low', 'soon'], ['w-soon', 'soon']])
    expect([r.overdue, r.soon, r.partial]).toEqual([2, 3, false])
    expect(r.rows.find((x) => x.id === 'w-late')!.overdueDays).toBe(11)
  })
  it('상한 — 수는 전체, 행은 상한까지', async () => {
    const r = okOf(await getDueWork(WA, actor, { client: client(), now: NOW, limit: 2 }))
    expect(r.rows).toHaveLength(2); expect(r.overdue + r.soon).toBe(5)
  })
  it('이슈 원천이 실패하면 작업만 그리고 partial(0건으로 위장하지 않는다)', async () => {
    const r = okOf(await getDueWork(WA, actor, { client: client(tables(), { fail: 'issue_assignees' }), now: NOW }))
    expect(r.partial).toBe(true); expect(r.rows.every((x) => x.kind === 'wbs')).toBe(true)
  })
  it('모듈·가시성 판정 실패는 실패다', async () => {
    m.many.mockRejectedValue(new Error('down'))
    expect((await getDueWork(WA, actor, { client: client(), now: NOW })).ok).toBe(false)
  })
})

describe('getMyIssues', () => {
  it('심각도 높은 순(제품 기본 등급) → 기한, 모르는 등급은 뒤. 비공개 프로젝트의 이슈는 없다', async () => {
    const r = okOf(await getMyIssues(WA, actor, { client: client(), now: NOW }))
    expect(r.rows.map((x) => [x.id, x.severity])).toEqual([['i-high', 'high'], ['i-mid', 'medium'], ['i-low', 'low'], ['i-custom', 'blocker']])
    expect(r.total).toBe(4)
  })
  it('이슈 모듈이 꺼진 프로젝트의 이슈는 읽지 않는다', async () => {
    const noIssues = new Set<ModuleId>(ALL.filter((x) => x !== 'issues'))
    m.many.mockResolvedValue({ sets: new Map([[P1, ON], [P2, noIssues], [PS, ON], [PV, ON]]), failed: [] })
    const r = okOf(await getMyIssues(WA, actor, { client: client(), now: NOW }))
    expect(r.rows.map((x) => x.id)).not.toContain('i-high')
  })
  it('이슈 조회 실패는 partial — 빈 목록만 보이지 않는다', async () => {
    const r = okOf(await getMyIssues(WA, actor, { client: client(tables(), { fail: 'issue_assignees' }), now: NOW }))
    expect([r.rows.length, r.partial]).toEqual([0, true])
  })
})

describe('getProjectProgress', () => {
  it('내가 속한 프로젝트만(명단 밖 공개 프로젝트·비공개 제외) — 완료 비율·지난 미완 수. 같은 상태 안에서는 진척이 낮은 것이 위', async () => {
    const r = okOf(await getProjectProgress(WA, actor, { client: client(), now: NOW }))
    expect(r.rows.map((p) => [p.name, p.status, p.pct])).toEqual([['Beta', 'active', 0], ['Acme', 'active', 25]]); expect(r.total).toBe(2)
    const acme = r.rows[1]
    expect([acme.done, acme.total, acme.overdueOpen]).toEqual([1, 4, 1])
  })
  it('종료일이 지난 미완 프로젝트(지연)가 진행 중보다 위', async () => {
    const t = tables({ projects: PROJECTS.map((p) => (p.id === P1 ? { ...p, end_date: '2026-09-15' } : p)) })
    const r = okOf(await getProjectProgress(WA, actor, { client: client(t), now: NOW }))
    expect(r.rows.map((p) => [p.name, p.status])).toEqual([['Acme', 'overdue'], ['Beta', 'active']])
  })
  it('프로젝트 목록과 같은 요청에서 프로젝트·잎 조회를 다시 하지 않는다(요청 범위 공유는 React cache — 테스트에서는 같은 계산임만 본다)', async () => {
    const c = client()
    const rows = okOf(await getProjectRows(WA, actor, { client: c, now: NOW, limit: 50 }))
    const prog = okOf(await getProjectProgress(WA, actor, { client: c, now: NOW }))
    for (const p of prog.rows) expect(p.statusReason).toBe(rows.rows.find((x) => x.id === p.id)!.statusReason)
  })
  it('프로젝트 조회 실패는 실패', async () => {
    expect((await getProjectProgress(WA, actor, { client: client(tables(), { fail: 'projects' }), now: NOW })).ok).toBe(false)
  })
})

describe('getWeekSchedule — 워크스페이스 달력의 이번 주', () => {
  it('이번 주(일요일 시작)의 마감과 내 회의를 날짜별로 — 하루 안에서는 회의 먼저', async () => {
    m.meetings.mockResolvedValue({ ok: true, exceptions: [], meetings: [mtg('m1', P1, '2026-10-01', '10:00'), mtg('m2', P1, '2026-10-02', null), mtg('m-other', P2, '2026-10-01', '09:00', false), mtg('m-secret', PS, '2026-10-01', '08:00')] })
    const r = okOf(await getWeekSchedule(WA, actor, { client: client(), now: NOW }))
    expect(m.meetings).toHaveBeenCalledWith(WA, '2026-09-27', '2026-10-03')
    expect(r.days.map((d) => d.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'])
    expect(r.days.find((d) => d.isToday)!.date).toBe('2026-10-01')
    expect(r.days.find((d) => d.date === '2026-10-01')!.items.map((i) => [i.kind, i.id])).toEqual([['meeting', 'm1:2026-10-01'], ['wbs', 'w-today']])
    expect(r.days.find((d) => d.date === '2026-10-02')!.items.map((i) => i.kind)).toEqual(['meeting', 'issue'])
    expect(r.rows).toHaveLength(4); expect(r.partial).toBe(false)                // 지난 주(w-late)·다음 주(w-soon)·남의 회의·비공개 회의는 없다
  })
  it('월요일 시작 워크스페이스는 주가 달라진다', async () => {
    m.wsCfg.mockResolvedValue({ calendar: { ...cal, weekStart: [{ day: 'monday', from: null }] }, calendarError: null })
    const r = okOf(await getWeekSchedule(WA, actor, { client: client(), now: NOW }))
    expect([r.days[0].date, r.days[6].date]).toEqual(['2026-09-28', '2026-10-04'])
  })
  it('회의 조회가 실패해도 마감은 그리고 partial', async () => {
    m.meetings.mockResolvedValue({ ok: false, error: 'down' })
    const r = okOf(await getWeekSchedule(WA, actor, { client: client(), now: NOW }))
    expect(r.partial).toBe(true); expect(r.rows.map((i) => i.id)).toEqual(['w-today', 'i-low'])
  })
  it('회의 모듈이 어디서도 켜지지 않았으면 회의를 읽지 않는다', async () => {
    const noMeet = new Set<ModuleId>(ALL.filter((x) => x !== 'meetings'))
    m.many.mockResolvedValue({ sets: new Map([[P1, noMeet], [P2, noMeet], [PS, noMeet], [PV, noMeet]]), failed: [] })
    okOf(await getWeekSchedule(WA, actor, { client: client(), now: NOW }))
    expect(m.meetings).not.toHaveBeenCalled()
  })
  it('워크스페이스 달력이 손상이면 던진다 — 다른 주를 지어내지 않는다(홈의 safe 가 그 위젯만 실패로)', async () => {
    m.wsCfg.mockResolvedValue({ calendar: null, calendarError: new Error('CONFIG_INVALID') })
    await expect(getWeekSchedule(WA, actor, { client: client(), now: NOW })).rejects.toThrow()
  })
})

describe('getRecentChanges', () => {
  const log = (id: number, item: string, pid: string, field: string, at: string, o: string | null = null, n: string | null = null) =>
    ({ id, field, old_value: o, new_value: n, at, wbs_items: { id: item, name: `작업 ${item}`, project_id: pid, projects: { name: NAME[pid] } } })
  it('내 프로젝트의 변경만 최신 순 — 명단 밖 프로젝트·비공개·사용자 정의 필드 로그는 없다', async () => {
    const c = fake(tables({ change_logs: [
      log(1, 'a', P1, 'actual_pct', '2026-09-30T01:00:00Z', '10', '40'), log(2, 'b', P2, 'name', '2026-09-30T05:00:00Z'), log(3, 'c', PV, 'actual_pct', '2026-09-30T09:00:00Z'),
      log(4, 'd', PS, 'actual_pct', '2026-09-30T10:00:00Z'), log(5, 'a', P1, 'custom:cost', '2026-09-30T11:00:00Z'),
    ] }) as never)
    const r = okOf(await getRecentChanges(WA, actor, { client: c as never, now: NOW }))
    expect(r.rows.map((x) => x.id)).toEqual(['2', '1'])
    expect(r.rows[1]).toMatchObject({ itemName: '작업 a', projectName: 'Acme', field: 'actual_pct', oldValue: '10', newValue: '40' })
    const call = c.calls.find((x) => x.table === 'change_logs')!
    expect(call.filters.find((f) => f[1] === 'wbs_items.project_id')![2]).toEqual([P1, P2])     // 조회 인자에도 내 프로젝트만
    expect(call.limit).toBe(8)
  })
  it('조회 실패는 던진다', async () => {
    await expect(getRecentChanges(WA, actor, { client: client(tables(), { fail: 'change_logs' }), now: NOW })).rejects.toThrow(/최근 변경/)
  })
})

describe('getAttendanceToday', () => {
  const rec = (id: string, pid: string, person: string, name: string, type: string, date = '2026-10-01') =>
    ({ id, project_id: pid, type, date, projects: { name: NAME[pid] }, project_members: { person_id: person, people: { display_name: name } } })
  it('오늘 자리를 비운 사람만(근무로 세는 유형 제외) 이름순 — 같은 사람·같은 유형은 한 번, 내 프로젝트만', async () => {
    const c = fake(tables({ attendance_records: [
      rec('a1', P1, 'pa', '나연', 'annual'), rec('a2', P1, 'pb', '가람', 'trip'), rec('a3', P1, 'pc', '다온', 'work'), rec('a4', P2, 'pa', '나연', 'annual'),
      rec('a5', P1, 'pd', '라희', 'annual', '2026-09-30'), rec('a6', PV, 'pe', '마루', 'sick'), rec('a7', PS, 'pf', '바다', 'sick'),
    ] }) as never)
    const r = okOf(await getAttendanceToday(WA, actor, { client: c as never, now: NOW }))
    expect(r.rows.map((x) => [x.name, x.typeLabel])).toEqual([['가람', '출장'], ['나연', '연차']])
    expect([r.total, r.partial]).toEqual([2, false])
  })
  it('유형 어휘를 못 읽은 프로젝트는 기록을 모두 싣고 code 를 그대로 보이며 partial', async () => {
    m.vocabs.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, null])))
    const r = okOf(await getAttendanceToday(WA, actor, { client: client(tables({ attendance_records: [rec('a1', P1, 'pa', '나연', 'work')] })), now: NOW }))
    expect(r.rows).toEqual([expect.objectContaining({ name: '나연', type: 'work', typeLabel: null })]); expect(r.partial).toBe(true)
  })
  it('근태 모듈이 켜진 내 프로젝트가 없으면 조회하지 않는다', async () => {
    const off = new Set<ModuleId>(ALL.filter((x) => x !== 'attendance'))
    m.many.mockResolvedValue({ sets: new Map([[P1, off], [P2, off], [PS, off], [PV, ON]]), failed: [] })
    const c = fake(tables() as never)
    expect(okOf(await getAttendanceToday(WA, actor, { client: c as never, now: NOW })).rows).toEqual([])
    expect(c.calls.some((x) => x.table === 'attendance_records')).toBe(false)
  })
  it('달력을 하나도 못 읽으면 실패 — 오늘을 지어내지 않는다', async () => {
    m.cals.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, null])))
    expect((await getAttendanceToday(WA, actor, { client: client(), now: NOW })).ok).toBe(false)
  })
})

describe('getAgentsStatus', () => {
  const order = (id: string, pid: string, status: string) => ({ id, project_id: pid, status })
  it('내 프로젝트의 작업 수를 상태별로 — 명단 밖·비공개 프로젝트는 세지 않는다', async () => {
    const t = tables({ agent_work_orders: [order('o1', P1, 'claimed'), order('o2', P1, 'claimed'), order('o3', P2, 'reported'), order('o4', P1, 'approved'), order('o5', PV, 'claimed'), order('o6', PS, 'ready')] })
    const r = okOf(await getAgentsStatus(WA, actor, { client: client(t), now: NOW }))
    expect(r.rows).toEqual([{ key: 'claimed', count: 2 }, { key: 'reported', count: 1 }, { key: 'ready', count: 0 }]); expect(r.projects).toBe(2)
  })
  it('수를 못 세면 던진다(0 으로 그리지 않는다)', async () => {
    await expect(getAgentsStatus(WA, actor, { client: client(tables(), { fail: 'agent_work_orders' }), now: NOW })).rejects.toThrow(/에이전트 작업 수/)
  })
})

describe('getWeeklyReportStatus', () => {
  it('프로젝트마다 그 달력의 이번 주 문서가 있는지 — 없는 프로젝트가 위, 내 프로젝트만', async () => {
    const t = tables({ weekly_reports: [{ project_id: P1, week_start: '2026-09-27', updated_at: '2026-09-30T00:00:00Z' }, { project_id: P2, week_start: '2026-09-20', updated_at: '2026-09-25T00:00:00Z' }] })
    const r = okOf(await getWeeklyReportStatus(WA, actor, { client: client(t), now: NOW }))
    expect(r.rows.map((x) => [x.projectName, x.weekStart, x.written])).toEqual([['Beta', '2026-09-27', false], ['Acme', '2026-09-27', true]])
    expect(r.rows[0].href).toBe(`/p/${P2}/weekly?week=2026-09-27`)
  })
  it('주 시작이 프로젝트마다 다르면 그 프로젝트의 주로 본다', async () => {
    m.cals.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, id === P2 ? { ...cal, weekStart: [{ day: 'monday', from: null }] } : cal])))
    const t = tables({ weekly_reports: [{ project_id: P2, week_start: '2026-09-28', updated_at: '2026-09-30T00:00:00Z' }] })
    const r = okOf(await getWeeklyReportStatus(WA, actor, { client: client(t), now: NOW }))
    expect(r.rows.find((x) => x.projectName === 'Beta')).toMatchObject({ weekStart: '2026-09-28', written: true })
  })
  it('달력을 못 읽은 프로젝트는 빼고 partial, 전부 못 읽으면 실패', async () => {
    m.cals.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, id === P1 ? cal : null])))
    const r = okOf(await getWeeklyReportStatus(WA, actor, { client: client(tables({ weekly_reports: [] })), now: NOW }))
    expect([r.rows.map((x) => x.projectName), r.partial]).toEqual([['Acme'], true])
    m.cals.mockImplementation(async (ids: readonly string[]) => new Map(ids.map((id) => [id, null])))
    expect((await getWeeklyReportStatus(WA, actor, { client: client(tables({ weekly_reports: [] })), now: NOW })).ok).toBe(false)
  })
})

describe('getWikiRecent', () => {
  const topic = (id: string, pid: string, at: string) => ({ id, title: `문서 ${id}`, project_id: pid, last_changed_at: at, projects: { name: NAME[pid] } })
  it('위키가 켜진 볼 수 있는 프로젝트의 최근 문서 + 답 없는 질문 수 — 비공개 프로젝트는 없다', async () => {
    const t = tables({
      wiki_topics: [topic('t1', P1, '2026-09-29T00:00:00Z'), topic('t2', PV, '2026-09-30T00:00:00Z'), topic('t3', PS, '2026-10-01T00:00:00Z')],
      wiki_questions: [{ id: 'q1', project_id: P1, status: 'open' }, { id: 'q2', project_id: P1, status: 'answered' }, { id: 'q3', project_id: PS, status: 'open' }],
    })
    const r = okOf(await getWikiRecent(WA, actor, { client: client(t), now: NOW }))
    expect(r.rows.map((x) => x.id)).toEqual(['t2', 't1']); expect(r.openQuestions).toBe(1); expect(r.partial).toBe(false)
    expect(r.rows[0].href).toBe(`/p/${PV}/wiki/topics/t2`)
  })
  it('질문 수를 못 세면 null + partial — 문서는 그대로', async () => {
    const t = tables({ wiki_topics: [topic('t1', P1, '2026-09-29T00:00:00Z')] })
    const r = okOf(await getWikiRecent(WA, actor, { client: client(t, { fail: 'wiki_questions' }), now: NOW }))
    expect([r.rows.length, r.openQuestions, r.partial]).toEqual([1, null, true])
  })
  it('문서 조회 실패는 던진다', async () => {
    await expect(getWikiRecent(WA, actor, { client: client(tables(), { fail: 'wiki_topics' }), now: NOW })).rejects.toThrow(/위키 문서/)
  })
})
