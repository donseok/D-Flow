import { Suspense, use, type ReactNode } from 'react'
import Link from 'next/link'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'
import { KIND_LABEL_KEY, MyWorkList } from './MyWorkList'
import { MemoWidget } from './MemoWidget'
import { ProjectStatusChip } from './ProjectStatusChip'
import { wsHref, wsMinuteHref } from '@/lib/workspace/paths'
import { t, type DictKey } from '@/lib/i18n/dict'
import { stampIn } from '@/lib/domain/calendar'
import { DEFAULT_SEVERITIES, vocabLabel } from '@/lib/settings/vocab'
import type { PortalWidgetId, WidgetSlot } from '@/lib/portal/widgets'
import type { MyWorkKind, MyWorkRow } from '@/lib/portal/myWork'
import type { ProjectRow, RecentDoc, UpcomingRow } from '@/lib/data/portal'
import type {
  AgentCountKey, AgentCountRow, AttendanceTodayRow, ChangeRow, DueWorkRow, ProgressSummaryRow, WeekDay, WeekItem, WeeklyStatusRow, WikiRecentRow,
} from '@/lib/data/portalWidgets'

type Fail = { ok: false; error: string }
type AnnRow = { id: string; title: string; projectId: string; projectName: string; isPinned: boolean }
/** 위젯마다의 로더 결과(홈에 올라간 위젯만 채운다 — 꺼진·올리지 않은 위젯의 원천은 읽지 않는다) */
export interface WidgetData {
  my_work?: Promise<{ ok: true; rows: MyWorkRow[]; failedKinds: MyWorkKind[] } | Fail>
  projects?: Promise<{ ok: true; rows: ProjectRow[] } | Fail>
  review?: Promise<{ ok: true; rows: MyWorkRow[] } | Fail>
  upcoming?: Promise<{ ok: true; rows: UpcomingRow[]; partial: boolean } | Fail>
  recent_docs?: Promise<{ ok: true; rows: RecentDoc[] } | Fail>
  announcements?: Promise<{ ok: true; rows: AnnRow[]; partial: boolean } | Fail>
  due_work?: Promise<{ ok: true; rows: DueWorkRow[]; overdue: number; soon: number; partial: boolean } | Fail>
  my_issues?: Promise<{ ok: true; rows: MyWorkRow[]; total: number; partial: boolean } | Fail>
  project_progress?: Promise<{ ok: true; rows: ProgressSummaryRow[]; total: number } | Fail>
  week_schedule?: Promise<{ ok: true; rows: WeekItem[]; days: WeekDay[]; partial: boolean } | Fail>
  favorites?: Promise<{ ok: true; rows: ProjectRow[] } | Fail>
  recent_changes?: Promise<{ ok: true; rows: ChangeRow[]; partial: boolean } | Fail>
  attendance_today?: Promise<{ ok: true; rows: AttendanceTodayRow[]; total: number; partial: boolean } | Fail>
  agents_status?: Promise<{ ok: true; rows: AgentCountRow[]; projects: number; partial: boolean } | Fail>
  weekly_reports?: Promise<{ ok: true; rows: WeeklyStatusRow[]; partial: boolean } | Fail>
  wiki_recent?: Promise<{ ok: true; rows: WikiRecentRow[]; openQuestions: number | null; partial: boolean } | Fail>
}
export type HomeTab = 'all' | 'mine' | 'review'
export interface QuickLink { key: DictKey; href: string }
export interface WidgetCtx {
  slug: string; workspaceId: string; tab: HomeTab; reviewTab: boolean
  title(id: PortalWidgetId): string
  data: WidgetData
  /** 빠른 실행의 링크(권한·모듈로 거른 것 — 홈이 만든다) */
  quick: QuickLink[]
  /** 메모 본문. null = 개인 설정을 읽지 못했다(빈 메모로 그리면 저장이 옛 글을 덮는다 — 입력을 막는다) */
  memo: string | null
  /** 화면 워크스페이스의 시간대(최근 변경의 시각 표시). null = 달력을 못 읽음 — 날짜만 UTC 로 보이지 않게 시각을 그리지 않는다 */
  timeZone: string | null
}

