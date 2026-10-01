'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import {
  Bell, ChevronRight, Cpu, KeyRound, LogOut, Menu, User, UserCog, Users, X,
} from 'lucide-react'
import { createBrowserClient } from '@/lib/supabase/client'
import { canManageTeams } from '@/lib/authz/teamsAccess'
import { canManageLlmConfig } from '@/lib/authz/llmConfigAccess'
import { markAllNotificationsRead } from '@/app/actions/notifications'
import { markInboxSeen, markAllInboxRead, markInboxItemRead, type InboxItem } from '@/app/actions/inbox'
import { useShellState } from './ShellStateProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import { BrandMark } from '@/components/ui/BrandMark'
import { BRAND } from '@/lib/branding'
import { Tooltip } from '@/components/ui/Tooltip'
import { HeaderAnnouncementTicker } from './HeaderAnnouncementTicker'
import { InboxPanel } from './InboxPanel'
import { useProjectNavigation } from './ProjectNavigationContext'
import { projectMenu, type SidebarProject } from './Sidebar'
import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'
import { identityTeamLabel } from '@/lib/domain/identityTeams'
import { clearAllWikiDrafts } from '@/lib/drafts/wikiDrafts'

const SECTION_LABEL: Record<string, string> = {
  dashboard: '대시보드', wbs: 'WBS · 간트', gantt: '간트 차트', kanban: '칸반 보드', issues: '이슈관리',
  members: '멤버', attendance: '근태현황', announcements: '공지사항', meetings: '회의', weekly: '주간업무', wiki: '프로젝트 Wiki', settings: '설정',
  // = nav.projectAgents·importWizard.heroTitleSuffix — t() 전환은 SP3 레지스트리 파생 때(라벨이 바뀌어 기존 mock 이 깨진다).
  agents: '에이전트', import: '임포트 마법사',
}

/** 서버 레이아웃이 Actor 에서 평탄화해 내리는 신원 표시용 스냅샷 — Actor(Map)는 직렬화되지 않는다. */
export interface HeaderIdentity {
  roleLabel: string
  /** 내 모든 프로젝트의 명단 대표 팀 code(중복 제거·가나다순). null 은 권한 조회 실패로 모름 — 빈 목록('소속 미지정')과 다르다. */
  teamCodes: string[] | null
  /** 팀 관리·LLM 설정·사용 현황 등 전역 메뉴 노출 */
  isSuperuser: boolean
  showUsage: boolean
  showPortfolio: boolean
  /** 새 프로젝트 생성 어포던스(isAnyWorkspaceAdmin). degraded 는 false. */
  canCreateProject?: boolean
}

