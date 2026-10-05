'use client'

import { Edit3, X, CheckSquare } from 'lucide-react'

export interface WbsBulkBarProps {
  selectedCount: number
  totalCount: number
  onOpenBulkEdit: () => void
  onClearSelection: () => void
  onOpenPaste?: () => void
  onSelectAll?: () => void
  isAllSelected?: boolean
}

/**
 * WBS 대량 작업 플로팅 바 (UX-08, D6-§8-bulk)
 * - 그리드에서 1개 이상의 행이 체크박스로 선택되었을 때 화면 하단에 표시
 * - '선택한 N개' 정보, '전체 선택' 전환 버튼, '대량 수정' 실행 버튼 및 '선택 해제' 제공
 */
export function WbsBulkBar({
  selectedCount,
  totalCount,
  onOpenBulkEdit,
  onClearSelection,
  onSelectAll,
  onOpenPaste,
  isAllSelected = false,
}: WbsBulkBarProps) {
  if (selectedCount <= 0) return null

  return (
    <div
      role="region"
      aria-label="대량 작업 바"
      data-testid="wbs-bulk-bar"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl flex-wrap justify-center items-center gap-3 rounded-2xl border border-border bg-surface-raised/95 px-5 py-2.5 shadow-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-200"
    >
      <div className="flex items-center gap-2 pr-2 border-r border-border text-fg">
        <CheckSquare className="h-4 w-4 text-action" />
        <span className="text-sm font-medium">
          <strong className="font-semibold text-fg" data-testid="wbs-bulk-selected-count">
            {selectedCount}
          </strong>
          개 선택됨
        </span>
      </div>

      {!isAllSelected && onSelectAll && totalCount > selectedCount && (
        <button
          type="button"
          onClick={onSelectAll}
          data-testid="wbs-bulk-select-all-btn"
          className="min-h-11 px-2 text-xs font-medium text-action hover:underline rounded transition-colors"
        >
          결과 전체 {totalCount}개 선택
        </button>
      )}

      <button
        type="button"
        onClick={onOpenBulkEdit}
        data-testid="wbs-bulk-edit-btn"
        className="flex min-h-11 items-center gap-1.5 rounded-full bg-action px-3.5 text-xs font-semibold text-action-fg shadow-xs hover:bg-action-hover transition-colors"
      >
        <Edit3 className="h-3.5 w-3.5" />
        대량 수정
      </button>

      {onOpenPaste && <button type="button" onClick={onOpenPaste} className="min-h-11 rounded-full border border-border px-3 text-xs font-semibold">붙여넣기</button>}
      <button
        type="button"
        onClick={onClearSelection}
        data-testid="wbs-bulk-clear-btn"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg transition-colors"
        title="선택 해제"
        aria-label="선택 해제"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
