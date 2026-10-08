import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon, title, description, action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="card flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center transition-all">
      {Icon && (
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-action/20 bg-action-soft text-action ring-8 ring-action-soft/40">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <h3 className="mt-4 text-section font-semibold text-fg tracking-tight">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-body text-fg-secondary leading-relaxed">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