export function HeaderChrome({ identity, projects, userName }: { identity: HeaderIdentity | null; projects: SidebarProject[]; userName?: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [open, setOpen] = useState<null | 'notif' | 'profile'>(null)
  const [pwOpen, setPwOpen] = useState(false)

  const { routeProjectId } = useProjectNavigation()
  // 알림함·파생 알림·공지 배지 조회는 ShellStateProvider 가 내비게이션당 GET 1왕복으로
  // 합쳐 내려준다(2026-08-18 성능 감사 — 종전엔 이 컴포넌트가 서버 액션 3개를 따로 쐈다).
  const {
    inbox, setInbox, inboxLoading, inboxFailed,
    notifs, setNotifs, notifLoading, menuUnreadAnnouncements,
  } = useShellState()
  // 헤더 배지의 공지 합산은 URL 프로젝트가 있을 때만(기존 시맨틱 — 전역 화면에서는 0).
  // 프로젝트 화면에서는 메뉴 문맥 == URL 프로젝트라 값이 같다.
  const unreadAnn = routeProjectId ? menuUnreadAnnouncements : 0

  useEffect(() => { setMenuOpen(false); setOpen(null) }, [pathname])

  const context = useMemo(() => {
    const globalSection = pathname === '/meetings'
      ? t('nav.myMeetings')
      : pathname === '/minutes' || pathname.startsWith('/minutes/')
        ? t('nav.minutes')
        : null
    if (globalSection) {
      return { rootLabel: t('nav.workspace'), sectionLabel: globalSection }
    }

    const match = pathname.match(/^\/p\/[^/]+\/?([^/]+)?/)
    if (!routeProjectId || !match) return { rootLabel: null as string | null, sectionLabel: null as string | null }
    const project = projects.find(p => p.id === routeProjectId) ?? null
    const section = SECTION_LABEL[match[1] ?? ''] ?? '프로젝트'
    return {
      rootLabel: project?.name ?? null,
      sectionLabel: section === '프로젝트' ? null : section,
    }
  }, [pathname, projects, routeProjectId, t])

  const signOut = async () => {
    // 공용 PC 에서 다음 사용자에게 위키 초안이 남지 않게 — 세션을 끊기 전에 지운다.
    // 세션 만료·/login 진입에서는 지우지 않는다(주인의 초안을 부순다).
    try { clearAllWikiDrafts(window.localStorage) } catch { /* 저장소를 못 쓰는 환경 */ }
    await createBrowserClient().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  // 패널·배지는 안읽음만 표시(읽은 항목은 목록에서 제거 — 사용자 결정). notifs는 읽음 포함
  // 전체를 유지한다 — '모두 읽음' 저장이 전체 id를 보내야 기존 읽음이 유실되지 않는다(replace 시맨틱).
  const visibleNotifs = useMemo(() => notifs.filter(n => !n.read), [notifs])
  const unreadNotifs = visibleNotifs.length
  const markAllRead = () => {
    if (!routeProjectId || unreadNotifs === 0) return
    const snapshot = notifs
    setNotifs(ns => ns.map(n => ({ ...n, read: true }))) // 낙관 반영 — 배지 즉시 0
    markAllNotificationsRead(routeProjectId, snapshot.map(n => n.id))
      .then(r => { if (!r.ok) setNotifs(snapshot) }) // 실패 시 복원(다음 로드가 서버 상태로 재정렬)
      .catch(() => setNotifs(snapshot))
  }

  // 배지 합산 — 개인 unseen + 파생 안읽음 + 공지 안읽음(결정 N3: 한 벨, 합산 배지)
  const unseenInbox = useMemo(() => inbox.filter(n => !n.seen).length, [inbox])
  const badge = unseenInbox + unreadNotifs + unreadAnn

  // 벨 열람 = seen 소등(read 는 항목 클릭에서 처리)
  // 세 액션(markInbox*) 모두 throw 하지 않고 {ok:false}를 반환하므로, 낙관 반영 후
  // r.ok 를 봐야 실패를 감지할 수 있다 — markAllRead(파생 구획, 위)와 동일한 스냅샷/롤백 패턴.
  const openNotif = () => {
    const next = open === 'notif' ? null : 'notif'
    setOpen(next)
    if (next === 'notif' && unseenInbox > 0) {
      const snapshot = inbox
      setInbox(ns => ns.map(n => ({ ...n, seen: true }))) // 낙관 반영
      markInboxSeen()
        .then(r => { if (!r.ok) setInbox(snapshot) })
        .catch(() => setInbox(snapshot))
    }
  }

  const onInboxItemClick = (item: InboxItem) => {
    const snapshot = inbox
    setInbox(ns => ns.map(n => (n.recipientId === item.recipientId ? { ...n, read: true } : n)))
    markInboxItemRead(item.recipientId)
      .then(r => { if (!r.ok) setInbox(snapshot) })
      .catch(() => setInbox(snapshot))
    if (item.href) { setOpen(null); router.push(item.href) }
  }

  const onMarkAllRead = () => {
    const snapshot = inbox
    setInbox(ns => ns.map(n => ({ ...n, read: true, seen: true })))
    markAllInboxRead()
      .then(r => { if (!r.ok) setInbox(snapshot) })
      .catch(() => setInbox(snapshot))
    markAllRead() // 기존 파생 구획 읽음 처리 재사용
  }

  const roleLabel = identity?.roleLabel ?? '게스트'
  const displayName = userName?.trim() || null
  const teamCodes = identity?.teamCodes ?? null
  // 0팀 '소속 미지정', 1팀 그 code, n팀 '첫 팀 외 n-1' — 전체 목록은 팝오버 부제의 title 로.
  // 모르면(null) '—' — 미지정이라고 주장하지 않는다.
  const teamLabel = teamCodes ? identityTeamLabel(teamCodes) : '—'
  // 프로필 부제: 이름이 있으면 역할·팀을(0팀·모름은 역할만), 없으면 팀만.
  const roleTeam = teamCodes?.length ? `${roleLabel} · ${teamLabel}` : roleLabel

  return (
    <>
      <header className="sticky top-0 z-(--z-shell) px-1.5 pt-1.5 sm:px-5 sm:pt-2 lg:px-7">
        <div className="flex h-12 items-center gap-3 rounded-2xl border border-line bg-surface/85 px-3 shadow-[var(--shadow-sm)] backdrop-blur-xl sm:px-4">
          {/* 로고 */}
          <button onClick={() => setMenuOpen(true)} className="chrome-icon lg:hidden" aria-label="메뉴 열기"><Menu className="h-4 w-4" /></button>
          {/* 모바일 현재 위치 — 히어로가 md 미만에서 숨으므로 프로젝트명은 여기서 보여준다 */}
          {context.rootLabel && (
            <span data-mobile-project className="min-w-0 truncate text-[13px] font-semibold text-ink md:hidden">
              {context.rootLabel}
            </span>
          )}
          <Link href="/projects" className="hidden items-center sm:flex" aria-label={`${BRAND.productName} 홈`}>
            <BrandMark withWordmark tagline />
          </Link>

          {/* 브레드크럼 */}
          {context.rootLabel && (
            <nav className="ml-1 hidden min-w-0 items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 md:flex" aria-label="현재 위치">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
              <span className="truncate text-[13px] font-semibold text-ink">{context.rootLabel}</span>
              {context.sectionLabel && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  <span className="truncate text-[13px] font-medium text-ink-muted">{context.sectionLabel}</span>
                </>
              )}
            </nav>
          )}

          {/* 공지 티커 — 브레드크럼과 우측 컨트롤 사이 빈 공간에 공지 제목 상시 노출.
              @container: 남은 공간이 좁으면 티커가 스스로 숨도록 컨테이너 쿼리 기준점 제공 */}
          <div className="@container hidden min-w-0 flex-1 md:flex">
            <HeaderAnnouncementTicker projectId={routeProjectId} />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            {/* 공정율 기준일 자동/수동 바로가기 버튼 — 사용자 요청으로 화면에서 제거(기능은 설정 페이지에 유지) */}
            {/* 언어·테마 선택은 계정 팝오버와 /account 에 있다(2026-09-29 사용자 결정 #21 — 전역 바 아이콘 토글은 두지 않는다) */}

            {/* 알림 */}
            <div className="relative">
              <Tooltip label={t('chrome.notifications')} side="bottom" disabled={open === 'notif'}>
                <button onClick={openNotif} className="chrome-icon relative" aria-label={t('chrome.notifications')}>
                  <Bell className="h-4 w-4" />
                  {badge > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-action px-1 text-xs font-bold text-action-fg ring-2 ring-surface">{badge}</span>
                  )}
                </button>
              </Tooltip>
              {open === 'notif' && (
                <Popover onClose={() => setOpen(null)}>
                  <InboxPanel
                    items={inbox} derived={visibleNotifs} unreadAnnouncements={unreadAnn}
                    projectId={routeProjectId} loading={inboxLoading || notifLoading} failed={inboxFailed}
                    onItemClick={onInboxItemClick} onMarkAllRead={onMarkAllRead}
                  />
                </Popover>
              )}
            </div>

            {/* 프로필 */}
            <div className="relative">
              <button data-profile-trigger onClick={() => setOpen(open === 'profile' ? null : 'profile')} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2.5 transition hover:border-line-strong sm:pr-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-action text-action-fg"><User className="h-4 w-4" /></span>
                <span className="hidden leading-tight sm:block">
                  <span className="block text-[11px] font-semibold text-ink">{displayName ?? roleLabel}</span>
                  <span className="block text-[9px] text-ink-subtle">{displayName ? roleLabel : teamLabel}</span>
                </span>
              </button>
              {open === 'profile' && (
                <Popover onClose={() => setOpen(null)}>
                  <div className="border-b border-line px-4 py-3">
                    <div className="text-sm font-semibold text-ink">{displayName ?? roleLabel}</div>
                    <div data-profile-subtitle title={teamCodes && teamCodes.length > 1 ? teamCodes.join(', ') : undefined} className="mt-0.5 text-xs text-ink-subtle">{displayName ? roleTeam : teamLabel}</div>
                  </div>
                  <Link href="/account" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                    <KeyRound className="h-4 w-4" />내 계정
                  </Link>
                  {/* 어포던스 판정은 각 화면 게이트와 같은 predicate — 링크만 보이고 페이지는 거부되는 드리프트 방지 */}
                  {(canManageTeams(identity) || canManageLlmConfig(identity) || identity?.isSuperuser) && (
                    <>
                      {/* 링크별로 각자의 판정을 건다 — 지금은 전부 슈퍼유저라 결과가 같지만,
                          한쪽 권한이 넓어지는 날 OR 게이트는 다른 링크까지 같이 열어버린다. */}
                      {/* 계정 관리는 슈퍼유저 전용(2026-08-20) — 종전에는 진입 링크가 아예 없던 화면 */}
                      {identity?.isSuperuser && (
                        <Link href="/admin/accounts" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                          <UserCog className="h-4 w-4" />계정 관리
                        </Link>
                      )}
                      {canManageTeams(identity) && (
                        <Link href="/admin/teams" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                          <Users className="h-4 w-4" />팀 관리
                        </Link>
                      )}
                      {/* 서버 전역 LLM 설정 — 프로젝트 설정 페이지에도 진입 카드가 있지만,
                          프로젝트가 하나도 없는 슈퍼유저는 그 경로로 도달할 수 없어 여기에도 둔다. */}
                      {canManageLlmConfig(identity) && (
                        <Link href="/admin/llm-config" onClick={() => setOpen(null)} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-ink">
                          <Cpu className="h-4 w-4" />LLM 설정
                        </Link>
                      )}
                    </>
                  )}
                  <button onClick={signOut} className="flex w-full items-center gap-2 border-t border-line px-4 py-3 text-left text-sm text-ink-muted transition hover:bg-surface-2 hover:text-delayed">
                    <LogOut className="h-4 w-4" />{t('chrome.logout')}
                  </button>
                </Popover>
              )}
            </div>
          </div>
        </div>
      </header>

      {menuOpen && <MobileMenu projects={projects} pathname={pathname} onClose={() => setMenuOpen(false)} roleLabel={roleLabel} identity={identity} displayName={displayName} />}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  )
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <button className="fixed inset-0 z-(--z-popover) cursor-default" aria-label="닫기" onClick={onClose} />
      <div className="absolute right-0 top-12 z-(--z-popover) w-80 overflow-hidden rounded-(--radius-panel) border border-border bg-surface-raised shadow-(--shadow-popover)">{children}</div>
    </>
  )
}

