'use client'
// 팝오버 키보드 계약(개정 §5.10.2, E25) — 열면 첫 항목 초점, Esc·바깥 클릭이면 닫고 트리거로 초점이 돌아온다
import { useCallback, useEffect, useRef, useState } from 'react'

const ITEM = '[role="menuitem"],[role="menuitemradio"],[role="option"],a[href],button:not([disabled])'
export function usePopover() {
  const [open, setOpenRaw] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const setOpen = useCallback((v: boolean) => { setOpenRaw(v); if (!v) triggerRef.current?.focus() }, [])
  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(ITEM)?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown) }
  }, [open, setOpen])
  return { open, setOpen, triggerRef, panelRef }
}
