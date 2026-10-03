import Link from 'next/link'
import { wsHref } from '@/lib/workspace/paths'
import type { ProjectLifecycleStatus } from '@/lib/domain/project-status'
import type { ProjectsView } from '@/lib/portal/prefs'
import { ProjectsViewToggle } from './ProjectsViewToggle'
const statuses = [['ready', '시작 전'], ['active', '진행 중'], ['overdue', '지연'], ['done', '완료'], ['unknown', '확인 불가']] as const
export function ProjectsToolbar({ slug, q, status, favoritesOnly, view }: { slug: string; q: string; status?: ProjectLifecycleStatus; favoritesOnly: boolean; view: ProjectsView }) {
  const keep = { q, status, fav: favoritesOnly ? '1' : undefined }
  return <div className="flex flex-wrap items-center gap-3">
    <form method="get" action={wsHref(slug, 'projects')} className="flex min-w-0 items-center gap-2">
      <input name="q" defaultValue={q} aria-label="프로젝트 검색" placeholder="프로젝트 검색" className="app-input min-w-0 w-44" />
      {status && <input type="hidden" name="status" value={status} />}{favoritesOnly && <input type="hidden" name="fav" value="1" />}<button type="submit" className="btn btn-ghost">검색</button>
    </form>
    <nav aria-label="프로젝트 상태" className="flex flex-wrap gap-2">
      {[[undefined, '전체'], ...statuses].map(([value, label]) => <Link key={value ?? 'all'} href={wsHref(slug, 'projects', { ...keep, status: value })} aria-current={status === value ? 'page' : undefined} className={`rounded-full border px-2.5 py-1 text-meta ${status === value ? 'border-action bg-action-weak font-semibold text-action' : 'border-border text-fg-secondary hover:bg-surface-hover'}`}>{label}</Link>)}
    </nav>
    <Link href={wsHref(slug, 'projects', { ...keep, fav: favoritesOnly ? undefined : '1' })} aria-current={favoritesOnly ? 'page' : undefined} className="text-meta text-action underline">즐겨찾기만</Link>
    <ProjectsViewToggle view={view} />
  </div>
}
