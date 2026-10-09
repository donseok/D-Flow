import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { valueOf } from '@/lib/settings/registry'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { getWorkspacePrefs } from '@/app/actions/preferences'
import {
  getMyWork, getPortalSummary, getProjectRows, getRecentDocuments, getReviewRows, getUpcomingMeetings, getWorkspaceAnnouncements, workspaceModuleSets,
} from '@/lib/data/portal'
import { PORTAL_WIDGETS, defaultPortalWidgets, isPortalReviewer, visibleWidgets, type PortalWidgetSetting } from '@/lib/portal/widgets'
import { parseHiddenWidgets } from '@/lib/portal/prefs'
import { portalDateLabel } from '@/lib/portal/dateLabel'
import type { MyWorkKind } from '@/lib/portal/myWork'
import { isProjectAdmin, isWorkspaceAdmin } from '@/lib/domain/authz'
import { wsHref } from '@/lib/workspace/paths'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { translatorFor } from '@/lib/i18n/translate'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { PortalSummary } from '@/components/portal/PortalSummary'
import { WidgetSlotView, safe, type HomeTab, type WidgetCtx, type WidgetData } from '@/components/portal/PortalWidgets'
import { HiddenWidgetsProvider } from '@/components/portal/HiddenWidgetsProvider'
import { ShowHiddenWidgets } from '@/components/portal/ShowHiddenWidgets'

/** 탭 제목 — 화면 언어를 따른다(ko 는 종전의 '홈') */
export async function generateMetadata() { return { title: t(await getServerLocale(), 'nav.home') } }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)
const TAB_KINDS: Record<HomeTab, MyWorkKind[] | undefined> = { all: undefined, mine: ['wbs', 'issue'], review: ['approval'] }

/**
 * 워크스페이스 홈 v1(포털 — SP3b 스펙 §6.1). 노출 식 = portal.widgets(워크스페이스 관리자의 켜짐·순서) ∧ 개인 숨김 ∧ 모듈 합집합 ∧ 검토자.
 * 위젯마다 Suspense 와 독립 로더 — 실패·예외는 그 위젯만(⑥). 모든 로더가 한 순간(now)·같은 요청 범위 원천을 쓴다(W8, 판정 R1).
 * 머리의 날짜·시간대는 화면 워크스페이스의 달력(viewTimezone — R1: 서울 상수 없음).
 */
