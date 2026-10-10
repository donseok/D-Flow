'use client'

import type { LucideIcon } from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'

export type SegTab<T extends string = string> = { key: T; label: string; icon?: LucideIcon }

/** 세그먼트 토글 — 칸반 그룹/뷰 전환, 근태 캘린더/리스트 등.
 *  모든 항목이 .seg-item 을 단다 — 선택 체크(::before)가 그 규칙에 있고, 비활성 항목은 숨은 체크로 같은 폭을 잡는다(스펙 §4.1 블록 8). */
export function SegmentedTabs<T extends string>({
  tabs, value, onChange, size = 'md', label,
}: {
  tabs: SegTab<T>[]
  value: T
  onChange: (key: T) => void
  size?: 'sm' | 'md'
  label?: string
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const selectedIndex = Math.max(0, tabs.findIndex(tab => tab.key === value))
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-control' : 'px-3.5 py-2 text-control'
  function move(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    const tab = tabs[next]
    buttons.current.get(tab.key)?.focus()
    onChange(tab.key)
  }
  return (
    // 좁은 화면에서 항목이 눌려 글자 단위로 줄바꿈되지 않게 한다 — 항목은 한 줄을 지키고 넘치면 줄 안에서 가로로 민다
    <div className="seg max-w-full overflow-x-auto" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const active = tab.key === value
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            type="button"
            ref={node => { if (node) buttons.current.set(tab.key, node); else buttons.current.delete(tab.key) }}
            role="tab"
            tabIndex={index === selectedIndex ? 0 : -1}
            aria-selected={active}
            onKeyDown={e => move(e, index)}
            onClick={() => onChange(tab.key)}
            className={`seg-item shrink-0 whitespace-nowrap ${pad} ${active ? 'seg-item-active' : ''}`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
