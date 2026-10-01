'use client'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NavGroup, NavItemId } from '@/lib/nav/registry'
import { activeNavItem } from '@/lib/nav/active'
import { NavList, SideRail } from './NavList'
import type { SidebarCollapsed } from './sidebarState'

/** 프로젝트 내비(§5.4.2) — 머리 = ← 워크스페이스 홈 + 프로젝트 전환기, p.settings 는 그룹 목록 아래 구분선 뒤 */
export function ProjectNav({ groups, pathname, workspaceHome, projectSwitcher, badges, collapsed }: {
  groups: readonly NavGroup[]; pathname: string; workspaceHome: string | null; projectSwitcher: ReactNode
  badges: Partial<Record<NavItemId, number | null>>; collapsed: SidebarCollapsed
}) {
  const { t } = useLocale()
  const activeId = activeNavItem(pathname, groups)
  const settings = groups.filter((g) => g.group === 'p.settings')
  return (
    <SideRail collapsed={collapsed} label={t('nav.project')}>
      {workspaceHome && (
        <Link href={workspaceHome} aria-label={collapsed === true ? '워크스페이스 홈' : undefined} className="mb-2 flex h-9 items-center gap-2 px-3 text-control text-fg-secondary hover:text-fg">
          <ArrowLeft size={16} aria-hidden />{collapsed !== true && <span className={collapsed === null ? 'hidden xl:inline' : ''}>워크스페이스 홈</span>}
        </Link>
      )}
      {collapsed !== true && projectSwitcher}
      <NavList groups={groups} activeId={activeId} collapsed={collapsed} badges={badges} exclude={['p.settings']} />
      {settings.length > 0 && <div data-nav-divider className="my-2 border-t border-border" />}
      <NavList groups={settings} activeId={activeId} collapsed={collapsed} />
    </SideRail>
  )
}
