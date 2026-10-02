import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/w/acme/minutes' }))
vi.mock('@/components/app/NotificationBell', () => ({ NotificationBell: () => <span data-bell /> }))
vi.mock('@/components/app/AccountMenu', () => ({ AccountMenu: () => <span data-account /> }))
import { GlobalBar } from '@/components/app/GlobalBar'

const brand = { productName: 'Acme', workspaceId: 'w1', hasFull: false, hasFullDark: false, hasMark: false }
const base = { brand, homeHref: '/w/acme', identity: null, staging: false, onOpenDrawer: () => {} }
describe('GlobalBar(★10, D28)', () => {
  it('티커 없음, 찾기 자리에 조작 없음, 브랜드 → 워크스페이스 홈, 셸 층', () => {
    const html = renderToString(<GlobalBar {...base} scope="workspace" crumbs={{ scope: 'workspace', workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: '회의록' }} />)
    expect(html).not.toContain('data-ticker'); expect(html).not.toContain('HeaderAnnouncementTicker')
    expect(html).toMatch(/data-slot="search"[^>]*><\/div>/)
    expect(html).toContain('href="/w/acme"')
    expect(html).toContain('z-(--z-shell)'); expect(html).toContain('h-12')
    expect(html).toContain('data-bell'); expect(html).toContain('data-account')
  })
  it('워크스페이스 범위 = 칩 "워크스페이스 전체"·프로젝트 이름 없음, 프로젝트 범위 = 칩 없음, (global) = 칩 없음', () => {
    const ws = renderToString(<GlobalBar {...base} scope="workspace" crumbs={{ scope: 'workspace', workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: '회의록' }} />)
    expect(ws).toContain('워크스페이스 전체'); expect(ws).toContain('aria-label="현재 위치"')
    const pj = renderToString(<GlobalBar {...base} scope="project" crumbs={{ scope: 'project', workspace: { name: 'Acme', href: '/w/acme' }, project: { name: 'Apollo', href: '/p/p1/dashboard' }, screen: '이슈' }} />)
    expect(pj).not.toContain('워크스페이스 전체'); expect(pj).toContain('Apollo')
    const gl = renderToString(<GlobalBar {...base} scope="global" crumbs={{ scope: 'global', workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: null }} />)
    expect(gl).not.toContain('워크스페이스 전체')
  })
  it('AA1 — 프로젝트 범위의 브레드크럼 프로젝트 칸은 넘겨받은 전환기(없으면 개요 링크)', () => {
    const crumbs = { scope: 'project' as const, workspace: { name: 'Acme', href: '/w/acme' }, project: { name: 'Apollo', href: '/p/p1/dashboard' }, screen: '이슈' }
    const withSlot = renderToString(<GlobalBar {...base} scope="project" crumbs={crumbs} projectSwitcher={<button data-project-switcher="crumb">Apollo</button>} />)
    expect(withSlot).toContain('data-project-switcher="crumb"'); expect(withSlot).not.toContain('href="/p/p1/dashboard"')
    const plain = renderToString(<GlobalBar {...base} scope="project" crumbs={crumbs} />)
    expect(plain).toContain('href="/p/p1/dashboard"')
  })
  it('AI 아이콘은 넘겨받은 것만 그린다(탐침 404 면 셸이 넘기지 않는다 — D33)', () => {
    const none = renderToString(<GlobalBar {...base} scope="workspace" crumbs={{ scope: 'workspace', workspace: null, project: null, screen: null }} />)
    expect(none).not.toContain('data-ai-open')
    const some = renderToString(<GlobalBar {...base} scope="workspace" aiButton={<button data-ai-open />} crumbs={{ scope: 'workspace', workspace: null, project: null, screen: null }} />)
    expect(some).toContain('data-ai-open')
  })
  it('STAGING 표지는 prop 으로만', () => {
    const on = renderToString(<GlobalBar {...base} staging scope="global" crumbs={{ scope: 'global', workspace: null, project: null, screen: null }} />)
    expect(on).toContain('STAGING')
    const off = renderToString(<GlobalBar {...base} scope="global" crumbs={{ scope: 'global', workspace: null, project: null, screen: null }} />)
    expect(off).not.toContain('STAGING')
  })
  it('768 미만 — 브레드크럼 대신 범위 이름 버튼이 같은 드로어를 연다(스펙 §5.4.5, Z10). 브레드크럼은 md 이상(정적 래퍼)', () => {
    const pj = renderToString(<GlobalBar {...base} scope="project" crumbs={{ scope: 'project', workspace: { name: 'Acme', href: '/w/acme' }, project: { name: 'Apollo', href: '/p/p1/dashboard' }, screen: '이슈' }} />)
    expect(pj).toMatch(/<button[^>]*data-scope-button[^>]*>/)
    expect(pj).toMatch(/data-scope-button[^>]*class="[^"]*md:hidden/)
    expect(pj).toMatch(/class="hidden min-w-0 md:block"[^>]*><nav aria-label="현재 위치"/)
    expect(pj.match(/data-scope-button[\s\S]*?<\/button>/)?.[0]).toContain('Apollo')
    const ws = renderToString(<GlobalBar {...base} scope="workspace" crumbs={{ scope: 'workspace', workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: null }} />)
    expect(ws.match(/data-scope-button[\s\S]*?<\/button>/)?.[0]).toContain('Acme')
    const none = renderToString(<GlobalBar {...base} scope="global" crumbs={{ scope: 'global', workspace: null, project: null, screen: null }} />)
    expect(none).not.toContain('data-scope-button')
  })
  it('워크스페이스 전환기(D4)를 받으면 브레드크럼의 워크스페이스 자리에 둔다(링크 대신)', () => {
    const html = renderToString(<GlobalBar {...base} scope="workspace" workspaceSwitcher={<span data-ws-switcher-slot>Acme▾</span>} crumbs={{ scope: 'workspace', workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: null }} />)
    expect(html).toMatch(/aria-label="현재 위치"[\s\S]*data-ws-switcher-slot/)
    expect(html.match(/<nav aria-label="현재 위치"[\s\S]*?<\/nav>/)?.[0]).not.toContain('href="/w/acme"')
  })
})
