import Link from 'next/link'
import type { PortalSummary as Summary, SummaryCell } from '@/lib/portal/summary'
import { wsHref } from '@/lib/workspace/paths'

/**
 * 요약 수치 셋(스펙 §6.1) — 칸마다 독립 실패('—' + title·숨은 글에 사유). 각 칸은 내 업무의 그 거르기로 간다(W7).
 * 검토 칸은 검토자에게만(reviewer — 판정 불가(null)면 그린다: 그때 수는 0 이거나 모름이라 남의 검토 수가 새지 않는다)
 */
export function PortalSummary({ slug, summary, showReview }: { slug: string; summary: Summary; showReview: boolean }) {
  const cell = (id: keyof Summary, label: string, query: Record<string, string>, c: SummaryCell) => (
    <Link key={id} data-summary={id} href={wsHref(slug, 'my-work', query)} title={c.ok ? undefined : c.reason}
      className="flex min-w-36 flex-1 flex-col rounded-(--radius-panel) border border-border bg-surface px-4 py-3 hover:bg-surface-hover">
      <span className="text-meta text-fg-secondary">{label}</span>
      <span className="text-title tabular-nums text-fg">{c.ok ? c.count : '—'}</span>
      {!c.ok && <span className="sr-only">{c.reason}</span>}
    </Link>
  )
  return (
    <nav aria-label="요약" className="mb-6 flex flex-wrap gap-3">
      {cell('mine', '내 담당', { kind: 'wbs,issue' }, summary.mine)}
      {showReview && cell('review', '검토 대기', { kind: 'approval' }, summary.review)}
      {cell('dueToday', '오늘 마감', { due: 'today' }, summary.dueToday)}
    </nav>
  )
}
