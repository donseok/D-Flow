import Link from 'next/link'
import { wsHref } from '@/lib/workspace/paths'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import type { ProjectsView } from '@/lib/portal/prefs'
import { ProjectsViewToggle } from './ProjectsViewToggle'
import { t, type DictKey, type Locale } from '@/lib/i18n/dict'
const statuses: readonly (readonly [ProjectLifecycleStatus, DictKey])[] = [['ready', 'portalUi.projects.statusReady'], ['active', 'portalUi.projects.statusActive'], ['overdue', 'portalUi.projects.statusOverdue'], ['done', 'portalUi.projects.statusDone'], ['unknown', 'portalUi.projects.statusUnknown']]
export function ProjectsToolbar({ slug, q, status, favoritesOnly, view, locale = 'ko' }: { slug: string; q: string; status?: ProjectLifecycleStatus; favoritesOnly: boolean; view: ProjectsView; locale?: Locale }) {
  const keep = { q, status, fav: favoritesOnly ? '1' : undefined }
  return <div className="flex flex-wrap items-center gap-3">
    <form method="get" action={wsHref(slug, 'projects')} className="flex min-w-0 items-center gap-2">
      <input name="q" defaultValue={q} aria-label={t(locale, 'portalUi.projects.searchLabel')} placeholder={t(locale, 'portalUi.projects.searchLabel')} className="app-input min-w-0 w-44" />
      {status && <input type="hidden" name="status" value={status} />}{favoritesOnly && <input type="hidden" name="fav" value="1" />}<button type="submit" className="btn btn-ghost">{t(locale, 'common.search')}</button>
    </form>
    <nav aria-label={t(locale, 'portalUi.projects.statusAria')} className="flex flex-wrap gap-2">
      {([[undefined, 'portalUi.projects.statusAll'], ...statuses] as const).map(([value, label]) => <Link key={value ?? 'all'} href={wsHref(slug, 'projects', { ...keep, status: value })} aria-current={status === value ? 'page' : undefined} className={`rounded-full border px-2.5 py-1 text-meta ${status === value ? 'border-action bg-action-soft font-semibold text-action' : 'border-border text-fg-secondary hover:bg-surface-hover'}`}>{t(locale, label)}</Link>)}
    </nav>
    <Link href={wsHref(slug, 'projects', { ...keep, fav: favoritesOnly ? undefined : '1' })} aria-current={favoritesOnly ? 'page' : undefined} className="text-meta text-action underline">{t(locale, 'portalUi.projects.favoritesOnly')}</Link>
    <ProjectsViewToggle view={view} />
  </div>
}
