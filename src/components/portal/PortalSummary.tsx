import Link from 'next/link'
import type { PortalSummary as Summary, SummaryCell } from '@/lib/portal/summary'
import { wsHref } from '@/lib/workspace/paths'
import { t} from '@/lib/i18n/dict'

/**
 * 요약 수치 셋(스펙 §6.1) — 칸마다 독립 실패('—' + title·숨은 글에 사유). 각 칸은 내 업무의 그 거르기로 간다(W7).
 * 검토 칸은 검토자에게만(reviewer — 판정 불가(null)면 그린다: 그때 수는 0 이거나 모름이라 남의 검토 수가 새지 않는다)
 * 모양은 지표 카드(2026-10-10 디자인 정비) — 라벨 500 보조 글자, 값 text-kpi. 시안의 값 아래 보조 설명 한 줄은 두지 않았다:
 * 요약은 칸마다 건수 하나뿐이라(SummaryCell) 내역(진행 중·시작 전 등)을 만들려면 새 조회가 든다.
 */
export function PortalSummary({ slug, summary, showReview }: { slug: string; summary: Summary; showReview: boolean }) {
  const cell = (id: keyof Summary, label: string, query: Record<string, string>, c: SummaryCell) => (
    <Link key={id} data-summary={id} href={wsHref(slug, 'my-work', query)} title={c.ok ? undefined : c.reason}
      className="flex min-w-0 flex-col gap-1 rounded-(--radius-panel) border border-border bg-surface px-3 py-3 shadow-(--shadow-card) hover:bg-surface-hover sm:px-5 sm:py-4">
      <span className="text-meta font-medium text-fg-secondary">{label}</span>
      {/* 0 은 흐리게 — 할 일이 없는 칸이 화면에서 가장 큰 글자로 눈을 끌지 않게 */}
      <span className={`text-kpi tabular-nums ${c.ok && c.count === 0 ? 'text-fg-muted' : 'text-fg'}`}>{c.ok ? c.count : '—'}</span>
      {!c.ok && <span className="sr-only">{c.reason}</span>}
    </Link>
  )
  return (
    <nav aria-label={t('portalUi.summary.aria')} className={`mb-6 grid gap-2 sm:gap-3 ${showReview ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {cell('mine', t('portalUi.summary.mine'), { kind: 'wbs,issue' }, summary.mine)}
      {showReview && cell('review', t('portalUi.summary.review'), { kind: 'approval' }, summary.review)}
      {cell('dueToday', t('portalUi.summary.dueToday'), { due: 'today' }, summary.dueToday)}
    </nav>
  )
}
