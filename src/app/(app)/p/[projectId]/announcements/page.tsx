import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { getAnnouncements, getAnnouncementSeenAt } from '@/lib/data/announcements'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { PageHeader } from '@/components/app/PageHeader'
import { AnnouncementsView } from '@/components/announcements/AnnouncementsView'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { LoadErrorNotice } from '@/components/ui/LoadErrorNotice'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pickCalendar } from '@/lib/settings/pick'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { requireModulePage } from '@/lib/modules/pageGate'

export default async function AnnouncementsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  await requireModulePage({ projectId }, 'announcements')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [annRes, lastSeenAt, m, projects, locale, pc] = await Promise.all([
    getAnnouncements(projectId),
    getAnnouncementSeenAt(projectId),
    getActorForView(),
    listProjects(),
    getServerLocale(),
    loadProjectConfigForPage(projectId),
  ])

  const project = projects.find((p) => p.id === projectId)
  const projectName = project?.name ?? t(locale, 'ann.projectFallback')
  const canEdit = isProjectAdmin(m, projectId)
  // 공지를 못 읽었으면 목록 자리에 사유를 둔다('공지 없음' 빈 상태·읽음 처리를 하지 않는다).
  // 프로젝트 달력('오늘'·날짜 표기의 tz, 계획 D-21a) — 못 읽거나 손상이면 목록 자리에 그 사유(서울·UTC 로 대체하지 않는다)
  const cal = pc.ok ? pickCalendar(pc.cfg) : null
  const tz = cal?.ok ? cal.calendar.timezone : null
  const calendarError = tz ? null
    : cal && !cal.ok ? <ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} locale={locale} />
      : <ConfigLoadError error={pc.ok ? '' : pc.error} locale={locale} />

  return (
    <ProjectPageShell
      hero={<PageHeader title={`${projectName} ${t(locale, 'ann.heroTitleSuffix')}`} description={t(locale, 'ann.heroDesc')} />}
    >
      {!annRes.ok ? <LoadErrorNotice message={t(locale, 'common.loadFailed.announcements')} />
        : tz ? (
          <AnnouncementsView
            announcements={annRes.rows}
            lastSeenAt={lastSeenAt}
            canEdit={canEdit}
            projectId={projectId}
            timeZone={tz}
          />
        ) : calendarError}
    </ProjectPageShell>
  )
}
