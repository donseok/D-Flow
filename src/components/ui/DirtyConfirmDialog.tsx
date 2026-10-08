'use client'

import { useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'

export interface DirtyConfirmDialogProps {
  open: boolean
  title?: string
  description?: string
  discardText?: string
  continueText?: string
  onDiscard: () => void
  onContinue: () => void
}

/**
 * 이탈 방어 대화상자 (D6-§7-exit)
 * 폼/인스펙터/모달에서 수정 사항이 있는 상태로 닫기나 이탈을 시도할 때 확인을 요청합니다.
 */
export function DirtyConfirmDialog({
  open,
  title,
  description,
  discardText,
  continueText,
  onDiscard,
  onContinue,
}: DirtyConfirmDialogProps) {
  const { t } = useLocale()
  const continueBtnRef = useRef<HTMLButtonElement>(null)

  // Esc 입력 시 '계속 편집'으로 안전하게 닫음 (최우선 순위로 하위 모달의 닫힘을 방지)
  useEscHandler(
    () => {
      onContinue()
    },
    { priority: ESC_PRIORITY.PICKER + 10, enabled: open }
  )

  useEffect(() => {
    if (open) {
      continueBtnRef.current?.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const getLabel = (key: DictKey, fallback: string) => {
    const val = t(key)
    return !val || val === key ? fallback : val
  }

  const resolvedTitle = title ?? getLabel('common.unsavedChanges', '저장되지 않은 변경사항')
  const resolvedDesc =
    description ??
    getLabel(
      'common.unsavedChangesDesc',
      '저장하지 않은 변경사항이 있습니다. 나가시겠습니까? 변경사항은 취소됩니다.'
    )
  const resolvedDiscard = discardText ?? getLabel('common.discardAndLeave', '변경사항 버리기')
  const resolvedContinue = continueText ?? getLabel('common.continueEditing', '계속 편집')

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={resolvedTitle}
      className="fixed inset-0 z-(--z-modal-alert) flex items-center justify-center p-4"
    >
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onContinue}
        aria-hidden="true"
      />
      <div className="relative z-10 w-full max-w-sm rounded-(--radius-panel) border border-border bg-surface-raised p-5 shadow-(--shadow-modal) animate-in fade-in zoom-in-95">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning-weak text-warning">
            <AlertTriangle className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-fg">{resolvedTitle}</h3>
            <p className="mt-1 text-sm text-fg-secondary leading-relaxed">{resolvedDesc}</p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            ref={continueBtnRef}
            type="button"
            onClick={onContinue}
            className="rounded-(--radius-control) border border-border-input bg-surface px-3.5 py-1.5 text-sm font-medium text-fg shadow-xs transition-[color,background-color,border-color,box-shadow] duration-(--motion-fast) hover:bg-surface-hover hover:border-border-focus/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          >
            {resolvedContinue}
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="rounded-(--radius-control) bg-danger px-3.5 py-1.5 text-sm font-medium text-danger-fg shadow-xs transition-[color,background-color,opacity,box-shadow] duration-(--motion-fast) hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
          >
            {resolvedDiscard}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
