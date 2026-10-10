import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { valueOf } from '@/lib/settings/registry'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import {
  getMyWork, getPortalSummary, getProjectRows, getRecentDocuments, getReviewRows, getUpcomingMeetings, getWorkspaceAnnouncements, workspaceModuleSets,
} from '@/lib/data/portal'
import {
  getAgentsStatus, getAttendanceToday, getDueWork, getMyIssues, getProjectProgress, getRecentChanges, getWeekSchedule, getWeeklyReportStatus, getWikiRecent,
} from '@/lib/data/portalWidgets'
import {
  defaultPortalWidgets, isPortalReviewer, parsePortalLayout, portalWidgetDef, resolveHomeLayout, type PortalWidgetId, type PortalWidgetSetting,
} from '@/lib/portal/widgets'
import { parseHiddenWidgets } from '@/lib/portal/prefs'
import { portalDateLabel } from '@/lib/portal/dateLabel'
import type { MyWorkKind } from '@/lib/portal/myWork'
import { isProjectAdmin, isWorkspaceAdmin } from '@/lib/domain/authz'
import { wsHref } from '@/lib/workspace/paths'
import { t } from '@/lib/i18n/dict'
import { koTranslate } from '@/lib/i18n/translate'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { PortalSummary } from '@/components/portal/PortalSummary'
import { WidgetSlotView, safe, type HomeTab, type QuickLink, type WidgetCtx, type WidgetData } from '@/components/portal/PortalWidgets'
import { HomeGrid } from '@/components/portal/HomeGrid'

/** 탭 제목 — 사전에서 꺼낸다('홈') */
export async function generateMetadata() { return { title: t('nav.home') } }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)
const TAB_KINDS: Record<HomeTab, MyWorkKind[] | undefined> = { all: undefined, mine: ['wbs', 'issue'], review: ['approval'] }

/**
 * 워크스페이스 홈(포털 — SP3b 스펙 §6.1, 2026-10-10 위젯 강화). 세 층이 겹친다: portal.widgets(워크스페이스 관리자가 정한 허용·기본 배치) ∧
 * 개인 구성(portalLayout — 내가 올린 위젯·순서·크기) ∧ 모듈 합집합·검토자. 개인 구성이 없으면 기본 배치(옛 개인 숨김은 거기서 뺀다).
 * 홈에 올라간 위젯만 조회한다. 위젯마다 Suspense 와 독립 로더 — 실패·예외는 그 위젯만(⑥). 모든 로더가 한 순간(now)·같은 요청 범위 원천을 쓴다(W8, 판정 R1).
 * 머리의 날짜·시간대는 화면 워크스페이스의 달력(viewTimezone — R1: 서울 상수 없음).
 */
