import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectRoster } from '@/lib/data/members'
import { getProjectConfig } from '@/lib/data/projectConfig'
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
  const [{ items, dependencies, unresolvedDepends, holidays, today }, actor, projects, initialCollapsed, user, projectConfig, uiPrefs, roster] = await Promise.all([
    getComputedWbs(projectId),
    getActorForView(),
    listProjects(),
    getWbsCollapse(projectId),
    getSession(),
    getProjectConfig(projectId),
    getUiPrefs(),
    getProjectRoster(projectId),
  ])
  // 명단은 담당자 선택·이름 표시용 곁가지 — 실패해도 간트는 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[wbs] 명단 조회 실패(project=${projectId}) — 담당자 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  const project = (projects as ProjectRow[]).find(p => p.id === projectId)
  // 프레즌스 신원 — 주간 시트와 동일하게 서버 세션에서 전달
  const me = user ? { id: user.id, name: displayNameFrom(user.user_metadata, user.email) ?? '사용자' } : null
  return (
    <ProjectPageShell
      flush
      pinned={roster.ok ? undefined : <RosterLoadError error={roster.error} />}
      hero={<PageHero
        eyebrow="WBS · GANTT"
        title={`${project?.name ?? t(locale, 'wbs.projectFallback')} ${t(locale, 'wbs.heroTitleSuffix')}`}
        description={t(locale, 'wbs.heroDesc')}
      />}
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
        levelLabels={projectConfig.levelLabels}
        maxDepth={projectConfig.maxDepth}
        milestoneKeywords={projectConfig.milestoneKeywords}
        initialHideDone={uiPrefs.wbsHideDone ?? false}
        initialOutline={uiPrefs.wbsOutline ?? false}
        initialGanttScale={uiPrefs.wbsGanttScale}
        members={members}
      />
    </ProjectPageShell>
  )
}
