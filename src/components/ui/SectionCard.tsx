import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

/** 타이틀 헤더가 있는 카드 컨테이너. eyebrow 는 선택 — 없으면 제목이 아이콘 높이 가운데에 온다. */
export function SectionCard({
  eyebrow, title, icon: Icon, actions, children, className = '', id, searchText,
}: {
  eyebrow?: string
  title: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  id?: string
  searchText?: string
}) {
  return (
    <section id={id} data-settings-search={searchText} className={`card scroll-mt-24 p-5 sm:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {Icon && (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-action/20 bg-action-soft text-action">
              <Icon className="h-4 w-4" />
            </span>
          )}
          <div>
            {eyebrow && <div className="text-meta font-semibold text-fg-muted">{eyebrow}</div>}
            <h3 className={`${eyebrow ? 'mt-0.5 ' : ''}text-sm font-semibold tracking-tight text-fg`}>{title}</h3>
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}
