// 워크스페이스 홈 v1(포털 — SP3b 스펙 §6.1, §9 ⑥) — 위젯마다 독립 로더와 Suspense, 실패는 그 위젯만. 홈 v0 테스트(home-v0)를 대체한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAll } from './_render'
const h = vi.hoisted(() => ({
  scope: vi.fn(), cfg: vi.fn(), prefs: vi.fn(), sets: vi.fn(), summary: vi.fn(), tz: vi.fn(),
  work: vi.fn(), projects: vi.fn(), reviewRows: vi.fn(), upcoming: vi.fn(), docs: vi.fn(), ann: vi.fn(), countReview: vi.fn(),
  due: vi.fn(), issues: vi.fn(), progress: vi.fn(), week: vi.fn(), changes: vi.fn(), att: vi.fn(), agents: vi.fn(), weekly: vi.fn(), wiki: vi.fn(),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.scope }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.cfg }))
vi.mock('@/lib/calendar/viewZone', () => ({ viewTimezone: h.tz }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: h.prefs }))
vi.mock('@/lib/data/portal', () => ({
  workspaceModuleSets: h.sets, getPortalSummary: h.summary, getMyWork: h.work, getProjectRows: h.projects, countMyReview: h.countReview,
  getReviewRows: h.reviewRows, getUpcomingMeetings: h.upcoming, getRecentDocuments: h.docs, getWorkspaceAnnouncements: h.ann,
}))
vi.mock('@/lib/data/portalWidgets', () => ({
  getDueWork: h.due, getMyIssues: h.issues, getProjectProgress: h.progress, getWeekSchedule: h.week, getRecentChanges: h.changes,
  getAttendanceToday: h.att, getAgentsStatus: h.agents, getWeeklyReportStatus: h.weekly, getWikiRecent: h.wiki,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => '/w/acme', notFound: () => { throw new Error('404') } }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t(k as Parameters<typeof t>[0])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ t: ko }) }
})
import Home from '@/app/(app)/w/[slug]/page'
import { defaultPortalWidgets } from '@/lib/portal/widgets'
import { makeActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-000000001830', slug: 'acme', name: 'Acme' }
const P = '00000000-0000-0000-7e57-000000001831'
const admin = makeActor({ workspaceRoles: new Map([[WS.id, 'member']]), projectRoles: new Map([[P, 'admin']]), projectWorkspace: new Map([[P, WS.id]]) })
const member = makeActor({ workspaceRoles: new Map([[WS.id, 'member']]), projectRoles: new Map([[P, 'member']]), projectWorkspace: new Map([[P, WS.id]]) })
const ok = <T,>(rows: T[]) => ({ ok: true, rows })
const allOn = new Set(['agents', 'meetings', 'minutes', 'announcements'])
const summary = (review: number) => ({ mine: { ok: true, count: 3 }, review: { ok: true, count: review }, dueToday: { ok: true, count: 0 } })
const cfgWith = (value: unknown, status = 'set') => ({ workspaceId: WS.id, revision: 1, keys: { 'portal.widgets': status === 'invalid' ? { status, error: '깨짐' } : { status, value } } })
beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.scope.mockResolvedValue({ ws: WS, actor: admin, degraded: false, role: 'member' })
  h.cfg.mockResolvedValue(cfgWith(defaultPortalWidgets(), 'default'))
  h.tz.mockResolvedValue({ ok: true, timeZone: 'Asia/Seoul' })
  h.prefs.mockResolvedValue({})
  h.sets.mockResolvedValue({ ok: true, sets: new Map([[P, allOn]]), union: allOn, partial: false })
  h.summary.mockResolvedValue(summary(1))
  h.work.mockResolvedValue({ ok: true, rows: [], nextCursor: null, failedKinds: [] })
  h.projects.mockResolvedValue({ ok: true, rows: [], nextCursor: null })
  h.reviewRows.mockResolvedValue(ok([])); h.upcoming.mockResolvedValue({ ok: true, rows: [], partial: false }); h.docs.mockResolvedValue(ok([]))
  h.ann.mockResolvedValue({ ok: true, rows: [], partial: false })
})
const render = async (q: Record<string, string> = {}) => renderAll(await Home({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve(q) }))
/** 그 href 의 <a> 가 aria-current="page" 인가(속성 순서 무관) */
const current = (html: string, href: string) => (html.match(/<a\b[^>]*>/g) ?? []).some((a) => a.includes(`href="${href}"`) && a.includes('aria-current="page"'))
/** 홈에 그려진 위젯 id(문서 순서) · 위젯 칸의 크기 */
const shown = (html: string) => [...html.matchAll(/<section[^>]*data-widget="([^"]+)"/g)].map((m) => m[1])
const sizes = (html: string) => Object.fromEntries([...html.matchAll(/<div[^>]*>/g)].map((m) => m[0]).filter((d) => d.includes('data-widget-cell='))
  .map((d) => [d.match(/data-widget-cell="([^"]+)"/)![1], d.match(/data-size="([^"]+)"/)![1]]))
