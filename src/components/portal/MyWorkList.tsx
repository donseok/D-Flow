import Link from 'next/link'
import { CalendarClock, CircleAlert, ListChecks, ShieldCheck, type LucideIcon } from 'lucide-react'
import type { MyWorkKind, MyWorkRow } from '@/lib/portal/myWork'
import { StatusMessage } from '@/components/ui/StatusMessage'

export const KIND_LABEL: Record<MyWorkKind, string> = { wbs: '작업', issue: '이슈', approval: '검토', meeting: '회의' }
const KIND_ICON: Record<MyWorkKind, LucideIcon> = { wbs: ListChecks, issue: CircleAlert, approval: ShieldCheck, meeting: CalendarClock }

/**
 * 내 업무 행(56px) — 행 전체가 링크. 종류는 아이콘 + 읽히는 글(sr-only), 상태는 중립 칩(진척 %·이슈 상태·'검토 대기'·시각),
 * 기한 지남은 색만이 아니라 글자로도 알린다
 */
export function MyWorkList({ rows, failedKinds, empty }: { rows: MyWorkRow[]; failedKinds: MyWorkKind[]; empty: string }) {
  return (
    <div className="space-y-2">
      {failedKinds.length > 0 && (
        <StatusMessage kind="partial_error" compact title={`일부 항목(${failedKinds.map((k) => KIND_LABEL[k]).join('·')})을 불러오지 못했습니다`} />
      )}
      {rows.length === 0 ? (empty ? <StatusMessage kind="empty" compact title={empty} /> : null) : (
        <ul className="divide-y divide-border rounded-(--radius-panel) border border-border bg-surface">
          {rows.map((r) => {
            const Icon = KIND_ICON[r.kind]
            return (
              <li key={`${r.kind}:${r.id}`}>
                <Link href={r.href} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-surface-hover">
                  <Icon className="h-4 w-4 shrink-0 text-fg-secondary" aria-hidden />
                  <span className="sr-only">{KIND_LABEL[r.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-fg">{r.title}</span>
                    <span className="block truncate text-meta text-fg-secondary">{r.projectName}</span>
                  </span>
                  <span className="chip shrink-0 bg-surface-subtle text-fg-secondary">{r.status}</span>
                  <span className={`w-28 shrink-0 text-right text-meta tabular-nums ${r.overdueDays ? 'font-semibold text-danger' : 'text-fg-secondary'}`}>
                    {r.due ?? '기한 없음'}{r.overdueDays ? ` · ${r.overdueDays}일 지남` : ''}
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