/** 로더가 던져도 그 위젯만 실패 — 범위 오류 경계로 번지지 않게(스펙 §6.1 ⑥). 원인은 로그로 */
export function safe<T>(p: Promise<T>, label: string): Promise<T | Fail> {
  return p.catch((e: unknown) => {
    console.error(`[portal] ${label} 실패`, e instanceof Error ? e.message : e)
    return { ok: false as const, error: t('portalUi.widget.loadFailed').replace('{label}', () => label) }
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

const ROW = 'flex min-h-11 items-center gap-2 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover'
const fill = (s: string, vars: Record<string, string | number>) => Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, () => String(v)), s)
const KIND_KEY: Record<WeekItem['kind'], DictKey> = { wbs: 'portalUi.kind.wbs', issue: 'portalUi.kind.issue', meeting: 'portalUi.kind.meeting' }
const AGENT_KEY: Record<AgentCountKey, DictKey> = { claimed: 'portalUi.widget.agentsClaimed', reported: 'portalUi.widget.agentsReported', ready: 'portalUi.widget.agentsReady' }
/** 변경 이력의 필드 라벨 — WBS 상세의 변경 이력(ChangeHistoryList)과 같은 사전 키 */
const CHANGE_FIELD_KEY: Record<string, DictKey> = {
  actual_pct: 'wbs.colActualPct', weight: 'wbs.colWeight', name: 'wbs.fieldName', planned_start: 'wbs.colPlannedStart', planned_end: 'wbs.colPlannedEnd',
  deliverable: 'wbs.colDeliverable', biz: 'wbs.fieldBiz', created: 'wbs.fieldCreated', dependency: 'wbs.dependencies', stage: 'wbs.stageLabel', spec: 'wbs.specPanelTitle',
}
/** 값을 그대로 보일 만한 필드만(짧고 뜻이 분명한 것) — 나머지는 '무엇이 바뀌었나'(필드 이름)만.
 *  단계(stage)는 값을 보이지 않는다: 저장값이 프로젝트마다 다른 흐름의 코드(im·xx …)라 이름 없이 보이면 뜻을 알 수 없다 */
const CHANGE_VALUE_FIELDS = new Set(['actual_pct', 'planned_start', 'planned_end'])
function changeText(c: ChangeRow): string {
  const label = t(CHANGE_FIELD_KEY[c.field] ?? 'wbs.fieldName')
  if (c.field === 'created') return t('portalUi.widget.changesCreated')
  if (!CHANGE_VALUE_FIELDS.has(c.field)) return label
  const show = (v: string | null) => (v === null || v === '' ? t('portalUi.widget.changesNone') : c.field === 'actual_pct' ? `${v}%` : v)
  return `${label} ${fill(t('portalUi.widget.changesArrow'), { from: show(c.oldValue), to: show(c.newValue) })}`
}

export function WidgetSlotView({ slot, ctx }: { slot: Pick<WidgetSlot, 'id' | 'state'>; ctx: WidgetCtx }) {
  const title = ctx.title(slot.id)
  const frame = (children: ReactNode, extra: { more?: { href: string; label: string }; tabs?: ReactNode; note?: ReactNode } = {}) =>
    <WidgetFrame id={slot.id} title={title} {...extra}>{children}</WidgetFrame>
  // 켜졌는지(또는 검토자인지) 판정하지 못한 위젯 — 숨기지 않고 실패 카드(W10·R9 ①). 그 원천은 읽지 않는다
  if (slot.state === 'module_unknown') return frame(<WidgetError title={t('portalUi.widget.moduleUnknown')} />)
  const wrap = (node: ReactNode) => <Suspense fallback={<StatusMessage kind="loading" compact title={t('portalUi.widget.loading').replace('{title}', () => title)} />}>{node}</Suspense>
  const d = ctx.data
  switch (slot.id) {
    case 'my_work': {
      if (!d.my_work) return null
      const tab = (key: HomeTab, label: string) => <Link key={key} href={wsHref(ctx.slug, '', { tab: key })} aria-current={ctx.tab === key ? 'page' : undefined}
        className={`chip ${ctx.tab === key ? 'bg-surface-selected text-fg' : 'text-fg-secondary hover:bg-surface-hover'}`}>{label}</Link>
      const tabs = <nav aria-label={t('portalUi.widget.workTabsAria')} className="flex gap-1">{tab('all', t('portalUi.widget.tabAll'))}{tab('mine', t('portalUi.widget.tabMine'))}{ctx.reviewTab && tab('review', t('portalUi.widget.tabReview'))}</nav>
      return frame(wrap(<Body p={d.my_work} empty="" selfEmpty>{(r) => <MyWorkList rows={r.rows} failedKinds={r.failedKinds} empty={t('portalUi.widget.workEmpty')} />}</Body>),
        { tabs, more: { href: wsHref(ctx.slug, 'my-work'), label: t('portalUi.widget.workMore') } })
    }
    case 'projects':
      if (!d.projects) return null
      return frame(wrap(<Body p={d.projects} empty={t('portalUi.widget.projectsEmpty')}>{(r) => <ul className="divide-y divide-border">
        {r.rows.map((p) => <li key={p.id}>
          <Link href={`/p/${p.id}/dashboard`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{p.name}</span>
              <span className="block truncate text-meta text-fg-secondary">{p.statusReason}</span></span>
            <ProjectStatusChip status={p.status} />
            <span className="shrink-0 text-meta tabular-nums text-fg-secondary">{p.nextDue ? t('portalUi.widget.nextDue').replace('{date}', p.nextDue) : t('portalUi.widget.noNextDue')}</span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'projects'), label: t('common.viewAll') } })
    case 'review':
      if (!d.review) return null
      return frame(wrap(<Body p={d.review} empty={t('portalUi.widget.reviewEmpty')}>{(r) => <MyWorkList rows={r.rows} failedKinds={[]} empty="" />}</Body>),
        { more: { href: wsHref(ctx.slug, 'my-work', { kind: 'approval' }), label: t('portalUi.widget.reviewMore') } })
    case 'upcoming':
      if (!d.upcoming) return null
      return frame(wrap(<Body p={d.upcoming} empty={t('portalUi.widget.upcomingEmpty')} partial={t('portalUi.widget.upcomingPartial')}>{(r) => <ul className="space-y-1">
        {r.rows.map((m) => <li key={m.id}>
          <Link href={m.href} className={ROW}>
            <span className="w-28 shrink-0 text-meta tabular-nums text-fg-secondary">{m.date}{m.startTime ? ` ${m.startTime}` : t('portalUi.widget.allDay')}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{m.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{m.projectName}</span></span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'meetings'), label: t('portalUi.widget.upcomingMore') } })
    case 'recent_docs':
      if (!d.recent_docs) return null
      return frame(wrap(<Body p={d.recent_docs} empty={t('portalUi.widget.docsEmpty')}>{(r) => <ul className="space-y-1">
        {r.rows.map((m) => <li key={m.id}>
          <Link href={wsMinuteHref(ctx.slug, m.id)} className="flex min-h-11 flex-col justify-center rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="block truncate text-body text-fg">{m.title}</span>
            <span className="block truncate text-meta text-fg-secondary">{m.projectName ?? t('portalUi.widget.workspace')}{m.date ? ` · ${m.date}` : ''}</span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'minutes'), label: t('portalUi.widget.docsMore') } })
    case 'announcements':
      if (!d.announcements) return null
      return frame(wrap(<Body p={d.announcements} empty={t('portalUi.widget.annEmpty')} partial={t('portalUi.widget.annPartial')}>{(r) => <ul className="space-y-1">
        {r.rows.map((a) => <li key={a.id}>
          <Link href={`/p/${a.projectId}/announcements`} className={ROW}>
            {a.isPinned && <span className="chip shrink-0 text-action">{t('portalUi.widget.pinned')}</span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{a.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{a.projectName}</span></span>
          </Link></li>)}</ul>}</Body>))

    // ── 위젯 강화(2026-10-10) ──
    case 'due_work':
      if (!d.due_work) return null
      return frame(wrap(<Body p={d.due_work} empty={t('portalUi.widget.dueEmpty')} partial={t('portalUi.widget.duePartial')}>{(r) => <>
        <p className="text-meta tabular-nums text-fg-secondary">{fill(t('portalUi.widget.dueCounts'), { overdue: r.overdue, soon: r.soon })}</p>
        <ul className="space-y-1">{r.rows.map((w) => <li key={`${w.kind}:${w.id}`}>
          <Link href={w.href} className={ROW}>
            {/* 지연·임박을 색만으로 가르지 않는다 — 칩의 글자가 함께 말한다 */}
            <span className={`chip shrink-0 ${w.dueKind === 'overdue' ? 'bg-danger-weak text-danger' : 'bg-surface-subtle text-fg-secondary'}`}>{t(w.dueKind === 'overdue' ? 'portalUi.widget.dueOverdue' : 'portalUi.widget.dueSoon')}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{w.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{t(KIND_LABEL_KEY[w.kind])} · {w.projectName}</span></span>
            <span className={`shrink-0 text-right text-meta tabular-nums ${w.overdueDays ? 'font-semibold text-danger' : 'text-fg-secondary'}`}>
              {w.due}{w.overdueDays ? t('portalUi.work.overdueDays').replace('{n}', String(w.overdueDays)) : ''}</span>
          </Link></li>)}</ul></>}</Body>), { more: { href: wsHref(ctx.slug, 'my-work', { kind: 'wbs,issue' }), label: t('portalUi.widget.dueMore') } })
    case 'my_issues':
      if (!d.my_issues) return null
      return frame(wrap(<Body p={d.my_issues} empty={t('portalUi.widget.issuesEmpty')} partial={t('portalUi.widget.issuesPartial')}>{(r) => <>
        <p className="text-meta tabular-nums text-fg-secondary">{fill(t('portalUi.widget.issuesTotal'), { n: r.total })}</p>
        <ul className="space-y-1">{r.rows.map((i) => {
          // 프로젝트를 가로지르는 화면이라 심각도는 제품 기본 이름으로 그린다(모르는 code 는 code 그대로)
          const sev = i.severity ? vocabLabel('issues.severities', DEFAULT_SEVERITIES, i.severity, t) : null
          return <li key={i.id}>
            <Link href={i.href} className={ROW}>
              {sev && <span className={`chip shrink-0 ${i.severity === 'high' ? 'bg-danger-weak text-danger' : 'bg-surface-subtle text-fg-secondary'}`}>
                <span className="sr-only">{t('portalUi.widget.severityAria')} </span>{sev}</span>}
              <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{i.title}</span>
                <span className="block truncate text-meta text-fg-secondary">{i.projectName} · {i.status}</span></span>
              <span className={`shrink-0 text-right text-meta tabular-nums ${i.overdueDays ? 'font-semibold text-danger' : 'text-fg-secondary'}`}>
                {i.due ?? t('portalUi.work.noDue')}{i.overdueDays ? t('portalUi.work.overdueDays').replace('{n}', String(i.overdueDays)) : ''}</span>
            </Link></li>
        })}</ul></>}</Body>), { more: { href: wsHref(ctx.slug, 'my-work', { kind: 'issue' }), label: t('portalUi.widget.issuesMore') } })
    case 'project_progress':
      if (!d.project_progress) return null
      return frame(wrap(<Body p={d.project_progress} empty={t('portalUi.widget.progressEmpty')}>{(r) => <ul className="space-y-1">
        {r.rows.map((p) => <li key={p.id}>
          <Link href={`/p/${p.id}/dashboard`} className="block rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-body text-fg">{p.name}</span>
              <ProjectStatusChip status={p.status} />
              <span className="w-12 shrink-0 text-right text-body font-semibold tabular-nums text-fg">
                {p.pct === null ? '—' : fill(t('portalUi.widget.progressPct'), { pct: p.pct })}</span>
            </span>
            {p.pct !== null && <span role="img" aria-label={fill(t('portalUi.widget.progressBarAria'), { name: p.name, pct: p.pct })} className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-surface-subtle">
              <span className="block h-full bg-action" style={{ width: `${p.pct}%` }} /></span>}
            <span className="mt-1 block text-meta tabular-nums text-fg-secondary">
              {p.total > 0 ? fill(t('portalUi.widget.progressCount'), { done: p.done, total: p.total }) : t(p.overdueOpen === null ? 'portalUi.widget.progressUnknown' : 'portalUi.widget.progressNoWbs')}
              {p.overdueOpen ? <span className="font-semibold text-danger"> · {fill(t('portalUi.widget.progressOverdue'), { n: p.overdueOpen })}</span> : null}
              {p.nextDue ? ` · ${t('portalUi.widget.nextDue').replace('{date}', p.nextDue)}` : ''}
            </span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'projects'), label: t('common.viewAll') } })
    case 'week_schedule':
      if (!d.week_schedule) return null
      return frame(wrap(<Body p={d.week_schedule} empty={t('portalUi.widget.weekEmpty')} partial={t('portalUi.widget.weekPartial')}>{(r) => <ol className="space-y-3">
        {r.days.filter((day) => day.items.length > 0).map((day) => <li key={day.date}>
          <h3 className="mb-1 flex items-center gap-2 text-meta font-semibold text-fg-secondary">
            <span className="tabular-nums">{day.label}</span>
            {day.isToday && <span className="chip bg-surface-selected text-fg">{t('portalUi.widget.weekToday')}</span>}
          </h3>
          <ul className="space-y-1">{day.items.map((it) => <li key={`${it.kind}:${it.id}`}>
            <Link href={it.href} className={ROW}>
              <span className="w-16 shrink-0 text-meta tabular-nums text-fg-secondary">{it.kind === 'meeting' ? (it.time ?? t('portalUi.widget.weekAllDay')) : t('portalUi.widget.weekDue')}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{it.title}</span>
                <span className="block truncate text-meta text-fg-secondary">{t(KIND_KEY[it.kind])} · {it.projectName}</span></span>
            </Link></li>)}</ul>
        </li>)}</ol>}</Body>), { more: { href: wsHref(ctx.slug, 'my-work'), label: t('portalUi.widget.workMore') } })
    case 'favorites':
      if (!d.favorites) return null
      return frame(wrap(<Body p={d.favorites} empty={t('portalUi.widget.favEmpty')}>{(r) => <ul className="space-y-1">
        {r.rows.map((p) => <li key={p.id}>
          <Link href={`/p/${p.id}/dashboard`} className={ROW}>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{p.name}</span>
              <span className="block truncate text-meta text-fg-secondary">{p.statusReason}</span></span>
            <ProjectStatusChip status={p.status} />
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'projects'), label: t('portalUi.widget.favMore') } })
    case 'quick_actions':
      return frame(ctx.quick.length === 0 ? <StatusMessage kind="empty" compact title={t('portalUi.widget.quickEmpty')} /> : <ul className="flex flex-wrap gap-2">
        {ctx.quick.map((q) => <li key={q.key}>
          <Link href={q.href} className="inline-flex min-h-11 items-center rounded-(--radius-control) border border-border-input bg-surface px-3.5 text-control font-semibold text-fg hover:bg-surface-hover">{t(q.key)}</Link>
        </li>)}</ul>)
    case 'memo':
      return frame(<MemoWidget workspaceId={ctx.workspaceId} initial={ctx.memo} />)
    case 'recent_changes':
      if (!d.recent_changes) return null
      return frame(wrap(<Body p={d.recent_changes} empty={t('portalUi.widget.changesEmpty')}>{(r) => <ul className="space-y-1">
        {r.rows.map((c) => <li key={c.id}>
          <Link href={c.href} className={ROW}>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{c.itemName}</span>
              <span className="block truncate text-meta text-fg-secondary">{c.projectName} · {changeText(c)}</span></span>
            {ctx.timeZone && <span className="shrink-0 text-meta tabular-nums text-fg-secondary">{stampIn(ctx.timeZone, c.at).slice(5)}</span>}
          </Link></li>)}</ul>}</Body>))
    case 'attendance_today':
      if (!d.attendance_today) return null
      return frame(wrap(<Body p={d.attendance_today} empty={t('portalUi.widget.attEmpty')} partial={t('portalUi.widget.attPartial')}>{(r) => <>
        <p className="text-meta tabular-nums text-fg-secondary">{fill(t('portalUi.widget.attTotal'), { n: r.total })}</p>
        <ul className="space-y-1">{r.rows.map((a) => <li key={a.id}>
          <Link href={`/p/${a.projectId}/attendance`} className={ROW}>
            <span className="chip shrink-0 bg-surface-subtle text-fg-secondary">{a.typeLabel ?? a.type}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{a.name}</span>
              <span className="block truncate text-meta text-fg-secondary">{a.projectName}</span></span>
          </Link></li>)}</ul></>}</Body>))
    case 'agents_status':
      if (!d.agents_status) return null
      return frame(wrap(<Body p={d.agents_status} empty={t('portalUi.widget.agentsEmpty')} partial={t('portalUi.widget.agentsPartial')}>{(r) => <>
        <dl className="flex flex-wrap gap-3">{r.rows.map((c) => <div key={c.key} data-agent-count={c.key} className="min-w-24 flex-1 rounded-(--radius-control) bg-surface-subtle px-3 py-2">
          <dt className="text-meta text-fg-secondary">{t(AGENT_KEY[c.key])}</dt>
          <dd className="text-title tabular-nums text-fg">{c.count}</dd>
        </div>)}</dl>
        <p className="text-meta text-fg-secondary">{fill(t('portalUi.widget.agentsProjects'), { n: r.projects })}</p></>}</Body>),
        { more: { href: wsHref(ctx.slug, 'agents'), label: t('portalUi.widget.agentsMore') } })
    case 'weekly_reports':
      if (!d.weekly_reports) return null
      return frame(wrap(<Body p={d.weekly_reports} empty={t('portalUi.widget.weeklyEmpty')} partial={t('portalUi.widget.weeklyPartial')}>{(r) => <ul className="space-y-1">
        {r.rows.map((w) => <li key={w.projectId}>
          <Link href={w.href} className={ROW}>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{w.projectName}</span>
              <span className="block truncate text-meta tabular-nums text-fg-secondary">{fill(t('portalUi.widget.weeklyWeek'), { date: w.weekStart })}</span></span>
            <span data-weekly-written={w.written} className={`chip shrink-0 ${w.written ? 'bg-success-weak text-success' : 'bg-pending-weak text-pending'}`}>{t(w.written ? 'portalUi.widget.weeklyWritten' : 'portalUi.widget.weeklyMissing')}</span>
          </Link></li>)}</ul>}</Body>))
    case 'wiki_recent':
      if (!d.wiki_recent) return null
      return frame(wrap(<Body p={d.wiki_recent} empty={t('portalUi.widget.wikiEmpty')} partial={t('portalUi.widget.wikiPartial')} selfEmpty>{(r) => <>
        {r.openQuestions !== null && r.openQuestions > 0 && <p className="text-meta font-semibold tabular-nums text-fg">{fill(t('portalUi.widget.wikiQuestions'), { n: r.openQuestions })}</p>}
        {r.rows.length === 0 ? <StatusMessage kind="empty" compact title={t('portalUi.widget.wikiEmpty')} /> : <ul className="space-y-1">
          {r.rows.map((w) => <li key={w.id}>
            <Link href={w.href} className="flex min-h-11 flex-col justify-center rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
              <span className="block truncate text-body text-fg">{w.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{w.projectName}{ctx.timeZone ? ` · ${stampIn(ctx.timeZone, w.changedAt).slice(0, 10)}` : ''}</span>
            </Link></li>)}</ul>}</>}</Body>))
  }
}
