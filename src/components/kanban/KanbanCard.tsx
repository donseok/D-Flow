'use client'

import type { DragEvent, KeyboardEvent } from 'react'
import { CalendarRange, GripVertical, Minus, Plus, Check, RotateCcw, Play, Loader2, AlertCircle, RotateCw, X } from 'lucide-react'
import type { ComputedItem } from '@/lib/domain/types'
import type { DueSignal, ProgressBucket } from '@/lib/domain/kanban'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OwnerBadges, STATUS } from '@/components/wbs/shared'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 칸반 카드 — 실행 보드용. 본문 클릭=WBS 딥링크, 진행중은 +/− 스텝퍼, 시작전=착수, 완료=재개.
 *  드래그(진행 뷰·편집권한)로 버킷 이동. 이동 실패 시 의도한 위치 보존 및 재시도 액션 제공(D6-§2-kanban). */
export function KanbanCard({
  card, bucket, pathLabel, due,
  draggable = false, dragging = false, editable = false, saving = false, failed,
  onOpen, onStart, onStep, onComplete, onReopen, onDragStart, onDragEnd,
}: {
  card: ComputedItem
  bucket: ProgressBucket
  pathLabel?: string
  due?: DueSignal
  draggable?: boolean
  dragging?: boolean
  editable?: boolean
  saving?: boolean
  /** 이동 실패 상태 및 재시도/취소 액션 (D6-§2-kanban) */
  failed?: {
    error: string
    onRetry: () => void
    onDismiss: () => void
  }
  onOpen?: () => void
  onStart?: () => void
  onStep?: (delta: number) => void
  onComplete?: () => void
  onReopen?: () => void
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd?: (e: DragEvent<HTMLDivElement>) => void
}) {
  const { t } = useLocale()
  const accent = STATUS[card.status].bar
  const pct = Math.round(card.rolledActualPct)
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  const openKey = onOpen
    ? (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }
    : undefined

  const dueBadge = due && (
    <span className={`badge ${due.kind === 'overdue' ? 'bg-delayed-weak text-delayed' : 'bg-surface-2 text-ink-muted'}`}>
      {due.kind === 'overdue'
        ? `${t('kanban.overduePrefix')}${due.days}${t('kanban.overdueSuffix')}`
        : due.days === 0 ? t('kanban.ddayToday') : `${t('kanban.ddayPrefix')}${due.days}`}
    </span>
  )

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative shrink-0 overflow-hidden rounded-xl border p-3.5 shadow-sm transition
        ${failed ? 'border-warning/80 bg-warning/5 ring-1 ring-warning/30' : 'border-line bg-surface'}
        ${draggable ? 'cursor-grab select-none hover:border-line-strong hover:shadow-md active:cursor-grabbing' : ''}
        ${dragging ? 'opacity-40' : ''}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden />
      {draggable && (
        <GripVertical className="pointer-events-none absolute right-2 top-2 h-3.5 w-3.5 text-ink-subtle opacity-0 transition group-hover:opacity-100" aria-hidden />
      )}

      {/* 본문(클릭=WBS 딥링크) */}
      <div
        data-card-body
        role={onOpen ? 'button' : undefined}
        tabIndex={onOpen ? 0 : undefined}
        aria-label={onOpen ? `${card.name} — ${t('kanban.card.actual')} ${pct}%. ${t('kanban.openInWbs')}` : undefined}
        onClick={onOpen}
        onKeyDown={openKey}
        className={`pl-1.5 ${onOpen ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-ring rounded' : ''}`}
      >
        {pathLabel && <p className="mb-1 truncate text-[10px] font-medium uppercase tracking-wide text-ink-subtle" title={pathLabel}>{pathLabel}</p>}
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink" title={card.name}>{card.name}</p>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-subtle">
          <CalendarRange className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{card.plannedEnd ?? '—'}</span>
          {dueBadge}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <ProgressBar value={card.rolledActualPct} tone={accent} height="h-1.5" label={`${card.name} ${t('kanban.card.actual')}`} />
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-ink-muted">{pct}%</span>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <OwnerBadges owners={card.owners} />
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" aria-label={t('kanban.saving')} />}
        </div>
      </div>

      {/* 액션 행(편집 권한 · 진행 뷰). 본문 클릭과 분리 위해 stopPropagation. */}
      {editable && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5" onClick={stop}>
          {bucket === 'not_started' && onStart && (
            <button className="btn btn-ghost h-7 px-2 text-[12px] gap-1" disabled={saving} onClick={onStart}><Play className="h-3.5 w-3.5" />{t('kanban.start')}</button>
          )}
          {bucket === 'in_progress' && (
            <>
              {onStep && <button className="btn btn-ghost h-7 px-2 text-[12px]" aria-label={t('kanban.decrease')} disabled={saving} onClick={() => onStep(-10)}><Minus className="h-3.5 w-3.5" /></button>}
              {onStep && <button className="btn btn-ghost h-7 px-2 text-[12px]" aria-label={t('kanban.increase')} disabled={saving} onClick={() => onStep(10)}><Plus className="h-3.5 w-3.5" /></button>}
              {onComplete && <button className="btn btn-ghost h-7 px-2 text-[12px] ml-auto gap-1 text-done" disabled={saving} onClick={onComplete}><Check className="h-3.5 w-3.5" />{t('kanban.complete')}</button>}
            </>
          )}
          {bucket === 'done' && onReopen && (
            <button className="btn btn-ghost h-7 px-2 text-[12px] gap-1" disabled={saving} onClick={onReopen}><RotateCcw className="h-3.5 w-3.5" />{t('kanban.reopen')}</button>
          )}
        </div>
      )}

      {/* 이동 실패 및 재시도 액션 (D6-§2-kanban) */}
      {failed && (
        <div data-testid="kanban-failed-move" className="mt-2.5 rounded-lg bg-surface border border-warning/30 p-2 text-xs" onClick={stop}>
          <div className="flex items-start gap-1.5 text-warning font-medium">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="leading-tight">{failed.error || '이동 저장에 실패했습니다.'}</span>
          </div>
          <div className="mt-2 flex items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={failed.onDismiss}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-fg-secondary hover:bg-surface-hover text-xs"
            >
              <X className="h-3 w-3" />
              <span>원위치</span>
            </button>
            <button
              type="button"
              onClick={failed.onRetry}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded bg-warning text-warning-fg font-medium px-2 py-1 text-xs hover:bg-warning/90"
            >
              <RotateCw className={`h-3 w-3 ${saving ? 'animate-spin' : ''}`} />
              <span>재시도</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
