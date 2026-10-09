'use client'

import { useId, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Calendar, ArrowRight, X, Clock } from 'lucide-react'
import { useDialogFocus } from '@/lib/ui/useDialogFocus'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'
import { shiftBusinessDays } from '@/lib/domain/dependencySchedule'
import type { DayCal } from '@/lib/domain/progress'
import type { ComputedItem, TaskDependency } from '@/lib/domain/types'

export interface GanttImpactConfirmDialogProps {
  open: boolean
  item: ComputedItem | null
  originalStart: string
  originalEnd: string
  proposedStart: string
  proposedEnd: string
  dependencies: TaskDependency[]
  calendar: DayCal
  itemById: Map<string, ComputedItem>
  onConfirm: () => void
  onCancel: () => void
  isSaving?: boolean
}

/**
 * 간트 바 드래그 완료 시 선후행 영향 검토 다이얼로그 (D6-§8-gantt, Q08)
 * - 자동 후속 이동(전파) 없이 선후행 일정 충돌/영향을 사용자에게 미리 보여주고 명시적 확인 후 적용
 * - 날짜 폼이 드래그 없는 대체 경로로 병행 제공됨
 */
export function GanttImpactConfirmDialog({
  open,
  item,
  originalStart,
  originalEnd,
  proposedStart,
  proposedEnd,
  dependencies,
  itemById,
  calendar,
  onConfirm,
  onCancel,
  isSaving = false,
}: GanttImpactConfirmDialogProps) {
  const dialogId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  useDialogFocus(panelRef, open)
  useEscHandler(onCancel, { priority: ESC_PRIORITY.MODAL, enabled: open && !isSaving })

  // 선행 및 후행 작업 영향 분석
  const impacts = useMemo(() => {
    if (!item) return { predecessors: [], successors: [], unverified: 0 }

    const itemDeps = dependencies.filter(
      d => d.predecessorId === item.id || d.successorId === item.id,
    )

    const preds: Array<{ item: ComputedItem; conflict: boolean; message: string }> = []
    const succs: Array<{ item: ComputedItem; conflict: boolean; message: string }> = []

    for (const dep of itemDeps) {
      if (dep.successorId === item.id) {
        // dep.predecessorId -> item.id
        const pred = itemById.get(dep.predecessorId)
        const anchor = dep.type === 'SS' ? pred?.plannedStart : pred?.plannedEnd
        if (pred && anchor) {
          const requiredStart = shiftBusinessDays(anchor, dep.lagDays + (dep.type === 'FS' ? 1 : 0), calendar)
          const conflict = requiredStart > proposedStart
          preds.push({
            item: pred,
            conflict,
            message: conflict
              ? `선행 ${dep.type} 제약의 최소 시작일(${requiredStart})보다 시작일(${proposedStart})이 앞섭니다.`
              : `정상 연결 (${dep.type}, 최소 ${requiredStart} 시작)`,
          })
        }
      } else if (dep.predecessorId === item.id) {
        // item.id -> dep.successorId
        const succ = itemById.get(dep.successorId)
        if (succ && succ.plannedStart) {
          const requiredStart = shiftBusinessDays(dep.type === 'SS' ? proposedStart : proposedEnd, dep.lagDays + (dep.type === 'FS' ? 1 : 0), calendar)
          const conflict = succ.plannedStart < requiredStart
          succs.push({
            item: succ,
            conflict,
            message: conflict
              ? `후행 작업 시작일(${succ.plannedStart})이 ${dep.type} 제약의 최소 시작일(${requiredStart})보다 앞섭니다.`
              : `정상 연결 (${dep.type}, 최소 ${requiredStart} 시작)`,
          })
        }
      }
    }

    return { predecessors: preds, successors: succs, unverified: itemDeps.length - preds.length - succs.length }
  }, [item, dependencies, itemById, proposedStart, proposedEnd, calendar])

  const hasConflicts =
    impacts.predecessors.some(p => p.conflict) || impacts.successors.some(s => s.conflict) || impacts.unverified > 0

  if (!open || !item) return null

  const content = (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
      data-testid="gantt-impact-dialog"
      className="fixed inset-0 z-(--z-modal) flex items-start justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div className="my-auto flex shrink-0 flex-col w-full max-w-lg max-h-[max(300px,calc(100dvh-2rem))] rounded-2xl border border-border bg-surface-raised shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        {/* 헤더 */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                hasConflicts ? 'bg-warning-weak text-warning' : 'bg-action/10 text-action'
              }`}
            >
              {hasConflicts ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <Calendar className="h-5 w-5" />
              )}
            </div>
            <div>
              <h2 id={`${dialogId}-title`} className="text-base font-semibold text-fg">
                간트 일정 변경 검토
              </h2>
              <p className="text-xs text-fg-muted truncate max-w-xs">{item.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel} disabled={isSaving}
            className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          {/* 변경 일정 비교 박스 */}
          <div className="rounded-xl border border-border bg-surface-subtle p-3.5 flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-medium text-fg-muted block">원래 일정</span>
              <span className="font-semibold text-fg-secondary">
                {originalStart} ~ {originalEnd}
              </span>
            </div>
            <ArrowRight className="h-4 w-4 text-fg-muted shrink-0 mx-2" />
            <div className="space-y-1 text-right">
              <span className="text-xs font-medium text-action block">변경 예정 일정</span>
              <span className="font-semibold text-fg font-mono">
                {proposedStart} ~ {proposedEnd}
              </span>
            </div>
          </div>

          {/* 선후행 의존 영향 */}
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-fg-muted">
              <Clock className="h-3.5 w-3.5" />
              선후행 의존 영향 검토
            </h4>

            {impacts.predecessors.length === 0 && impacts.successors.length === 0 ? (
              <div className="p-3 rounded-lg border border-border/60 bg-surface text-fg-muted text-xs">
                {impacts.unverified ? '연결된 작업의 일정 정보가 부족해 영향을 확인할 수 없습니다. 날짜를 확인해 주세요.' : '연결된 선후행 의존성이 없어 다른 작업 일정에 영향을 주지 않습니다.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {impacts.predecessors.map(p => (
                  <div
                    key={p.item.id}
                    data-testid="impact-predecessor"
                    className={`p-2.5 rounded-lg border text-xs ${
                      p.conflict
                        ? 'border-warning bg-warning-weak dark:bg-warning-weak text-warning dark:text-warning'
                        : 'border-border/60 bg-surface text-fg-secondary'
                    }`}
                  >
                    <div className="font-medium truncate">[선행] {p.item.name}</div>
                    <div className="mt-0.5 text-xs opacity-90">{p.message}</div>
                  </div>
                ))}

                {impacts.successors.map(s => (
                  <div
                    key={s.item.id}
                    data-testid="impact-successor"
                    className={`p-2.5 rounded-lg border text-xs ${
                      s.conflict
                        ? 'border-warning bg-warning-weak dark:bg-warning-weak text-warning dark:text-warning'
                        : 'border-border/60 bg-surface text-fg-secondary'
                    }`}
                  >
                    <div className="font-medium truncate">[후행] {s.item.name}</div>
                    <div className="mt-0.5 text-xs opacity-90">{s.message}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {impacts.unverified > 0 && (impacts.predecessors.length > 0 || impacts.successors.length > 0) && <p role="alert" className="text-warning">연결된 {impacts.unverified}개 작업의 일정 정보가 부족해 영향을 확인할 수 없습니다.</p>}
          <p className="text-xs text-fg-muted bg-surface-subtle/50 p-2.5 rounded-lg border border-border/40">
            * 자동 후속 이동(전파)을 하지 않으며, 작업 일정을 개별적으로 보존합니다.
          </p>
        </div>

        {/* 푸터 */}
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 py-4 border-t border-border bg-surface-subtle/50">
          <button
            type="button"
            onClick={onCancel} disabled={isSaving}
            className="min-h-11 rounded-xl border border-border bg-surface px-4 text-xs font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving}
            data-testid="gantt-impact-confirm-btn"
            className="min-h-11 rounded-xl bg-action px-4 text-xs font-semibold text-action-fg transition-colors hover:bg-action-hover"
          >
            {isSaving ? '저장 중...' : '일정 변경 적용'}
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(content, document.body)
}
