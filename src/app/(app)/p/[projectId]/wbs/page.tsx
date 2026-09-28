import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectRoster } from '@/lib/data/members'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick } from '@/lib/settings/pick'
import { levelDepthOf } from '@/lib/settings/projectConfig'
import { listProjects } from '@/app/actions/project'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { toProjectActorView } from '@/lib/domain/authz'
import { displayNameFrom } from '@/lib/domain/display-name'
import { getWbsCollapse, getUiPrefs } from '@/app/actions/preferences'
import { WbsGanttSheet } from '@/components/wbs/WbsGanttSheet'
import { PageHero } from '@/components/ui/PageHero'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'

type ProjectRow = { id: string; name: string; description?: string | null; start_date?: string | null; end_date?: string | null }

export default async function WbsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<{ view?: string; focus?: string }>
}) {
  const { projectId } = await params
  const { view, focus } = await searchParams
  const locale = await getServerLocale()
  const [{ items, dependencies, unresolvedDepends, holidays, today }, actor, projects, initialCollapsed, user, pc, uiPrefs, roster] = await Promise.all([
    getComputedWbs(projectId),
    getActorForView(),
    listProjects(),
    getWbsCollapse(projectId),
    getSession(),
    loadProjectConfigForPage(projectId),
    getUiPrefs(),
    getProjectRoster(projectId),
  ])
  // 명단은 담당자 선택·이름 표시용 곁가지 — 실패해도 간트는 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[wbs] 명단 조회 실패(project=${projectId}) — 담당자 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  // 프레즌스 신원 — 주간 시트와 동일하게 서버 세션에서 전달
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null
  const hero = <PageHero
    eyebrow="WBS · GANTT"
    title={`${project?.name ?? t(locale, 'wbs.projectFallback')} ${t(locale, 'wbs.heroTitleSuffix')}`}
    description={t(locale, 'wbs.heroDesc')}
  />
  // 설정을 못 읽거나 단계 이름이 손상이면 간트를 기본값으로 그리지 않는다(스펙 §3.5) — 트리 깊이·라벨이 틀린 채 편집하게 된다.
  if (!pc.ok) return <ProjectPageShell hero={hero}><ConfigLoadError error={pc.error} locale={locale} /></ProjectPageShell>
  const labels = pick(pc.cfg, 'core.level_labels')
  if (!labels.ok) return <ProjectPageShell hero={hero}><ConfigLoadError error={labels.error} keyName={labels.key} locale={locale} /></ProjectPageShell>
  // 키워드 손상은 마커 없이 그리고 명단 오류와 같은 자리에 사유를 띄운다.
  const keywords = pick(pc.cfg, 'core.milestone_keywords')
  const pinned = roster.ok && keywords.ok ? undefined : (
    <>
      {!roster.ok && <RosterLoadError error={roster.error} />}
      {!keywords.ok && <ConfigLoadError error={keywords.error} keyName={keywords.key} locale={locale} />}
    </>
  )
  return (
    <ProjectPageShell
      flush
      pinned={pinned}
      hero={hero}
    >
      <WbsGanttSheet
        key={projectId}
        items={items}
        dependencies={dependencies}
        unresolvedDepends={unresolvedDepends}
        holidays={holidays}
        today={today}
        actorView={toProjectActorView(actor, projectId)}
        me={me}
        projectId={projectId}
        projectName={project?.name ?? ''}
        projectDescription={project?.description}
        startDate={project?.start_date}
        endDate={project?.end_date}
        defaultView={view === 'timeline' ? 'timeline' : 'sheet'}
        initialCollapsed={initialCollapsed ?? undefined}
        focusId={focus ?? null}
        levelLabels={labels.value}
        maxDepth={levelDepthOf(pc.cfg)}
        milestoneKeywords={keywords.ok ? keywords.value : []}
        initialHideDone={uiPrefs.wbsHideDone ?? false}
        initialOutline={uiPrefs.wbsOutline ?? false}
        initialGanttScale={uiPrefs.wbsGanttScale}
        members={members}
      />
    </ProjectPageShell>
  )
}
