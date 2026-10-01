import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
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

const SP = (id: string, name: string) => ({ id, name, status: 'active' as const, isAdmin: false })
const nav = (over: Partial<Parameters<typeof WorkspaceNav>[0]> = {}) => renderToString(
  <WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" projects={[]} favoriteIds={[]} recentIds={[]} projectsFailed={false} canCreateProject={false} badges={{}} collapsed={false} {...over} />)

describe('WorkspaceNav', () => {
  it('활성 항목 하나에만 aria-current, 즐겨찾기 5·최근 3·전체 보기·새 프로젝트', () => {
    const fav = Array.from({ length: 7 }, (_, i) => SP(`f${i}`, `즐겨찾기 ${i}`))
    const rec = Array.from({ length: 5 }, (_, i) => SP(`r${i}`, `최근 ${i}`))
    const html = nav({ pathname: '/w/acme/minutes/x', projects: [...fav, ...rec], favoriteIds: fav.map((p) => p.id), recentIds: rec.map((p) => p.id), canCreateProject: true, badges: { 'ws.my_work': 3 } })
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(ariaCurrentHref(html, '/w/acme/minutes')).toBe(true)
    expect((html.match(/data-fav-project/g) ?? []).length).toBe(5)
    expect((html.match(/data-recent-project/g) ?? []).length).toBe(3)
    expect(html).toContain('href="/w/acme/projects?new=1"'); expect(html).toContain('href="/w/acme/projects"')
    expect(html).toContain('>3<')
  })
  it('최근 방문은 즐겨찾기와 겹치는 것을 빼고 센다', () => {
    const html = nav({ projects: [SP('a', 'A'), SP('b', 'B')], favoriteIds: ['a'], recentIds: ['a', 'b'] })
    expect((html.match(/data-recent-project/g) ?? []).length).toBe(1)
    expect(html).not.toContain('projects?new=1')
  })
  it('W14 — 목록(현재 워크스페이스의 가시 프로젝트)에 없는 즐겨찾기·최근 id 는 그리지 않는다(이름도 목록에서만)', () => {
    const html = nav({ projects: [SP('a', 'Apollo')], favoriteIds: ['other-ws', 'a'], recentIds: ['hidden'] })
    expect((html.match(/data-fav-project/g) ?? []).length).toBe(1)
    expect(html).not.toContain('data-recent-project'); expect(html).not.toContain('other-ws'); expect(html).not.toContain('hidden"')
  })
  it('목록 조회 실패면 즐겨찾기 자리에 실패 한 줄(빈 목록으로 위장하지 않는다 — U2b-2 권한 리뷰 Y3)', () => {
    const html = nav({ projectsFailed: true, favoriteIds: ['a'] })
    expect(html).toContain('프로젝트 목록을 불러오지 못했습니다'); expect(html).toContain('data-projects-failed')
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
