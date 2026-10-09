// 내 업무 페이지(v0 + SP3b UI-3 W7) — 종류 쉼표 목록·오늘 마감 거르기(홈 요약 칸의 링크가 여기로 온다). 옛 home-v0.test 의 내 업무 절을 옮겼다.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ loadWorkspaceScope: vi.fn(), getMyWork: vi.fn(), getPortalSummary: vi.fn() }))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/data/portal', () => ({ getMyWork: h.getMyWork, getPortalSummary: h.getPortalSummary }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: async () => 'ko' }))

import MyWork from '@/app/(app)/w/[slug]/my-work/page'
import { makeActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-0000000016e1', slug: 'acme', name: 'Acme' }
const row = { kind: 'issue', id: 'i1', title: '로그인 오류', projectId: 'p1', projectName: 'Apollo', due: '2026-09-30', overdueDays: 1, status: 'open', href: '/p/p1/issues?focus=i1' }
/** 그 href 의 <a> 가 aria-current="page" 인가(속성 순서 무관) */
const current = (html: string, href: string) => (html.match(/<a\b[^>]*>/g) ?? []).some((a) => a.includes(`href="${href}"`) && a.includes('aria-current="page"'))
const render = async (q: Record<string, string>) => renderToString(await MyWork({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve(q) }))
beforeEach(() => {
  vi.clearAllMocks()
  h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) }), degraded: false, role: 'member' })
  h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: null, failedKinds: [] })
})

describe('내 업무', () => {
  it('종류 칩(링크·aria-current), 50행, 더 보기 = ?cursor=', async () => {
    h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: 'c1', failedKinds: [] })
    const html = await render({ kind: 'issue' })
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: ['issue'], cursor: null, limit: 50, dueToday: false })
    expect(current(html, '/w/acme/my-work?kind=issue')).toBe(true)
    expect(current(html, '/w/acme/my-work')).toBe(false)
    expect(html).toContain('href="/w/acme/my-work?kind=issue&amp;cursor=c1"')
    expect(html.match(/<h1/g)).toHaveLength(1)
  })
  it('종류 쉼표 목록 — 홈 요약의 "내 담당"(작업·이슈) 칩이 그 쿼리에서만 현재', async () => {
    const html = await render({ kind: 'wbs,issue' })
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: ['wbs', 'issue'], cursor: null, limit: 50, dueToday: false })
    expect(current(html, '/w/acme/my-work?kind=wbs%2Cissue')).toBe(true)
    expect(current(html, '/w/acme/my-work?kind=issue')).toBe(false); expect(current(html, '/w/acme/my-work')).toBe(false)
  })
  it('오늘 마감(due=today) — 로더에 dueToday, 칩 현재, 더 보기가 거르기를 잇는다', async () => {
    h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: 'c2', failedKinds: [] })
    const html = await render({ due: 'today' })
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: undefined, cursor: null, limit: 50, dueToday: true })
    expect(current(html, '/w/acme/my-work?due=today')).toBe(true); expect(current(html, '/w/acme/my-work')).toBe(false)
    expect(html).toContain('href="/w/acme/my-work?due=today&amp;cursor=c2"')
  })
  it('모르는 종류는 버린다 — 전부 모르면 전체', async () => {
    const all = await render({ kind: 'nope' })
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: undefined, cursor: null, limit: 50, dueToday: false })
    expect(current(all, '/w/acme/my-work')).toBe(true)
    vi.clearAllMocks()
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) }), degraded: false, role: 'member' })
    h.getMyWork.mockResolvedValue({ ok: true, rows: [], nextCursor: null, failedKinds: [] })
    await render({ kind: 'issue,nope,issue' })
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: ['issue'], cursor: null, limit: 50, dueToday: false })
  })
  it('열화는 로더를 부르지 않고 실패 문구(막는 오류), 로더 실패도 막는 오류', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    const html = await render({})
    expect(h.getMyWork).not.toHaveBeenCalled()
    expect(html).toContain('내 업무를 불러오지 못했습니다')
    expect(html).toMatch(/role="alert"[^>]*data-status-kind="partial_error"|data-status-kind="partial_error"[^>]*role="alert"/)
    vi.clearAllMocks()
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) }), degraded: false, role: 'member' })
    h.getMyWork.mockResolvedValue({ ok: false, error: 'x' })
    expect(await render({})).toMatch(/role="alert"/)
  })
  it('행 — 종류 아이콘 + 읽히는 종류 글, 지난 기한은 색만이 아니라 글자로', async () => {
    const html = await render({})
    expect(html).toContain('<span class="sr-only">이슈</span>')
    expect(html).toContain('1일 지남')
    expect(html).toContain('href="/p/p1/issues?focus=i1"')
  })
  it('원천 일부 실패는 받은 행과 함께 알린다(failedKinds)', async () => {
    h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: null, failedKinds: ['issue'] })
    const html = await render({})
    expect(html).toContain('로그인 오류'); expect(html).toContain('일부 항목(이슈)을 불러오지 못했습니다')
  })
})
