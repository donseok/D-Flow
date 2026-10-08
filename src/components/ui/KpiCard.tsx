import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type Tone = 'default' | 'brand' | 'success' | 'warning' | 'danger'

const TONE: Record<Tone, { value: string; iconWrap: string }> = {
  default: { value: 'text-fg', iconWrap: 'bg-surface-subtle text-fg-secondary border border-border/50' },
  brand: { value: 'text-action', iconWrap: 'bg-action-soft text-action border border-action/20' },
  success: { value: 'text-success', iconWrap: 'bg-success-weak text-success border border-success/20' },
  warning: { value: 'text-warning', iconWrap: 'bg-warning-weak text-warning border border-warning/20' },
  danger: { value: 'text-danger', iconWrap: 'bg-danger-weak text-danger border border-danger/20' },
}

/** variant='hero' 의 아이콘 색 — 히어로가 밝은 표면이 된 뒤(SP3b UI-1)라 본색과 같다. 변형 삭제는 UI-2b 어댑터 몫 */
const HERO_ICON: Record<Tone, string> = {
  default: 'text-fg-secondary',
  brand: 'text-action',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

/** KPI 카드 — 히어로 우측 레일 또는 그리드에 사용. label 위, 큰 value, 보조 sub.
 *  variant='hero'면 다크 히어로 패널 안에 들어가는 글래스 스타일(밝은 글씨). */
export function KpiCard({
  label, value, sub, icon: Icon, tone = 'default', variant = 'surface', children,
}: {
  label: string
  value: ReactNode
  sub?: string
  icon?: LucideIcon
  tone?: Tone
  variant?: 'surface' | 'hero'
  children?: ReactNode
}) {
  if (variant === 'hero') {
    return (
      <div className="rounded-(--radius-panel) border border-border bg-surface-subtle p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-meta font-semibold text-fg-secondary">{label}</div>
            <div className="mt-1.5 text-kpi font-semibold leading-none tabular-nums tracking-tight text-fg">{value}</div>
            {sub && <div className="mt-1.5 text-xs text-fg-secondary leading-normal">{sub}</div>}
          </div>
          {Icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-(--radius-control) border border-border bg-surface ${HERO_ICON[tone]}`}><Icon className="h-4 w-4" /></span>}
        </div>
        {children}
      </div>
    )
  }

  const tw = TONE[tone]
  return (
    <div className="kpi-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-meta font-semibold text-fg-muted">{label}</div>
          <div className={`mt-1.5 text-kpi font-semibold leading-none tabular-nums tracking-tight ${tw.value}`}>{value}</div>
          {sub && <div className="mt-1.5 text-xs text-fg-secondary leading-normal">{sub}</div>}
        </div>
        {Icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tw.iconWrap}`}><Icon className="h-4 w-4" /></span>}
      </div>
      {children}
    </div>
  )
}
