import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHero } from '@/components/ui/PageHero'
import { WikiTopicDetail } from '@/components/wiki/WikiTopicDetail'
import { getWikiTopicDetail } from '@/lib/data/wiki'
import { t } from '@/lib/i18n/dict'
import { getServerLocale } from '@/lib/i18n/server'
import { requireModulePage } from '@/lib/modules/pageGate'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pickCalendar } from '@/lib/settings/pick'

export default async function WikiTopicPage({
  params,
}: {
  params: Promise<{ projectId: string; topicId: string }>
}) {
  const { projectId, topicId } = await params
  await requireModulePage({ projectId }, 'wiki')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [data, projects, locale, membership, pc] = await Promise.all([
    getWikiTopicDetail(projectId, topicId),
    listProjects(),
    getServerLocale(),
    getActorForView(),
    loadProjectConfigForPage(projectId),
  ])
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectName = project?.name ?? t(locale, 'wiki.projectFallback')
  const title = data.topic
    ? `${projectName} · ${data.topic.title}`
    : `${projectName}${t(locale, 'wiki.heroTitleSuffix')}`
  const canEditDocuments = isProjectMember(membership, projectId)
  // instant(갱신·검증·변경 시각)의 tz = 프로젝트 달력 — 못 읽거나 손상이면 본문 자리에 사유(서울·UTC 로 대체하지 않는다, 계획 D-21a)
  const cal = pc.ok ? pickCalendar(pc.cfg) : null
  if (!cal?.ok) {
    return (
      <ProjectPageShell hero={<PageHero title={title} />}>
        {cal ? <ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} locale={locale} />
          : <ConfigLoadError error={pc.ok ? '' : pc.error} locale={locale} />}
      </ProjectPageShell>
    )
  }

  return (
    <ProjectPageShell hero={<PageHero title={title} />}>
      <WikiTopicDetail
        projectId={projectId}
        data={data}
        locale={locale}
        canCurate={isProjectAdmin(membership, projectId)}
        canEditDocuments={canEditDocuments}
        canVerifyDocuments={canEditDocuments}
        userId={membership?.userId ?? null}
        timeZone={cal.calendar.timezone}
      />
    </ProjectPageShell>
  )
}
