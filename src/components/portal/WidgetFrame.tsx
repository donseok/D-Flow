import type { ReactNode } from 'react'
import Link from 'next/link'
import { WidgetHideButton } from './WidgetHideButton'
import type { PortalWidgetId } from '@/lib/portal/widgets'

/** 위젯 틀(스펙 §6.1) — section[data-widget], h2, 머리에 '더 보기' 링크와 숨기기(개인). 숨기기만 클라이언트다 */
export function WidgetFrame({ id, title, workspaceId, hidden, more, tabs, children }: {
  id: PortalWidgetId; title: string; workspaceId: string; hidden: readonly PortalWidgetId[]
  more?: { href: string; label: string }; tabs?: ReactNode; children: ReactNode
}) {
  return (
    <section data-widget={id} aria-labelledby={`widget-${id}`} className="min-w-0 rounded-(--radius-panel) border border-border/80 bg-surface p-4.5 shadow-xs">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id={`widget-${id}`} className="text-section text-fg">{title}</h2>
        {tabs}
        <span className="ml-auto flex items-center gap-1">
          {more && <Link href={more.href} className="text-meta font-semibold text-action hover:underline">{more.label}</Link>}
          <WidgetHideButton workspaceId={workspaceId} widgetId={id} hidden={hidden} title={title} />
        </span>
      </div>
      {children}
    </section>
  )
}
