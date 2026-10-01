'use client'

import type { LucideIcon } from 'lucide-react'

export type SegTab<T extends string = string> = { key: T; label: string; icon?: LucideIcon }

/** 세그먼트 토글 — 칸반 그룹/뷰 전환, 근태 캘린더/리스트 등.
 *  모든 항목이 .seg-item 을 단다 — 선택 체크(::before)가 그 규칙에 있고, 비활성 항목은 숨은 체크로 같은 폭을 잡는다(스펙 §4.1 블록 8). */
export function SegmentedTabs<T extends string>({
  tabs, value, onChange, size = 'md',
}: {
  tabs: SegTab<T>[]
  value: T
  onChange: (key: T) => void
  size?: 'sm' | 'md'
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-3.5 py-2 text-sm'
  return (
    <div className="seg" role="tablist">
      {tabs.map(tab => {
        const active = tab.key === value
        const Icon = tab.icon
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={`seg-item ${pad} ${active ? 'seg-item-active' : ''}`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
