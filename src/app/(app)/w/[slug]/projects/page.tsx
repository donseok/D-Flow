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
import { getServerLocale } from '@/lib/i18n/server'
import { t } from '@/lib/i18n/dict'
import { buttonClass } from '@/components/ui/buttonStyles'
const STATUSES = ['ready', 'active', 'overdue', 'done', 'unknown'] as const
export const metadata = { title: '전체 프로젝트' }
export default async function ProjectsPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; status?: string; fav?: string; cursor?: string; new?: string }>
}) {
  const { slug } = await params
  const scope = await loadWorkspaceScope(slug)
  const [sp, locale] = await Promise.all([searchParams, getServerLocale()])
  const { ws, actor } = scope
  const header = (create?: ReactNode) => <PageHeader title={t(locale, 'nav.allProjects')} meta={ws.name} primaryAction={create} />
  if (!actor) return <PageFrame width="portal" header={header()}><StatusMessage kind="partial_error" blocking title="권한 정보를 읽지 못해 목록을 그리지 못했습니다" /></PageFrame>
  // 기존 달력 손상 경로를 보존한다. 잘못된 시간대로 상태를 지어내지 않는다(R6).
  const zone = await viewTimezone(ws.id)
  if (!zone.ok) return <ConfigLoadError error={zone.error} keyName={zone.key} kind="invalid" locale={locale} />
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status as (typeof STATUSES)[number] : undefined
  const q = sp.q?.trim() || undefined, favoritesOnly = sp.fav === '1'
  const [res, acc, wsPrefs] = await Promise.all([
    getProjectRows(ws.id, actor, { q, status, favoritesOnly, cursor: sp.cursor ?? null, limit: 50 }),
    getAccountPrefs(),
    getWorkspacePrefs(ws.id, { strict: true }).catch((e: unknown) => { console.error('[projects] 즐겨찾기 조회 실패', e); return null }),
  ])
  const canCreate = isWorkspaceAdmin(actor, ws.id) && res.ok
  const copy = canCreate ? await listWorkspaceProjects(ws.id, actor) : null
  const create = canCreate ? <NewProjectModal workspaceId={ws.id} workspaceName={ws.name} copyCandidates={copy?.ok ? copy.rows.map(p => ({ id: p.id, name: p.name })) : []} defaultOpen={sp.new === '1'} /> : undefined
  const view = acc.projectsView === 'cards' ? 'cards' : 'rows'
  const keep = { q, status, fav: favoritesOnly ? '1' : undefined }
  return <PageFrame width="portal" header={header(create)} toolbar={<ProjectsToolbar slug={ws.slug} q={q ?? ''} status={status} favoritesOnly={favoritesOnly} view={view} />}>
    {copy && !copy.ok && <StatusMessage kind="partial_error" compact title="복사할 프로젝트 목록을 불러오지 못했습니다 — 빈 프로젝트로만 만들 수 있습니다" />}
    {wsPrefs === null && <StatusMessage kind="partial_error" compact title="즐겨찾기를 불러오지 못했습니다" detail="현재 목록은 볼 수 있지만 즐겨찾기는 변경할 수 없습니다." />}
    <FavoritesProvider key={ws.id} workspaceId={ws.id} initial={wsPrefs === null ? null : wsPrefs.favoriteProjectIds ?? []}>
      {!res.ok ? <StatusMessage kind="partial_error" blocking title="프로젝트를 불러오지 못했습니다" detail="잠시 뒤 새로고침하세요." />
        : !res.rows.length ? <StatusMessage kind="empty" title={q || status || favoritesOnly ? '조건에 맞는 프로젝트가 없습니다' : '아직 프로젝트가 없습니다'} />
        : view === 'cards' ? <ProjectCards rows={res.rows} locale={locale} /> : <ProjectRowsTable rows={res.rows} locale={locale} />}
      {res.ok && res.nextCursor && <Link href={wsHref(ws.slug, 'projects', { ...keep, cursor: res.nextCursor })} className={`${buttonClass('ghost')} mt-4`}>더 보기</Link>}
    </FavoritesProvider>
  </PageFrame>
}
