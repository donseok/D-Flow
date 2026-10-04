import { loadIssueEntryContext } from '@/lib/issues/context'
import { getIssues } from '@/lib/data/issues'
import { getProjectRoster } from '@/lib/data/members'
import { resolveMemberIds } from '@/lib/data/meetings'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { createServerClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { IssuesView } from '@/components/issues/IssuesView'
import { todayIn } from '@/lib/domain/calendar'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick, pickCalendar } from '@/lib/settings/pick'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'

export default async function IssuesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'issues')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [issues, roster, m, projects, locale, { user, myMemberIds }, pc, entry] = await Promise.all([
    getIssues(projectId),
    getProjectRoster(projectId),
    getActorForView(),
    listProjects(),
    getServerLocale(),
    // '내 담당' 필터용 — 계정 연결(people.user_id)로 찾은 내 활성 명단 행. 비로그인은 빈 배열.
    // resolveMemberIds 는 getSession 의 user 인자가 필요한 진짜 의존이라 체인은 유지하되,
    // 체인 전체를 Promise.all 의 한 항목으로 태워 다른 독립 조회와 왕복을 겹친다(직렬 2단 → 1단).
    // 조회 실패(null)는 종전대로 빈 배열로 받는다 — 이슈 목록은 그대로 그리고 '내 담당' 필터만 비어 보인다(로그는 로더가 남긴다).
    (async () => {
      const user = await getSession()
      const myMemberIds = user ? (await resolveMemberIds(await createServerClient(), user)) ?? [] : []
      return { user, myMemberIds }
    })(),
    loadProjectConfigForPage(projectId),
    loadIssueEntryContext(projectId),
  ])
  // '오늘'의 tz = 프로젝트 달력(계획 D-22·D-21a) — 못 읽거나 손상이면 그 사유를 그린다(서울·UTC 로 대체하지 않는다)
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} locale={locale} /></div>
  const cal = pickCalendar(pc.cfg)
  if (!cal.ok) return <div className="p-6"><ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} locale={locale} /></div>
  // 목록의 심각도 칩·정렬·필터 = 설정 어휘(B4). 등록 문맥(entry)과 따로 읽어 문맥이 실패해도 목록은 그린다
  const severities = pick(pc.cfg, 'issues.severities')
  if (!severities.ok) return <div className="p-6"><ConfigLoadError error={severities.error} keyName={severities.key} kind={severities.kind} locale={locale} /></div>
  const sources = pick(pc.cfg, 'issues.sources')
  if (!sources.ok) return <div className="p-6"><ConfigLoadError error={sources.error} keyName={sources.key} kind={sources.kind} locale={locale} /></div>
  const today = todayIn(cal.calendar.timezone, new Date())
  // 명단은 담당자 선택·이름 표시용 곁가지 — 실패해도 이슈는 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[issues] 명단 조회 실패(project=${projectId}) — 담당자 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []

  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'issue.projectFallback')

  return (
    <ProjectPageShell
      pinned={roster.ok ? undefined : <RosterLoadError error={roster.error} />}
      hero={
        <PageHero
          eyebrow="ISSUES"
          badge={<HeroBadge>Issue Tracker</HeroBadge>}
          title={`${projectName} ${t(locale, 'issue.heroTitleSuffix')}`}
          description={t(locale, 'issue.heroDesc')}
        />
      }
    >
      <IssuesView
        entryContext={entry.ok ? entry.value : null}
        entryError={entry.ok ? undefined : entry.error}
        issues={issues}
        members={members}
        projectId={projectId}
        workspaceId={m?.projectWorkspace.get(projectId) ?? null}
        currentUserId={user?.id ?? null}
        canEdit={isProjectMember(m, projectId)}
        isProjectAdmin={isProjectAdmin(m, projectId)}
        myMemberIds={myMemberIds}
        today={today}
        timeZone={cal.calendar.timezone}
        severities={severities.value}
        sources={sources.value}
      />
    </ProjectPageShell>
  )
}
