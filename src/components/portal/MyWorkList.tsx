import Link from 'next/link'
import { CalendarClock, CircleAlert, ListChecks, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { MyWorkKind, MyWorkRow } from '@/lib/portal/myWork'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { t, type DictKey} from '@/lib/i18n/dict'

export const KIND_LABEL_KEY: Record<MyWorkKind, DictKey> = { wbs: 'portalUi.kind.wbs', issue: 'portalUi.kind.issue', approval: 'portalUi.kind.approval', meeting: 'portalUi.kind.meeting' }
const KIND_ICON: Record<MyWorkKind, LucideIcon> = { wbs: ListChecks, issue: CircleAlert, approval: ShieldCheck, meeting: CalendarClock }

/**
 * 내 업무 행(56px) — 행 전체가 링크. 종류는 아이콘 + 읽히는 글(sr-only), 상태는 중립 칩(진척 %·이슈 상태·'검토 대기'·시각),
 * 기한 지남은 색만이 아니라 글자로도 알린다
 */
export function MyWorkList({ rows, failedKinds, empty, bare = false }: {
  rows: MyWorkRow[]; failedKinds: MyWorkKind[]; empty: string
  /** 이미 카드(위젯 틀) 안에 놓일 때 — 테두리·그림자를 또 두르지 않는다 */
  bare?: boolean
}) {
  return (
    <div className="space-y-2">
      {failedKinds.length > 0 && (
        <StatusMessage kind="partial_error" compact title={t('portalUi.work.partialFailed').replace('{kinds}', failedKinds.map((k) => t(KIND_LABEL_KEY[k])).join('·'))} />
      )}
      {rows.length === 0 ? (empty ? <StatusMessage kind="empty" compact title={empty} /> : null) : (
        <ul className={`divide-y divide-border ${bare ? '-mx-2' : 'rounded-(--radius-panel) border border-border bg-surface shadow-(--shadow-card)'}`}>
          {rows.map((r) => {
            const Icon = KIND_ICON[r.kind]
            return (
              <li key={`${r.kind}:${r.id}`}>
                <Link href={r.href} className={`flex min-h-14 items-center gap-3 py-2 hover:bg-surface-hover ${bare ? 'rounded-(--radius-control) px-2' : 'px-4'}`}>
                  <Icon className="h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
                  <span className="sr-only">{t(KIND_LABEL_KEY[r.kind])}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-fg">{r.title}</span>
                    <span className="block truncate text-meta text-fg-secondary">{r.projectName}</span>
                  </span>
                  <span className="chip shrink-0 bg-surface-subtle text-fg-secondary">{r.status}</span>
                  <span className={`w-28 shrink-0 text-right text-meta tabular-nums ${r.overdueDays ? 'font-semibold text-danger' : 'text-fg-secondary'}`}>
                    {r.due ?? t('portalUi.work.noDue')}{r.overdueDays ? t('portalUi.work.overdueDays').replace('{n}', String(r.overdueDays)) : ''}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
