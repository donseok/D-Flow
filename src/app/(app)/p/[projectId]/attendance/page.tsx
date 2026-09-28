import { CalendarCheck, CalendarOff, PlaneTakeoff } from 'lucide-react'
import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectRoster } from '@/lib/data/members'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { summarize } from '@/lib/domain/attendance'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { PageHero, HeroBadge } from '@/components/ui/PageHero'
import { KpiCard } from '@/components/ui/KpiCard'
import { AttendanceView } from '@/components/attendance/AttendanceView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { seoulToday } from '@/lib/domain/dates'
import { requireModulePage } from '@/lib/modules/pageGate'

export default async function AttendancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'attendance')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [records, roster, m] = await Promise.all([
    getAttendanceRecords(projectId),
    getProjectRoster(projectId),
    getActorForView(),
  ])
  // 명단은 인원 선택·이름 표시용 곁가지 — 실패해도 기록은 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[attendance] 명단 조회 실패(project=${projectId}) — 인원 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  const locale = await getServerLocale()
  const today = seoulToday()
  const s = summarize(records)

  return (
    <ProjectPageShell
      pinned={roster.ok ? undefined : <RosterLoadError error={roster.error} />}
      hero={<PageHero
        eyebrow="ATTENDANCE"
        badge={<HeroBadge>Attendance</HeroBadge>}
        title={t(locale, 'att.title')}
        description={t(locale, 'att.desc')}
        heroKpis={
          <>
            <KpiCard variant="hero" label="TOTAL RECORDS" value={s.total} sub={t(locale, 'att.kpi.totalSub')} icon={CalendarCheck} />
            <KpiCard variant="hero" label="LEAVE DAYS" value={s.leave} sub={t(locale, 'att.kpi.leaveSub')} icon={CalendarOff} tone="brand" />
            <KpiCard variant="hero" label="BUSINESS TRIP" value={s.trip} sub={t(locale, 'att.kpi.tripSub')} icon={PlaneTakeoff} tone="warning" />
          </>
        }
      />}
    >
      <AttendanceView
        projectId={projectId}
        records={records}
        members={members}
        initialDate={today}
        canEdit={isProjectMember(m, projectId)}
      />
    </ProjectPageShell>
  )
}