export default async function WorkspaceHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                   // 첫 await — 비소속 404
  const ws = scope.ws
  const now = new Date()
  const [{ tab: rawTab }, tz] = await Promise.all([
    searchParams,
    viewTimezone(ws.id).catch((e: unknown) => {
      console.error('[home] 워크스페이스 달력 조회 실패 — 머리의 날짜를 그리지 않는다', ws.id, e instanceof Error ? e.message : e)
      return { ok: false as const }
    }),
  ])
  const date = tz.ok ? portalDateLabel(now, tz.timeZone) : null
  const meta = date && tz.ok
    ? t('pages.home.meta').replace('{date}', date).replace('{tz}', tz.timeZone)
    : t('pages.home.metaNoTz')     // 다른 시간대로 날짜를 지어내지 않는다
  const header = <PageHeader title={t('nav.home')} meta={meta} />
  const actor = scope.actor
  if (!actor) {
    return <PageFrame width="portal" header={header}>
      <StatusMessage kind="partial_error" blocking title={t('pages.home.noActor')} detail={t('pages.common.refreshLater')} />
    </PageFrame>                                                                  // 열화 — 로더를 부르지 않는다(fail-closed)
  }
  const [cfg, prefs, mods, summary] = await Promise.all([
    getWorkspaceConfig(ws.id).then((c) => ({ ok: true as const, value: valueOf(c, 'portal.widgets') as PortalWidgetSetting })).catch((e: unknown) => {
      console.error('[home] portal.widgets 읽기 실패 — 기본 배치로 그린다', ws.id, e instanceof Error ? e.message : e)
      return { ok: false as const }
    }),
    getWorkspacePrefs(ws.id, { strict: true }).catch(() => null),
    workspaceModuleSets(ws.id, actor),
    getPortalSummary(ws.id, actor, { now, t: koTranslate }),
  ])
  // 검토자(W11·R9 ①) — 합집합을 못 읽으면 관리자 여부는 '모름'(null). 검토 대기 수는 요약과 같은 원천(왕복이 늘지 않는다)
  const adminOfAgentsProject = mods.ok ? [...mods.sets].some(([pid, s]) => s.has('agents') && isProjectAdmin(actor, pid)) : null
  const reviewer = isPortalReviewer({ adminOfAgentsProject, reviewCount: summary.review.ok ? summary.review.count : null })
  // 개인 설정을 읽지 못하면(null) 개인 구성도 옛 숨김도 모른다 — 기본 배치로 그리고 알린다(구성 편집은 막는다: 읽지 못한 값 위에 덮어쓰지 않는다)
  const home = resolveHomeLayout({
    setting: cfg.ok ? cfg.value : defaultPortalWidgets(), layout: parsePortalLayout(prefs?.portalLayout), legacyHidden: parseHiddenWidgets(prefs?.portalHiddenWidgets),
    moduleUnion: mods.ok ? mods.union : null, reviewer,
  })
  const tab: HomeTab = rawTab === 'mine' || (rawTab === 'review' && reviewer === true) ? rawTab : 'all'
  const want = new Set(home.slots.filter((s) => s.state === 'show').map((s) => s.id))
  const title = (id: PortalWidgetId) => t(portalWidgetDef(id).labelKey)
  const o = { now, t: koTranslate }
  const data: WidgetData = {}                                                     // 홈에 올라간 위젯의 로더만 — 꺼진·올리지 않은·판정 못 한 위젯의 원천은 읽지 않는다
  if (want.has('my_work')) data.my_work = safe(getMyWork(ws.id, actor, { kinds: TAB_KINDS[tab], limit: 20, now }), title('my_work'))
  if (want.has('projects')) data.projects = safe(getProjectRows(ws.id, actor, { status: 'active', limit: 20, ...o }), title('projects'))
  if (want.has('review')) data.review = safe(getReviewRows(ws.id, actor, { limit: 20, now }), title('review'))
  if (want.has('upcoming')) data.upcoming = safe(getUpcomingMeetings(ws.id, actor, { limit: 5, now }), title('upcoming'))
  if (want.has('recent_docs')) data.recent_docs = safe(getRecentDocuments(ws.id, actor, { limit: 5 }), title('recent_docs'))
  if (want.has('announcements')) data.announcements = safe(getWorkspaceAnnouncements(ws.id, actor, { limit: 5, now }), title('announcements'))
  if (want.has('due_work')) data.due_work = safe(getDueWork(ws.id, actor, { now }), title('due_work'))
  if (want.has('my_issues')) data.my_issues = safe(getMyIssues(ws.id, actor, { now }), title('my_issues'))
  if (want.has('project_progress')) data.project_progress = safe(getProjectProgress(ws.id, actor, o), title('project_progress'))
  if (want.has('week_schedule')) data.week_schedule = safe(getWeekSchedule(ws.id, actor, { now }), title('week_schedule'))
  if (want.has('favorites')) data.favorites = safe(getProjectRows(ws.id, actor, { favoritesOnly: true, limit: 20, ...o }), title('favorites'))
  if (want.has('recent_changes')) data.recent_changes = safe(getRecentChanges(ws.id, actor, { now }), title('recent_changes'))
  if (want.has('attendance_today')) data.attendance_today = safe(getAttendanceToday(ws.id, actor, { now }), title('attendance_today'))
  if (want.has('agents_status')) data.agents_status = safe(getAgentsStatus(ws.id, actor, { now }), title('agents_status'))
  if (want.has('weekly_reports')) data.weekly_reports = safe(getWeeklyReportStatus(ws.id, actor, { now }), title('weekly_reports'))
  if (want.has('wiki_recent')) data.wiki_recent = safe(getWikiRecent(ws.id, actor, { now }), title('wiki_recent'))
  const wsAdmin = isWorkspaceAdmin(actor, ws.id)
  // 빠른 실행 — 내비와 같은 조건으로 거른다(모듈이 어디서도 안 켜졌거나 합집합을 못 읽었으면 그 링크는 두지 않는다 — 닫힌 화면으로 보내지 않는다)
  const has = (m: 'meetings' | 'minutes' | 'agents') => mods.ok && mods.union.has(m)
  const quick: QuickLink[] = [
    { key: 'portalUi.widget.quickMyWork', href: wsHref(ws.slug, 'my-work') },
    { key: 'portalUi.widget.quickProjects', href: wsHref(ws.slug, 'projects') },
    ...(has('meetings') ? [{ key: 'portalUi.widget.quickMeetings' as const, href: wsHref(ws.slug, 'meetings') }] : []),
    ...(has('minutes') ? [{ key: 'portalUi.widget.quickMinutes' as const, href: wsHref(ws.slug, 'minutes') }] : []),
    ...(has('agents') ? [{ key: 'portalUi.widget.quickAgents' as const, href: wsHref(ws.slug, 'agents') }] : []),
    ...(wsAdmin ? [
      { key: 'portalUi.widget.quickMembers' as const, href: wsHref(ws.slug, 'admin/accounts') },
      { key: 'portalUi.widget.quickTeams' as const, href: wsHref(ws.slug, 'admin/teams') },
      { key: 'portalUi.widget.quickSettings' as const, href: wsHref(ws.slug, 'settings') },
    ] : []),
    { key: 'portalUi.widget.quickAccount', href: '/account' },
  ]
  const ctx: WidgetCtx = {
    slug: ws.slug, workspaceId: ws.id, tab, reviewTab: reviewer === true, data, title, quick,
    memo: prefs === null ? null : (typeof prefs.portalMemo === 'string' ? prefs.portalMemo : ''), timeZone: tz.ok ? tz.timeZone : null,
  }
  const settingsAction = wsAdmin ? { label: t('pages.home.toSettings'), href: `${wsHref(ws.slug, 'settings')}#workspace-menu` } : undefined
  return (
    <PageFrame width="portal" header={header}>
      {!cfg.ok && <div className="mb-4"><StatusMessage kind="partial_error" compact title={t('pages.home.widgetConfigFailed')} action={settingsAction} /></div>}
      {prefs === null && <div className="mb-4"><StatusMessage kind="partial_error" compact title={t('pages.home.prefsFailed')} detail={t('pages.home.prefsFailedDetail')} /></div>}
      {mods.ok && mods.partial && <div className="mb-4"><StatusMessage kind="partial_error" compact title={t('pages.home.modulesPartial')} /></div>}
      <PortalSummary slug={ws.slug} summary={summary} showReview={reviewer !== false} />
      {/* key — 저장 뒤 다시 읽은 구성으로 초안을 새로 시작한다(편집 상태가 옛 구성에 붙어 남지 않게) */}
      <HomeGrid key={`${ws.id}:${home.slots.map((s) => `${s.id}.${s.size}`).join(',')}`} workspaceId={ws.id} canEdit={prefs !== null} personal={home.personal} defaults={home.defaults}
        slots={home.slots.map((s) => ({ id: s.id, size: s.size, title: title(s.id), node: <WidgetSlotView slot={s} ctx={ctx} /> }))}
        gallery={home.gallery.map((g) => ({ id: g.id, size: g.size, isNew: g.isNew, title: title(g.id), desc: t(portalWidgetDef(g.id).descKey) }))} />
      <div className="pb-8" />
    </PageFrame>
  )
}
