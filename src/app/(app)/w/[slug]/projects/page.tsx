import Link from 'next/link'
import type { ReactNode } from 'react'
import { getProjectRows, listWorkspaceProjects } from '@/lib/data/portal'
import { getAccountPrefs, getWorkspacePrefs } from '@/app/actions/preferences'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { isWorkspaceAdmin } from '@/lib/domain/authz'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { PageFrame } from '@/components/app/PageFrame'
import { PageHeader } from '@/components/app/PageHeader'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { NewProjectModal } from '@/components/home/NewProjectModal'
import { FavoritesProvider } from '@/components/portal/FavoritesProvider'
import { ProjectRowsTable } from '@/components/portal/ProjectRowsTable'
import { ProjectCards } from '@/components/portal/ProjectCards'
import { ProjectsToolbar } from '@/components/portal/ProjectsToolbar'
import { wsHref } from '@/lib/workspace/paths'
import { koTranslate } from '@/lib/i18n/translate'
import { t } from '@/lib/i18n/dict'
import { buttonClass } from '@/components/ui/buttonStyles'
const STATUSES = ['ready', 'active', 'overdue', 'done', 'unknown'] as const
/** 탭 제목 — 사전에서 꺼낸다('전체 프로젝트') */
export async function generateMetadata() { return { title: t('nav.allProjects') } }
export default async function ProjectsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; status?: string; fav?: string; cursor?: string; new?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)
  const sp = await searchParams
  const { ws, actor } = scope
  const header = (create?: ReactNode) => <PageHeader title={t('nav.allProjects')} meta={ws.name} primaryAction={create} />
  if (!actor) return <PageFrame width="portal" header={header()}><StatusMessage kind="partial_error" blocking title={t('pages.projects.noActor')} /></PageFrame>
  // 기존 달력 손상 경로를 보존한다. 잘못된 시간대로 상태를 지어내지 않는다(R6).
  const zone = await viewTimezone(scope.ws.id)
  if (!zone.ok) return <ConfigLoadError error={zone.error} keyName={zone.key} kind="invalid" />
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status as (typeof STATUSES)[number] : undefined
  const q = sp.q?.trim() || undefined, favoritesOnly = sp.fav === '1'
  const [res, acc, wsPrefs] = await Promise.all([
    getProjectRows(ws.id, actor, { q, status, favoritesOnly, cursor: sp.cursor ?? null, limit: 50, t: koTranslate }),
    getAccountPrefs(),
    getWorkspacePrefs(ws.id, { strict: true }).catch((e: unknown) => { console.error('[projects] 즐겨찾기 조회 실패', e); return null }),
  ])
  const canCreate = isWorkspaceAdmin(actor, ws.id) && res.ok
  const copy = canCreate ? await listWorkspaceProjects(ws.id, actor) : null
  const create = canCreate ? <NewProjectModal workspaceId={ws.id} workspaceName={ws.name} copyCandidates={copy?.ok ? copy.rows.map(p => ({ id: p.id, name: p.name })) : []} defaultOpen={sp.new === '1'} /> : undefined
  const view = acc.projectsView === 'cards' ? 'cards' : 'rows'
  const keep = { q, status, fav: favoritesOnly ? '1' : undefined }
  return <PageFrame width="portal" header={header(create)} toolbar={<ProjectsToolbar slug={ws.slug} q={q ?? ''} status={status} favoritesOnly={favoritesOnly} view={view} />}>
    {copy && !copy.ok && <StatusMessage kind="partial_error" compact title={t('pages.projects.copyFailed')} />}
    {wsPrefs === null && <StatusMessage kind="partial_error" compact title={t('pages.projects.favoritesFailed')} detail={t('pages.projects.favoritesFailedDetail')} />}
    <FavoritesProvider key={ws.id} workspaceId={ws.id} initial={wsPrefs === null ? null : wsPrefs.favoriteProjectIds ?? []}>
      {!res.ok ? <StatusMessage kind="partial_error" blocking title={t('pages.projects.loadFailed')} detail={t('pages.common.refreshLater')} />
        : !res.rows.length ? <StatusMessage kind="empty" title={t(q || status || favoritesOnly ? 'pages.projects.emptyFiltered' : 'pages.projects.empty')} />
        : view === 'cards' ? <ProjectCards rows={res.rows} /> : <ProjectRowsTable rows={res.rows} />}
      {res.ok && res.nextCursor && <Link href={wsHref(ws.slug, 'projects', { ...keep, cursor: res.nextCursor })} className={`${buttonClass('ghost')} mt-4`}>{t('pages.common.more')}</Link>}
    </FavoritesProvider>
  </PageFrame>
}
