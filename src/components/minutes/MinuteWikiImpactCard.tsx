'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { formatStampIn } from '@/lib/i18n/format'

export type MinuteWikiSyncStatus =
  | 'unlinked'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'partial'
  | 'failed'

export type MinuteWikiImpactCounts = {
  created: number
  changed: number
  reaffirmed: number
  conflicted: number
}

export type MinuteWikiImpactItem = {
  id: string
  title: string
  href: string
  kindLabel?: string | null
  change: keyof MinuteWikiImpactCounts
}

export type MinuteWikiImpactCardProps = {
  status: MinuteWikiSyncStatus
  counts: MinuteWikiImpactCounts
  items: MinuteWikiImpactItem[]
  wikiHref?: string | null
  projectName?: string | null
  processedAt?: string | null
  embedded?: boolean
}

const COUNT_STYLE: Record<keyof MinuteWikiImpactCounts, string> = {
  created: 'bg-success-weak text-success',
  changed: 'bg-progress-weak text-progress',
  reaffirmed: 'bg-surface-subtle text-fg-secondary',
  conflicted: 'bg-danger-weak text-danger',
}

function statusStyle(status: MinuteWikiSyncStatus) {
  switch (status) {
    case 'ready':
      return {
        chip: 'bg-success-weak text-success',
        dot: 'bg-success',
        icon: CheckCircle2,
        label: 'min.wiki.status.ready' as const,
      }
    case 'partial':
      return {
        chip: 'bg-warning/15 text-warning',
        dot: 'bg-warning',
        icon: AlertTriangle,
        label: 'min.wiki.status.partial' as const,
      }
    case 'failed':
      return {
        chip: 'bg-danger-weak text-danger',
        dot: 'bg-danger',
        icon: AlertTriangle,
        label: 'min.wiki.status.failed' as const,
      }
    case 'processing':
      return {
        chip: 'bg-progress-weak text-progress',
        dot: 'bg-progress',
        icon: LoaderCircle,
        label: 'min.wiki.status.processing' as const,
      }
    case 'queued':
      return {
        chip: 'bg-surface-subtle text-fg-secondary',
        dot: 'bg-fg-muted',
        icon: Clock3,
        label: 'min.wiki.status.queued' as const,
      }
    default:
      return {
        chip: 'bg-surface-subtle text-fg-secondary',
        dot: 'bg-fg-muted',
        icon: BookOpen,
        label: 'min.wiki.status.unlinked' as const,
      }
  }
}

function countLabel(change: keyof MinuteWikiImpactCounts) {
  switch (change) {
    case 'created': return 'min.wiki.count.created' as const
    case 'changed': return 'min.wiki.count.changed' as const
    case 'reaffirmed': return 'min.wiki.count.reaffirmed' as const
    case 'conflicted': return 'min.wiki.count.conflicted' as const
  }
}

function statusDescription(status: MinuteWikiSyncStatus) {
  switch (status) {
    case 'unlinked': return 'min.wiki.desc.unlinked' as const
    case 'queued': return 'min.wiki.desc.queued' as const
    case 'processing': return 'min.wiki.desc.processing' as const
    case 'failed': return 'min.wiki.desc.failed' as const
    default: return 'min.wiki.desc.ready' as const
  }
}

function processedDate(value: string, timeZone: string | null) {
  if (Number.isNaN(new Date(value).getTime())) return value
  return formatStampIn(value, timeZone)
}

export function MinuteWikiImpactCard({
  status,
  counts,
  items,
  wikiHref,
  projectName,
  processedAt,
  embedded = false,
  timeZone,
}: MinuteWikiImpactCardProps & {
  /** 처리 시각의 시간대 — 서버가 내려준 회의록 범위 tz(계획 P8, A-4 리뷰 N7). null 이면 범위 달력을 읽지 못한 것 — 시각은 '—' */
  timeZone: string | null
}) {
  const { t } = useLocale()
  const meta = statusStyle(status)
  const StatusIcon = meta.icon
  const countEntries = (Object.keys(counts) as (keyof MinuteWikiImpactCounts)[])

  return (
    <section className={embedded ? 'min-w-0' : 'card shrink-0 p-4'} aria-labelledby="minute-wiki-title">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-4 w-4 text-action" aria-hidden />
        <h2 id="minute-wiki-title" className="text-sm font-bold text-fg">
          {t('min.wiki.title')}
        </h2>
        {projectName && <span className="text-xs text-fg-secondary">{projectName}</span>}
        <span className={`chip ${meta.chip}`}>
          <StatusIcon
            className={`h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`}
            aria-hidden
          />
          {t(meta.label)}
        </span>
        {wikiHref && (
          <Link href={wikiHref} className="ml-auto inline-flex items-center gap-1 text-xs text-action hover:text-action-hover">
            {t('min.wiki.open')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>

      <p className="mt-1 text-xs text-fg-secondary">{t(statusDescription(status))}</p>

      {status !== 'unlinked' && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {countEntries.map(change => (
            <div key={change} className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-meta text-fg-muted">{t(countLabel(change))}</p>
              <p className={`mt-0.5 inline-flex rounded-md px-1.5 py-0.5 text-sm font-bold tabular-nums ${COUNT_STYLE[change]}`}>
                {counts[change]}
              </p>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="eyebrow mb-1">{t('min.wiki.affected')}</p>
          <ul className="space-y-1">
            {items.map(item => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-surface-subtle"
                >
                  <span className={`chip shrink-0 ${COUNT_STYLE[item.change]}`}>
                    {t(countLabel(item.change))}
                  </span>
                  {item.kindLabel && (
                    <span className="shrink-0 text-xs text-fg-muted">{item.kindLabel}</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-fg">{item.title}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(status === 'ready' || status === 'partial') && items.length === 0 && (
        <p className="mt-3 rounded-lg bg-surface-subtle px-3 py-2 text-xs text-fg-secondary">
          {t('min.wiki.noChanges')}
        </p>
      )}

      {processedAt && (
        <p className="mt-2 text-right text-meta tabular-nums text-fg-muted">
          {t('min.wiki.processedAt')} {processedDate(processedAt, timeZone)}
        </p>
      )}
    </section>
  )
}
