'use client'
import { ChevronsUpDown } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { MyWorkspace } from '@/lib/workspace/list'
import type { WorkspaceRef } from '@/lib/workspace/constants'
import { usePopover } from './usePopover'

/** 워크스페이스 전환기(★6, D4) — 목록은 소속만. 고르면 /w/<새 slug> 로(프로젝트 id·필터를 가져가지 않는다) */
export function WorkspaceSwitcher({ current, workspaces, viewingAsPlatformAdmin }: { current: WorkspaceRef; workspaces: MyWorkspace[]; viewingAsPlatformAdmin: boolean }) {
  const router = useRouter()
  const { open, setOpen, triggerRef, panelRef } = usePopover()
  const list = workspaces.length >= 2
  const name = <span className="truncate text-control font-semibold text-fg">{current.name}</span>
  return (
    <div className="relative flex min-w-0 items-center gap-2">
      {list ? (
        <button ref={triggerRef} type="button" data-ws-switcher="list" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
          className="flex min-w-0 items-center gap-1.5 rounded-(--radius-control) px-2 py-1 hover:bg-surface-hover">
          {name}<ChevronsUpDown size={14} aria-hidden className="shrink-0 text-fg-secondary" />
        </button>
      ) : <span className="flex min-w-0 px-2">{name}</span>}
      {viewingAsPlatformAdmin && <span className="shrink-0 rounded-full bg-warning-weak px-2 py-0.5 text-meta font-semibold text-warning">플랫폼 관리자로 보는 중</span>}
      {list && open && (
        <div ref={panelRef} role="menu" aria-label="워크스페이스" className="absolute left-0 top-full z-(--z-popover) mt-1 min-w-56 rounded-(--radius-panel) border border-border bg-surface-raised p-1 shadow-(--shadow-popover)"
          onKeyDown={(e) => {
            const items = [...(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
            const i = items.indexOf(document.activeElement as HTMLElement)
            if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
            if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
            if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
            if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
          }}>
          {workspaces.map((w) => (
            <button key={w.id} type="button" role="menuitemradio" aria-checked={w.id === current.id}
              onClick={() => { setOpen(false); if (w.id !== current.id) router.push(`/w/${encodeURIComponent(w.slug)}`) }}
              className="flex w-full items-center justify-between gap-3 rounded-(--radius-control) px-3 py-2 text-left text-control hover:bg-surface-hover focus:bg-surface-hover">
              <span className="truncate">{w.name}</span>{w.id === current.id && <span aria-hidden className="text-action">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
