import Link from 'next/link'
import { Briefcase, Lock, ArrowRight, AlertTriangle } from 'lucide-react'
import type { PortfolioRow } from '@/lib/domain/portfolio'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import type { Signal } from '@/lib/domain/dashboard'
import { SIGNAL_META } from '@/components/dashboard/signalStyle'
import { SectionCard } from '@/components/ui/SectionCard'
import { CountBadge, MiniEmpty } from '@/components/dashboard/bits'
import { fmtDate } from '@/components/wbs/shared'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

const SIGNAL_LABEL: Record<Signal, DictKey> = {
  green: 'pf.signal.green', amber: 'pf.signal.amber', red: 'pf.signal.red', neutral: 'pf.signal.neutral',
}
const STATUS_CHIP: Record<ProjectLifecycleStatus, { labelKey: DictKey; chip: string; dot: string }> = {
  ready: { labelKey: 'pf.status.ready', chip: 'bg-pending-weak text-pending', dot: 'bg-pending' },
  active: { labelKey: 'pf.status.active', chip: 'bg-action-soft text-action', dot: 'bg-action' },
  overdue: { labelKey: 'pf.status.overdue', chip: 'bg-danger-weak text-danger', dot: 'bg-danger' },
  done: { labelKey: 'pf.status.done', chip: 'bg-success-weak text-success', dot: 'bg-success' },
  unknown: { labelKey: 'pf.status.unknown', chip: 'bg-surface-subtle text-fg-secondary', dot: 'bg-fg-muted' },
}

const th = 'px-2 py-2 font-semibold'