export default async function WorkspaceHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)                                   // 첫 await — 비소속 404
  const ws = scope.ws
  const now = new Date()
  const [{ tab: rawTab }, locale, tz] = await Promise.all([
    searchParams, getServerLocale(),
    viewTimezone(ws.id).catch((e: unknown) => {
      console.error('[home] 워크스페이스 달력 조회 실패 — 머리의 날짜를 그리지 않는다', ws.id, e instanceof Error ? e.message : e)
      return { ok: false as const }
    }),
  ])
  const date = tz.ok ? portalDateLabel(now, tz.timeZone, locale) : null
  const meta = date && tz.ok
    ? t(locale, 'pages.home.meta').replace('{date}', date).replace('{tz}', tz.timeZone)
    : t(locale, 'pages.home.metaNoTz')     // 다른 시간대로 날짜를 지어내지 않는다
  const header = <PageHeader title={t(locale, 'nav.home')} meta={meta} />
  const actor = scope.actor
  if (!actor) {
    return <PageFrame width="portal" header={header}>
      <StatusMessage kind="partial_error" blocking title={t(locale, 'pages.home.noActor')} detail={t(locale, 'pages.common.refreshLater')} />
    </PageFrame>                                                                  // 열화 — 로더를 부르지 않는다(fail-closed)
  }
  const [cfg, prefs, mods, summary] = await Promise.all([
    getWorkspaceConfig(ws.id).then((c) => ({ ok: true as const, value: valueOf(c, 'portal.widgets') as PortalWidgetSetting })).catch((e: unknown) => {
      console.error('[home] portal.widgets 읽기 실패 — 기본 배치로 그린다', ws.id, e instanceof Error ? e.message : e)
      return { ok: false as const }
    }),
    getWorkspacePrefs(ws.id, { strict: true }).catch(() => null),
    workspaceModuleSets(ws.id, actor),
    getPortalSummary(ws.id, actor, { now, t: translatorFor(locale) }),
  ])
  // 검토자(W11·R9 ①) — 합집합을 못 읽으면 관리자 여부는 '모름'(null). 검토 대기 수는 요약과 같은 원천(왕복이 늘지 않는다)
  const adminOfAgentsProject = mods.ok ? [...mods.sets].some(([pid, s]) => s.has('agents') && isProjectAdmin(actor, pid)) : null
  const reviewer = isPortalReviewer({ adminOfAgentsProject, reviewCount: summary.review.ok ? summary.review.count : null })
  const hidden = parseHiddenWidgets(prefs?.portalHiddenWidgets) ?? []
  const slots = visibleWidgets({ setting: cfg.ok ? cfg.value : defaultPortalWidgets(), hidden, moduleUnion: mods.ok ? mods.union : null, reviewer })
  const tab: HomeTab = rawTab === 'mine' || (rawTab === 'review' && reviewer === true) ? rawTab : 'all'
  const want = new Set([...slots.main, ...slots.side].filter((s) => s.state === 'show').map((s) => s.id))
  const data: WidgetData = {}                                                     // 보일 위젯의 로더만 — 꺼진·숨긴·판정 못 한 위젯의 원천은 읽지 않는다
  if (want.has('my_work')) data.my_work = safe(getMyWork(ws.id, actor, { kinds: TAB_KINDS[tab], limit: 20, now }), t(locale, 'portal.widget.my_work'), locale)
  if (want.has('projects')) data.projects = safe(getProjectRows(ws.id, actor, { status: 'active', limit: 20, now, t: translatorFor(locale) }), t(locale, 'portal.widget.projects'), locale)
  if (want.has('review')) data.review = safe(getReviewRows(ws.id, actor, { limit: 20, now }), t(locale, 'portal.widget.review'), locale)
  if (want.has('upcoming')) data.upcoming = safe(getUpcomingMeetings(ws.id, actor, { limit: 5, now }), t(locale, 'portal.widget.upcoming'), locale)
  if (want.has('recent_docs')) data.recent_docs = safe(getRecentDocuments(ws.id, actor, { limit: 5 }), t(locale, 'portal.widget.recent_docs'), locale)
  if (want.has('announcements')) data.announcements = safe(getWorkspaceAnnouncements(ws.id, actor, { limit: 5, now }), t(locale, 'portal.widget.announcements'), locale)
  const labelOf = new Map(PORTAL_WIDGETS.map((w) => [w.id, w.labelKey]))
  const ctx: WidgetCtx = { slug: ws.slug, workspaceId: ws.id, locale, hidden, tab, reviewTab: reviewer === true, data, title: (id) => t(locale, labelOf.get(id)!) }
  const settingsAction = isWorkspaceAdmin(actor, ws.id) ? { label: t(locale, 'pages.home.toSettings'), href: `${wsHref(ws.slug, 'settings')}#workspace-menu` } : undefined
  return (
    <PageFrame width="portal" header={header}>
      {!cfg.ok && <div className="mb-4"><StatusMessage kind="partial_error" compact title={t(locale, 'pages.home.widgetConfigFailed')} action={settingsAction} /></div>}
      {prefs === null && <div className="mb-4"><StatusMessage kind="partial_error" compact title={t(locale, 'pages.home.prefsFailed')} detail={t(locale, 'pages.home.prefsFailedDetail')} /></div>}
      {mods.ok && mods.partial && <div className="mb-4"><StatusMessage kind="partial_error" compact title={t(locale, 'pages.home.modulesPartial')} /></div>}
      <PortalSummary slug={ws.slug} summary={summary} showReview={reviewer !== false} locale={locale} />
      <HiddenWidgetsProvider key={`${ws.id}:${prefs === null ? 'unavailable' : hidden.join(',')}`} workspaceId={ws.id} hidden={prefs === null ? null : hidden}>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="min-w-0 space-y-6 lg:col-span-8">{slots.main.map((s) => <WidgetSlotView key={s.id} slot={s} ctx={ctx} />)}</div>
        <div className="min-w-0 space-y-6 lg:col-span-4">{slots.side.map((s) => <WidgetSlotView key={s.id} slot={s} ctx={ctx} />)}</div>
      </div>
      {slots.hiddenCount > 0 ? <ShowHiddenWidgets workspaceId={ws.id} count={slots.hiddenCount} /> : <div className="pb-8" />}
      </HiddenWidgetsProvider>
    </PageFrame>
  )
}
