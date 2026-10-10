'use client'

import { CalendarRange, FileText, GripVertical, Pin, PinOff, Search } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import { formatPct1, formatPp1 } from '@/lib/domain/format'
import type { DictKey } from '@/lib/i18n/dict'
import type { ShownSchedule } from '@/lib/domain/wbsDerived'
import { useLocale } from '@/components/providers/LocaleProvider'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { LevelBadge, OwnerBadges, STATUS, fmtDate } from './shared'

export function WbsProgressLens({
  item,
  number,
  shown,
  parentPath,
  pinned,
  onTogglePin,
  levelLabels,
  dragHandleProps,
}: {
  item: ComputedItem | null
  /** 개요 번호(표의 번호 열과 같은 값) — 저장 code 는 보이지 않는다(BUG-05) */
  number?: string
  /** 표시 일정(BUG-12) — 직접 입력이 없는 상위 행은 하위의 min/max */
  shown?: ShownSchedule
  parentPath: string[]
  pinned: boolean
  onTogglePin: () => void
  /** 프로젝트별 depth 라벨(§7.3 ProjectConfig) — 상위(WbsGanttSheet)가 서버 페이지에서 받아 전파. */
  levelLabels: string[]
  /** 창 이동 그립에 얹을 포인터 핸들러 — 위치 상태는 상위(WbsGanttSheet)가 소유한다. */
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
}) {
  const { t } = useLocale()

  if (!item) {
    return (
      <div
        data-wbs-progress-lens-guide
        className="pointer-events-auto flex min-h-12 w-full max-w-2xl items-center justify-center gap-2 rounded-2xl border border-action/25 bg-surface/95 px-4 py-3 text-sm font-medium text-fg-secondary shadow-[var(--shadow-lg)] backdrop-blur-md"
      >
        <Search aria-hidden className="h-4 w-4 text-action" />
        {t('wbs.progressLensGuide')}
      </div>
    )
  }

  const variance = item.rolledActualPct - item.plannedPct
  const varianceTone = variance < 0 ? 'text-danger' : variance > 0 ? 'text-success' : 'text-fg-secondary'
  const pathLabel = [parentPath.join(' › '), number ?? ''].filter(Boolean).join(' · ')

  return (
    <section
      data-wbs-progress-lens-card
      data-item-id={item.id}
      data-pinned={pinned ? 'true' : 'false'}
      aria-label={t('wbs.progressLens')}
      aria-live="polite"
      className="pointer-events-auto max-h-[min(42dvh,360px)] w-full max-w-5xl overflow-y-auto rounded-2xl border border-action/25 bg-surface/95 p-4 shadow-[var(--shadow-xl)] backdrop-blur-md"
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-action-soft text-action">
              <Search aria-hidden className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2 text-xs text-fg-muted">
                <LevelBadge depth={item.depth} isOwnerSplit={item.isOwnerSplit} levelLabels={levelLabels} t={t} />
                <span data-lens-field="path" className="truncate">{pathLabel}</span>
              </div>
              <h3 data-lens-field="name" className="mt-1 truncate text-lg font-bold tracking-tight text-fg">
                {item.name}
              </h3>
            </div>
            {dragHandleProps && (
              <span
                data-wbs-progress-lens-drag
                {...dragHandleProps}
                aria-hidden
                className="flex h-8 shrink-0 cursor-grab touch-none items-center rounded-lg px-1 text-fg-muted hover:bg-border hover:text-fg active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" />
              </span>
            )}
            <button
              type="button"
              data-wbs-progress-lens-pin
              onClick={onTogglePin}
              aria-pressed={pinned}
              className={`btn h-8 shrink-0 px-2.5 text-meta ${
                pinned ? 'border border-border-focus bg-action-soft text-action' : 'btn-ghost'
              }`}
            >
              {pinned
                ? <PinOff aria-hidden className="h-3.5 w-3.5" />
                : <Pin aria-hidden className="h-3.5 w-3.5" />}
              {t(pinned ? 'wbs.progressLensUnpin' : 'wbs.progressLensPin')}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span data-lens-field="status" className={`chip ${STATUS[item.status].chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS[item.status].dot}`} />
              {t(`status.${item.status}` as DictKey)}
            </span>
            <div data-lens-field="owners" className="flex items-center gap-1.5 rounded-lg bg-surface-subtle px-2 py-1">
              <span className="text-meta font-medium text-fg-muted">{t('wbs.colOwners')}</span>
              {item.owners.length
                ? <OwnerBadges owners={item.owners} />
                : <span className="text-xs text-fg-muted">{t('wbs.unassigned')}</span>}
            </div>
            {/* 날짜는 돋보기의 핵심 정보 — text-xs 는 작아서 안 보인다는 피드백(2026-08-21)으로 키움 */}
            <span data-lens-field="schedule" className="inline-flex items-center gap-1.5 text-base font-semibold tabular-nums text-fg">
              <CalendarRange aria-hidden className="h-4 w-4 text-fg-muted" />
              {fmtDate(shown ? shown.start : item.plannedStart)} ~ {fmtDate(shown ? shown.end : item.plannedEnd)}
            </span>
          </div>

          <div data-lens-field="deliverable" className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-fg-secondary">
            <FileText aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-muted" />
            <span className="shrink-0 font-medium">{t('wbs.colDeliverable')}</span>
            <span className="truncate text-fg">{item.deliverable ?? t('common.none')}</span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface-subtle/60 p-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <LensStat
              field="planned"
              label={t('wbs.colPlannedPct')}
              value={`${formatPct1(item.plannedPct)}%`}
            />
            <LensStat
              field="actual"
              label={t('wbs.colActualPct')}
              value={`${formatPct1(item.rolledActualPct)}%`}
              emphasis
            />
            <LensStat
              field="delta"
              label={t('wbs.progressVariance')}
              value={`${formatPp1(variance)}%p`}
              valueClassName={varianceTone}
            />
            <LensStat
              field="achievement"
              label={t('wbs.colAchievement')}
              value={item.achievement == null ? '—' : `${formatPct1(item.achievement)}%`}
            />
          </div>
          <div className="mt-3 space-y-2.5">
            <div data-lens-bar="planned" className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
              <span className="text-meta font-semibold text-fg-muted">{t('wbs.colPlannedPct')}</span>
              <ProgressBar
                value={item.plannedPct}
                tone="bg-fg-secondary"
                height="h-2"
                label={`${item.name} ${t('wbs.colPlannedPct')} ${formatPct1(item.plannedPct)}%`}
              />
            </div>
            <div data-lens-bar="actual" className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-2">
              <span className="text-meta font-semibold text-fg-muted">{t('wbs.colActualPct')}</span>
              <ProgressBar
                value={item.rolledActualPct}
                tone={STATUS[item.status].bar}
                height="h-2.5"
                label={`${item.name} ${t('wbs.colActualPct')} ${formatPct1(item.rolledActualPct)}%`}
              />
            </div>
          </div>
          <div className="mt-2 text-right text-meta text-fg-muted">
            {pinned ? t('wbs.progressLensPinned') : t('wbs.progressLensEscHint')}
          </div>
        </div>
      </div>
    </section>
  )
}

function LensStat({
  field,
  label,
  value,
  emphasis = false,
  valueClassName = 'text-fg',
}: {
  field: 'planned' | 'actual' | 'delta' | 'achievement'
  label: string
  value: string
  emphasis?: boolean
  valueClassName?: string
}) {
  return (
    <div data-lens-field={field} className="min-w-0 rounded-lg bg-surface px-2.5 py-2">
      <div className="truncate text-meta font-medium text-fg-muted">{label}</div>
      <div className={`${emphasis ? 'text-xl' : 'text-base'} mt-0.5 font-bold leading-none tabular-nums ${valueClassName}`}>
        {value}
      </div>
    </div>
  )
}
