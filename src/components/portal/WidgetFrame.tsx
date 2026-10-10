import type { ReactNode } from 'react'
import Link from 'next/link'
import type { PortalWidgetId } from '@/lib/portal/widgets'

/**
 * 위젯 틀(스펙 §6.1) — section[data-widget], h2, 머리에 '더 보기' 링크. 서버 컴포넌트다.
 * 빼기·옮기기·크기는 틀이 아니라 홈 격자(HomeGrid)의 편집 모드가 맡는다 — 옛 숨기기 버튼은 그 안으로 흡수됐다(2026-10-10).
 */
export function WidgetFrame({ id, title, more, tabs, note, children }: {
  id: PortalWidgetId; title: string
  more?: { href: string; label: string }; tabs?: ReactNode
  /** 머리 오른쪽의 요약 한 줄(건수 등) */
  note?: ReactNode; children: ReactNode
}) {
  return (
    <section data-widget={id} aria-labelledby={`widget-${id}`} className="h-full min-w-0 rounded-(--radius-panel) border border-border bg-surface p-4.5 shadow-(--shadow-card)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id={`widget-${id}`} className="text-section text-fg">{title}</h2>
        {tabs}
        <span className="ml-auto flex items-center gap-3">
          {note && <span className="text-meta tabular-nums text-fg-secondary">{note}</span>}
          {more && <Link href={more.href} className="text-meta font-semibold text-action hover:underline">{more.label}</Link>}
        </span>
      </div>
      {children}
    </section>
  )
}
