// 셸 소비(개정 §5.12.5 ③) — navFor 와 같은 모듈 × caps × navigation.menu 조합표로 셸 컴포넌트를 그려 navFor 결과와 **같은 항목만** 있는지 본다.
// 과제 29 가 MobileNavDrawer·ContextBreadcrumb 를 같은 표에 더한다.
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => `t:${k}`, locale: 'ko' }) }))
import { WorkspaceNav } from '@/components/app/WorkspaceNav'
import { ProjectNav } from '@/components/app/ProjectNav'
import { MobileNavDrawer } from '@/components/app/MobileNavDrawer'
import { navScreenLabel } from '@/components/app/ContextBreadcrumb'
import { navFor, type NavCaps } from '@/lib/nav/registry'
import { CORE_MODULES, NON_CORE_MODULES, type ModuleId } from '@/lib/modules/defaults'
import type { NavMenuSetting } from '@/lib/settings/registry'

const ALL_CAPS: NavCaps = { isPlatformAdmin: true, isWorkspaceAdmin: true, isProjectAdmin: true, canViewUsage: true, canViewPortfolio: true, canCreateProject: true }
const NO_CAPS: NavCaps = { isPlatformAdmin: false, isWorkspaceAdmin: false, isProjectAdmin: false, canViewUsage: false, canViewPortfolio: false, canCreateProject: false }
const sets: Record<string, ReadonlySet<ModuleId>> = {
  core: new Set(CORE_MODULES), all: new Set([...CORE_MODULES, ...NON_CORE_MODULES]),
  noMinutes: new Set([...CORE_MODULES, ...NON_CORE_MODULES].filter((m) => m !== 'minutes' && m !== 'wiki')),
}
const menus: Record<'none' | 'custom', NavMenuSetting> = { none: { order: [], labels: {} }, custom: { order: ['ws.minutes', 'p.issues'], labels: { 'ws.minutes': '회의 기록', 'p.issues': '문제' } } }
const hrefs = (html: string) => [...html.matchAll(/data-nav-item="([^"]+)"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*data-nav-item="([^"]+)"/g)]
  .map((m) => (m[1] ? `${m[1]}=${m[2]}` : `${m[4]}=${m[3]}`)).sort()

describe('셸 소비 — navFor 결과와 같은 항목만(③)', () => {
  for (const [setName, effective] of Object.entries(sets)) for (const [capsName, caps] of Object.entries({ all: ALL_CAPS, none: NO_CAPS })) for (const [menuName, menu] of Object.entries(menus)) {
    it(`${setName} × caps:${capsName} × menu:${menuName}`, () => {
      const ws = navFor({ scope: 'workspace', base: '/w/acme', effective, caps, menu })
      const pj = navFor({ scope: 'project', base: '/p/p1', effective, caps, menu })
      const expectOf = (g: typeof ws) => g.flatMap((x) => x.items.map((i) => `${i.id}=${i.href}`)).sort()
      const wHtml = renderToString(<WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" favorites={[]} recent={[]} canCreateProject={false} badges={{}} collapsed={false} />)
      const pHtml = renderToString(<ProjectNav groups={pj} pathname="/p/p1/dashboard" workspaceHome="/w/acme" projectSwitcher={null} badges={{}} collapsed={false} />)
      expect(hrefs(wHtml)).toEqual(expectOf(ws))
      expect(hrefs(pHtml)).toEqual(expectOf(pj))
      if (menuName === 'custom' && effective.has('minutes')) expect(wHtml).toContain('회의 기록')
      // 드로어 — 같은 navFor 결과를 그대로(1024 미만의 유일한 내비)
      const dHtml = renderToString(<MobileNavDrawer open onClose={() => {}} workspaceSwitcher={null} groups={pj} pathname="/p/p1/dashboard" workspaceHome="/w/acme" projectSwitcher={null} badges={{}} />)
      expect(hrefs(dHtml)).toEqual(expectOf(pj))
      // 브레드크럼의 화면 이름 = 활성 항목의 라벨(설정 라벨 포함), 활성 항목이 없으면 null
      const t = (k: string) => `t:${k}`
      const minutes = ws.flatMap((g) => g.items).find((i) => i.id === 'ws.minutes')
      expect(navScreenLabel('/w/acme/minutes/m1', ws, t)).toBe(minutes ? (typeof minutes.label === 'string' ? minutes.label : t(minutes.label.key)) : null)
      expect(navScreenLabel('/account', ws, t)).toBeNull()
    })
  }
  it('모듈을 끄면 그 항목이 사라진다(회의록·위키)', () => {
    const ws = navFor({ scope: 'workspace', base: '/w/acme', effective: sets.noMinutes, caps: ALL_CAPS, menu: menus.none })
    const html = renderToString(<WorkspaceNav groups={ws} pathname="/w/acme" slug="acme" favorites={[]} recent={[]} canCreateProject={false} badges={{}} collapsed={false} />)
    expect(html).not.toContain('/w/acme/minutes')
  })
})
