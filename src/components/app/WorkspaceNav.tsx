'use client'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NavGroup, NavItemId } from '@/lib/nav/registry'
import { activeNavItem } from '@/lib/nav/active'
import { wsHref } from '@/lib/workspace/paths'
import { NavList, SideRail } from './NavList'
import type { SidebarCollapsed } from './sidebarState'

const FAV_MAX = 5
const RECENT_MAX = 3
const ROW = 'block truncate rounded-(--radius-control) px-3 py-1.5 text-control text-fg-secondary hover:bg-surface-hover'

/**
 * 워크스페이스 내비(§5.4.2) — '프로젝트' 아래 즐겨찾기 최대 5·최근 방문 최대 3(즐겨찾기 제외)·전체 보기·+ 새 프로젝트(caps). 링크일 뿐 현재 범위 강조 없음.
 * favorites·recent 는 부르는 쪽(범위 레이아웃 — 과제 31)이 현재 워크스페이스의 가시 프로젝트로 거른 이름 목록이다(W14).
 */
export function WorkspaceNav({ groups, pathname, slug, favorites, recent, canCreateProject, badges, collapsed }: {
  groups: readonly NavGroup[]; pathname: string; slug: string
  favorites: { id: string; name: string }[]; recent: { id: string; name: string }[]
  canCreateProject: boolean; badges: Partial<Record<NavItemId, number | null>>; collapsed: SidebarCollapsed
}) {
  const { t } = useLocale()
  const fav = favorites.slice(0, FAV_MAX)
  const rec = recent.filter((r) => !fav.some((f) => f.id === r.id)).slice(0, RECENT_MAX)
  const shortcuts = collapsed !== true && (fav.length > 0 || rec.length > 0 || canCreateProject) ? (
    <div className="mt-3 space-y-0.5 border-t border-border pt-3">
      {fav.map((p) => <Link key={p.id} data-fav-project href={`/p/${encodeURIComponent(p.id)}/dashboard`} className={ROW}>{p.name}</Link>)}
      {rec.map((p) => <Link key={p.id} data-recent-project href={`/p/${encodeURIComponent(p.id)}/dashboard`} className={ROW}>{p.name}</Link>)}
      <Link href={wsHref(slug, 'projects')} className="block px-3 py-1.5 text-meta font-semibold text-action hover:underline">전체 보기</Link>
      {canCreateProject && (
        <Link href={wsHref(slug, 'projects', { new: '1' })} className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-semibold text-action hover:underline">
          <Plus size={14} aria-hidden /> 새 프로젝트
        </Link>
      )}
    </div>
  ) : null
  return (
    <SideRail collapsed={collapsed} label={t('nav.workspace')}>
      <NavList groups={groups} activeId={activeNavItem(pathname, groups)} collapsed={collapsed} badges={badges} />
      {/* 선호 없음이면 1024~1279 접힌 폭에서 숨긴다 — 표시 토큰은 감싸는 요소의 정적 리터럴(D17 ②) */}
      {shortcuts && (collapsed === null ? <div className="hidden xl:block">{shortcuts}</div> : shortcuts)}
    </SideRail>
  )
}
