'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  BarChart3, BookOpenText, Bot, Briefcase, CalendarCheck, CalendarClock, CalendarRange, CircleAlert, Columns3, FolderOpen, LayoutDashboard, LayoutGrid,
  ListTree, Megaphone, NotebookPen, NotebookText, PanelLeft, Plus, Settings, Users, type LucideIcon,
} from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Tooltip } from '@/components/ui/Tooltip'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import { useShellState } from './ShellStateProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { useProjectNavigation } from './ProjectNavigationContext'
import { SIDEBAR_STORAGE_KEY, SIDEBAR_TOGGLE_EVENT, dispatchSidebarToggle } from './sidebarState'

export type SidebarProject = {
  id: string
  name: string
  status: 'ready' | 'active' | 'overdue' | 'done' | 'unknown'
  baseDate?: string | null
  /** 이 프로젝트의 관리자 여부 — 설정 메뉴 노출 판정(페이지 게이트와 동일 predicate, 미지정 = false) */
  isAdmin?: boolean
}

// 접힘 상태의 정본은 sidebarState.ts(새 셸과 공유) — 이 파일은 과제 31 이 지운다
export { SIDEBAR_STORAGE_KEY, SIDEBAR_TOGGLE_EVENT, dispatchSidebarToggle } from './sidebarState'

const STATUS_META: Record<SidebarProject['status'], { dot: string; label: string }> = {
  ready: { dot: 'bg-pending', label: '준비' },
  active: { dot: 'bg-progress', label: '진행중' },
  // '지연 종료' = 기간 경과+미완(생애 축) — 대시보드의 '지연'(계획 대비 미달)과 다른 개념이라 라벨을 홈과 통일
  overdue: { dot: 'bg-danger', label: '지연 종료' },
  done: { dot: 'bg-success', label: '완료' },
  // WBS 조회 실패 — 완료 여부를 모른다. 모름을 '완료'로 표시하지 않기 위한 상태(추측 금지)
  unknown: { dot: 'bg-warning', label: '확인 불가' },
}

/** 프로젝트 메뉴 목록 — 데스크톱 사이드바와 모바일 메뉴(HeaderChrome)가 같은 목록을 쓴다(2026-09-19, 모바일에 에이전트가 빠져 있었다). */
export function projectMenu(base: string, showUsage: boolean, showPortfolio: boolean, isAdmin: boolean): { href: string; labelKey: DictKey; icon: LucideIcon; match: string }[] {
  const items: { href: string; labelKey: DictKey; icon: LucideIcon; match: string }[] = [
    { href: `${base}/dashboard`, labelKey: 'nav.dashboard', icon: LayoutDashboard, match: `${base}/dashboard` },
    { href: `${base}/wbs`, labelKey: 'nav.wbsGantt', icon: ListTree, match: `${base}/wbs` },
    { href: `${base}/kanban`, labelKey: 'nav.kanban', icon: Columns3, match: `${base}/kanban` },
    { href: `${base}/meetings`, labelKey: 'nav.meetings', icon: CalendarClock, match: `${base}/meetings` },
    { href: `${base}/weekly`, labelKey: 'nav.weekly', icon: NotebookPen, match: `${base}/weekly` },
    { href: `${base}/issues`, labelKey: 'nav.issues', icon: CircleAlert, match: `${base}/issues` },
    { href: `${base}/wiki`, labelKey: 'nav.wiki', icon: BookOpenText, match: `${base}/wiki` },
    { href: `${base}/announcements`, labelKey: 'nav.announcements', icon: Megaphone, match: `${base}/announcements` },
    { href: `${base}/members`, labelKey: 'nav.members', icon: Users, match: `${base}/members` },
    { href: `${base}/attendance`, labelKey: 'nav.attendance', icon: CalendarCheck, match: `${base}/attendance` },
    // 프로젝트 에이전트(2026-09-14) — 에이전트 스튜디오(/agents/office)가 기본 화면이고 위임·승인(/agents)은 둘째 탭이다(2026-09-19).
    // match 는 /agents 접두라 두 탭 어디서든 이 항목 하나가 켜진다. 멤버 전원(프로젝트 목록 자체가 멤버 기준).
    { href: `${base}/agents/office`, labelKey: 'nav.projectAgents', icon: Bot, match: `${base}/agents` },
  ]
  // 설정은 프로젝트 관리자 전용(2026-08-20) — 링크만 숨기는 게 아니라 페이지 게이트도 함께 건다.
  if (isAdmin) items.push({ href: `${base}/settings`, labelKey: 'nav.settings', icon: Settings, match: `${base}/settings` })
  // 포트폴리오·사용 현황은 전사 지표라 프로젝트 스코프가 아니다 —
  // 설정 바로 아래에 두되 링크는 전역 경로로 보낸다. 슈퍼유저 전용이라 그 외에는 항목 자체를 숨긴다.
  if (showPortfolio) items.push({ href: '/portfolio', labelKey: 'nav.portfolio', icon: Briefcase, match: '/portfolio' })
  if (showUsage) items.push({ href: '/usage', labelKey: 'nav.usage', icon: BarChart3, match: '/usage' })
  // 전역 좌석표(/agents)는 메뉴에 두지 않는다(2026-09-14) — 프로젝트 메뉴 옆에 놓이면 '에이전트'와 같은 종류로 읽힌다.
  // 진입은 프로젝트 스튜디오 탭(/p/<id>/agents/office)의 "전체 스튜디오" 링크 한 곳.
  return items
}

