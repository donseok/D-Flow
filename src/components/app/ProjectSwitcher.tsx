'use client'
import { useId, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import { MODULE_LABEL } from '@/lib/modules/labels'
import { withObjectParticle } from '@/lib/i18n/particle'
import type { ModuleId } from '@/lib/modules/defaults'
import type { ShellProject } from '@/lib/data/portal'

const STATUS_LABEL: Record<string, string> = { ready: '준비', active: '진행', done: '완료', overdue: '지연', unknown: '확인 불가' }
const DEGRADED_TOAST = '설정을 불러오지 못해 개요를 열었습니다'

/**
 * 프로젝트 전환기(★6, D41) — 셸이 가진 그 워크스페이스 목록을 클라이언트에서 거른다(⌘K 와 다르다). 고르면 서버가 같은 모듈 유지를 판정한다.
 * 즐겨찾기·최근 id 는 목록(현재 워크스페이스의 가시 프로젝트)에 있는 것만 그린다 — 다른 워크스페이스·숨김 프로젝트 id 는 조용히 빠진다(W14).
 */
export function ProjectSwitcher({ currentProjectId, projects, favoriteIds, recentIds, projectsFailed = false }: {
  currentProjectId: string | null; projects: ShellProject[]; favoriteIds: string[]; recentIds: string[]
  /** 셸 목록 조회 실패 — '일치하는 프로젝트가 없습니다' 대신 실패 문구(3원칙 ①) */
  projectsFailed?: boolean
}) {
  const router = useRouter(); const pathname = usePathname(); const sp = useSearchParams(); const { toast } = useToast()
  const listId = useId(); const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [active, setActive] = useState(0)
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const sections = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const match = (p: ShellProject) => p.name.toLowerCase().includes(needle)
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((p): p is ShellProject => !!p && match(p))
    return [
      { label: '즐겨찾기', items: pick(favoriteIds) },
      { label: '최근 방문', items: pick(recentIds.filter((id) => !favoriteIds.includes(id))) },
      { label: '전체', items: projects.filter(match) },
    ].filter((s) => s.items.length > 0)
  }, [q, projects, favoriteIds, recentIds, byId])
  const flat = sections.flatMap((s) => s.items.map((p) => ({ section: s.label, p })))
  const optId = (i: number) => `${listId}-o${i}`

  async function choose(p: ShellProject) {
    setOpen(false)
    const query = sp.toString() ? `?${sp.toString()}` : ''
    const url = `/api/nav/switch-target?project=${encodeURIComponent(p.id)}&path=${encodeURIComponent(pathname)}&query=${encodeURIComponent(query)}`
    try {
      const res = await fetch(url, { cache: 'no-store' })
      // 404 = 숨김·워크스페이스 밖(존재 은닉) — 설정 판독 실패로 알리지 않고 이동하지 않는다. 401 = 세션 만료 → 로그인(Z8)
      if (res.status === 404) { toast({ title: '이 프로젝트를 열 수 없습니다', variant: 'info' }); return }
      if (res.status === 401) { router.push('/login'); return }
      if (!res.ok) throw new Error(`switch-target ${res.status}`)
      const body = (await res.json()) as { href: string; fallbackModule: ModuleId | null; degraded?: true }
      router.push(body.href)
      if (body.degraded) toast({ title: DEGRADED_TOAST, variant: 'info' })
      else if (body.fallbackModule) toast({ title: `이 프로젝트에서는 ${withObjectParticle(MODULE_LABEL[body.fallbackModule] ?? body.fallbackModule)} 사용하지 않아 개요를 열었습니다.`, variant: 'info' })
    } catch (e) {
      console.error('[ProjectSwitcher] 전환 대상 판정 실패 — 개요로:', e instanceof Error ? e.message : e)
      router.push(`/p/${encodeURIComponent(p.id)}/dashboard`)
      toast({ title: DEGRADED_TOAST, variant: 'info' })
    }
  }

  const last = Math.max(flat.length - 1, 0)
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + (open ? 1 : 0), last)); setOpen(true) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Home') { e.preventDefault(); setOpen(true); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setOpen(true); setActive(last) }
    else if (e.key === 'Enter') { e.preventDefault(); if (!open) { setOpen(true); return } const hit = flat[active]; if (hit) void choose(hit.p) }
    else if (e.key === 'Escape') { if (open) e.stopPropagation(); setOpen(false) }
  }
  let n = -1
  return (
    <div className="relative mb-2 px-1">
      <input role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && flat.length ? optId(Math.min(active, last)) : undefined} aria-label="프로젝트 전환"
        value={q} placeholder={currentProjectId ? byId.get(currentProjectId)?.name ?? '프로젝트' : '프로젝트'}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onKeyDown={onKey}
        className="h-9 w-full rounded-(--radius-control) border border-border-input bg-surface px-3 text-control" />
      {open && (
        <div id={listId} role="listbox" aria-label="프로젝트" className="absolute left-1 right-1 top-full z-(--z-popover) mt-1 max-h-80 overflow-y-auto rounded-(--radius-panel) border border-border bg-surface-raised p-1 shadow-(--shadow-popover)">
          {projectsFailed
            ? <div data-projects-failed className="px-2 py-1.5 text-meta text-danger">프로젝트 목록을 불러오지 못했습니다</div>
            : sections.length === 0 && <div className="px-2 py-1.5 text-meta text-fg-secondary">일치하는 프로젝트가 없습니다</div>}
          {sections.map((s) => (
            <div key={s.label} role="group" aria-label={s.label}>
              <div aria-hidden className="px-2 pb-0.5 pt-2 text-meta font-semibold text-fg-secondary">{s.label}</div>
              {s.items.map((p) => { n += 1; const i = n; return (
                <div key={`${s.label}-${p.id}`} id={optId(i)} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); void choose(p) }}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-(--radius-control) px-2 py-1.5 text-control ${i === active ? 'bg-surface-selected' : ''}`}>
                  <span className="truncate">{p.name}</span><span className="shrink-0 text-meta text-fg-secondary">{STATUS_LABEL[p.status] ?? p.status}</span>
                </div>) })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
