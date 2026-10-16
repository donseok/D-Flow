import { getAttendanceRecords } from '@/lib/data/attendance'
import { getProjectRoster } from '@/lib/data/members'
import { getActorForView } from '@/lib/authz'
import { isProjectMember } from '@/lib/domain/authz'
import { calendarViewOf, holidayNamesOf } from '@/lib/domain/attendance'
import { t } from '@/lib/i18n/dict'
import { PageHeader } from '@/components/app/PageHeader'
import { AttendanceView } from '@/components/attendance/AttendanceView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { RosterLoadError } from '@/components/members/RosterLoadError'
import { todayIn } from '@/lib/domain/calendar'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pick, pickCalendar } from '@/lib/settings/pick'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'
import { StatusMessage } from '@/components/ui/StatusMessage'

/** 탭 제목 — 화면 이름만 낸다(프로젝트 이름은 싣지 않는다 — 레이아웃의 존재 은닉과 같은 이유) */
export async function generateMetadata() { return { title: t('nav.attendance') } }
export default async function AttendancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'attendance')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [records, roster, m, pc] = await Promise.all([
    getAttendanceRecords(projectId),
    getProjectRoster(projectId),
    getActorForView(),
    loadProjectConfigForPage(projectId),
  ])
  // 명단은 인원 선택·이름 표시용 곁가지 — 실패해도 기록은 그리되, 빈 선택 목록이 '0명' 으로 읽히지 않게 사유를 띄운다.
  if (!roster.ok) console.error(`[attendance] 명단 조회 실패(project=${projectId}) — 인원 목록 없이 그리고 경고를 띄운다`)
  const members = roster.ok ? roster.rows : []
  // '오늘'의 tz = 프로젝트 달력(계획 D-22·D-21a) — 못 읽거나 손상이면 그 사유를 그린다(서울·UTC 로 대체하지 않는다)
  if (!pc.ok) return <div className="p-6"><ConfigLoadError error={pc.error} /></div>
  const cal = pickCalendar(pc.cfg)
  if (!cal.ok) return <div className="p-6"><ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} /></div>
  const types = pick(pc.cfg, 'attendance.types')
  if (!types.ok) return <div className="p-6"><ConfigLoadError error={types.error} keyName={types.key} kind={types.kind} /></div>
  const today = todayIn(cal.calendar.timezone, new Date())
  const pinned = roster.ok ? undefined : <RosterLoadError error={roster.error} />
  const hero = <PageHeader title={t('att.title')} description={t('att.desc')} />
  // 근태 조회 실패는 "아직 등록된 근태가 없습니다"로 그리지 않는다(3원칙 ①) — 빈 달력 위에서 입력하면 있는 기록을 못 본 채 겹쳐 쓴다.
  // 로그는 로더(getAttendanceRecords)가 남긴다.
  if (!records.ok) {
    return (
      <ProjectPageShell pinned={pinned} hero={hero}>
        <StatusMessage kind="partial_error" blocking title={t('att.loadFailed')} detail={t('pages.common.refreshLater')} />
      </ProjectPageShell>
    )
  }

  return (
    <ProjectPageShell
      pinned={pinned}
      hero={hero}
    >
      <AttendanceView
        projectId={projectId}
        records={records.records}
        members={members}
        initialDate={today}
        canEdit={isProjectMember(m, projectId)}
        calendar={calendarViewOf(cal.calendar)}
        holidayNames={holidayNamesOf(pc.cfg.holidays)}
        types={types.value}
      />
    </ProjectPageShell>
  )
}
