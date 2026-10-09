import { Suspense, use, type ReactNode } from 'react'
import Link from 'next/link'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'
import { MyWorkList } from './MyWorkList'
import { ProjectStatusChip } from './ProjectStatusChip'
import { wsHref, wsMinuteHref } from '@/lib/workspace/paths'
import { t, type Locale } from '@/lib/i18n/dict'
import type { PortalWidgetId, WidgetSlot } from '@/lib/portal/widgets'
import type { MyWorkKind, MyWorkRow } from '@/lib/portal/myWork'
import type { ProjectRow, RecentDoc, UpcomingRow } from '@/lib/data/portal'

type Fail = { ok: false; error: string }
type AnnRow = { id: string; title: string; projectId: string; projectName: string; isPinned: boolean }
/** 위젯마다의 로더 결과(보일 위젯만 채운다 — 꺼진·숨긴 위젯의 원천은 읽지 않는다) */
export interface WidgetData {
  my_work?: Promise<{ ok: true; rows: MyWorkRow[]; failedKinds: MyWorkKind[] } | Fail>
  projects?: Promise<{ ok: true; rows: ProjectRow[] } | Fail>
  review?: Promise<{ ok: true; rows: MyWorkRow[] } | Fail>
  upcoming?: Promise<{ ok: true; rows: UpcomingRow[]; partial: boolean } | Fail>
  recent_docs?: Promise<{ ok: true; rows: RecentDoc[] } | Fail>
  announcements?: Promise<{ ok: true; rows: AnnRow[]; partial: boolean } | Fail>
}
export type HomeTab = 'all' | 'mine' | 'review'
export interface WidgetCtx {
  slug: string; workspaceId: string; locale: Locale; hidden: readonly PortalWidgetId[]; tab: HomeTab; reviewTab: boolean
  title(id: PortalWidgetId): string
  data: WidgetData
}

/** 로더가 던져도 그 위젯만 실패 — 범위 오류 경계로 번지지 않게(스펙 §6.1 ⑥). 원인은 로그로 */
export function safe<T>(p: Promise<T>, label: string, locale: Locale = 'ko'): Promise<T | Fail> {
  return p.catch((e: unknown) => {
    console.error(`[portal] ${label} 실패`, e instanceof Error ? e.message : e)
    return { ok: false as const, error: t(locale, 'portalUi.widget.loadFailed').replace('{label}', () => label) }
  })
}

/** 위젯 본문 — 실패는 그 위젯만(WidgetError·다시 시도), 일부 실패(partial)는 받은 행과 함께 한 줄, 0건은 empty(selfEmpty 면 자식이 그린다) */
function Body<R extends { ok: true; rows: unknown[]; partial?: boolean }>({ p, empty, partial, selfEmpty = false, children }: {
  p: Promise<R | Fail>; empty: string; partial?: string; selfEmpty?: boolean; children(res: R): ReactNode
}) {
  const r = use(p)
  if (!r.ok) return <WidgetError title={r.error} />
  return <div className="space-y-2">
    {r.partial && partial && <StatusMessage kind="partial_error" compact title={partial} />}
    {r.rows.length === 0 && !selfEmpty ? <StatusMessage kind="empty" compact title={empty} /> : children(r)}
  </div>
}

