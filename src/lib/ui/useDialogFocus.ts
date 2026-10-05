'use client'

import { useEffect, type RefObject } from 'react'

/** 독립 다이얼로그의 포커스 트랩/복원. 저장 중 disabled 전환에도 Tab이 외부로 빠지지 않는다. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open || !ref.current) return
    const panel = ref.current
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.closest('[hidden],[aria-hidden="true"]'))
    document.body.style.overflow = 'hidden'
    ;(controls()[0] ?? panel).focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const nodes = controls()
      const first = nodes[0]
      const last = nodes.at(-1)
      if (!nodes.length || !panel.contains(document.activeElement)) {
        event.preventDefault(); (first ?? panel).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (previous?.isConnected) previous.focus()
    }
  }, [open, ref])
}