export function PortfolioTable({ rows, leadersDegraded, locale }: {
  rows: PortfolioRow[]; leadersDegraded: boolean; locale: Locale
}) {
  const tr = (k: DictKey) => t(locale, k)
  if (rows.length === 0) {
    return (
      <SectionCard title={tr('pf.table.title')} icon={Briefcase}>
        <MiniEmpty text={tr('pf.empty')} />
      </SectionCard>
    )
  }
  return (
    <SectionCard title={tr('pf.table.title')} icon={Briefcase}
      actions={<CountBadge n={rows.length} unit={tr('pf.unit')} />}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-meta leading-4 text-fg-muted">
              <th className={th}>{tr('pf.col.signal')}</th>
              <th className={th}>{tr('pf.col.project')}</th>
              <th className={th}>{tr('pf.col.progress')}</th>
              <th className={`${th} text-right`}>{tr('pf.col.variance')}</th>
              <th className={`${th} text-right`}>{tr('pf.col.spi')}</th>
              <th className={th}>{tr('pf.col.end')}</th>
              <th className={th}>{tr('pf.col.workload')}</th>
              <th className={th}>{tr('pf.col.milestone')}</th>
              <th className={th}>{tr('pf.col.pm')}</th>
              <th className={th}>{tr('pf.col.status')}</th>
              <th className="px-2 py-2" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const s = STATUS_CHIP[row.lifecycle]
              const signal = row.exec?.overall.signal ?? 'neutral'
              const m = SIGNAL_META[signal]
              const Icon = m.icon
              const ms = row.exec?.milestone ?? null
              const sched = row.exec?.schedule ?? null
              return (
                <tr key={row.projectId} className="border-b border-border/60 transition hover:bg-surface-subtle/60">
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-semibold ${m.chip}`}>
                        <Icon className="h-3.5 w-3.5" aria-hidden />{tr(SIGNAL_LABEL[signal])}
                      </span>
                      {row.riskCount > 0 && (
                        <span
                          title={row.riskTitles.join(' · ')}
                          className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-meta font-bold tabular-nums ${row.riskWorst === 'red' ? 'bg-danger-weak text-danger' : 'bg-pending-weak text-warning'}`}
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden />{row.riskCount}
                        </span>
                      )}
                      {row.hygiene && !row.hygiene.clean && (
                        <span
                          title={`${tr('pf.hygiene.noOwner')} ${row.hygiene.noOwner} · ${tr('pf.hygiene.noDates')} ${row.hygiene.noDates} · ${tr('pf.hygiene.mixedWeight')} ${row.hygiene.mixedWeight}`}
                          className="inline-flex items-center rounded-full bg-surface-subtle px-1.5 py-0.5 text-meta font-semibold text-fg-muted"
                        >
                          {tr('pf.hygiene.label')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[220px] px-2 py-2.5">
                    <Link href={`/p/${row.projectId}/dashboard`}
                      className="inline-flex items-center gap-1.5 font-semibold text-fg hover:text-action hover:underline">
                      {row.isPrivate && <Lock className="h-3 w-3 shrink-0 text-fg-muted" aria-label={tr('pf.private')} />}
                      <span className="truncate">{row.name}</span>
                    </Link>
                    {row.baseDate && (
                      <div className="mt-0.5 text-meta text-fg-muted">{tr('pf.baseDate')} {fmtDate(row.baseDate)}</div>
                    )}
                  </td>
                  {row.degraded ? (
                    <td colSpan={6} className="px-2 py-2.5 text-meta text-danger">{tr('pf.degradedRow')}</td>
                  ) : !row.exec ? (
                    <>
                      <td className="px-2 py-2.5"><span className="text-fg-muted">—</span></td>
                      <td className="px-2 py-2.5 text-right"><span className="text-fg-muted">—</span></td>
                      <td className="px-2 py-2.5 text-right"><span className="text-fg-muted">—</span></td>
                      <td className="px-2 py-2.5"><span className="text-fg-muted">—</span></td>
                      <td className="px-2 py-2.5"><span className="text-fg-muted">—</span></td>
                      <td className="px-2 py-2.5"><span className="text-fg-muted">—</span></td>
                    </>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        <span className="font-semibold text-fg">{row.exec!.progress.actual}%</span>
                        <span className="text-fg-muted"> / {row.exec!.progress.planned}%</span>
                      </td>
                      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-semibold tabular-nums ${row.exec!.progress.variance < 0 ? 'text-danger' : 'text-success'}`}>
                        {row.exec!.progress.variance > 0 ? '+' : ''}{row.exec!.progress.variance}%p
                        {row.trendDelta != null && row.trendDelta !== 0 && (
                          <span
                            title={tr('pf.trend.tooltip')}
                            className={`ml-1 text-meta font-semibold ${row.trendDelta < 0 ? 'text-danger' : 'text-success'}`}
                          >
                            {row.trendDelta < 0 ? '▼' : '▲'}{Math.abs(row.trendDelta)}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right tabular-nums text-fg">
                        {row.spi != null ? row.spi.toFixed(2) : (
                          <span
                            title={tr(
                              row.exec!.schedule.label === 'done' ? 'pf.spi.done'
                                : row.exec!.schedule.label === 'none' ? 'pf.spi.none'
                                  : 'pf.spi.early',
                            )}
                            className="text-fg-muted"
                          >—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        {sched?.projectedEnd ? (
                          <>
                            <span className="text-fg">{fmtDate(sched.projectedEnd)}</span>
                            {sched.slipDays != null && (
                              <span className={`ml-1 text-meta font-semibold ${sched.slipDays > 0 ? 'text-danger' : 'text-success'}`}>
                                {sched.slipDays > 0 ? `+${sched.slipDays}` : sched.slipDays}d
                              </span>
                            )}
                          </>
                        ) : <span className="text-fg-muted">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5 tabular-nums">
                        <span className={row.exec!.risk.delayed > 0 ? 'font-semibold text-danger' : 'text-fg-muted'}>{row.exec!.risk.delayed}</span>
                        <span className="text-fg-muted"> · </span>
                        <span className={row.exec!.risk.dueSoon > 0 ? 'font-semibold text-fg' : 'text-fg-muted'}>{row.exec!.risk.dueSoon}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2.5">
                        {ms?.name ? (
                          <div className="flex max-w-[180px] items-baseline gap-1">
                            <span className={`min-w-0 truncate ${ms.overdue ? 'text-danger' : 'text-fg'}`}>{ms.name}</span>
                            <span className={`shrink-0 text-meta font-semibold tabular-nums ${ms.overdue ? 'text-danger' : 'text-fg'}`}>
                              {ms.dday != null && (ms.dday >= 0 ? `D-${ms.dday}` : `D+${-ms.dday}`)}
                            </span>
                          </div>
                        ) : <span className="text-fg-muted">—</span>}
                      </td>
                    </>
                  )}
                  <td className="px-2 py-2.5 text-fg-secondary">
                    <div className="max-w-[140px] truncate">
                      {leadersDegraded ? tr('pf.leadersUnknown') : (row.leaders.join(', ') || '—')}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className={`chip ${s.chip} whitespace-nowrap`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                      {tr(s.labelKey)}
                    </span>
                  </td>
                  <td className="px-2 py-2.5">
                    <Link href={`/p/${row.projectId}/dashboard`} aria-label={`${row.name} 대시보드`}
                      className="text-fg-muted transition hover:text-action">
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}