const widget = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-widget="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''

describe('포털 v1 — 위젯별 부분 실패(⑥)', () => {
  it('개인 설정 조회 실패는 홈을 기본 배치로 유지하며 알리고 홈 구성을 막는다(읽지 못한 값 위에 덮어쓰지 않는다)', async () => {
    h.prefs.mockRejectedValue(new Error('down'))
    const html = await render()
    expect(h.prefs).toHaveBeenCalledWith(WS.id, { strict: true })
    expect(html).toContain('개인 설정을 읽지 못해 내 홈 구성 대신 기본 배치로 보입니다')
    expect(html).toMatch(/<button[^>]*data-home-edit[^>]*aria-disabled="true"|<button[^>]*aria-disabled="true"[^>]*data-home-edit/)
    expect(html).toContain('개인 설정을 읽지 못해 지금은 홈을 구성할 수 없습니다')
    expect(widget(html, 'my_work')).not.toContain('partial_error')
  })
  it('로더 하나가 { ok: false } 면 그 위젯만 partial_error, 나머지는 그대로', async () => {
    h.upcoming.mockResolvedValue({ ok: false, error: '다가오는 회의를 불러오지 못했습니다.' })
    const html = await render()
    expect(widget(html, 'upcoming')).toContain('data-status-kind="partial_error"')
    expect(widget(html, 'upcoming')).toContain('다가오는 회의를 불러오지 못했습니다.')
    expect(widget(html, 'upcoming')).toContain('다시 시도')
    for (const id of ['my_work', 'projects', 'review', 'recent_docs', 'announcements']) expect(widget(html, id), id).not.toContain('partial_error')
  })
  it('로더가 던져도 그 위젯만 실패 — 화면 전체 오류로 번지지 않는다(safe)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.docs.mockRejectedValue(new Error('boom'))
    const html = await render()
    expect(widget(html, 'recent_docs')).toContain('partial_error'); expect(widget(html, 'my_work')).not.toContain('partial_error')
    err.mockRestore()
  })
  it('0건은 empty — 실패를 0건으로 그리지 않고, 0건을 실패로 그리지 않는다', async () => {
    const html = await render()
    expect(widget(html, 'announcements')).toContain('data-status-kind="empty"')
    expect(widget(html, 'announcements')).not.toContain('partial_error')
  })
  it('공지·회의 판정 일부 실패(partial)는 받은 행과 함께 알린다 — 0건이어도 "공지가 없습니다" 만 보이지 않게', async () => {
    h.ann.mockResolvedValue({ ok: true, partial: true, rows: [] })
    const html = await render()
    expect(widget(html, 'announcements')).toContain('data-status-kind="partial_error"')
  })
  it('요약 칸의 독립 실패 — "—" 와 title 에 사유, 나머지 칸은 수', async () => {
    h.summary.mockResolvedValue({ mine: { ok: false, reason: '일부 항목(이슈)을 불러오지 못했습니다' }, review: { ok: true, count: 1 }, dueToday: { ok: true, count: 2 } })
    const html = await render()
    expect(html).toMatch(/data-summary="mine"[^>]*title="일부 항목\(이슈\)을 불러오지 못했습니다"[\s\S]*?—/)
    expect(html).toMatch(/data-summary="dueToday"[\s\S]*?>2</)
    expect(html).toMatch(/data-summary="review"[\s\S]*?>1</)
  })
  it('요약 칸의 링크 — 내 업무의 그 거르기로(W7)', async () => {
    const html = await render()
    expect(html).toMatch(/data-summary="mine"[^>]*href="\/w\/acme\/my-work\?kind=wbs%2Cissue"|href="\/w\/acme\/my-work\?kind=wbs%2Cissue"[^>]*data-summary="mine"/)
    expect(html).toMatch(/href="\/w\/acme\/my-work\?due=today"/)
  })
  it('검토 권한이 없는 사용자 — review 위젯도 검토 칸도 없다(검토 수가 HTML 에 없다)', async () => {
    h.scope.mockResolvedValue({ ws: WS, actor: member, degraded: false, role: 'member' })
    h.summary.mockResolvedValue({ mine: { ok: true, count: 3 }, review: { ok: true, count: 0 }, dueToday: { ok: true, count: 0 } })
    const html = await render()
    expect(html).not.toContain('data-widget="review"'); expect(html).not.toContain('data-summary="review"'); expect(html).not.toContain('검토 대기')
    expect(h.reviewRows).not.toHaveBeenCalled()
  })
  it('검토 대기가 있으면 관리자가 아니어도 검토자 — 검토 위젯과 칸', async () => {
    h.scope.mockResolvedValue({ ws: WS, actor: member, degraded: false, role: 'member' })
    h.summary.mockResolvedValue(summary(2))
    const html = await render()
    expect(html).toContain('data-widget="review"'); expect(html).toMatch(/data-summary="review"[\s\S]*?>2</)
  })
  it('모듈 합집합 실패 — 모듈 위젯은 실패 카드(숨기지 않는다), my_work·projects 는 정상(Review Focus 5)', async () => {
    h.sets.mockResolvedValue({ ok: false, error: 'down' })
    const html = await render()
    for (const id of ['review', 'upcoming', 'recent_docs', 'announcements']) expect(widget(html, id), id).toContain('partial_error')
    expect(widget(html, 'my_work')).not.toContain('partial_error'); expect(widget(html, 'projects')).not.toContain('partial_error')
    expect(h.upcoming).not.toHaveBeenCalled(); expect(h.docs).not.toHaveBeenCalled(); expect(h.ann).not.toHaveBeenCalled()  // 켜졌는지 모르는 모듈의 원천은 읽지 않는다
  })
  it('R9 ① — 합집합 실패 + 검토 0건 관리자: 검토자 판정 불가라 review 를 조용히 빼지 않고 실패 카드로', async () => {
    h.sets.mockResolvedValue({ ok: false, error: 'down' })
    h.summary.mockResolvedValue(summary(0))
    const html = await render()
    expect(widget(html, 'review')).toContain('partial_error')
    expect(h.reviewRows).not.toHaveBeenCalled()
  })
  it('모듈 판정이 일부 프로젝트에서 실패하면 화면 위 한 줄로 알린다', async () => {
    h.sets.mockResolvedValue({ ok: true, sets: new Map([[P, allOn]]), union: allOn, partial: true })
    expect(await render()).toContain('일부 프로젝트의 기능 설정을 확인하지 못했습니다')
  })
  it('열화(actor null) — 로더를 부르지 않고 화면 전체 상태 하나', async () => {
    h.scope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    const html = await render()
    expect(h.work).not.toHaveBeenCalled(); expect(h.summary).not.toHaveBeenCalled(); expect(h.sets).not.toHaveBeenCalled()
    expect(html).toContain('role="alert"'); expect(html.match(/<h1/g)).toHaveLength(1)
  })
})

