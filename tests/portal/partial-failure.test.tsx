// 워크스페이스 홈 v1(포털 — SP3b 스펙 §6.1, §9 ⑥) — 위젯마다 독립 로더와 Suspense, 실패는 그 위젯만. 홈 v0 테스트(home-v0)를 대체한다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderAll } from './_render'
const h = vi.hoisted(() => ({
  scope: vi.fn(), cfg: vi.fn(), prefs: vi.fn(), sets: vi.fn(), summary: vi.fn(), tz: vi.fn(),
  work: vi.fn(), projects: vi.fn(), reviewRows: vi.fn(), upcoming: vi.fn(), docs: vi.fn(), ann: vi.fn(), countReview: vi.fn(),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.scope }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.cfg }))
vi.mock('@/lib/calendar/viewZone', () => ({ viewTimezone: h.tz }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: h.prefs }))
vi.mock('@/lib/data/portal', () => ({
  workspaceModuleSets: h.sets, getPortalSummary: h.summary, getMyWork: h.work, getProjectRows: h.projects, countMyReview: h.countReview,
  getReviewRows: h.reviewRows, getUpcomingMeetings: h.upcoming, getRecentDocuments: h.docs, getWorkspaceAnnouncements: h.ann,
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
const widget = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-widget="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''

describe('포털 v1 — 위젯별 부분 실패(⑥)', () => {
  it('개인 설정 조회 실패는 홈을 유지하며 알리고 숨김 버튼을 막는다', async () => {
    h.prefs.mockRejectedValue(new Error('down'))
    const html = await render()
    expect(h.prefs).toHaveBeenCalledWith(WS.id, { strict: true })
    expect(html).toContain('개인 설정을 읽지 못해 위젯 숨김을 적용하지 못했습니다')
    expect(widget(html, 'my_work')).toContain('이 위젯 숨기기')
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

describe('포털 v1 — 머리·설정·숨김·탭', () => {
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
  it('portal.widgets 에서 끈 위젯은 홈에 없다(설정 소비 — 숨김 수에도 들지 않는다)', async () => {
    h.cfg.mockResolvedValue(cfgWith(defaultPortalWidgets().map((w) => (w.id === 'announcements' ? { ...w, enabled: false } : w))))
    const html = await render()
    expect(html).not.toContain('data-widget="announcements"'); expect(html).not.toContain('숨긴 위젯')
    expect(h.ann).not.toHaveBeenCalled()                                           // 꺼진 위젯의 원천은 읽지 않는다
  })
  it('portal.widgets 순서 — 열 안에서 설정 순서를 따른다', async () => {
    const order = ['announcements', 'upcoming', 'recent_docs', 'review', 'projects', 'my_work'].map((id) => ({ id, enabled: true }))
    h.cfg.mockResolvedValue(cfgWith(order))
    const html = await render()
    expect(html.indexOf('data-widget="announcements"')).toBeLessThan(html.indexOf('data-widget="upcoming"'))
    expect(html.indexOf('data-widget="projects"')).toBeLessThan(html.indexOf('data-widget="my_work"'))
  })
  it('숨긴 위젯 — 빠지고, 끝에 "숨긴 위젯 N개 다시 보기"', async () => {
    h.prefs.mockResolvedValue({ portalHiddenWidgets: ['announcements', 'upcoming'] })
    const html = await render()
    expect(html).not.toContain('data-widget="announcements"'); expect(html).toContain('숨긴 위젯 2개 다시 보기')
    expect(widget(html, 'my_work')).toContain('aria-label="이 위젯 숨기기"')
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
