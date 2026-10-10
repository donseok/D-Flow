'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'

export interface SettingsNavItem { id: string; label: string }

/**
 * 설정 화면 껍데기(개정 §5.9.3, SP3b 스펙 §6.4) — 왼쪽 범주 목차(현재 범주 aria-current)·필드 검색, 본문 최대 폭 800,
 * 저장 바 높이만큼 본문 아래 여백과 입력의 스크롤 여백을 예약한다(마지막 입력·오류가 바에 가리지 않게 — W19).
 * 초점 스크롤은 크로미움이 요소의 scroll-margin 을 따르지 않아(UI-2b BB4 실측) 감싼 main 의 scroll-padding-bottom 도 같은 값으로 맞춘다.
 * 목차는 lg 이상에서 붙되 전역 바에 맞닿지 않게 1rem 띄운다(UI-2b 이월). 범주·섹션 저장·검증은 각 편집기(C)의 것이고 여기서 바꾸지 않는다.
 */
export function SettingsShell({ items, children }: { items: SettingsNavItem[]; children: ReactNode }) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null)
  const root = useRef<HTMLDivElement>(null)
  const content = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const needle = query.trim().toLocaleLowerCase()
    for (const section of content.current?.querySelectorAll<HTMLElement>('section[data-settings-search]') ?? []) {
      const haystack = `${section.dataset.settingsSearch ?? ''} ${section.textContent ?? ''}`.toLocaleLowerCase()
      section.hidden = !!needle && !haystack.includes(needle)
    }
  }, [query, children])
  useEffect(() => {                                            // 현재 범주 — 화면 위쪽 30% 띠에 걸친 범주 가운데 목차 순서로 마지막(막 들어온 범주)
    if (typeof IntersectionObserver === 'undefined') return
    const inBand = new Set<string>()
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) { const id = (e.target as HTMLElement).id; if (e.isIntersecting) inBand.add(id); else inBand.delete(id) }
      const last = [...items].reverse().find((it) => inBand.has(it.id))   // 끝까지 내리면 짧은 마지막 범주도 현재가 된다
      if (last) setActive(last.id)
    }, { rootMargin: '0px 0px -70% 0px' })
    for (const it of items) { const el = document.getElementById(it.id); if (el) io.observe(el) }
    return () => io.disconnect()
  }, [items])
  useEffect(() => {                                            // 저장 바 높이 → --settings-save-bar-h(+ main 의 초점 스크롤 여백)
    const box = content.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const main = root.current?.closest('main') ?? null
    const previousPadding = main?.style.scrollPaddingBottom ?? ''
    const bars = new Set<Element>()
    const heights = new Map<Element, number>()
    const reserve = () => {
      const h = Math.ceil(Math.max(0, ...heights.values()))
      root.current?.style.setProperty('--settings-save-bar-h', `${h}px`)
      if (main) main.style.scrollPaddingBottom = bars.size ? `${h + 8}px` : previousPadding
    }
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (bars.has(e.target)) heights.set(e.target, e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height)
      }
      reserve()
    })
    // 영역 편집 폼처럼 서버 children 변경 없이 뒤늦게 생기는 저장 바도 관찰한다(U3-3 P2-1).
    const sync = () => {
      const next = new Set(box.querySelectorAll<HTMLElement>('[data-save-bar]'))
      for (const b of bars) if (!next.has(b as HTMLElement)) { ro.unobserve(b); bars.delete(b); heights.delete(b) }
      for (const b of next) if (!bars.has(b)) {
        bars.add(b); heights.set(b, b.getBoundingClientRect().height); ro.observe(b, { box: 'border-box' })
      }
      reserve()
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-save-bar'] })
    return () => { mo.disconnect(); ro.disconnect(); if (main) main.style.scrollPaddingBottom = previousPadding }
  }, [children])

  return <div ref={root} style={{ '--settings-save-bar-h': '0px' } as CSSProperties} className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
    <aside className="space-y-3 rounded-(--radius-panel) border border-border bg-surface shadow-(--shadow-card) p-4 lg:sticky lg:top-[calc(var(--frame-sticky-top)+1rem)]" aria-label={t('settings.shell.toc')}>
      <label htmlFor="settings-search" className="block text-meta font-semibold text-fg">{t('settings.shell.search')}</label>
      <input id="settings-search" type="search" className="app-input w-full text-sm" value={query}
        onChange={event => setQuery(event.target.value)} placeholder={t('settings.shell.searchPh')} />
      <nav aria-label={t('settings.shell.categories')} className="flex flex-wrap gap-1 lg:flex-col">
        {items.map(item => <a key={item.id} href={`#${item.id}`} aria-current={active === item.id ? 'location' : undefined}
          onClick={() => setActive(item.id)}
          className={`rounded-(--radius-control) px-3 py-2 text-sm ${active === item.id ? 'bg-action-soft font-semibold text-action-hover' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'}`}>
          {item.label}
        </a>)}
      </nav>
    </aside>
    <div ref={content} className="min-w-0 max-w-[800px] space-y-5 pb-(--settings-save-bar-h) [&_input]:scroll-mb-(--settings-save-bar-h) [&_textarea]:scroll-mb-(--settings-save-bar-h) [&_select]:scroll-mb-(--settings-save-bar-h)">{children}</div>
  </div>
}
