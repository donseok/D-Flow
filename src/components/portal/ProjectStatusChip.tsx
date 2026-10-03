import { AlertTriangle, CheckCircle2, Circle, CircleDot, CircleHelp, type LucideIcon } from 'lucide-react'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'

/** 프로젝트 생애 상태 칩(스펙 §6.1·§6.2) — weak 배경 + 본색 글 + 아이콘(색만으로 뜻을 전하지 않는다 — 글을 늘 함께). 새 토큰 이름만 */
const TONE: Record<ProjectLifecycleStatus, { labelKey: DictKey; cls: string; Icon: LucideIcon }> = {
  ready: { labelKey: 'home.status_ready', cls: 'bg-pending-weak text-pending', Icon: Circle },
  active: { labelKey: 'home.status_active', cls: 'bg-progress-weak text-progress', Icon: CircleDot },
  overdue: { labelKey: 'home.status_overdue', cls: 'bg-danger-weak text-danger', Icon: AlertTriangle },
  done: { labelKey: 'home.status_done', cls: 'bg-success-weak text-success', Icon: CheckCircle2 },
  unknown: { labelKey: 'home.status_unknown', cls: 'bg-surface-subtle text-fg-secondary', Icon: CircleHelp },
}

export function ProjectStatusChip({ status, locale = 'ko' }: { status: ProjectLifecycleStatus; locale?: Locale }) {
  const { labelKey, cls, Icon } = TONE[status]
  return (
    <span data-project-status={status} className={`chip shrink-0 ${cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {t(locale, labelKey)}
    </span>
  )
}
