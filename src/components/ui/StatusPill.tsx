'use client'

import { Circle, CircleDot, AlertTriangle, CheckCircle2, type LucideIcon } from 'lucide-react'
import type { Status } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'

/** 상태 tone — weak 배경 + 본색 글자 + 아이콘(색만으로 전달하지 않는다, 개정 §5.5.4). 정의 파생 인터페이스는 SP5b */
export const STATUS_TONE: Record<Status, { cls: string; Icon: LucideIcon }> = {
  not_started: { cls: 'bg-pending-weak text-pending', Icon: Circle },
  in_progress: { cls: 'bg-progress-weak text-progress', Icon: CircleDot },
  delayed: { cls: 'bg-danger-weak text-danger', Icon: AlertTriangle },
  done: { cls: 'bg-success-weak text-success', Icon: CheckCircle2 },
}

/** 상태 칩 — 라벨은 locale 사전(status.*)에서 표시. */
export function StatusPill({ status }: { status: Status }) {
  const { t } = useLocale()
  const { cls, Icon } = STATUS_TONE[status]
  return (
    <span className={`chip tabular-nums ${cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {t(`status.${status}` as DictKey)}
    </span>
  )
}
