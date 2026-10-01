import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ loadWorkspaceScope: vi.fn(), getMyWork: vi.fn(), getProjectRows: vi.fn(), getWorkspaceAnnouncements: vi.fn() }))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/data/portal', () => ({ getMyWork: h.getMyWork, getProjectRows: h.getProjectRows, getWorkspaceAnnouncements: h.getWorkspaceAnnouncements }))

import Home from '@/app/(app)/w/[slug]/page'
import MyWork from '@/app/(app)/w/[slug]/my-work/page'
import { makeActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-0000000016e1', slug: 'acme', name: 'Acme' }
const row = { kind: 'issue', id: 'i1', title: '로그인 오류', projectId: 'p1', projectName: 'Apollo', due: '2026-09-30', overdueDays: 1, status: 'open', href: '/p/p1/issues?focus=i1' }
/** data-section="id" 섹션의 HTML 조각 */
/** 그 href 의 <a> 가 aria-current="page" 인가(속성 순서 무관) */
const current = (html: string, href: string) => (html.match(/<a\b[^>]*>/g) ?? []).some((a) => a.includes(`href="${href}"`) && a.includes('aria-current="page"'))
const section = (html: string, id: string) => html.match(new RegExp(`<section[^>]*data-section="${id}"[\\s\\S]*?</section>`))?.[0] ?? ''
beforeEach(() => {
  vi.clearAllMocks()
  h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) }), degraded: false, role: 'member' })
  h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: null, failedKinds: [] })
  h.getProjectRows.mockResolvedValue({ ok: true, rows: [], nextCursor: null })
  h.getWorkspaceAnnouncements.mockResolvedValue({ ok: true, rows: [] })
})

describe('홈 v0(D20)', () => {
  it('h1 "홈" + 섹션 셋(h2), 행 링크', async () => {
    const html = renderToString(await Home({ params: Promise.resolve({ slug: 'acme' }) }))
    expect(html.match(/<h1/g)).toHaveLength(1); expect(html).toContain('>홈<')
    for (const h2 of ['지금 처리할 일', '진행 중인 프로젝트', '공지']) expect(html).toMatch(new RegExp(`<h2[^>]*>${h2}</h2>`))
    expect(html).toContain('href="/p/p1/issues?focus=i1"')
    expect(html).toContain('href="/w/acme/my-work"')
    expect(section(html, 'projects')).not.toContain('href="/w/acme/projects"')   // 과제 25 전에는 없는 경로 — 옛 목록으로
    expect(h.loadWorkspaceScope).toHaveBeenCalledWith('acme')
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { limit: 20 })
    expect(h.getProjectRows).toHaveBeenCalledWith(WS.id, expect.anything(), { status: 'active', limit: 20 })
  })
  it('섹션 하나의 실패는 그 섹션만 부분 실패, 0건은 빈 상태 문구', async () => {
    h.getProjectRows.mockResolvedValue({ ok: false, error: 'x' })
    const html = renderToString(await Home({ params: Promise.resolve({ slug: 'acme' }) }))
    expect(section(html, 'projects')).toContain('data-status-kind="partial_error"')
    expect(section(html, 'work')).not.toContain('data-status-kind="partial_error"')
    expect(section(html, 'announcements')).toContain('data-status-kind="empty"')
    expect(section(html, 'announcements')).toContain('공지가 없습니다')
  })
  it('원천 일부 실패는 받은 행과 함께 알린다(failedKinds)', async () => {
    h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: null, failedKinds: ['issue'] })
    const html = renderToString(await Home({ params: Promise.resolve({ slug: 'acme' }) }))
    expect(html).toContain('로그인 오류'); expect(html).toContain('일부 항목(이슈)을 불러오지 못했습니다')
  })
  it('열화(actor null)는 로더를 부르지 않고 셋 다 부분 실패로', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    const html = renderToString(await Home({ params: Promise.resolve({ slug: 'acme' }) }))
    expect(h.getMyWork).not.toHaveBeenCalled(); expect(h.getProjectRows).not.toHaveBeenCalled(); expect(h.getWorkspaceAnnouncements).not.toHaveBeenCalled()
    for (const id of ['work', 'projects', 'announcements']) expect(section(html, id)).toContain('data-status-kind="partial_error"')
  })
  it('지난 기한은 색만이 아니라 글자로도 알린다', async () => {
    const html = renderToString(await Home({ params: Promise.resolve({ slug: 'acme' }) }))
    expect(html).toContain('1일 지남')
  })
})

describe('내 업무 v0', () => {
  it('종류 칩(링크·aria-current), 50행, 더 보기 = ?cursor=', async () => {
    h.getMyWork.mockResolvedValue({ ok: true, rows: [row], nextCursor: 'c1', failedKinds: [] })
    const html = renderToString(await MyWork({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve({ kind: 'issue' }) }))
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: ['issue'], cursor: null, limit: 50 })
    expect(current(html, '/w/acme/my-work?kind=issue')).toBe(true)
    expect(current(html, '/w/acme/my-work')).toBe(false)
    expect(html).toContain('href="/w/acme/my-work?kind=issue&amp;cursor=c1"')
    expect(html.match(/<h1/g)).toHaveLength(1)
  })
  it('모르는 종류는 전체, 열화는 로더를 부르지 않고 실패 문구', async () => {
    const all = renderToString(await MyWork({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve({ kind: 'nope' }) }))
    expect(h.getMyWork).toHaveBeenCalledWith(WS.id, expect.anything(), { kinds: undefined, cursor: null, limit: 50 })
    expect(current(all, '/w/acme/my-work')).toBe(true)
    vi.clearAllMocks()
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    const html = renderToString(await MyWork({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve({}) }))
    expect(h.getMyWork).not.toHaveBeenCalled()
    expect(html).toContain('내 업무를 불러오지 못했습니다')
  })
})