export function Sidebar({ projects, showUsage = false, showPortfolio = false, canCreateProject = false }: {
  projects: SidebarProject[]; showUsage?: boolean; showPortfolio?: boolean
  /** '+ 새 프로젝트' 노출 — 워크스페이스 관리자·플랫폼 관리자(isAnyWorkspaceAdmin). 미지정·degraded = false(fail-closed). */
  canCreateProject?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useLocale()
  const {
    routeProjectId,
    menuProjectId,
    menuProject,
    isGlobalBridge,
  } = useProjectNavigation()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1') } catch {}
  }, [])

  // 외부(PrefsSync reconcile / 헤더 등) 토글 이벤트 수신 — 마운트된 Sidebar 동기화.
  useEffect(() => {
    const onToggle = (e: Event) => setCollapsed((e as CustomEvent<{ collapsed: boolean }>).detail.collapsed)
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, onToggle)
  }, [])

  const toggleCollapse = () => {
    const next = !collapsed
    dispatchSidebarToggle(next)          // localStorage + 이벤트(→ setCollapsed)
    queueUiPref({ sidebarCollapsed: next }) // 사용자 액션만 서버 저장
  }

  // 전역 화면에서는 최근 메뉴 문맥과 실제 선택을 구분한다. 빈 값이어야 사용자가
  // 최근 프로젝트 자체를 다시 골라도 change가 발생해 대시보드로 진입할 수 있다.
  const selectedProjectId = routeProjectId ?? ''
  const selectedProject = selectedProjectId
    ? projects.find(project => project.id === selectedProjectId) ?? null
    : null

  const selectProject = (projectId: string) => {
    if (!projects.some(project => project.id === projectId)) return
    router.push(`/p/${encodeURIComponent(projectId)}/dashboard`)
  }

  // 안읽음 공지 배지 — ShellStateProvider 가 내비게이션당 통합 1왕복으로 조회한 값을 쓴다.
  // (종전엔 헤더와 이 컴포넌트가 같은 인자로 같은 액션을 각자 쐈다 — 2026-08-18 성능 감사.)
  // 회의록·내 회의에서는 보존한 프로젝트 메뉴(menuProjectId)의 배지를 유지한다.
  const { menuUnreadAnnouncements, menuPendingApprovals } = useShellState()
  const unread = menuProjectId ? menuUnreadAnnouncements : 0
  // 에이전트 메뉴 결재 대기 배지(2026-09-18) — 내가 승인할 수 있는 완료 보고 수. 허브에 들어가지 않아도 알 수 있게.
  const pending = menuProjectId ? menuPendingApprovals : 0
  const badges: Partial<Record<DictKey, { count: number; tip: string; bg: string }>> = {
    'nav.announcements': { count: unread, tip: '', bg: 'bg-action text-action-fg' },
    'nav.projectAgents': { count: pending, tip: '결재 대기 ', bg: 'bg-warning text-warning-fg' },
  }

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-r border-border bg-surface px-3 py-3 text-fg lg:flex ${collapsed ? 'w-[78px]' : 'w-[248px]'} transition-[width] duration-200`}
    >
      <div className="flex items-center justify-end">
        <Tooltip label={collapsed ? '사이드바 펼치기' : '사이드바 접기'} side="right">
          <button onClick={toggleCollapse} className="flex h-6 w-6 items-center justify-center rounded-md border border-border text-fg-secondary transition hover:bg-surface-hover hover:text-fg" aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* 프로젝트 선택 — 핵심 작업 문맥이므로 사이드바 최상단에 둔다. */}
      <div className="mt-2 flex shrink-0 flex-col">
        <div className="mb-1.5 flex shrink-0 items-center justify-between px-2">
          {!collapsed && <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">프로젝트</span>}
          {!collapsed && <Link href="/projects" className="text-[10px] font-medium text-fg-secondary transition hover:text-fg">{t('common.viewAll')}</Link>}
        </div>
        {collapsed ? (
          <Tooltip
            label={projects.length === 0
              ? t('common.noProjects')
              : selectedProject
                ? `${selectedProject.name} · ${STATUS_META[selectedProject.status].label}`
                : t('common.selectProject')}
            side="right"
          >
            <div className="relative mx-auto flex h-9 w-10 items-center justify-center rounded-xl border border-border bg-surface-subtle text-fg-secondary transition focus-within:border-border-focus focus-within:ring-2 focus-within:ring-border-focus/25 hover:bg-surface-hover hover:text-fg">
              <FolderOpen className="h-[18px] w-[18px]" aria-hidden />
              <select
                aria-label={t('common.selectProject')}
                value={selectedProjectId}
                disabled={projects.length === 0}
                onChange={event => selectProject(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              >
                <option value="" disabled={projects.length > 0}>
                  {projects.length === 0 ? t('common.noProjects') : t('common.selectProject')}
                </option>
                {projects.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name} · {STATUS_META[project.status].label}
                  </option>
                ))}
              </select>
            </div>
          </Tooltip>
        ) : (
          <div className="relative">
            <FolderOpen className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-fg-secondary" aria-hidden />
            <select
              aria-label={t('common.selectProject')}
              value={selectedProjectId}
              disabled={projects.length === 0}
              onChange={event => selectProject(event.target.value)}
              className="h-11 w-full cursor-pointer rounded-xl border border-border bg-surface-subtle py-2 pl-9 pr-2 text-[13px] font-medium text-fg outline-none transition hover:border-border-input focus:border-border-focus focus:ring-2 focus:ring-border-focus/25 disabled:cursor-not-allowed disabled:text-fg-disabled"
            >
              <option value="" disabled={projects.length > 0}>
                {projects.length === 0 ? t('common.noProjects') : t('common.selectProject')}
              </option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name} · {STATUS_META[project.status].label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 전역: 내 회의 */}
      <Tooltip label={t('nav.myMeetings')} side="right" disabled={!collapsed}>
        <Link href="/meetings" aria-current={pathname === '/meetings' ? 'page' : undefined}
          className={`side-link mt-2 ${pathname === '/meetings' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
          <CalendarRange className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="flex-1">{t('nav.myMeetings')}</span>}
        </Link>
      </Tooltip>

      {/* 전역: 회의록 */}
      <Tooltip label={t('nav.minutes')} side="right" disabled={!collapsed}>
        <Link href="/minutes" aria-current={pathname.startsWith('/minutes') ? 'page' : undefined}
          className={`side-link ${pathname.startsWith('/minutes') ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
          <NotebookText className="h-[18px] w-[18px] shrink-0" />
          {!collapsed && <span className="flex-1">{t('nav.minutes')}</span>}
        </Link>
      </Tooltip>

      {/* 메뉴 섹션 */}
      <div className="mt-4 flex shrink-0 flex-col">
        <nav className="shrink-0 border-t border-border pt-3" aria-label="주요 메뉴">
          <div className="mb-1.5 flex items-center justify-between px-2">
            {!collapsed && (
              <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
                {isGlobalBridge && menuProject ? `${menuProject.name} 메뉴` : '메뉴'}
              </span>
            )}
            {canCreateProject && (
              <Tooltip label={t('common.newProject')} side="right">
                <Link href="/projects" className={`flex h-6 w-6 items-center justify-center rounded-lg border border-border text-fg-secondary transition hover:bg-surface-hover hover:text-fg ${collapsed ? 'mx-auto' : ''}`} aria-label={t('common.newProject')}>
                  <Plus className="h-3.5 w-3.5" />
                </Link>
              </Tooltip>
            )}
          </div>
          <div className="space-y-1">
            {menuProjectId ? (
              <>
                {projectMenu(`/p/${menuProjectId}`, showUsage, showPortfolio, projects.find(p => p.id === menuProjectId)?.isAdmin ?? false).map(item => {
                  const active = pathname === item.match || pathname.startsWith(item.match + '/')
                  const ItemIcon = item.icon
                  const label = t(item.labelKey)
                  const projectPrefix = isGlobalBridge && menuProject ? `${menuProject.name} · ` : ''
                  // 접힘 상태에서 배지 항목(공지 안읽음 · 에이전트 결재 대기)은 수까지 툴팁에 노출(배지가 점으로 축약되므로)
                  const badge = badges[item.labelKey]
                  const n = badge && badge.count > 0 ? (badge.count > 99 ? '99+' : String(badge.count)) : null
                  const tip = collapsed && badge && n
                    ? `${projectPrefix}${label} · ${badge.tip}${n}`
                    : `${projectPrefix}${label}`
                  return (
                    <Tooltip key={item.href} label={tip} side="right" disabled={!collapsed}>
                      <Link href={item.href} aria-current={active ? 'page' : undefined} className={`side-link relative ${active ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                        <ItemIcon className="h-[18px] w-[18px] shrink-0" />
                        {!collapsed && <span className="flex-1">{label}</span>}
                        {!collapsed && badge && n && (
                          <span data-nav-badge={item.labelKey} title={badge.tip ? `${badge.tip}${n}건` : undefined}
                            className={`flex h-5 min-w-5 items-center justify-center rounded-full ${badge.bg} px-1.5 text-xs font-bold tabular-nums`}>
                            {n}
                          </span>
                        )}
                        {collapsed && badge && n && (
                          <span aria-hidden data-nav-dot={item.labelKey} className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${badge.bg} ring-2 ring-surface`} />
                        )}
                      </Link>
                    </Tooltip>
                  )
                })}
              </>
            ) : (
              <>
                <Tooltip label={t('nav.home')} side="right" disabled={!collapsed}>
                  <Link href="/projects" aria-current={pathname === '/projects' ? 'page' : undefined}
                    className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                    <LayoutGrid className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.home')}</span>}
                  </Link>
                </Tooltip>
                {/* 프로젝트를 고르지 않은 상태에서도 포트폴리오에 닿을 수 있어야 한다 — 슈퍼유저 전용 */}
                {showPortfolio && (
                  <Tooltip label={t('nav.portfolio')} side="right" disabled={!collapsed}>
                    <Link href="/portfolio" aria-current={pathname === '/portfolio' ? 'page' : undefined}
                      className={`side-link ${pathname === '/portfolio' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                      <Briefcase className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.portfolio')}</span>}
                    </Link>
                  </Tooltip>
                )}
                {/* 프로젝트를 고르지 않은 상태에서도 사용 현황에 닿을 수 있어야 한다 — 슈퍼유저 전용 */}
                {showUsage && (
                  <Tooltip label={t('nav.usage')} side="right" disabled={!collapsed}>
                    <Link href="/usage" aria-current={pathname === '/usage' ? 'page' : undefined}
                      className={`side-link ${pathname === '/usage' ? 'side-link-active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                      <BarChart3 className="h-[18px] w-[18px] shrink-0" />{!collapsed && <span className="flex-1">{t('nav.usage')}</span>}
                    </Link>
                  </Tooltip>
                )}
              </>
            )}
          </div>
        </nav>
      </div>
    </aside>
  )
}
