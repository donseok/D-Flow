'use client'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Tooltip } from '@/components/ui/Tooltip'
import type { DictKey } from '@/lib/i18n/dict'
import type { NavGroup, NavGroupId, NavItemId } from '@/lib/nav/registry'
import { NAV_ICON_SIZE, NAV_ICON_STROKE, navIcon } from './navIcons'
import type { SidebarCollapsed } from './sidebarState'

export const NAV_GROUP_LABEL: Partial<Record<NavGroupId, DictKey>> = {
  'ws.main': 'nav.group.main', 'ws.shared': 'nav.group.shared', 'ws.ops': 'nav.group.ops', 'ws.platform': 'nav.group.platform',
  'p.plan': 'nav.group.plan', 'p.collab': 'nav.group.collab', 'p.team': 'nav.group.team',
}

/** navFor 결과만 그린다 — 손으로 적은 항목·경로가 없다(§5.4.2). 상태(배지 값)에 따른 표시는 조건부 렌더(D17) */
export function NavList({ groups, activeId, collapsed, badges = {}, exclude = [] }: {
  groups: readonly NavGroup[]; activeId: NavItemId | null; collapsed: SidebarCollapsed
  badges?: Partial<Record<NavItemId, number | null>>; exclude?: readonly NavItemId[]
}) {
  const { t } = useLocale()
  const labelOf = (l: NavGroup['items'][number]['label']) => (typeof l === 'string' ? l : t(l.key))
  // 선호 없음 = CSS 로 1024~1279 숨김·1280+ 보임(정적 문자열 — 안전망 클래스와 같은 리터럴, D17 ②). 명시 선호는 조건부 렌더
  const textCls = collapsed === null ? 'hidden xl:inline' : ''
  const headCls = collapsed === null ? 'hidden xl:block' : ''
  return (
    <>
      {groups.map((g) => {
        const items = g.items.filter((i) => !exclude.includes(i.id))
        if (!items.length) return null
        const head = NAV_GROUP_LABEL[g.group]
        return (
          <div key={g.group} className="space-y-0.5" role="group" aria-label={head ? t(head) : undefined}>
            {head && collapsed !== true && <div className={`px-3 pb-1 pt-3 text-meta font-semibold text-fg-secondary ${headCls}`}>{t(head)}</div>}
            {items.map((i) => {
              const Icon = navIcon(i.icon)
              const active = i.id === activeId
              const badge = badges[i.id]
              const label = labelOf(i.label)
              const link = (
                <Link key={i.id} href={i.href} data-nav-item={i.id} aria-current={active ? 'page' : undefined}
                  aria-label={collapsed === true ? label : undefined}
                  className={`flex h-9 items-center gap-2.5 rounded-(--radius-control) px-3 text-control ${active ? 'bg-surface-selected font-semibold text-fg' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}>
                  <Icon size={NAV_ICON_SIZE.menu} strokeWidth={NAV_ICON_STROKE} aria-hidden className="shrink-0" />
                  {collapsed !== true && <span className={`min-w-0 flex-1 truncate ${textCls}`}>{label}</span>}
                  {typeof badge === 'number' && badge > 0 && (
                    <span data-nav-badge className="rounded-full bg-action px-1.5 text-meta font-semibold text-action-fg">{badge}</span>
                  )}
                </Link>
              )
              return collapsed === true ? <Tooltip key={i.id} label={label} side="right">{link}</Tooltip> : link
            })}
          </div>
        )
      })}
    </>
  )
}

/** 사이드바 틀 — 폭 232/64(§5.4.2). 1024 미만은 숨김(드로어 — D55), 선호 없음은 폭 유틸로 1024~1279 접힘 */
export function SideRail({ collapsed, children, label }: { collapsed: SidebarCollapsed; children: ReactNode; label: string }) {
  const width = collapsed === null ? 'lg:w-16 xl:w-58' : collapsed ? 'w-16' : 'w-58'
  return (
    <aside aria-label={label} data-collapsed={collapsed === true ? 'true' : collapsed === false ? 'false' : 'auto'}
      className={`hidden lg:flex ${width} shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-2 py-3`}>
      {children}
    </aside>
  )
}
