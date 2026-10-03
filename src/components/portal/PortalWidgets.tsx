import { Suspense, use, type ReactNode } from 'react'
import Link from 'next/link'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { WidgetError } from './WidgetError'
import { WidgetFrame } from './WidgetFrame'
import { MyWorkList } from './MyWorkList'
import { ProjectStatusChip } from './ProjectStatusChip'
import { wsHref, wsMinuteHref } from '@/lib/workspace/paths'
import type { Locale } from '@/lib/i18n/dict'
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
export function safe<T>(p: Promise<T>, label: string): Promise<T | Fail> {
  return p.catch((e: unknown) => {
    console.error(`[portal] ${label} 실패`, e instanceof Error ? e.message : e)
    return { ok: false as const, error: `${label}을(를) 불러오지 못했습니다.` }
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
  const frame = (children: ReactNode, extra: { more?: { href: string; label: string }; tabs?: ReactNode } = {}) =>
    <WidgetFrame id={slot.id} title={title} workspaceId={ctx.workspaceId} hidden={ctx.hidden} {...extra}>{children}</WidgetFrame>
  // 켜졌는지(또는 검토자인지) 판정하지 못한 위젯 — 숨기지 않고 실패 카드(W10·R9 ①). 그 원천은 읽지 않는다
  if (slot.state === 'module_unknown') return frame(<WidgetError title="이 위젯을 쓸 수 있는지 확인하지 못했습니다." />)
  const wrap = (node: ReactNode) => <Suspense fallback={<StatusMessage kind="loading" compact title={`${title} 불러오는 중`} />}>{node}</Suspense>
  const d = ctx.data
  switch (slot.id) {
    case 'my_work': {
      if (!d.my_work) return null
      const tab = (key: HomeTab, label: string) => <Link key={key} href={wsHref(ctx.slug, '', { tab: key })} aria-current={ctx.tab === key ? 'page' : undefined}
        className={`chip ${ctx.tab === key ? 'bg-surface-selected text-fg' : 'text-fg-secondary hover:bg-surface-hover'}`}>{label}</Link>
      const tabs = <nav aria-label="내 업무 구분" className="flex gap-1">{tab('all', '전체')}{tab('mine', '내 담당')}{ctx.reviewTab && tab('review', '검토')}</nav>
      return frame(wrap(<Body p={d.my_work} empty="" selfEmpty>{(r) => <MyWorkList rows={r.rows} failedKinds={r.failedKinds} empty="지금 처리할 일이 없습니다" />}</Body>),
        { tabs, more: { href: wsHref(ctx.slug, 'my-work'), label: '내 업무 전체' } })
    }
    case 'projects':
      if (!d.projects) return null
      return frame(wrap(<Body p={d.projects} empty="진행 중인 프로젝트가 없습니다">{(r) => <ul className="divide-y divide-border">
        {r.rows.map((p) => <li key={p.id}>
          <Link href={`/p/${p.id}/dashboard`} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{p.name}</span>
              <span className="block truncate text-meta text-fg-secondary">{p.statusReason}</span></span>
            <ProjectStatusChip status={p.status} locale={ctx.locale} />
            <span className="shrink-0 text-meta tabular-nums text-fg-secondary">{p.nextDue ? `다음 기한 ${p.nextDue}` : '다음 기한 없음'}</span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'projects'), label: '전체 보기' } })
    case 'review':
      if (!d.review) return null
      return frame(wrap(<Body p={d.review} empty="검토할 보고가 없습니다">{(r) => <MyWorkList rows={r.rows} failedKinds={[]} empty="" />}</Body>),
        { more: { href: wsHref(ctx.slug, 'my-work', { kind: 'approval' }), label: '모두 보기' } })
    case 'upcoming':
      if (!d.upcoming) return null
      return frame(wrap(<Body p={d.upcoming} empty="다가오는 회의가 없습니다" partial="일부 프로젝트의 회의를 불러오지 못했을 수 있습니다">{(r) => <ul className="space-y-1">
        {r.rows.map((m) => <li key={m.id}>
          <Link href={m.href} className="flex min-h-11 items-center gap-2 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="w-28 shrink-0 text-meta tabular-nums text-fg-secondary">{m.date}{m.startTime ? ` ${m.startTime}` : ' 종일'}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{m.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{m.projectName}</span></span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'meetings'), label: '회의 일정' } })
    case 'recent_docs':
      if (!d.recent_docs) return null
      return frame(wrap(<Body p={d.recent_docs} empty="최근 회의록이 없습니다">{(r) => <ul className="space-y-1">
        {r.rows.map((m) => <li key={m.id}>
          <Link href={wsMinuteHref(ctx.slug, m.id)} className="flex min-h-11 flex-col justify-center rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            <span className="block truncate text-body text-fg">{m.title}</span>
            <span className="block truncate text-meta text-fg-secondary">{m.projectName ?? '워크스페이스'}{m.date ? ` · ${m.date}` : ''}</span>
          </Link></li>)}</ul>}</Body>), { more: { href: wsHref(ctx.slug, 'minutes'), label: '회의록' } })
    case 'announcements':
      if (!d.announcements) return null
      return frame(wrap(<Body p={d.announcements} empty="공지가 없습니다" partial="일부 프로젝트의 공지를 불러오지 못했을 수 있습니다">{(r) => <ul className="space-y-1">
        {r.rows.map((a) => <li key={a.id}>
          <Link href={`/p/${a.projectId}/announcements`} className="flex min-h-11 items-center gap-2 rounded-(--radius-control) px-1 py-2 hover:bg-surface-hover">
            {a.isPinned && <span className="chip shrink-0 text-action">고정</span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-body text-fg">{a.title}</span>
              <span className="block truncate text-meta text-fg-secondary">{a.projectName}</span></span>
          </Link></li>)}</ul>}</Body>))
  }
}
