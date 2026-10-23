import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale({ also: ['pages.accounts.projectsFailed'] }))
import { WorkspaceNav } from '@/components/app/WorkspaceNav'
import { ProjectNav } from '@/components/app/ProjectNav'
import { navFor } from '@/lib/nav/registry'
import { CORE_MODULES, NON_CORE_MODULES } from '@/lib/modules/defaults'

const caps = { isPlatformAdmin: false, isWorkspaceAdmin: true, isProjectAdmin: true, canViewUsage: false, canViewPortfolio: false, canCreateProject: true }
const all = new Set([...CORE_MODULES, ...NON_CORE_MODULES])
const ws = navFor({ scope: 'workspace', base: '/w/acme', effective: all, caps, menu: { order: [], labels: {} } })
const pj = navFor({ scope: 'project', base: '/p/p1', effective: all, caps, menu: { order: [], labels: {} } })
const ariaCurrentHref = (html: string, href: string) =>
  new RegExp(`href="${href}"[^>]*aria-current="page"|aria-current="page"[^>]*href="${href}"`).test(html)

const nav = (over: Partial<Parameters<typeof WorkspaceNav>[0]> = {}) => renderToString(
  <WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" projectsFailed={false} canCreateProject={false} badges={{}} collapsed={false} {...over} />)
// 프로젝트 콤보는 라우터 훅을 쓰는 전환기라 슬롯으로 받는다(ProjectNav 와 같은 꼴) — 여기서는 자리 표시만 넣는다
const combo = <div data-combo />

describe('WorkspaceNav', () => {
  it('활성 항목 하나에만 aria-current, 프로젝트 콤보·전체 보기·새 프로젝트', () => {
    const html = nav({ pathname: '/w/acme/minutes/x', projectSwitcher: combo, canCreateProject: true, badges: { 'ws.my_work': 3 } })
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(ariaCurrentHref(html, '/w/acme/minutes')).toBe(true)
    expect(html).toContain('data-combo')
    expect(html).toContain('href="/w/acme/projects?new=1"'); expect(html).toContain('href="/w/acme/projects"')
    expect(html).toContain('>3<')
  })
  it('즐겨찾기·최근 링크 행은 더 그리지 않는다 — 콤보 하나로 줄였다', () => {
    const html = nav({ projectSwitcher: combo })
    expect(html).not.toContain('data-fav-project'); expect(html).not.toContain('data-recent-project')
  })
  it('콤보는 메뉴 바로 아래 구분선 안(바로가기 영역)에 있고 전체 보기 링크보다 앞이다', () => {
    const html = nav({ projectSwitcher: combo })
    expect(html).toMatch(/border-t[^>]*>[\s\S]*data-combo[\s\S]*href="\/w\/acme\/projects"/)
  })
  it('프로젝트가 없고(콤보 없음) 만들 권한도 목록 실패도 없으면 바로가기 영역 자체를 두지 않는다', () => {
    const html = nav()
    // 메뉴 항목에도 /w/acme/projects 링크가 있으므로 링크가 아니라 바로가기 영역의 컨테이너(구분선 + 위 간격)로 본다
    expect(html).not.toContain('data-combo'); expect(html).not.toContain('mt-3 space-y-0.5 border-t')
    expect(html).not.toContain('projects?new=1')
  })
  it('새 프로젝트는 만들 권한이 있을 때만', () => {
    expect(nav({ projectSwitcher: combo })).not.toContain('projects?new=1')
    expect(nav({ projectSwitcher: combo, canCreateProject: true })).toContain('projects?new=1')
  })
  it('목록 조회 실패면 콤보 자리에 실패 한 줄(빈 목록으로 위장하지 않는다 — U2b-2 권한 리뷰 Y3)', () => {
    const html = nav({ projectsFailed: true })
    expect(html).toContain('프로젝트 목록을 불러오지 못했습니다'); expect(html).toContain('data-projects-failed')
  })
  it('접힘(true)이면 콤보를 그리지 않는다 — 64px 레일에 입력창을 두지 않는다', () => {
    expect(nav({ projectSwitcher: combo, collapsed: true })).not.toContain('data-combo')
  })
  it('배지 null 은 그리지 않는다(0 으로 위장 금지)', () => {
    expect(nav({ badges: { 'ws.my_work': null } })).not.toContain('data-nav-badge')
  })
  it('선호 없음(null)은 CSS 폭 규칙(1024~1279 접힘·1280+ 펼침), 명시 선호는 조건부 렌더 — 조건부 hidden 을 반응형 display 에 덧붙이지 않는다', () => {
    const auto = nav({ collapsed: null })
    expect(auto).toContain('lg:w-16'); expect(auto).toContain('xl:w-58'); expect(auto).toContain('hidden xl:inline')
    const closed = nav({ collapsed: true })
    expect(closed).not.toContain('xl:w-58'); expect(closed).toContain('data-collapsed="true"')
  })
})

describe('ProjectNav', () => {
  it('워크스페이스 홈 링크·설정은 구분선 뒤·간트 경로도 작업 계획 활성', () => {
    const html = renderToString(<ProjectNav groups={pj} pathname="/p/p1/gantt" workspaceHome="/w/acme" projectSwitcher={<div data-x />} badges={{ 'p.agents': 2, 'p.announcements': null }} collapsed={false} />)
    expect(html).toContain('href="/w/acme"')
    expect(html).toMatch(/data-nav-divider[\s\S]*href="\/p\/p1\/settings"/)
    expect(ariaCurrentHref(html, '/p/p1/wbs')).toBe(true)
    expect(html).toContain('data-x')
  })
})

describe('접힘·접근성 세부(U2b-2 충실도 리뷰 Z2·Z3·Z11)', () => {
  const links = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0])
  it('Z2 — ProjectNav 선호 없음(null)이면 전환기를 정적 래퍼 hidden xl:block 으로 감싼다(1024~1279 의 64px 레일에 입력창을 그리지 않는다)', () => {
    const auto = renderToString(<ProjectNav groups={pj} pathname="/p/p1/wbs" workspaceHome="/w/acme" projectSwitcher={<div data-x />} badges={{}} collapsed={null} />)
    expect(auto).toMatch(/<div class="hidden xl:block"><div data-x/)
    const open = renderToString(<ProjectNav groups={pj} pathname="/p/p1/wbs" workspaceHome="/w/acme" projectSwitcher={<div data-x />} badges={{}} collapsed={false} />)
    expect(open).not.toContain('hidden xl:block"><div data-x')
  })
  it('Z3 — 접힘 상태와 무관하게 내비 링크·워크스페이스 홈은 접근 가능한 이름(aria-label)을 늘 갖는다', () => {
    for (const collapsed of [null, true, false] as const) {
      const w = renderToString(<WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" projectsFailed={false} canCreateProject={false} badges={{}} collapsed={collapsed} />)
      for (const a of links(w).filter((l) => l.includes('data-nav-item'))) expect(a, `${collapsed}: ${a}`).toMatch(/aria-label="[^"]+"/)
      const p = renderToString(<ProjectNav groups={pj} pathname="/p/p1/wbs" workspaceHome="/w/acme" projectSwitcher={null} badges={{}} collapsed={collapsed} />)
      for (const a of links(p)) expect(a, `${collapsed}: ${a}`).toMatch(/aria-label="[^"]+"/)
    }
  })
  it('Z11 — 사이드바는 nav 랜드마크를 갖고, 배지는 99+·tabular-nums, 접힘(true)이면 아이콘 모서리 점(숫자는 sr-only)', () => {
    const open = renderToString(<WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" projectsFailed={false} canCreateProject={false} badges={{ 'ws.my_work': 120 }} collapsed={false} />)
    expect(open).toMatch(/<nav [^>]*aria-label="[^"]+"/)
    expect(open).toMatch(/data-nav-badge[^>]*tabular-nums[^>]*>99\+</)
    const closed = renderToString(<WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" projectsFailed={false} canCreateProject={false} badges={{ 'ws.my_work': 3 }} collapsed />)
    expect(closed).toContain('data-nav-badge-dot'); expect(closed).not.toMatch(/data-nav-badge[^-]/)
    expect(closed).toMatch(/<span class="sr-only">3<\/span>/)
  })
})

