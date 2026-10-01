'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface SettingsNavItem { id: string; label: string }

/** 서버에서 그린 범주를 유지하면서 목차와 필드 검색만 클라이언트에서 제어한다. */
export function SettingsShell({ items, children }: { items: SettingsNavItem[]; children: ReactNode }) {
  const [query, setQuery] = useState('')
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase()
    for (const section of content.current?.querySelectorAll<HTMLElement>('section[data-settings-search]') ?? []) {
      const haystack = `${section.dataset.settingsSearch ?? ''} ${section.textContent ?? ''}`.toLocaleLowerCase()
      section.hidden = !!needle && !haystack.includes(needle)
    }
  }, [query, children])

  return <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <aside className="space-y-3 rounded-xl border border-line bg-surface p-4 lg:sticky lg:top-24" aria-label="설정 목차">
      <label htmlFor="settings-search" className="block text-xs font-semibold text-ink">설정 검색</label>
      <input id="settings-search" type="search" className="app-input w-full text-sm" value={query}
        onChange={event => setQuery(event.target.value)} placeholder="이름·설명·설정 키" />
      <nav aria-label="설정 범주" className="flex flex-wrap gap-1 lg:flex-col">
        {items.map(item => <a key={item.id} href={`#${item.id}`} className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface-2 hover:text-ink">
          {item.label}
        </a>)}
      </nav>
    </aside>
    <div ref={content} className="min-w-0 space-y-5">{children}</div>
  </div>
}
