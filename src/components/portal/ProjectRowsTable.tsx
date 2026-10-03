import Link from 'next/link'
import type { Locale } from '@/lib/i18n/dict'
import type { ProjectRow } from '@/lib/data/portal'
import { FavoriteToggle } from './FavoriteToggle'
import { ProjectStatusChip } from './ProjectStatusChip'
export const projectPeriod = (p: ProjectRow) => p.startDate || p.endDate ? `${p.startDate ?? '미정'} – ${p.endDate ?? '미정'}` : '기간 미정'
export function ProjectProgress({ row: p }: { row: ProjectRow }) {
  return p.progress ? <span className="inline-flex items-center gap-2">
    <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-subtle" aria-hidden><span className="block h-full bg-action" style={{ width: `${p.progress.total ? Math.round(p.progress.done / p.progress.total * 100) : 0}%` }} /></span>
    <span className="whitespace-nowrap text-meta tabular-nums text-fg-secondary">완료 {p.progress.done}/{p.progress.total}</span>
  </span> : <span className="text-meta text-fg-secondary">진척 확인 불가</span>
}
export function ProjectRowsTable({ rows, locale = 'ko' }: { rows: ProjectRow[]; locale?: Locale }) {
  return <div className="max-w-full overflow-x-auto rounded-(--radius-panel) border border-border bg-surface">
    <table className="w-full min-w-[720px] text-sm"><thead><tr className="border-b border-border text-left text-meta font-semibold text-fg-secondary">
      <th scope="col" className="w-12 px-3 py-2"><span className="sr-only">즐겨찾기</span><span aria-hidden>☆</span></th>
      <th scope="col" className="px-3 py-2">이름</th><th scope="col" className="px-3 py-2">상태</th><th scope="col" className="px-3 py-2">기간</th><th scope="col" className="px-3 py-2">진척</th>
    </tr></thead><tbody className="divide-y divide-border">{rows.map(p => <tr key={p.id} className="hover:bg-surface-hover">
      <td className="px-3 py-2"><FavoriteToggle projectId={p.id} projectName={p.name} /></td>
      <th scope="row" className="max-w-xs px-3 py-2 text-left font-normal"><Link href={`/p/${p.id}/dashboard`} className="break-words font-semibold text-fg hover:underline">{p.name}</Link><span className="block text-meta text-fg-secondary">{p.statusReason}</span></th>
      <td className="px-3 py-2"><ProjectStatusChip status={p.status} locale={locale} /></td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-fg-secondary">{projectPeriod(p)}{p.nextDue && <span className="block text-meta">다음 기한 {p.nextDue}</span>}</td>
      <td className="px-3 py-2"><ProjectProgress row={p} /></td>
    </tr>)}</tbody></table>
  </div>
}
