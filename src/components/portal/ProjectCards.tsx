import Link from 'next/link'
import type { Locale } from '@/lib/i18n/dict'
import type { ProjectRow } from '@/lib/data/portal'
import { FavoriteToggle } from './FavoriteToggle'
import { ProjectStatusChip } from './ProjectStatusChip'
import { projectPeriod, ProjectProgress } from './ProjectRowsTable'
export function ProjectCards({ rows, locale = 'ko' }: { rows: ProjectRow[]; locale?: Locale }) {
  return <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map(p => <article key={p.id} data-project-card className="min-w-0 rounded-(--radius-panel) border border-border/80 bg-surface p-4.5 transition-[box-shadow,border-color,background-color] duration-(--motion-fast) hover:border-border-input hover:bg-surface-hover">
    <div className="flex items-start justify-between gap-3"><ProjectStatusChip status={p.status} locale={locale} /><FavoriteToggle projectId={p.id} projectName={p.name} /></div>
    <h2 className="mt-2 break-words text-base font-semibold"><Link href={`/p/${p.id}/dashboard`} className="text-fg hover:underline">{p.name}</Link></h2>
    <p className="mt-1 text-meta text-fg-secondary">{p.statusReason}</p>
    <p className="mt-2 line-clamp-2 text-sm text-fg-secondary">{p.description?.trim() || '설명이 없습니다'}</p>
    <p className="my-3 text-meta tabular-nums text-fg-secondary">{projectPeriod(p)}</p><ProjectProgress row={p} />
  </article>)}</div>
}
