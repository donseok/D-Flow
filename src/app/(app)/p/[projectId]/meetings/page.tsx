import { CalendarClock, CalendarCheck, CalendarPlus } from 'lucide-react'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { getProjectRoster } from '@/lib/data/members'
import { expandMeetings, summarizeMeetings } from '@/lib/domain/meetings'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { MeetingsView } from '@/components/meetings/MeetingsView'
import { todayIn } from '@/lib/domain/calendar'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pickCalendar } from '@/lib/settings/pick'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'

function monthGrid(todayIso: string): [string, string] {
  const [y, m] = todayIso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1)); const dow = first.getUTCDay()
  const s = new Date(Date.UTC(y, m - 1, 1 - dow)); const e = new Date(Date.UTC(y, m - 1, 1 - dow + 41))
  const f = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return [f(s), f(e)]
}

export default async function MeetingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'meetings')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [meetRes, roster, m, user, projects, locale, pc] = await Promise.all([
    getProjectMeetingData(projectId),
    getProjectRoster(projectId),
    getActorForView(),
    getSession(),
    listProjects(),
    getServerLocale(),
    loadProjectConfigForPage(projectId),
  ])
  // '오늘'의 tz = 프로젝트 달력(계획 D-22·D-21a) — 못 읽거나 손상이면 그 사유를 그린다(서울·UTC 로 대체하지 않는다)
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} locale={locale} /></div>
  const cal = pickCalendar(pc.cfg)
  if (!cal.ok) return <div className="p-6"><ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} locale={locale} /></div>
  const today = todayIn(cal.calendar.timezone, new Date())
  // 명단은 참석자 선택·이름 표시용 곁가지 — 실패해도 일정은 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[meetings] 명단 조회 실패(project=${projectId}) — 참석자 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  // 회의를 못 읽었으면 달력은 빈 채로 그리되(새 회의 등록은 막지 않는다) 사유를 고정 머리에 띄우고 KPI 는 숫자 대신 '—'.
  const meetings = meetRes.ok ? meetRes.meetings : []
  const exceptions = meetRes.ok ? meetRes.exceptions : []
  const project = projects.find(p => p.id === projectId)
  const projectName = project?.name ?? ''
  const [gs, ge] = monthGrid(today)
  const monthOcc = expandMeetings(meetings, exceptions, gs, ge)
  const { today: todayN, upcoming7d, total } = summarizeMeetings(monthOcc, today)
  const kpi = (n: number) => (meetRes.ok ? n : '—')

  return (
    <ProjectPageShell
      pinned={meetRes.ok && roster.ok ? undefined : (
        <div className="space-y-2">
          {!meetRes.ok && <LoadErrorNotice message={t(locale, 'common.loadFailed.meetings')} />}
          {!roster.ok && <RosterLoadError error={roster.error} />}
        </div>
      )}
      hero={<PageHero
        eyebrow="MEETINGS"
        badge={<HeroBadge>Meetings</HeroBadge>}
        title={`${projectName} ${t(locale, 'meet.heroTitleSuffix')}`}
        description={t(locale, 'meet.heroDesc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TODAY" value={kpi(todayN)} sub={t(locale, 'meet.kpi.todaySub')} icon={CalendarCheck} tone="brand" />
            <KpiCard variant="hero" label="NEXT 7 DAYS" value={kpi(upcoming7d)} sub={t(locale, 'meet.kpi.upcomingSub')} icon={CalendarClock} tone="warning" />
            <KpiCard variant="hero" label="THIS MONTH" value={kpi(total)} sub={t(locale, 'meet.kpi.totalSub')} icon={CalendarPlus} tone="success" />
          </>
        }
      />}
    >
      <MeetingsView projectId={projectId} meetings={meetings} exceptions={exceptions} members={members}
        loadFailed={!meetRes.ok} todayIso={today} currentUserId={user?.id ?? null}
        canManage={isProjectAdmin(m, projectId)} canEdit={isProjectMember(m, projectId)} />
    </ProjectPageShell>
  )
}
