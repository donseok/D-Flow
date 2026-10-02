import Link from 'next/link'
import type { MyWorkKind, MyWorkRow } from '@/lib/portal/myWork'
import { StatusMessage } from '@/components/ui/StatusMessage'

export const KIND_LABEL: Record<MyWorkKind, string> = { wbs: '작업', issue: '이슈', approval: '검토', meeting: '회의' }

/** 내 업무 행(56px) — 행 전체가 링크. 기한 지남은 글자로도 알린다(색만으로 전달하지 않는다) */
export function MyWorkList({ rows, failedKinds, empty }: { rows: MyWorkRow[]; failedKinds: MyWorkKind[]; empty: string }) {
  return (
    <div className="space-y-2">
      {failedKinds.length > 0 && (
        <StatusMessage kind="partial_error" compact title={`일부 항목(${failedKinds.map((k) => KIND_LABEL[k]).join('·')})을 불러오지 못했습니다`} />
      )}
      {rows.length === 0 ? <StatusMessage kind="empty" compact title={empty} /> : (
        <ul className="divide-y divide-border rounded-(--radius-panel) border border-border bg-surface">
          {rows.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <Link href={r.href} className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-hover">
                <span className="w-10 shrink-0 text-meta font-semibold text-fg-secondary">{KIND_LABEL[r.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{r.title}</span>
                  <span className="block truncate text-meta text-fg-secondary">{r.projectName} · {r.status}</span>
                </span>
                <span className={`shrink-0 text-meta ${r.overdueDays ? 'font-semibold text-danger' : 'text-fg-secondary'}`}>
                  {r.due ?? '기한 없음'}{r.overdueDays ? ` · ${r.overdueDays}일 지남` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
