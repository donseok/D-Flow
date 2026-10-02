'use client'
import { useEffect, useRef, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, X } from 'lucide-react'
import type { NavGroup, NavItemId } from '@/lib/nav/registry'
import { activeNavItem } from '@/lib/nav/active'
import { NavList } from './NavList'
import { focusablesIn, trapTab } from './focusTrap'

/**
 * 모바일 드로어(§5.4.5) — 1024 미만(부모가 그 폭에서만 연다). dialog·aria-modal·초점 가둠·Esc·배경 클릭으로 닫힘.
 * 열 때 초점이 있던 곳(햄버거)으로 닫을 때 돌려주고, 열린 채 경로가 바뀌면(드로어 안 링크로 이동) 닫는다.
 */
export function MobileNavDrawer({ open, onClose, workspaceSwitcher, groups, pathname, workspaceHome, projectSwitcher, badges }: {
  open: boolean; onClose(): void; workspaceSwitcher: ReactNode; groups: readonly NavGroup[]; pathname: string
  workspaceHome: string | null; projectSwitcher: ReactNode; badges: Partial<Record<NavItemId, number | null>>
}) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement as HTMLElement | null
    focusablesIn(ref.current)[0]?.focus()
    return () => { opener.current?.focus?.() }
  }, [open])
  useEffect(() => {
    if (open && lastPath.current !== pathname) onClose()
    lastPath.current = pathname
  }, [open, pathname, onClose])
  // 열린 채 1024 이상으로 넓어지면 닫는다 — 그 폭에는 사이드바가 있고 드로어(모달)가 남으면 화면을 가린다(Z11)
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(min-width: 1024px)')
    if (mq.matches) { onClose(); return }
    const on = (e: { matches: boolean }) => { if (e.matches) onClose() }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [open, onClose])
  if (!open) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    trapTab(e, ref.current)
  }
  return (
    <div data-drawer-backdrop className="fixed inset-0 z-(--z-overlay) bg-fg/30" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="메뉴" tabIndex={-1} onKeyDown={onKey}
        className="flex h-full w-72 max-w-[85vw] flex-col gap-2 overflow-y-auto border-r border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">{workspaceSwitcher}</div>
          <button type="button" aria-label="메뉴 닫기" onClick={onClose} className="rounded-(--radius-control) p-2 hover:bg-surface-hover"><X size={18} aria-hidden /></button>
        </div>
        {workspaceHome && <Link href={workspaceHome} className="flex items-center gap-2 px-3 py-2 text-control text-fg-secondary"><ArrowLeft size={16} aria-hidden />워크스페이스 홈</Link>}
        {projectSwitcher}
        <NavList groups={groups} activeId={activeNavItem(pathname, groups)} collapsed={false} badges={badges} />
      </div>
    </div>
  )
}
