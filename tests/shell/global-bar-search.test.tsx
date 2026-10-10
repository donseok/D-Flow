// GlobalBar → 전역 검색 대화상자 배선 — 셸이 준 메뉴(navigation.menu 의 해석 결과)와 제품 이름(branding.product_name)을 그대로 내린다.
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ dialog: vi.fn() }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/w/acme' }))
vi.mock('@/components/app/NotificationBell', () => ({ NotificationBell: () => null }))
vi.mock('@/components/app/AccountMenu', () => ({ AccountMenu: () => null }))
vi.mock('@/components/search/GlobalSearchDialog', () => ({ GlobalSearchDialog: (p: unknown) => { h.dialog(p); return null } }))

import { GlobalBar } from '@/components/app/GlobalBar'
import type { NavGroup } from '@/lib/nav/registry'

const wsGroups: NavGroup[] = [{ group: 'ws.main', items: [{ id: 'ws.projects', href: '/w/acme/projects', label: '과제 목록', icon: 'FolderOpen' }] }]
const pGroups: NavGroup[] = [{ group: 'p.plan', items: [{ id: 'p.wbs', href: '/p/p1/wbs', label: '공정표', icon: 'ListTree' }] }]
const brand = (productName: string) => ({ productName, workspaceId: 'w1', hasFull: false, hasMark: false })
const base = { homeHref: '/w/acme', identity: null, staging: false, onOpenDrawer: () => {}, workspaceId: 'w1' }
const crumbs = { scope: 'workspace' as const, workspace: { name: 'Acme', href: '/w/acme' }, project: null, screen: null }
const props = () => h.dialog.mock.calls.at(-1)?.[0] as { nav: unknown; productName: string }

beforeEach(() => { h.dialog.mockClear() })

describe('GlobalBar — 검색 대화상자에 내리는 값', () => {
  it('셸의 메뉴와 브랜드의 제품 이름을 그대로 내린다', () => {
    renderToString(<GlobalBar {...base} brand={brand('Acme Flow')} scope="project" crumbs={crumbs} searchNav={{ workspace: wsGroups, project: pGroups }} />)
    expect(props().nav).toEqual({ workspace: wsGroups, project: pGroups })
    expect(props().productName).toBe('Acme Flow')
  })
  it('격리 — 다른 워크스페이스의 셸은 자기 값만 내린다(앞 렌더의 이름·메뉴가 남지 않는다)', () => {
    renderToString(<GlobalBar {...base} brand={brand('Acme Flow')} scope="workspace" crumbs={crumbs} searchNav={{ workspace: wsGroups, project: null }} />)
    renderToString(<GlobalBar {...base} brand={brand('Beta PM')} scope="workspace" crumbs={crumbs} searchNav={{ workspace: [], project: null }} />)
    expect(props()).toMatchObject({ productName: 'Beta PM', nav: { workspace: [], project: null } })
    expect(JSON.stringify(props())).not.toMatch(/Acme Flow|과제 목록/)
  })
  it('메뉴를 받지 못한 셸은 빈 메뉴다 — 손으로 적은 기본 목록으로 채우지 않는다', () => {
    renderToString(<GlobalBar {...base} brand={brand('Acme Flow')} scope="workspace" crumbs={crumbs} />)
    expect(props().nav).toEqual({ workspace: [], project: null })
  })
})
