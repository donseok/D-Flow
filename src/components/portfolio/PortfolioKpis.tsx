import { KpiCard } from '@/components/ui/KpiCard'
import type { PortfolioModel } from '@/lib/domain/portfolio'
import { t} from '@/lib/i18n/dict'

/** 상단 KPI — 프로젝트 수·신호 분포·지연 종료·집계 실패. 집계는 buildPortfolio 가 끝냈다. 모양은 홈 요약과 같은 지표 카드(KpiCard)다. */
export function PortfolioKpis({ totals }: { totals: PortfolioModel['totals'] }) {
  const tr = t
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label={tr('pf.kpi.projects')} value={totals.count} />
      <div className="kpi-card">
        <div className="text-meta font-medium text-fg-secondary">{tr('pf.kpi.signals')}</div>
        {/* 폰 폭(두 열)에서는 네 수가 한 줄에 들도록 한 단계 작게 */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-title-sm tabular-nums sm:gap-x-3 sm:text-kpi">
          <span className="inline-flex items-center gap-1 sm:gap-1.5 text-danger"><span aria-hidden className="h-2 w-2 rounded-full bg-danger" />{totals.red}</span>
          <span className="inline-flex items-center gap-1 sm:gap-1.5 text-warning"><span aria-hidden className="h-2 w-2 rounded-full bg-warning" />{totals.amber}</span>
          <span className="inline-flex items-center gap-1 sm:gap-1.5 text-success"><span aria-hidden className="h-2 w-2 rounded-full bg-success" />{totals.green}</span>
          <span className="inline-flex items-center gap-1 sm:gap-1.5 text-fg-muted"><span aria-hidden className="h-2 w-2 rounded-full bg-fg-muted" />{totals.neutral}</span>
        </div>
        <div className="mt-1.5 text-meta text-fg-muted">{tr('pf.kpi.signalsSub')}</div>
      </div>
      <KpiCard label={tr('pf.kpi.overdue')} value={totals.overdue} tone={totals.overdue > 0 ? 'danger' : undefined} />
      <KpiCard label={tr('pf.kpi.degraded')} value={totals.degraded}
        tone={totals.degraded > 0 ? 'danger' : undefined}
        sub={totals.degraded > 0 ? tr('pf.kpi.degradedSub') : undefined} />
    </div>
  )
}