export function WidgetSlotView({ slot, ctx }: { slot: WidgetSlot; ctx: WidgetCtx }) {
  const title = ctx.title(slot.id)
  const L = ctx.locale
  const frame = (children: ReactNode, extra: { more?: { href: string; label: string }; tabs?: ReactNode } = {}) =>
    <WidgetFrame id={slot.id} title={title} workspaceId={ctx.workspaceId} hidden={ctx.hidden} {...extra}>{children}</WidgetFrame>
  // 켜졌는지(또는 검토자인지) 판정하지 못한 위젯 — 숨기지 않고 실패 카드(W10·R9 ①). 그 원천은 읽지 않는다
  if (slot.state === 'module_unknown') return frame(<WidgetError title={t(L, 'portalUi.widget.moduleUnknown')} />)
  const wrap = (node: ReactNode) => <Suspense fallback={<StatusMessage kind="loading" compact title={t(L, 'portalUi.widget.loading').replace('{title}', () => title)} />}>{node}</Suspense>
  const d = ctx.data
  switch (slot.id) {
    case 'my_work': {
      if (!d.my_work) return null
      const tab = (key: HomeTab, label: string) => <Link key={key} href={wsHref(ctx.slug, '', { tab: key })} aria-current={ctx.tab === key ? 'page' : undefined}
        className={`chip ${ctx.tab === key ? 'bg-surface-selected text-fg' : 'text-fg-secondary hover:bg-surface-hover'}`}>{label}</Link>
      const tabs = <nav aria-label={t(L, 'portalUi.widget.workTabsAria')} className="flex gap-1">{tab('all', t(L, 'portalUi.widget.tabAll'))}{tab('mine', t(L, 'portalUi.widget.tabMine'))}{ctx.reviewTab && tab('review', t(L, 'portalUi.widget.tabReview'))}</nav>
      return frame(wrap(<Body p={d.my_work} empty="" selfEmpty>{(r) => <MyWorkList rows={r.rows} failedKinds={r.failedKinds} empty={t(L, 'portalUi.widget.workEmpty')} locale={L} />}</Body>),
        { tabs, more: { href: wsHref(ctx.slug, 'my-work'), label: t(L, 'portalUi.widget.workMore') } })
    }
    case 'projects':
      if (!d.projects) return null
      return frame(wrap(<Body p={d.projects} empty={t(L, 'portalUi.widget.projectsEmpty')}>{(r) => <ul className="divide-y divide-border">
        {r.rows.map((p) => <li key={p.id}>
          <Link href={`/p/${p.id}/dashboard`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{p.name}</span>
              <span className="block truncate text-meta text-fg-secondary">{p.statusReason}</span></span>
            <ProjectStatusChip status={p.status} locale={ctx.locale} />
            <span className="shrink-0 text-meta tabular-nums text-fg-secondary">{p.nextDue ? t(L, 'portalUi.widget.nextDue').replace('{date}', p.nextDue) : t(L, 'portalUi.widget.noNextDue')}</span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'projects'), label: t(L, 'common.viewAll') } })
    case 'review':
      if (!d.review) return null
      return frame(wrap(<Body p={d.review} empty={t(L, 'portalUi.widget.reviewEmpty')}>{(r) => <MyWorkList rows={r.rows} failedKinds={[]} empty="" locale={L} />}</Body>),
        { more: { href: wsHref(ctx.slug, 'my-work', { kind: 'approval' }), label: t(L, 'portalUi.widget.reviewMore') } })
    case 'upcoming':
      if (!d.upcoming) return null
      return frame(wrap(<Body p={d.upcoming} empty={t(L, 'portalUi.widget.upcomingEmpty')} partial={t(L, 'portalUi.widget.upcomingPartial')}>{(r) => <ul className="space-y-1">
        {r.rows.map((m) => <li key={m.id}>
          <Link href={m.href} className="flex min-h-11 items-center gap-2 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="w-28 shrink-0 text-meta tabular-nums text-fg-secondary">{m.date}{m.startTime ? ` ${m.startTime}` : t(L, 'portalUi.widget.allDay')}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{m.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{m.projectName}</span></span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'meetings'), label: t(L, 'portalUi.widget.upcomingMore') } })
    case 'recent_docs':
      if (!d.recent_docs) return null
      return frame(wrap(<Body p={d.recent_docs} empty={t(L, 'portalUi.widget.docsEmpty')}>{(r) => <ul className="space-y-1">
        {r.rows.map((m) => <li key={m.id}>
          <Link href={wsMinuteHref(ctx.slug, m.id)} className="flex min-h-11 flex-col justify-center rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="block truncate text-body text-fg">{m.title}</span>
            <span className="block truncate text-meta text-fg-secondary">{m.projectName ?? t(L, 'portalUi.widget.workspace')}{m.date ? ` · ${m.date}` : ''}</span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'minutes'), label: t(L, 'portalUi.widget.docsMore') } })
    case 'announcements':
      if (!d.announcements) return null
      return frame(wrap(<Body p={d.announcements} empty={t(L, 'portalUi.widget.annEmpty')} partial={t(L, 'portalUi.widget.annPartial')}>{(r) => <ul className="space-y-1">
        {r.rows.map((a) => <li key={a.id}>
          <Link href={`/p/${a.projectId}/announcements`} className="flex min-h-11 items-center gap-2 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            {a.isPinned && <span className="chip shrink-0 text-action">{t(L, 'portalUi.widget.pinned')}</span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{a.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{a.projectName}</span></span>
          </Link></li>)}</ul>}</Body>))
  }
}
