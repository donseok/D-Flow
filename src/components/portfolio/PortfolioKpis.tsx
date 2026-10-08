import { Stat } from '@/components/dashboard/bits'
import type { PortfolioModel } from '@/lib/domain/portfolio'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

/** 상단 KPI — 프로젝트 수·신호 분포·지연 종료·집계 실패. 집계는 buildPortfolio 가 끝냈다. */
export function PortfolioKpis({ totals, locale }: { totals: PortfolioModel['totals']; locale: Locale }) {
  const tr = (k: DictKey) => t(locale, k)
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label={tr('pf.kpi.projects')} value={totals.count} />
      <div className="rounded-xl border border-border bg-surface-subtle/50 px-4 py-3">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">{tr('pf.kpi.signals')}</div>
        <div className="mt-1.5 flex items-center gap-3 text-lg font-bold tabular-nums leading-none">
          <span className="inline-flex items-center gap-1.5 text-danger"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-danger" />{totals.red}</span>
          <span className="inline-flex items-center gap-1.5 text-warning"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-warning" />{totals.amber}</span>
          <span className="inline-flex items-center gap-1.5 text-success"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-success" />{totals.green}</span>
          <span className="inline-flex items-center gap-1.5 text-fg-muted"><span aria-hidden className="h-2.5 w-2.5 rounded-full bg-fg-muted" />{totals.neutral}</span>
        </div>
        <div className="mt-1 text-[11px] text-fg-secondary">{tr('pf.kpi.signalsSub')}</div>
      </div>
      <Stat label={tr('pf.kpi.overdue')} value={totals.overdue} tone={totals.overdue > 0 ? 'text-danger' : undefined} />
      <Stat label={tr('pf.kpi.degraded')} value={totals.degraded}
        tone={totals.degraded > 0 ? 'text-danger' : undefined}
        sub={totals.degraded > 0 ? tr('pf.kpi.degradedSub') : undefined} />
    </div>
  )
}
