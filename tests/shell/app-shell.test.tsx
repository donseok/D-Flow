// @vitest-environment jsdom
// AppShell(D2, 개정 §5.4.1) — 범위 셸의 조립: main 하나가 스크롤 주체(.app-main 클래스 본문 — overflow·scrollbar 유틸 없음), 레일 자리, 열화·설정 실패 알림,
// 범위별 내비(워크스페이스·프로젝트·global), 브레드크럼 화면 이름, 배지 계약(null 은 그리지 않는다). 하위 셸 조각은 각자 테스트가 있어 여기서는 받은 값만 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from './_dom'

const h = vi.hoisted(() => ({
  pathname: '/w/acme/minutes',
  badges: { myWorkReview: 3 as number | null, projectApprovals: 2 as number | null, projectUnreadAnnouncements: null as number | null },
  globalBar: vi.fn(), wsNav: vi.fn(), pNav: vi.fn(), pSwitcher: vi.fn(), drawer: vi.fn(),
}))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => `t:${k}`, locale: 'ko' }) }))
vi.mock('@/components/app/ShellStateProvider', () => ({ useShellState: () => ({ badges: h.badges }) }))
vi.mock('@/components/chat/AssistantChat', () => ({ useAiRailButton: () => null }))
vi.mock('@/components/app/GlobalBar', () => ({ GlobalBar: (p: unknown) => { h.globalBar(p); return <header data-global-bar /> } }))
vi.mock('@/components/app/WorkspaceNav', () => ({ WorkspaceNav: (p: unknown) => { h.wsNav(p); return <aside data-ws-nav /> } }))
vi.mock('@/components/app/ProjectNav', () => ({ ProjectNav: (p: { projectSwitcher: React.ReactNode }) => { h.pNav(p); return <aside data-p-nav>{p.projectSwitcher}</aside> } }))
vi.mock('@/components/app/ProjectSwitcher', () => ({ ProjectSwitcher: (p: unknown) => { h.pSwitcher(p); return <div data-p-switcher /> }, ProjectCrumbSwitcher: () => <div data-p-crumb-switcher /> }))
vi.mock('@/components/app/WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => <div data-ws-switcher-stub /> }))
vi.mock('@/components/app/MobileNavDrawer', () => ({ MobileNavDrawer: (p: unknown) => { h.drawer(p); return null } }))

import { AppShell } from '@/components/app/AppShell'
import { ShellEnvProvider } from '@/components/app/ShellEnv'
import type { ShellProps } from '@/lib/shell/loadShell'
import type { NavGroup } from '@/lib/nav/registry'

const WS = { id: '00000000-0000-0000-7e57-000000001761', slug: 'acme', name: 'Acme' }
const P1 = '00000000-0000-0000-7e57-000000001762', P2 = '00000000-0000-0000-7e57-000000001763'
const wsGroups: NavGroup[] = [{ group: 'ws.main', items: [{ id: 'ws.home', href: '/w/acme', label: { key: 'nav.home' as never }, icon: 'House' }, { id: 'ws.minutes', href: '/w/acme/minutes', label: '회의 기록', icon: 'FileText' }] }]
const pGroups: NavGroup[] = [{ group: 'p.overview', items: [{ id: 'p.dashboard', href: `/p/${P1}/dashboard`, label: { key: 'nav.dashboard' as never }, icon: 'LayoutDashboard' }] }]
const base = (over: Partial<ShellProps> = {}): ShellProps => ({
  scope: 'workspace', base: '/w/acme', groups: wsGroups, workspaceGroups: wsGroups, workspace: WS, workspaces: [], viewingAsPlatformAdmin: false,
  project: null, projects: [{ id: P1, name: '하나', status: 'active', isAdmin: false }, { id: P2, name: '둘', status: 'active', isAdmin: false }],
  projectsFailed: false, favoriteIds: [P2], recentIds: [P1],
  identity: { displayName: 'alice', roleLabel: '멤버', teamCodes: null },
  brand: { productName: 'D-Flow', workspaceId: WS.id, hasFull: false, hasFullDark: false, hasMark: false },
  accentCss: '', degraded: false, configDegraded: false, canEditSettings: false, ...over,
})
const shell = (p: ShellProps) => render(<ShellEnvProvider value={{ staging: false, sidebarCollapsed: null }}><AppShell {...p}><p data-body>본문</p></AppShell></ShellEnvProvider>)
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0]

beforeEach(() => { vi.clearAllMocks(); h.pathname = '/w/acme/minutes'; h.badges = { myWorkReview: 3, projectApprovals: 2, projectUnreadAnnouncements: null } })

