'use client'

import { Circle, CircleDot, AlertTriangle, CheckCircle2, PauseCircle, type LucideIcon } from 'lucide-react'
import type { Status } from '@/lib/domain/types'
import type { DictKey } from '@/lib/i18n/dict'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  DEFAULT_ISSUE_STATUSES, VOCAB_COLOR_CLASS, vocabLabel, type IssueCategory, type IssueStatusDef,
} from '@/lib/settings/vocab'

/** 상태 tone — weak 배경 + 본색 글자 + 아이콘(색만으로 전달하지 않는다, 개정 §5.5.4). */
export const STATUS_TONE: Record<Status, { cls: string; Icon: LucideIcon }> = {
  not_started: { cls: 'bg-pending-weak text-pending', Icon: Circle },
  in_progress: { cls: 'bg-progress-weak text-progress', Icon: CircleDot },
  delayed: { cls: 'bg-danger-weak text-danger', Icon: AlertTriangle },
  done: { cls: 'bg-success-weak text-success', Icon: CheckCircle2 },
}

/** 해석된 상태 정의(SP5b D8, 개정 §3.5 `{ id, label, category, tone, icon }`) — 설정이 정한 표시 상태를 그린다. tone 은 칩 클래스 */
export interface StatusPillDef {
  id: string
  label: string
  category?: string
  tone: string
  Icon: LucideIcon
  /** 비활성 표시 상태 — 기존 행만 이 상태에 남는다 */
  inactive?: boolean
}

/**
 * 상태 칩. 두 꼴(SP5b D8 — 유니언 props):
 * - `{ status }` — WBS 일정 상태(제품 고정 4종), 라벨은 사전(status.*)
 * - `{ def }` — 해석된 정의(이슈 표시 상태 등). 라벨·tone·아이콘을 정의에서 받는다
 */
export function StatusPill(props: { status: Status } | { def: StatusPillDef }) {
  const { t } = useLocale()
  if ('def' in props) {
    const { def } = props
    return (
      <span className={`chip tabular-nums ${def.tone}`} data-status={def.id}>
        <def.Icon className="h-3 w-3 shrink-0" aria-hidden />
        {def.label}
        {def.inactive ? <span className="text-meta opacity-75">{t('issue.status.inactiveBadge')}</span> : null}
      </span>
    )
  }
  const { cls, Icon } = STATUS_TONE[props.status]
  return (
    <span className={`chip tabular-nums ${cls}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {t(`status.${props.status}` as DictKey)}
    </span>
  )
}

/** 이슈 범주별 아이콘(제품 고정 4범주 — 색만으로 전달하지 않는다) */
export const ISSUE_CATEGORY_ICON: Readonly<Record<IssueCategory, LucideIcon>> = {
  open: Circle,
  in_progress: CircleDot,
  on_hold: PauseCircle,
  resolved: CheckCircle2,
}

/**
 * 이슈 표시 상태 → 칩 정의. code 가 없으면 범주 code.
 * defs 가 없으면(프로젝트 정의를 싣지 않는 화면 — 회의록 칩·포털·옛 픽스처, 비평 반영 — S23) **범주**로 그린다: 제품 기본 4정의의 그 범주 행.
 * 정의에 없는 code(지워진 상태)는 code 를 라벨로, 색은 neutral, 아이콘은 범주에서.
 */
export function issueStatusPillDef(
  t: (k: DictKey) => string, category: IssueCategory, code?: string | null, defs?: readonly IssueStatusDef[] | null,
): StatusPillDef {
  const list = defs ?? DEFAULT_ISSUE_STATUSES
  const c = defs ? (code ?? category) : category
  const def = list.find((d) => d.code === c)
  return {
    id: c,
    label: vocabLabel('workflow.issue_statuses', list, c, t),
    category,
    tone: VOCAB_COLOR_CLASS[def?.color ?? 'neutral'].chip,
    Icon: ISSUE_CATEGORY_ICON[category],
    inactive: def ? !def.active : false,
  }
}

/** 이슈 표시 상태 칩 — 이슈 목록·상세·회의록 칩·포털이 같이 쓴다 */
export function IssueStatusPill({ category, code, defs }: { category: IssueCategory; code?: string | null; defs?: readonly IssueStatusDef[] | null }) {
  const { t } = useLocale()
  return <StatusPill def={issueStatusPillDef(t, category, code, defs)} />
}