function MobileMenu({
  projects, pathname, onClose, roleLabel, identity, displayName,
}: { projects: SidebarProject[]; pathname: string; onClose: () => void; roleLabel: string; identity: HeaderIdentity | null; displayName: string | null }) {
  const router = useRouter()
  const { t } = useLocale()
  const { routeProjectId, menuProjectId, menuProject } = useProjectNavigation()
  // 최근 메뉴 문맥은 아래 하위 메뉴로 유지하되, 콤보는 실제 URL 프로젝트만
  // 선택한다. 그래야 전역 화면에서 최근 프로젝트 자체를 골라도 change가 발생한다.
  const selectedProjectId = routeProjectId ?? ''

  // 배지(공지 안읽음 · 에이전트 결재 대기) — 데스크탑 사이드바와 동일한 지표를 모바일 메뉴에서도 노출.
  // 별도 조회 없이 셸 상태(메뉴 문맥 기준)를 그대로 쓴다.
  const { menuUnreadAnnouncements, menuPendingApprovals } = useShellState()
  const badgeOf: Partial<Record<string, { count: number; bg: string }>> = menuProjectId
    ? {
        'nav.announcements': { count: menuUnreadAnnouncements, bg: 'bg-action text-action-fg' },
        'nav.projectAgents': { count: menuPendingApprovals, bg: 'bg-warning text-warning-fg' },
      }
    : {}

  // 항목·순서·설정 노출은 사이드바의 projectMenu 하나로 정한다 — 모바일이 따로 목록을 들고 있다가
  // 에이전트 메뉴가 빠지고 순서가 어긋났다(2026-09-19). 포트폴리오·사용 현황은 위 전역 목록에 이미 있어 뺀다.
  const links = menuProjectId
    ? projectMenu(`/p/${menuProjectId}`, false, false, projects.find(p => p.id === menuProjectId)?.isAdmin ?? false)
        .map(item => ({ href: item.href, match: item.match, labelKey: item.labelKey, label: t(item.labelKey), badge: badgeOf[item.labelKey] }))
    : []
  return (
    <div className="fixed inset-0 z-(--z-overlay) lg:hidden" role="dialog" aria-modal="true" aria-label="모바일 메뉴">
      <button className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} aria-label="메뉴 닫기" />
      <div className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-surface p-4 text-fg shadow-(--shadow-modal)">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold">{BRAND.productName}</span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-fg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <nav className="mt-6 min-h-0 flex-1 space-y-1 overflow-y-auto">
          <Link href="/projects" onClick={onClose} aria-current={pathname === '/projects' ? 'page' : undefined} className={`side-link ${pathname === '/projects' ? 'side-link-active' : ''}`}>{t('nav.allProjects')}</Link>
          <Link href="/meetings" onClick={onClose} aria-current={pathname === '/meetings' ? 'page' : undefined} className={`side-link ${pathname === '/meetings' ? 'side-link-active' : ''}`}>{t('nav.myMeetings')}</Link>
          <Link href="/minutes" onClick={onClose} aria-current={pathname.startsWith('/minutes') ? 'page' : undefined} className={`side-link ${pathname.startsWith('/minutes') ? 'side-link-active' : ''}`}>{t('nav.minutes')}</Link>
          {/* 사이드바는 hidden lg:flex 라 lg 미만에서는 여기가 /portfolio 의 유일한 진입점이다 — 슈퍼유저 전용 */}
          {identity?.showPortfolio && (
            <Link href="/portfolio" onClick={onClose} aria-current={pathname === '/portfolio' ? 'page' : undefined} className={`side-link ${pathname === '/portfolio' ? 'side-link-active' : ''}`}>{t('nav.portfolio')}</Link>
          )}
          {/* 사이드바는 hidden lg:flex 라 lg 미만에서는 여기가 /usage 의 유일한 진입점이다 — 슈퍼유저 전용 */}
          {identity?.showUsage && (
            <Link href="/usage" onClick={onClose} aria-current={pathname === '/usage' ? 'page' : undefined} className={`side-link ${pathname === '/usage' ? 'side-link-active' : ''}`}>{t('nav.usage')}</Link>
          )}
          <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">프로젝트</div>
          <div className="mx-1">
            <select
              aria-label={t('common.selectProject')}
              value={selectedProjectId}
              disabled={projects.length === 0}
              onChange={event => {
                const projectId = event.target.value
                if (!projects.some(project => project.id === projectId)) return
                router.push(`/p/${encodeURIComponent(projectId)}/dashboard`)
                onClose()
              }}
              className="h-10 w-full rounded-xl border border-border bg-surface-subtle px-3 text-[13px] font-medium text-fg outline-none transition focus:border-border-focus disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="" disabled={projects.length > 0}>
                {projects.length === 0 ? t('common.noProjects') : t('common.selectProject')}
              </option>
              {projects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          {links.length > 0 && (
            <>
              <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-muted">
                프로젝트 메뉴{menuProject ? ` · ${menuProject.name}` : ''}
              </div>
              {links.map(l => {
                const active = routeProjectId === menuProjectId
                  && (pathname === l.match || pathname.startsWith(`${l.match}/`))
                const n = l.badge && l.badge.count > 0 ? (l.badge.count > 99 ? '99+' : String(l.badge.count)) : null
                return (
                  <Link key={l.href} onClick={onClose} href={l.href} aria-current={active ? 'page' : undefined} className={`side-link ${active ? 'side-link-active' : ''}`}>
                    <span className="flex-1">{l.label}</span>
                    {l.badge && n && (
                      <span data-nav-badge={l.labelKey} className={`flex h-5 min-w-5 items-center justify-center rounded-full ${l.badge.bg} px-1.5 text-xs font-bold tabular-nums`}>
                        {n}
                      </span>
                    )}
                  </Link>
                )
              })}
            </>
          )}
        </nav>
        {identity && (
          <div data-identity-card className="mt-auto rounded-xl border border-border bg-surface-subtle p-3 text-xs text-fg-secondary">
            <div className="font-semibold text-fg">{displayName ?? roleLabel}</div>
            <div className="mt-0.5">{identity.teamCodes?.length ? (displayName ? `${roleLabel} · ${identityTeamLabel(identity.teamCodes)}` : identityTeamLabel(identity.teamCodes)) : roleLabel}</div>
          </div>
        )}
      </div>
    </div>
  )
}
