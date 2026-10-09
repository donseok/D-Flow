'use client'
import { usePathname } from 'next/navigation'
import { useCallback, useState, type ReactNode } from 'react'
import type { ShellProps } from '@/lib/shell/loadShell'
import { activeNavItem } from '@/lib/nav/active'
import { wsHref } from '@/lib/workspace/paths'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useAiRailButton } from '@/components/chat/AssistantChat'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { GlobalBar } from './GlobalBar'
import { WorkspaceNav } from './WorkspaceNav'
import { ProjectNav } from './ProjectNav'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { ProjectCrumbSwitcher, ProjectSwitcher } from './ProjectSwitcher'
import { MobileNavDrawer } from './MobileNavDrawer'
import { DegradedNotice } from './DegradedNotice'
import { useShellEnv } from './ShellEnv'
import { useSidebarCollapsed } from './sidebarState'
import { useShellState } from './ShellStateProvider'

/**
 * 범위 셸(D2, 개정 §5.4.1) — 전역 바는 전체 폭, main 이 유일한 세로 스크롤(.app-main 클래스 본문 — overflow·scrollbar 유틸 없음, D19), 레일 자리 #app-rail.
 * 범위 레이아웃이 서버에서 계산한 직렬화 값(ShellProps)만 받는다 — 손으로 적은 메뉴·권한 판정이 없다. 배지 null(모름)은 그대로 내려 그리지 않게 한다.
 * 워크스페이스를 모르는 최소 셸(slug 빈 값)은 홈·브레드크럼을 리졸버(/)로 둔다.
 */
export function AppShell({ children, ...p }: ShellProps & { children: ReactNode }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const env = useShellEnv()
  const [collapsed, setCollapsed] = useSidebarCollapsed(env.sidebarCollapsed)
  const { badges } = useShellState()
  const aiButton = useAiRailButton()
  const [drawer, setDrawer] = useState(false)
  const closeDrawer = useCallback(() => setDrawer(false), [])
  const known = p.workspace.slug !== ''
  const home = known ? wsHref(p.workspace.slug) : '/'
  // (global) 은 플랫폼 운영 두 화면만 활성 항목이 있다(절대 경로 항목). 계정 등은 없음 — 내비에는 빈 경로를 내려 아무것도 고르지 않는다
  const activeId = activeNavItem(pathname, p.groups)
  const navPath = p.scope === 'global' && !activeId ? '' : pathname
  const item = activeId ? p.groups.flatMap((g) => g.items).find((i) => i.id === activeId) : undefined
  const screenName = item ? (typeof item.label === 'string' ? item.label : t(item.label.key)) : null
  const projectName = p.project ? p.project.name || '프로젝트' : null
  const wsSwitcher = known ? <WorkspaceSwitcher current={p.workspace} workspaces={p.workspaces} viewingAsPlatformAdmin={p.viewingAsPlatformAdmin} /> : null
  const projectSwitcher = p.scope === 'project' && known
    ? <ProjectSwitcher currentProjectId={p.project?.id ?? null} projects={p.projects} favoriteIds={p.favoriteIds} recentIds={p.recentIds} projectsFailed={p.projectsFailed} />
    : null
  // 브레드크럼의 프로젝트 칸(AA1) — 768 이상 늘 있다(사이드바가 64px 레일인 1024~1279·명시 접힘에서도 프로젝트를 바꿀 수 있게)
  const projectCrumb = p.scope === 'project' && known && projectName
    ? <ProjectCrumbSwitcher currentName={projectName} currentProjectId={p.project?.id ?? null} projects={p.projects} favoriteIds={p.favoriteIds} recentIds={p.recentIds} projectsFailed={p.projectsFailed} />
    : null
  const navBadges = p.scope === 'project'
    ? { 'p.agents': badges.projectApprovals, 'p.announcements': badges.projectUnreadAnnouncements }
    : { 'ws.my_work': badges.myWorkReview }
  return (
    <div className="flex h-dvh flex-col bg-canvas">
      {p.accentCss && <style>{p.accentCss}</style>}
      <GlobalBar scope={p.scope} brand={p.brand} homeHref={home} identity={p.identity} staging={env.staging} aiButton={aiButton ?? undefined}
        onOpenDrawer={() => setDrawer(true)} workspaceSwitcher={wsSwitcher ?? undefined} projectSwitcher={projectCrumb ?? undefined}
        workspaceId={known ? p.workspace.id : undefined} projectId={p.project?.id} projectName={projectName ?? undefined}
        searchNav={{ workspace: p.workspaceGroups, project: p.scope === 'project' ? p.groups : null }}
        crumbs={{ scope: p.scope, workspace: known ? { name: p.workspace.name, href: home } : null, project: p.project && projectName ? { name: projectName, href: `/p/${p.project.id}/dashboard` } : null, screen: screenName }} />
      <div className="flex min-h-0 flex-1">
        {p.groups.length > 0 && (p.scope === 'project'
          ? <ProjectNav groups={p.groups} pathname={pathname} workspaceHome={known ? home : null} projectSwitcher={projectSwitcher} badges={navBadges} collapsed={collapsed} onToggleCollapsed={setCollapsed} />
          : <WorkspaceNav groups={p.groups} pathname={navPath} slug={p.workspace.slug} projects={p.projects} favoriteIds={p.favoriteIds}
              recentIds={p.recentIds} projectsFailed={p.projectsFailed} canCreateProject={p.canEditSettings} badges={navBadges} collapsed={collapsed} onToggleCollapsed={setCollapsed} />)}
        {/* relative — main 이 스크롤 상자이자 절대 위치의 기준이다. 기준이 아니면 본문 깊숙한 sr-only(position:absolute)가 문서 기준으로 놓여 문서 자체가 길어지고 스크롤이 둘이 된다 */}
        <main id="main-content" className="app-main relative flex min-w-0 flex-1 flex-col px-4 pb-4 sm:px-5 lg:px-6">
          {/* 위 간격은 패딩이 아니라 자리로 — sticky 는 스크롤 상자의 패딩 안쪽에 붙어 pt 만큼 위로 내용이 비친다(D54) */}
          <div aria-hidden="true" data-main-top-gap className="h-4 shrink-0" />
          {(p.degraded || p.projectsFailed) && <div className="shrink-0"><DegradedNotice actorFailed={p.degraded} projectsFailed={p.projectsFailed} /></div>}
          {p.configDegraded && (
            <div data-config-degraded className="mb-3 shrink-0 rounded-(--radius-panel) border border-border bg-surface px-3">
              <StatusMessage kind="partial_error" blocking compact title="설정을 불러오지 못해 메뉴 일부를 숨겼습니다."
                action={p.canEditSettings && known ? { label: '설정 열기', href: wsHref(p.workspace.slug, 'settings') } : undefined} />
            </div>
          )}
          {children}
        </main>
        <div id="app-rail" className="contents" />
      </div>
      <MobileNavDrawer open={drawer} onClose={closeDrawer} workspaceSwitcher={wsSwitcher} groups={p.groups}
        pathname={navPath} workspaceHome={p.scope === 'project' && known ? home : null} projectSwitcher={projectSwitcher} badges={navBadges} />
    </div>
  )
}
