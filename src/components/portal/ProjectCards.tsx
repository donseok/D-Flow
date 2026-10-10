import Link from 'next/link'
import { t} from '@/lib/i18n/dict'
import type { ProjectRow } from '@/lib/data/portal'
import { FavoriteToggle } from './FavoriteToggle'
import { ProjectStatusChip } from './ProjectStatusChip'
import { projectPeriod, ProjectProgress } from './ProjectRowsTable'
export function ProjectCards({ rows }: { rows: ProjectRow[] }) {
  return <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{rows.map(p => <article key={p.id} data-project-card className="min-w-0 rounded-(--radius-panel) border border-border/80 bg-surface shadow-(--shadow-card) p-4.5 transition-[box-shadow,border-color,background-color] duration-(--motion-fast) hover:border-border-input hover:bg-surface-hover">
    <div className="flex items-start justify-between gap-3"><ProjectStatusChip status={p.status} /><FavoriteToggle projectId={p.id} projectName={p.name} /></div>
    <h2 className="mt-2 break-words text-base font-semibold"><Link href={`/p/${p.id}/dashboard`} className="text-fg hover:underline">{p.name}</Link></h2>
    <p className="mt-1 text-meta text-fg-secondary">{p.statusReason}</p>
    <p className="mt-2 line-clamp-2 text-sm text-fg-secondary">{p.description?.trim() || t('portalUi.projects.noDescription')}</p>
    <p className="my-3 text-meta tabular-nums text-fg-secondary">{projectPeriod(p)}</p><ProjectProgress row={p} />
  </article>)}</div>
}
