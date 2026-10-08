import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectRoster } from '@/lib/data/members'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { PageHeader } from '@/components/app/PageHeader'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import { todayIn } from '@/lib/domain/calendar'
import { calendarViewOf, holidayNamesOf } from '@/lib/domain/attendance'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick, pickCalendar } from '@/lib/settings/pick'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { moduleSetFor } from '@/lib/modules/gate'
import { workspaceRefById } from '@/lib/workspace/resolve'
import { wsHref } from '@/lib/workspace/paths'

export default async function MeetingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'meetings')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const actorP = getActorForView()
  const [meetRes, roster, m, user, projects, locale, pc, mods, wsRef] = await Promise.all([
    getProjectMeetingData(projectId),
    getProjectRoster(projectId),
    actorP,
    getSession(),
    listProjects(),
    getServerLocale(),
    loadProjectConfigForPage(projectId),
    // D53 — '이 프로젝트 회의록' 은 회의록 모듈이 켜졌을 때만(판정 실패는 core 만 = 숨김, 로그는 moduleSetFor)
    moduleSetFor({ projectId }),
    // 그 링크의 슬러그 — 같은 행위자 조회를 이어 받는다(직렬 왕복을 늘리지 않게 같은 묶음에)
    actorP.then(async (actor) => {
      const wid = actor?.projectWorkspace.get(projectId)
      return wid ? workspaceRefById(wid) : null
    }),
  ])
  // '오늘'의 tz = 프로젝트 달력(계획 D-22·D-21a) — 못 읽거나 손상이면 그 사유를 그린다(서울·UTC 로 대체하지 않는다)
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} locale={locale} /></div>
  const cal = pickCalendar(pc.cfg)
  if (!cal.ok) return <div className="p-6"><ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} locale={locale} /></div>
  const categories = pick(pc.cfg, 'meetings.categories')
  if (!categories.ok) return <div className="p-6"><ConfigLoadError error={categories.error} keyName={categories.key} kind={categories.kind} locale={locale} /></div>
  const today = todayIn(cal.calendar.timezone, new Date())
  const minutesHref = mods.has('minutes') && wsRef?.ok ? wsHref(wsRef.ws.slug, 'minutes', { project: projectId }) : null
  // 명단은 참석자 선택·이름 표시용 곁가지 — 실패해도 일정은 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[meetings] 명단 조회 실패(project=${projectId}) — 참석자 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  // 회의를 못 읽었으면 달력은 빈 채로 그리되(새 회의 등록은 막지 않는다) 사유를 고정 머리에 띄운다.
  const meetings = meetRes.ok ? meetRes.meetings : []
  const exceptions = meetRes.ok ? meetRes.exceptions : []
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? ''

  return (
    <ProjectPageShell
      pinned={meetRes.ok && roster.ok ? undefined : (
        <div className="space-y-2">
          {!meetRes.ok && <LoadErrorNotice message={t(locale, 'common.loadFailed.meetings')} />}
          {!roster.ok && <RosterLoadError error={roster.error} />}
        </div>
      )}
      hero={<PageHeader title={`${projectName} ${t(locale, 'meet.heroTitleSuffix')}`} description={t(locale, 'meet.heroDesc')} />}
    >
      <MeetingsView projectId={projectId} meetings={meetings} exceptions={exceptions} members={members}
        loadFailed={!meetRes.ok} todayIso={today} currentUserId={user?.id ?? null}
        canManage={isProjectAdmin(m, projectId)} canEdit={isProjectMember(m, projectId)} minutesHref={minutesHref}
        calendar={calendarViewOf(cal.calendar)} holidayNames={holidayNamesOf(pc.cfg.holidays)}
        categories={categories.value} />
    </ProjectPageShell>
  )
}
