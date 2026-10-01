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
})
