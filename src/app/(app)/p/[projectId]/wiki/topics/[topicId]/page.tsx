import { listProjects } from '@/app/actions/project'
import { getActorForView } from '@/lib/authz'
import { isProjectAdmin, isProjectMember } from '@/lib/domain/authz'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'
import { PageHeader } from '@/components/app/PageHeader'
import { WikiTopicDetail } from '@/components/wiki/WikiTopicDetail'
import { getWikiTopicDetail } from '@/lib/data/wiki'
import { t } from '@/lib/i18n/dict'
import { requireModulePage } from '@/lib/modules/pageGate'
import { ConfigLoadError } from '@/components/settings/ConfigLoadError'
import { loadProjectConfigForPage } from '@/lib/settings/pageConfig'
import { pickCalendar } from '@/lib/settings/pick'
import { wsHref } from '@/lib/workspace/paths'
import { workspaceRefById } from '@/lib/workspace/resolve'
import { loadLocalDraftPolicy } from '@/lib/drafts/policy'

export default async function WikiTopicPage({
  params,
}: {
  params: Promise<{ projectId: string; topicId: string }>
}) {
  const { projectId, topicId } = await params
  await requireModulePage({ projectId }, 'wiki')   // 스펙 §4.2 1행 — 꺼지면 notFound(), 로더보다 앞(R14)
  const [data, projects, membership, pc] = await Promise.all([
    getWikiTopicDetail(projectId, topicId),
    listProjects(),
    getActorForView(),
    loadProjectConfigForPage(projectId),
  ])
  const project = projects.find((candidate) => candidate.id === projectId)
  const projectName = project?.name ?? t('wiki.projectFallback')
  const title = data.topic
    ? `${projectName} · ${data.topic.title}`
    : `${projectName}${t('wiki.heroTitleSuffix')}`
  const canEditDocuments = isProjectMember(membership, projectId)
  // instant(갱신·검증·변경 시각)의 tz = 프로젝트 달력 — 못 읽거나 손상이면 본문 자리에 사유(서울·UTC 로 대체하지 않는다, 계획 D-21a)
  const cal = pc.ok ? pickCalendar(pc.cfg) : null
  if (!cal?.ok) {
    return (
      <ProjectPageShell hero={<PageHeader title={title} />}>
        {cal ? <ConfigLoadError error={cal.error} keyName={cal.key} kind={cal.kind} />
          : <ConfigLoadError error={pc.ok ? '' : pc.error} />}
      </ProjectPageShell>
    )
  }
  // 근거·변경의 회의록 링크를 슬러그 형식으로(D38 ①, 과제 35) — 레이아웃이 같은 요청에서 부른 workspaceRefById(React cache)를 다시 쓴다.
  // 열화·조회 실패면 영구 링크 형식(스텁이 행의 워크스페이스로 보낸다, D6) — 링크가 틀리지 않고 한 번 더 돈다
  const wid = membership?.projectWorkspace.get(projectId)
  // 로컬 초안 정책(개정 §5.8.5)은 워크스페이스 전역 키 — 프로젝트 화면도 워크스페이스 값을 따른다. 못 읽으면 초안을 끈다(fail-closed)
  const [wsRef, draftPolicy] = await Promise.all([wid ? workspaceRefById(wid) : null, loadLocalDraftPolicy(wid ?? null)])
  const minutesBase = wsRef?.ok ? wsHref(wsRef.ws.slug, 'minutes') : undefined

  return (
    <ProjectPageShell hero={<PageHeader title={title} />}>
      <WikiTopicDetail
        projectId={projectId}
        data={data}
        canCurate={isProjectAdmin(membership, projectId)}
        canEditDocuments={canEditDocuments}
        canVerifyDocuments={canEditDocuments}
        userId={membership?.userId ?? null}
        timeZone={cal.calendar.timezone}
        minutesBase={minutesBase}
        draftPolicy={draftPolicy}
      />
    </ProjectPageShell>
  )
}