describe('AppShell', () => {
  it('① main#main-content 는 .app-main(스크롤 주체) — overflow·scrollbar 유틸이 없다 ② #app-rail 레일 자리 ⑥ 스킵 링크 대상', () => {
    shell(base())
    const main = document.querySelector('main#main-content')!
    expect(main.className).toContain('app-main')
    expect(main.className).not.toMatch(/overflow|scrollbar/)
    expect(document.getElementById('app-rail')).not.toBeNull()
    expect(main.querySelector('[data-body]')).not.toBeNull()
  })
  it('main 은 위 패딩이 없고 첫 자식이 위 간격 자리다 — sticky 는 스크롤 상자 패딩 안쪽에 붙어 pt 만큼 위로 내용이 비친다(D54, 과제 33 측정)', () => {
    shell(base())
    const main = document.querySelector('main#main-content')!
    expect(main.className).not.toMatch(/(?:^|\s)(?:\w+:)?(?:pt|py|p)-\d/)
    expect(main.firstElementChild?.hasAttribute('data-main-top-gap')).toBe(true)
    expect(main.firstElementChild?.getAttribute('aria-hidden')).toBe('true')
  })
  it('③ degraded 면 열화 알림, ④ configDegraded 면 role=alert 설정 실패 알림(관리자만 설정 링크)', () => {
    shell(base({ degraded: true, configDegraded: true, canEditSettings: true }))
    expect(document.querySelector('[data-degraded-notice]')).not.toBeNull()
    const alert = [...document.querySelectorAll('[role="alert"]')].find((e) => e.textContent?.includes('설정을 불러오지 못해 메뉴 일부를 숨겼습니다'))!
    expect(alert).toBeTruthy()
    expect(alert.querySelector('a')?.getAttribute('href')).toBe('/w/acme/settings')
  })
  it('설정 실패 알림 — 관리자가 아니면 설정 링크가 없다', () => {
    shell(base({ configDegraded: true, canEditSettings: false }))
    const alert = [...document.querySelectorAll('[role="alert"]')].find((e) => e.textContent?.includes('설정을 불러오지 못해'))!
    expect(alert.querySelector('a')).toBeNull()
  })
  it('목록 조회 실패(projectsFailed)는 열화 알림으로 드러낸다(3원칙 ①)', () => {
    shell(base({ projectsFailed: true }))
    expect(document.querySelector('[data-degraded-notice]')?.textContent).toContain('프로젝트 목록')
  })
  it('⑤ 워크스페이스 범위 — WorkspaceNav(ids·목록 그대로, W14 해석은 내비 안), 배지는 내 업무만, 브레드크럼 화면 이름', () => {
    shell(base())
    expect(document.querySelector('[data-ws-nav]')).not.toBeNull(); expect(document.querySelector('[data-p-nav]')).toBeNull()
    const nav = last(h.wsNav)
    expect(nav).toEqual(expect.objectContaining({ pathname: '/w/acme/minutes', slug: 'acme', favoriteIds: [P2], recentIds: [P1], projectsFailed: false, badges: { 'ws.my_work': 3 } }))
    expect(nav.projects.map((p: { id: string }) => p.id)).toEqual([P1, P2])
    const bar = last(h.globalBar)
    expect(bar.crumbs).toEqual({ scope: 'workspace', workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: '회의 기록' })
    expect(bar.homeHref).toBe('/w/acme')
    expect(bar.workspaceSwitcher).toBeTruthy()                                   // 데스크톱 전환기 자리(D4) — 드로어에도 같은 것
    expect(last(h.drawer).workspaceSwitcher).toBeTruthy()
  })
  it('전역 검색에 내리는 메뉴 — 워크스페이스 범위는 워크스페이스 메뉴만(프로젝트 null), 제품 이름은 셸의 브랜드 그대로', () => {
    shell(base({ brand: { productName: 'Acme Flow', workspaceId: WS.id, hasFull: false, hasFullDark: false, hasMark: false } }))
    expect(last(h.globalBar).searchNav).toEqual({ workspace: wsGroups, project: null })
    expect(last(h.globalBar).brand.productName).toBe('Acme Flow')
  })
  it('⑤ 프로젝트 범위 — ProjectNav + ProjectSwitcher, 배지 null 은 그대로 null(0 으로 위장하지 않는다)', () => {
    h.pathname = `/p/${P1}/dashboard`
    shell(base({ scope: 'project', base: `/p/${P1}`, groups: pGroups, project: { id: P1, name: '하나' } }))
    expect(document.querySelector('[data-p-nav]')).not.toBeNull(); expect(document.querySelector('[data-p-switcher]')).not.toBeNull()
    expect(last(h.pNav).badges).toEqual({ 'p.agents': 2, 'p.announcements': null })
    expect(last(h.pNav).workspaceHome).toBe('/w/acme')
    expect(last(h.pSwitcher)).toEqual(expect.objectContaining({ currentProjectId: P1, favoriteIds: [P2], recentIds: [P1], projectsFailed: false }))
    expect(last(h.globalBar).crumbs).toEqual({ scope: 'project', workspace: { name: 'Acme', href: '/w/acme' }, project: { name: '하나', href: `/p/${P1}/dashboard` }, screen: 't:nav.dashboard' })
    // 전역 검색(⌘K)에는 사이드 내비와 같은 해석 결과를 내린다 — 프로젝트 범위는 두 메뉴(프로젝트·워크스페이스), 제품 이름은 셸의 브랜드
    expect(last(h.globalBar).searchNav).toEqual({ workspace: wsGroups, project: pGroups })
    expect(last(h.globalBar).brand.productName).toBe('D-Flow')
    expect(last(h.globalBar).projectSwitcher).toBeTruthy()          // AA1 — 브레드크럼 프로젝트 칸의 전환기
    expect(typeof last(h.pNav).onToggleCollapsed).toBe('function')     // AA2 — 접기 토글이 계정 키 setter 를 받는다
  })
  it('⑤ global — 워크스페이스 내비이되 활성 항목 없음(pathname 빈 값)·브레드크럼 화면 이름 없음', () => {
    h.pathname = '/account'
    shell(base({ scope: 'global' }))
    expect(last(h.wsNav).pathname).toBe('')
    expect(last(h.globalBar).crumbs.screen).toBeNull()
  })
  it('⑤ global 의 플랫폼 운영 두 화면 — 사이드바·드로어가 그 항목을 고르고 브레드크럼에 화면 이름이 선다', () => {
    const platform: NavGroup[] = [...wsGroups, { group: 'ws.platform', items: [
      { id: 'ws.llm', href: '/admin/llm-config', label: { key: 'nav.llm' as never }, icon: 'Cpu' },
      { id: 'ws.ui_states', href: '/admin/ui-states', label: { key: 'nav.uiStates' as never }, icon: 'SwatchBook' }] }]
    for (const [path, key] of [['/admin/llm-config', 'nav.llm'], ['/admin/ui-states', 'nav.uiStates']] as const) {
      h.pathname = path
      shell(base({ scope: 'global', groups: platform }))
      expect(last(h.wsNav).pathname).toBe(path)
      expect(last(h.drawer).pathname).toBe(path)
      expect(last(h.globalBar).crumbs.screen).toBe(`t:${key}`)
    }
    h.pathname = '/account'
    shell(base({ scope: 'global', groups: platform }))
    expect(last(h.wsNav).pathname).toBe(''); expect(last(h.drawer).pathname).toBe(''); expect(last(h.globalBar).crumbs.screen).toBeNull()
  })
  it('최소 셸(워크스페이스 모름) — 내비 없음, 홈은 리졸버(/), 브레드크럼 워크스페이스 없음', () => {
    h.pathname = `/p/${P1}/wbs`
    shell(base({ scope: 'project', groups: [], workspace: { id: '', slug: '', name: '' }, project: { id: P1, name: '' }, projects: [], favoriteIds: [], recentIds: [], degraded: true }))
    expect(document.querySelector('[data-ws-nav]')).toBeNull(); expect(document.querySelector('[data-p-nav]')).toBeNull()
    const bar = last(h.globalBar)
    expect(bar.homeHref).toBe('/'); expect(bar.crumbs.workspace).toBeNull(); expect(bar.workspaceSwitcher).toBeUndefined()
  })
  it('accent 는 <style> 한 블록(받은 문자열 그대로 — 조립은 accentStyle 이 한다)', () => {
    shell(base({ accentCss: ':root{--color-action:#123456}' }))
    expect([...document.querySelectorAll('style')].map((s) => s.textContent)).toContain(':root{--color-action:#123456}')
  })
  it('드로어 — 같은 범위 내비·전환기를 받는다(프로젝트 범위면 워크스페이스 홈)', () => {
    h.pathname = `/p/${P1}/dashboard`
    shell(base({ scope: 'project', groups: pGroups, project: { id: P1, name: '하나' } }))
    const d = last(h.drawer)
    expect(d.open).toBe(false); expect(d.groups).toBe(pGroups); expect(d.workspaceHome).toBe('/w/acme')
  })
})