describe('포털 v1 — 머리·설정·구성·탭', () => {
  it('머리 meta 에 날짜와 워크스페이스 시간대 이름(viewTimezone — 판정 R1), h1 하나', async () => {
    const html = await render()
    expect(h.tz).toHaveBeenCalledWith(WS.id)
    expect(html).toMatch(/오늘의 업무 · \d+월 \d+일 [월화수목금토일]요일 · 시간대 Asia\/Seoul/)
    expect(html.match(/<h1/g)).toHaveLength(1); expect(html).toMatch(/<h1[^>]*>홈<\/h1>/)
  })
  it('워크스페이스 달력이 손상이면 시간대를 지어내지 않는다 — 머리에 확인 불가', async () => {
    h.tz.mockResolvedValue({ ok: false, error: '시간대 이름이 아닙니다.', key: 'calendar.timezone' })
    const html = await render()
    expect(html).toContain('시간대 확인 불가'); expect(html).not.toContain('Asia/Seoul')
    expect(widget(html, 'my_work')).toBeTruthy()                                   // 화면은 막지 않는다
  })
  it('모든 로더가 같은 순간(now)을 받는다 — 요청 범위 원천 공유(W8)·한 순간의 오늘(R1)', async () => {
    await render()
    const nows = [h.summary, h.work, h.projects, h.upcoming, h.ann, h.reviewRows].map((f) => (f.mock.calls[0] as unknown[])[2] as { now: Date })
    expect(nows.every((o) => o.now instanceof Date)).toBe(true)
    expect(new Set(nows.map((o) => o.now)).size).toBe(1)
  })
  it('portal.widgets 에서 끈 위젯은 홈에 없다(설정 소비)', async () => {
    h.cfg.mockResolvedValue(cfgWith(defaultPortalWidgets().map((w) => (w.id === 'announcements' ? { ...w, enabled: false } : w))))
    const html = await render()
    expect(html).not.toContain('data-widget="announcements"')
    expect(h.ann).not.toHaveBeenCalled()                                           // 꺼진 위젯의 원천은 읽지 않는다
  })
  it('portal.widgets 순서 — 설정 순서대로 놓는다(열 고정 없음 — 2026-10-10)', async () => {
    const order = ['announcements', 'upcoming', 'recent_docs', 'review', 'projects', 'my_work'].map((id) => ({ id, enabled: true }))
    h.cfg.mockResolvedValue(cfgWith(order))
    const html = await render()
    expect(shown(html)).toEqual(['announcements', 'upcoming', 'recent_docs', 'review', 'projects', 'my_work'])
  })
  it('기본 배치의 크기 — my_work·projects 는 전체 폭, 나머지는 반 폭(390 에서는 한 열)', async () => {
    const html = await render()
    expect(html).toContain('grid grid-cols-1 gap-6 lg:grid-cols-2')
    expect(sizes(html)).toEqual({ my_work: 'full', projects: 'full', review: 'half', upcoming: 'half', recent_docs: 'half', announcements: 'half' })
  })
  it('옛 숨김 값은 잃지 않는다 — 기본 배치에서 그 위젯이 빠지고(이행), 옛 "다시 보기" 줄은 없다', async () => {
    h.prefs.mockResolvedValue({ portalHiddenWidgets: ['announcements', 'upcoming'] })
    const html = await render()
    expect(shown(html)).toEqual(['my_work', 'projects', 'review', 'recent_docs']); expect(html).not.toContain('숨긴 위젯')
    expect(h.ann).not.toHaveBeenCalled(); expect(h.upcoming).not.toHaveBeenCalled()
    expect(html).toContain('홈 구성')
  })
  it('개인 구성 — 내 순서·크기로 그리고, 올린 위젯의 로더만 부른다', async () => {
    h.due.mockResolvedValue({ ok: true, rows: [], overdue: 0, soon: 0, partial: false })
    h.prefs.mockResolvedValue({ portalLayout: { v: 1, items: [{ id: 'due_work', size: 'full' }, { id: 'memo', size: 'half' }, { id: 'my_work', size: 'half' }], known: [] } })
    const html = await render()
    expect(shown(html)).toEqual(['due_work', 'memo', 'my_work']); expect(sizes(html)).toEqual({ due_work: 'full', memo: 'half', my_work: 'half' })
    expect(h.due).toHaveBeenCalledTimes(1); expect(h.work).toHaveBeenCalledTimes(1)
    for (const f of [h.projects, h.reviewRows, h.upcoming, h.docs, h.ann, h.issues, h.week, h.changes]) expect(f).not.toHaveBeenCalled()
  })
  it('관리자가 끈 위젯은 개인 구성에 있어도 없다 — 원천도 읽지 않는다', async () => {
    h.cfg.mockResolvedValue(cfgWith(defaultPortalWidgets().map((w) => (w.id === 'projects' ? { ...w, enabled: false } : w))))
    h.prefs.mockResolvedValue({ portalLayout: { v: 1, items: [{ id: 'projects', size: 'full' }, { id: 'my_work', size: 'full' }], known: [] } })
    const html = await render()
    expect(shown(html)).toEqual(['my_work']); expect(h.projects).not.toHaveBeenCalled()
  })
  it('위젯을 모두 뺀 개인 구성 — 빈 홈과 안내(기본 배치로 되돌아가지 않는다)', async () => {
    h.prefs.mockResolvedValue({ portalLayout: { v: 1, items: [], known: [] } })
    const html = await render()
    expect(shown(html)).toEqual([]); expect(html).toContain('홈에 올린 위젯이 없습니다'); expect(h.work).not.toHaveBeenCalled()
  })
  it('업무 위젯 탭 — ?tab=mine 이면 작업·이슈만 읽고 탭에 aria-current, 검토자가 아니면 검토 탭이 없다', async () => {
    const html = await render({ tab: 'mine' })
    expect(h.work).toHaveBeenCalledWith(WS.id, admin, expect.objectContaining({ kinds: ['wbs', 'issue'], limit: 20 }))
    expect(current(html, '/w/acme?tab=mine')).toBe(true); expect(current(html, '/w/acme?tab=all')).toBe(false)
    h.scope.mockResolvedValue({ ws: WS, actor: member, degraded: false, role: 'member' })
    h.summary.mockResolvedValue(summary(0))
    const m = await render({ tab: 'review' })
    expect(m).not.toContain('?tab=review'); expect(current(m, '/w/acme?tab=all')).toBe(true)
  })
  it('위젯 설정을 읽지 못하면 기본 배치 + 알림 한 줄(화면을 막지 않는다)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.cfg.mockRejectedValue(new Error('down'))
    const html = await render()
    expect(html).toContain('data-widget="my_work"'); expect(html).toContain('홈 위젯 설정을 읽지 못해 기본 배치로 보입니다')
    h.cfg.mockResolvedValue(cfgWith(null, 'invalid'))
    expect(await render()).toContain('홈 위젯 설정을 읽지 못해 기본 배치로 보입니다')
    err.mockRestore()
  })
  it('프로젝트 행 — 이름·근거·상태 칩(글)·다음 기한', async () => {
    h.projects.mockResolvedValue({ ok: true, nextCursor: null, rows: [{ id: P, name: 'Apollo', description: null, status: 'active', statusReason: '완료 1/4',
      startDate: '2026-09-01', endDate: '2026-12-31', isFavorite: false, progress: { done: 1, total: 4 }, nextDue: '2026-10-09' }] })
    const w = widget(await render(), 'projects')
    expect(w).toContain('Apollo'); expect(w).toContain('완료 1/4'); expect(w).toContain('진행중'); expect(w).toContain('다음 기한 2026-10-09')
    expect(w).toContain(`href="/p/${P}/dashboard"`)
  })
})
