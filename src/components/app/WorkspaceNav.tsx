'use client'
import type { ReactNode } from 'react'
import { NavigationLink as Link } from './NavigationLink'
import { Plus } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { NavGroup, NavItemId } from '@/lib/nav/registry'
import { activeNavItem } from '@/lib/nav/active'
import { wsHref } from '@/lib/workspace/paths'
import { NavList, SideRail } from './NavList'
import type { SidebarCollapsed } from './sidebarState'

/**
 * 워크스페이스 내비(§5.4.2) — '프로젝트' 아래 프로젝트 콤보(검색 + 즐겨찾기·전체 — 프로젝트 범위 사이드바와 같은 전환기)·전체 보기·+ 새 프로젝트(caps).
 * 예전에는 즐겨찾기 최대 5·최근 방문 최대 3 을 링크 행으로 늘어놓았다 — 행이 많아질수록 메뉴 아래가 길어지고 프로젝트가 늘면 찾을 수 없어서 콤보 하나로 줄였다.
 * 콤보는 라우터 훅을 쓰는 클라이언트 전환기라 슬롯(projectSwitcher)으로 받는다 — ProjectNav 와 같은 꼴이다. 즐겨찾기·최근 id 를 현재 워크스페이스의 가시 프로젝트
 * 목록으로만 해석하는 규칙(W14 — 목록에 없는 id 는 이름도 링크도 내지 않는다)은 전환기가 가진다. 목록 조회가 실패했으면 그 자리에 실패 한 줄(빈 목록으로 위장하지
 * 않는다 — 3원칙 ①).
 */
export function WorkspaceNav({ groups, pathname, slug, projectSwitcher, projectsFailed, canCreateProject, badges, collapsed, onToggleCollapsed }: {
  groups: readonly NavGroup[]; pathname: string; slug: string
  /** 프로젝트 콤보 — 프로젝트가 하나도 없으면 null(고를 것이 없다) */
  projectSwitcher?: ReactNode
  projectsFailed: boolean
  canCreateProject: boolean; badges: Partial<Record<NavItemId, number | null>>; collapsed: SidebarCollapsed
  /** 접기 토글(AA2) — 계정 키 sidebarCollapsed 저장 */
  onToggleCollapsed?: (next: boolean) => void
}) {
  const { t } = useLocale()
  const shortcuts = collapsed !== true && (projectSwitcher || canCreateProject || projectsFailed) ? (
    <div className="mt-3 space-y-0.5 border-t border-border pt-3">
      {projectsFailed && <p data-projects-failed role="status" className="px-3 py-1.5 text-meta text-danger">{t('pages.accounts.projectsFailed')}</p>}
      {projectSwitcher}
      <Link href={wsHref(slug, 'projects')} className="block px-3 py-1.5 text-meta font-semibold text-action hover:underline">{t('common.viewAll')}</Link>
      {canCreateProject && (
        <Link href={wsHref(slug, 'projects', { new: '1' })} className="flex items-center gap-1.5 px-3 py-1.5 text-meta font-semibold text-action hover:underline">
          <Plus size={14} aria-hidden /> {t('common.newProject')}
        </Link>
      )}
    </div>
  ) : null
  return (
    <SideRail collapsed={collapsed} label={t('nav.workspace')} onToggleCollapsed={onToggleCollapsed}>
      <NavList groups={groups} activeId={activeNavItem(pathname, groups)} collapsed={collapsed} badges={badges} />
      {/* 선호 없음이면 1024~1279 접힌 폭에서 숨긴다 — 표시 토큰은 감싸는 요소의 정적 리터럴(D17 ②) */}
      {shortcuts && (collapsed === null ? <div className="hidden xl:block">{shortcuts}</div> : shortcuts)}
    </SideRail>
  )
}
