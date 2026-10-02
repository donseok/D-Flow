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
import { wsHref } from '@/lib/workspace/paths'
import { workspaceRefById } from '@/lib/workspace/resolve'

export default async function WikiTopicPage({
  params,
}: {
  params: Promise<{ projectId: string; topicId: string }>
}) {
  const { projectId, topicId } = await params
  await requireModulePage({ projectId }, 'wiki')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [data, projects, locale, membership] = await Promise.all([
    getWikiTopicDetail(projectId, topicId),
    listProjects(),
    getServerLocale(),
    getActorForView(),
  ])
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectName = project?.name ?? t(locale, 'wiki.projectFallback')
  const title = data.topic
    ? `${projectName} · ${data.topic.title}`
    : `${projectName}${t(locale, 'wiki.heroTitleSuffix')}`
  const canEditDocuments = isProjectMember(membership, projectId)
  // 근거·변경의 회의록 링크를 슬러그 형식으로(D38 ①, 과제 35) — 레이아웃이 같은 요청에서 부른 workspaceRefById(React cache)를 다시 쓴다.
  // 열화·조회 실패면 영구 링크 형식(스텁이 행의 워크스페이스로 보낸다, D6) — 링크가 틀리지 않고 한 번 더 돈다
  const wid = membership?.projectWorkspace.get(projectId)
  const wsRef = wid ? await workspaceRefById(wid) : null
  const minutesBase = wsRef?.ok ? wsHref(wsRef.ws.slug, 'minutes') : undefined

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
        minutesBase={minutesBase}
      />
    </ProjectPageShell>
  )
}
