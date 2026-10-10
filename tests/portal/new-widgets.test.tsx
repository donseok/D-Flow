// 위젯 강화(2026-10-10)로 더한 위젯의 화면 — 위젯마다 행·빈 상태·오류 상태·일부 실패. 홈 페이지를 끝까지 그려(Suspense 포함) HTML 로 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAll } from './_render'
const h = vi.hoisted(() => ({
  scope: vi.fn(), cfg: vi.fn(), prefs: vi.fn(), sets: vi.fn(), summary: vi.fn(), tz: vi.fn(), work: vi.fn(), projects: vi.fn(),
  due: vi.fn(), issues: vi.fn(), progress: vi.fn(), week: vi.fn(), changes: vi.fn(), att: vi.fn(), agents: vi.fn(), weekly: vi.fn(), wiki: vi.fn(),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.scope }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.cfg }))
vi.mock('@/lib/calendar/viewZone', () => ({ viewTimezone: h.tz }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: h.prefs }))
vi.mock('@/lib/data/portal', () => ({
  workspaceModuleSets: h.sets, getPortalSummary: h.summary, getMyWork: h.work, getProjectRows: h.projects, countMyReview: vi.fn(),
  getReviewRows: vi.fn(), getUpcomingMeetings: vi.fn(), getRecentDocuments: vi.fn(), getWorkspaceAnnouncements: vi.fn(),
}))
vi.mock('@/lib/data/portalWidgets', () => ({
  getDueWork: h.due, getMyIssues: h.issues, getProjectProgress: h.progress, getWeekSchedule: h.week, getRecentChanges: h.changes,
  getAttendanceToday: h.att, getAgentsStatus: h.agents, getWeeklyReportStatus: h.weekly, getWikiRecent: h.wiki,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/w/acme', notFound: () => { throw new Error('404') } }))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).koLocale())
import Home from '@/app/(app)/w/[slug]/page'
import { PORTAL_WIDGET_IDS, defaultPortalWidgets, type PortalWidgetId } from '@/lib/portal/widgets'
import { makeActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-000000001930', slug: 'acme', name: 'Acme' }
const P = '00000000-0000-0000-7e57-000000001931'
const member = makeActor({ workspaceRoles: new Map([[WS.id, 'member']]), projectRoles: new Map([[P, 'member']]), projectWorkspace: new Map([[P, WS.id]]) })
const wsAdmin = makeActor({ workspaceRoles: new Map([[WS.id, 'admin']]), projectRoles: new Map(), projectWorkspace: new Map([[P, WS.id]]) })
const ALL = new Set(['agents', 'meetings', 'minutes', 'announcements', 'issues', 'attendance', 'weekly', 'wiki'])
const NEW: PortalWidgetId[] = ['due_work', 'my_issues', 'project_progress', 'week_schedule', 'favorites', 'quick_actions', 'memo', 'recent_changes', 'attendance_today', 'agents_status', 'weekly_reports', 'wiki_recent']
const layoutOf = (ids: PortalWidgetId[]) => ({ v: 1, items: ids.map((id) => ({ id, size: 'half' })), known: [] })
const work = (id: string, kind: string, over: Record<string, unknown> = {}) => ({ kind, id, title: `일 ${id}`, projectId: P, projectName: 'Apollo', due: '2026-10-02', overdueDays: null, status: '10%', href: `/p/${P}/wbs?focus=${id}`, ...over })
const project = (over: Record<string, unknown> = {}) => ({ id: P, name: 'Apollo', description: null, status: 'active', statusReason: '완료 1/4', startDate: null, endDate: null, isFavorite: true, progress: { done: 1, total: 4 }, nextDue: '2026-10-09', ...over })
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.scope.mockResolvedValue({ ws: WS, actor: member, degraded: false, role: 'member' })
  h.cfg.mockResolvedValue({ workspaceId: WS.id, revision: 1, keys: { 'portal.widgets': { status: 'default', value: defaultPortalWidgets() } } })
  h.tz.mockResolvedValue({ ok: true, timeZone: 'Asia/Seoul' })
  h.prefs.mockResolvedValue({ portalLayout: layoutOf(NEW), portalMemo: '적어 둔 글' })
  h.sets.mockResolvedValue({ ok: true, sets: new Map([[P, ALL]]), union: ALL, partial: false })
  h.summary.mockResolvedValue({ mine: { ok: true, count: 0 }, review: { ok: true, count: 0 }, dueToday: { ok: true, count: 0 } })
  h.due.mockResolvedValue({ ok: true, rows: [], overdue: 0, soon: 0, partial: false })
  h.issues.mockResolvedValue({ ok: true, rows: [], total: 0, partial: false })
  h.progress.mockResolvedValue({ ok: true, rows: [], total: 0 })
  h.week.mockResolvedValue({ ok: true, rows: [], days: [], partial: false })
  h.projects.mockResolvedValue({ ok: true, rows: [], nextCursor: null })
  h.changes.mockResolvedValue({ ok: true, rows: [], partial: false })
  h.att.mockResolvedValue({ ok: true, rows: [], total: 0, partial: false })
  h.agents.mockResolvedValue({ ok: true, rows: [], projects: 0, partial: false })
  h.weekly.mockResolvedValue({ ok: true, rows: [], partial: false })
  h.wiki.mockResolvedValue({ ok: true, rows: [], openQuestions: 0, partial: false })
})
const render = async () => renderAll(await Home({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve({}) }))
/** 그 위젯의 HTML — React 가 글 조각 사이에 넣는 주석(<!-- -->)은 걷어 낸다(이어진 문구를 그대로 단언하려고) */
const widget = (html: string, id: string) => (html.match(new RegExp(`<section[^>]*data-widget="${id}"[\\s\\S]*?</section>`))?.[0] ?? '').replace(/<!-- -->/g, '')
const LOADER: Partial<Record<PortalWidgetId, keyof typeof h>> = { due_work: 'due', my_issues: 'issues', project_progress: 'progress', week_schedule: 'week', favorites: 'projects',
  recent_changes: 'changes', attendance_today: 'att', agents_status: 'agents', weekly_reports: 'weekly', wiki_recent: 'wiki' }

describe('새 위젯 — 빈 상태·오류 상태', () => {
  it('열두 위젯이 모두 그려지고, 0건은 저마다의 빈 문구(실패로 그리지 않는다)', async () => {
    const html = await render()
    expect([...html.matchAll(/<section[^>]*data-widget="([^"]+)"/g)].map((m) => m[1])).toEqual(NEW)
    const EMPTY: Partial<Record<PortalWidgetId, string>> = {
      due_work: '기한이 지났거나 임박한 일이 없습니다', my_issues: '내가 담당인 미해결 이슈가 없습니다', project_progress: '내가 속한 프로젝트가 없습니다',
      week_schedule: '이번 주에 잡힌 회의와 마감이 없습니다', favorites: '즐겨찾기한 프로젝트가 없습니다', recent_changes: '최근 14일 동안 바뀐 작업이 없습니다',
      attendance_today: '오늘 자리를 비운 사람이 없습니다', agents_status: '에이전트를 쓰는 내 프로젝트가 없습니다', weekly_reports: '주간보고를 쓰는 내 프로젝트가 없습니다', wiki_recent: '최근 바뀐 위키 문서가 없습니다',
    }
    for (const [id, text] of Object.entries(EMPTY)) {
      expect(widget(html, id), id).toContain(text); expect(widget(html, id), id).toContain('data-status-kind="empty"'); expect(widget(html, id), id).not.toContain('partial_error')
    }
  })
  it.each(Object.entries(LOADER))('%s — 로더가 { ok: false } 면 그 위젯만 실패 카드(다시 시도)', async (id, key) => {
    h[key!].mockResolvedValue({ ok: false, error: '불러오지 못했습니다(시험).' })
    const html = await render()
    expect(widget(html, id)).toContain('data-status-kind="partial_error"'); expect(widget(html, id)).toContain('불러오지 못했습니다(시험).'); expect(widget(html, id)).toContain('다시 시도')
    for (const other of NEW.filter((x) => x !== id)) expect(widget(html, other), `${id} → ${other}`).not.toContain('partial_error')
  })
  it.each(Object.entries(LOADER))('%s — 로더가 던져도 그 위젯만 실패(safe) — "데이터 없음"으로 보이지 않는다', async (id, key) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h[key!].mockRejectedValue(new Error('boom'))
    const html = await render()
    expect(widget(html, id)).toContain('data-status-kind="partial_error"'); expect(widget(html, id)).not.toContain('data-status-kind="empty"')
    expect(widget(html, 'memo')).toContain('적어 둔 글')
    err.mockRestore()
  })
  it('일부 실패(partial)는 받은 행과 함께 알린다', async () => {
    h.due.mockResolvedValue({ ok: true, rows: [], overdue: 0, soon: 0, partial: true })
    h.att.mockResolvedValue({ ok: true, rows: [], total: 0, partial: true })
    h.wiki.mockResolvedValue({ ok: true, rows: [], openQuestions: null, partial: true })
    const html = await render()
    expect(widget(html, 'due_work')).toContain('일부 작업·이슈를 불러오지 못했을 수 있습니다')
    expect(widget(html, 'attendance_today')).toContain('일부 프로젝트의 근태를 불러오지 못했을 수 있습니다')
    expect(widget(html, 'wiki_recent')).toContain('위키 정보 일부를 불러오지 못했을 수 있습니다'); expect(widget(html, 'wiki_recent')).not.toContain('답을 기다리는 질문')
  })
  it('홈에 올리지 않은 위젯의 로더는 부르지 않는다', async () => {
    h.prefs.mockResolvedValue({ portalLayout: layoutOf(['due_work', 'memo', 'quick_actions']) })
    await render()
    expect(h.due).toHaveBeenCalledTimes(1)
    for (const f of [h.issues, h.progress, h.week, h.projects, h.changes, h.att, h.agents, h.weekly, h.wiki, h.work]) expect(f).not.toHaveBeenCalled()
  })
  it('모듈이 꺼진 위젯은 개인 구성에 있어도 없고 로더도 부르지 않는다', async () => {
    h.sets.mockResolvedValue({ ok: true, sets: new Map([[P, new Set(['issues'])]]), union: new Set(['issues']), partial: false })
    const html = await render()
    for (const id of ['attendance_today', 'agents_status', 'weekly_reports', 'wiki_recent']) expect(html, id).not.toContain(`data-widget="${id}"`)
    expect(html).toContain('data-widget="my_issues"')
    for (const f of [h.att, h.agents, h.weekly, h.wiki]) expect(f).not.toHaveBeenCalled()
  })
  it('모든 로더가 같은 순간(now)을 받는다', async () => {
    await render()
    const nows = [h.due, h.issues, h.progress, h.week, h.changes, h.att, h.agents, h.weekly, h.wiki, h.projects].map((f) => ((f.mock.calls[0] as unknown[])[2] as { now: Date }).now)
    expect(nows.every((n) => n instanceof Date)).toBe(true); expect(new Set(nows).size).toBe(1)
  })
})

describe('새 위젯 — 내용', () => {
  it('지연·임박 — 건수 한 줄, 지연·임박을 글자로 가르고 지난 일수를 적는다', async () => {
    h.due.mockResolvedValue({ ok: true, overdue: 1, soon: 1, partial: false, rows: [
      work('a', 'wbs', { dueKind: 'overdue', due: '2026-09-20', overdueDays: 11 }), work('b', 'issue', { dueKind: 'soon', status: '열림' })] })
    const w = widget(await render(), 'due_work')
    expect(w).toContain('지연 1건 · 임박 1건'); expect(w).toMatch(/>지연<[\s\S]*일 a[\s\S]*2026-09-20 · 11일 지남/); expect(w).toMatch(/>임박<[\s\S]*일 b/)
    expect(w).toContain('작업 · Apollo'); expect(w).toContain('이슈 · Apollo'); expect(w).toContain('href="/w/acme/my-work?kind=wbs%2Cissue"')
  })
  it('내 이슈 — 심각도는 제품 기본 이름, 모르는 등급은 code 그대로', async () => {
    h.issues.mockResolvedValue({ ok: true, total: 5, partial: false, rows: [work('i1', 'issue', { severity: 'high', status: '열림', due: null }), work('i2', 'issue', { severity: 'blocker', status: '진행중' })] })
    const w = widget(await render(), 'my_issues')
    expect(w).toContain('미해결 5건'); expect(w).toMatch(/심각도 <\/span>높음/); expect(w).toMatch(/심각도 <\/span>blocker/)
    expect(w).toContain('기한 없음'); expect(w).toContain('Apollo · 진행중')
  })
  it('프로젝트 진척 — 비율·완료 수·기한 지남을 글자로(막대만으로 말하지 않는다), 잎이 없으면 "작업 없음"', async () => {
    h.progress.mockResolvedValue({ ok: true, total: 3, rows: [
      { id: P, name: 'Apollo', status: 'active', statusReason: '', pct: 25, done: 1, total: 4, overdueOpen: 2, nextDue: '2026-10-09' },
      { id: 'p2', name: 'Borealis', status: 'ready', statusReason: '', pct: null, done: 0, total: 0, overdueOpen: 0, nextDue: null },
      { id: 'p3', name: 'Cygnus', status: 'unknown', statusReason: '', pct: null, done: 0, total: 0, overdueOpen: null, nextDue: null }] })
    const w = widget(await render(), 'project_progress')
    expect(w).toContain('25%'); expect(w).toContain('완료 1/4'); expect(w).toContain('기한 지남 2건'); expect(w).toContain('다음 기한 2026-10-09')
    expect(w).toContain('aria-label="Apollo 진척 25%"'); expect(w).toContain('width:25%')
    expect(w).toContain('작업 없음'); expect(w).toContain('진척 확인 불가'); expect(w).toContain(`href="/p/${P}/dashboard"`)
  })
  it('이번 주 일정 — 항목이 있는 날만, 오늘 표시, 회의는 시각·마감은 "마감"', async () => {
    const item = (kind: string, id: string, time: string | null) => ({ kind, id, title: `일정 ${id}`, projectName: 'Apollo', time, href: `/x/${id}` })
    const days = [{ date: '2026-09-30', label: '2026-09-30 (수)', isToday: false, items: [] },
      { date: '2026-10-01', label: '2026-10-01 (목)', isToday: true, items: [item('meeting', 'm1', '10:00'), item('meeting', 'm2', null), item('wbs', 'w1', null)] }]
    h.week.mockResolvedValue({ ok: true, rows: days.flatMap((d) => d.items), days, partial: false })
    const w = widget(await render(), 'week_schedule')
    expect(w).toContain('2026-10-01 (목)'); expect(w).not.toContain('2026-09-30 (수)'); expect(w).toContain('>오늘<')
    expect(w).toMatch(/10:00<\/span>[\s\S]*일정 m1/); expect(w).toMatch(/종일<\/span>[\s\S]*일정 m2/); expect(w).toMatch(/마감<\/span>[\s\S]*일정 w1/)
  })
  it('즐겨찾기 — 즐겨찾기만 거른 프로젝트 행으로 바로가기', async () => {
    h.projects.mockResolvedValue({ ok: true, nextCursor: null, rows: [project()] })
    const w = widget(await render(), 'favorites')
    expect(h.projects).toHaveBeenCalledWith(WS.id, member, expect.objectContaining({ favoritesOnly: true }))
    expect(w).toContain('Apollo'); expect(w).toContain(`href="/p/${P}/dashboard"`); expect(w).toContain('진행중')
  })
  it('빠른 실행 — 권한·모듈이 되는 화면만: 구성원은 관리 링크가 없고, 워크스페이스 관리자는 있다', async () => {
    const m = widget(await render(), 'quick_actions')
    for (const text of ['내 업무', '전체 프로젝트', '회의 일정', '회의록', '에이전트', '내 계정']) expect(m, text).toContain(`>${text}<`)
    for (const text of ['구성원 관리', '팀 관리', '워크스페이스 설정']) expect(m, text).not.toContain(text)
    h.scope.mockResolvedValue({ ws: WS, actor: wsAdmin, degraded: false, role: 'admin' })
    h.sets.mockResolvedValue({ ok: true, sets: new Map(), union: new Set(), partial: false })
    const a = widget(await render(), 'quick_actions')
    expect(a).toContain('href="/w/acme/admin/accounts"'); expect(a).toContain('href="/w/acme/settings"')
    for (const text of ['회의 일정', '회의록', '에이전트']) expect(a, text).not.toContain(`>${text}<`)    // 어디서도 켜지지 않은 모듈의 화면으로 보내지 않는다
  })
  it('메모 — 저장된 글을 싣고, 개인 설정을 못 읽으면 입력을 열지 않는다', async () => {
    expect(widget(await render(), 'memo')).toMatch(/<textarea[^>]*data-portal-memo[^>]*>적어 둔 글<\/textarea>/)
    h.prefs.mockRejectedValue(new Error('down'))
    h.cfg.mockResolvedValue({ workspaceId: WS.id, revision: 1, keys: { 'portal.widgets': { status: 'set', value: [{ id: 'memo', enabled: true, inDefault: true }, ...PORTAL_WIDGET_IDS.filter((x) => x !== 'memo').map((id) => ({ id, enabled: true, inDefault: false }))] } } })
    const w = widget(await render(), 'memo')
    expect(w).toContain('개인 설정을 읽지 못해 메모를 열 수 없습니다'); expect(w).not.toContain('<textarea')
  })
  it('최근 변경 — 무엇이 어떻게 바뀌었는지와 워크스페이스 시간대의 시각', async () => {
    const c = (id: string, field: string, o: string | null, n: string | null) => ({ id, itemId: `it-${id}`, itemName: `작업 ${id}`, projectId: P, projectName: 'Apollo', field, oldValue: o, newValue: n, at: '2026-09-30T15:30:00Z', href: `/p/${P}/wbs?focus=it-${id}` })
    h.changes.mockResolvedValue({ ok: true, partial: false, rows: [c('1', 'actual_pct', '10', '40'), c('2', 'created', null, null), c('3', 'name', '옛 이름', '새 이름'), c('4', 'planned_end', null, '2026-10-09')] })
    const w = widget(await render(), 'recent_changes')
    expect(w).toContain('Apollo · 실적% 10% → 40%'); expect(w).toContain('Apollo · 새로 만듦'); expect(w).toContain('Apollo · 계획종료 없음 → 2026-10-09')
    expect(w).toMatch(/Apollo · 이름</); expect(w).not.toContain('옛 이름')                 // 긴 값(이름·산출물)은 필드 이름만
    expect(w).toContain('10-01 00:30')                                                    // 서울 = UTC+9
    h.tz.mockResolvedValue({ ok: false, error: 'x', key: 'calendar.timezone' })
    expect(widget(await render(), 'recent_changes')).not.toMatch(/\d\d-\d\d \d\d:\d\d/)    // 시간대를 모르면 시각을 지어내지 않는다
  })
  it('오늘의 근태 — 유형 이름(없으면 code)·사람·프로젝트, 인원 수', async () => {
    h.att.mockResolvedValue({ ok: true, total: 2, partial: false, rows: [
      { id: 'a1', name: '가람', type: 'trip', typeLabel: '출장', projectId: P, projectName: 'Apollo' }, { id: 'a2', name: '나연', type: 'x9', typeLabel: null, projectId: P, projectName: 'Apollo' }] })
    const w = widget(await render(), 'attendance_today')
    expect(w).toContain('오늘 2명'); expect(w).toMatch(/>출장<[\s\S]*가람/); expect(w).toMatch(/>x9<[\s\S]*나연/); expect(w).toContain(`href="/p/${P}/attendance"`)
  })
  it('에이전트 현황 — 세 수치를 이름과 함께(0 도 수로 그린다)', async () => {
    h.agents.mockResolvedValue({ ok: true, projects: 2, partial: false, rows: [{ key: 'claimed', count: 3 }, { key: 'reported', count: 0 }, { key: 'ready', count: 7 }] })
    const w = widget(await render(), 'agents_status')
    expect(w).toMatch(/data-agent-count="claimed"[\s\S]*?일하는 중[\s\S]*?>3</); expect(w).toMatch(/data-agent-count="reported"[\s\S]*?결정 대기[\s\S]*?>0</)
    expect(w).toContain('프로젝트 2개 기준'); expect(w).toContain('href="/w/acme/agents"')
  })
  it('주간보고 현황 — 문서 있음·아직 없음을 글자로', async () => {
    h.weekly.mockResolvedValue({ ok: true, partial: false, rows: [
      { projectId: P, projectName: 'Apollo', weekStart: '2026-09-27', written: false, updatedAt: null, href: `/p/${P}/weekly?week=2026-09-27` },
      { projectId: 'p2', projectName: 'Borealis', weekStart: '2026-09-28', written: true, updatedAt: '2026-09-30T00:00:00Z', href: '/p/p2/weekly?week=2026-09-28' }] })
    const w = widget(await render(), 'weekly_reports')
    expect(w).toMatch(/Apollo[\s\S]*2026-09-27 주[\s\S]*아직 없음/); expect(w).toMatch(/Borealis[\s\S]*문서 있음/); expect(w).toContain(`href="/p/${P}/weekly?week=2026-09-27"`)
  })
  it('위키 — 최근 문서와 답을 기다리는 질문 수(문서가 없어도 질문 수는 보인다)', async () => {
    h.wiki.mockResolvedValue({ ok: true, openQuestions: 3, partial: false, rows: [{ id: 't1', title: '배포 절차', projectId: P, projectName: 'Apollo', changedAt: '2026-09-30T16:00:00Z', href: `/p/${P}/wiki/topics/t1` }] })
    const w = widget(await render(), 'wiki_recent')
    expect(w).toContain('답을 기다리는 질문 3건'); expect(w).toContain('배포 절차'); expect(w).toContain('Apollo · 2026-10-01')
    h.wiki.mockResolvedValue({ ok: true, openQuestions: 2, partial: false, rows: [] })
    const e = widget(await render(), 'wiki_recent')
    expect(e).toContain('답을 기다리는 질문 2건'); expect(e).toContain('최근 바뀐 위키 문서가 없습니다')
  })
})
