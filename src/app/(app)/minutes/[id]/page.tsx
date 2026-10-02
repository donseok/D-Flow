import { notFound } from 'next/navigation'
import {
  getMinuteDetail, getMinuteAnnotations, getMinuteVersions, getMinuteWikiImpact,
  getMinuteVersionBody, getMinuteFolderPath,
} from '@/lib/data/minutes'
import { getSession } from '@/lib/auth'
import { getActorForView } from '@/lib/authz'
import { canEditMinute } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { getUiPrefs } from '@/app/actions/preferences'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { parseMinuteSourceAnchor } from '@/lib/minutes/source'
import { getMinuteLinkedIssues } from '@/lib/data/issues'
import { getProjectRoster, getMyProjectIds } from '@/lib/data/members'
import { requireModulePage } from '@/lib/modules/pageGate'
import { minuteScopeTimezone } from '@/lib/minutes/timeFix.server'

export default async function MinuteDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    block?: string | string[]
    hash?: string | string[]
    body?: string | string[]
    version?: string | string[]
  }>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  // 대상 행의 워크스페이스로 판정(스펙 §4.2 2행). getMinuteDetail 은 react cache — 아래 묶음이 다시 읽지 않는다
  const head = await getMinuteDetail(id)
  if (!head?.minute.workspaceId) notFound()
  await requireModulePage({ workspaceId: head.minute.workspaceId }, 'minutes')
  const sourceAnchor = parseMinuteSourceAnchor(query)
  const requestedVersionId = typeof query.version === 'string' ? query.version : null
  // prefs 는 기존 병렬 묶음에 합류 — 직렬 왕복 단수는 그대로다(스펙 §4.5)
  const [detail, annotations, versions, requestedVersion, m, user, projects, prefs, linkedIssues] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMinuteVersions(id),
    requestedVersionId ? getMinuteVersionBody(id, requestedVersionId) : Promise.resolve(null),
    getActorForView(), getSession(), listProjects(), getUiPrefs(), getMinuteLinkedIssues(id),
  ])
  if (!detail) notFound()
  if (requestedVersionId && !requestedVersion) notFound()
  const issueProjectId = detail.minute.projectId ?? detail.minute.meetingProjectId ?? null
  // folderPath 는 folderId 를 알아야 풀 수 있어 이 2단 묶음에 합류시킨다 — 위 Promise.all 로
  // 끌어올릴 수 없고, 단독으로 await 하면 직렬 왕복이 한 단 더 붙는다.
  const [wikiImpact, issueRoster, folderPath, myProjectIds] = await Promise.all([
    getMinuteWikiImpact(
      id,
      detail.minute.projectId ?? null,
      detail.minute.projectName ?? null,
    ),
    issueProjectId ? getProjectRoster(issueProjectId) : Promise.resolve(null),
    getMinuteFolderPath(detail.minute.folderId ?? null),
    getMyProjectIds(),
  ])
  // 이슈 담당자 명단 실패는 뷰어가 이슈 폼을 열 때 사유로 보인다 — 빈 담당자 목록으로 열지 않는다.
  if (issueRoster && !issueRoster.ok) {
    console.error(`[minutes] 명단 조회 실패(project=${issueProjectId}) — 회의록 ${id} 에서 이슈 등록을 막고 사유를 알린다`)
  }
  const issueMembers = issueRoster?.ok ? issueRoster.rows : []
  const issueMembersError = issueRoster && !issueRoster.ok ? issueRoster.error : null
  const historicalVersion = requestedVersion
    ? { id: requestedVersion.id, versionNo: requestedVersion.versionNo }
    : null
  const displayMinute = requestedVersion
    ? {
      ...detail.minute,
      bodyMd: requestedVersion.bodyMd,
      title: requestedVersion.title ?? detail.minute.title,
      minuteDate: requestedVersion.minuteDate ?? detail.minute.minuteDate,
      teamCode: requestedVersion.teamCode ?? detail.minute.teamCode,
      meetingId: requestedVersion.meetingId,
      projectId: requestedVersion.projectId,
      projectName: projects.find(project => project.id === requestedVersion.projectId)?.name ?? null,
      meetingOccurrenceDate: requestedVersion.meetingOccurrenceDate,
      updatedAt: requestedVersion.createdAt,
    }
    : detail.minute
  const displayAnnotations = requestedVersion ? { highlights: [], insights: [] } : annotations
  // 서버 checkOwner 와 같은 canEditMinute — 행의 project_id·workspace_id 로 판정한다(회의 폴백 projectId 아님).
  // 멤버가 아닌 작성자·무프로젝트 회의록의 비슈퍼유저에게는 버튼을 열지 않는다.
  const canManage = !requestedVersion && !detail.minute.archivedAt
    && !!detail.minute.workspaceId
    && canEditMinute(m, {
      created_by: detail.minute.createdBy ?? null,
      project_id: detail.minute.ownProjectId ?? null,
      workspace_id: detail.minute.workspaceId,
    })
  // 버전·위키 처리 시각의 tz = 회의록 범위(녹취 보정과 같은 판정 — 계획 P8, A-4 리뷰 N7). 못 읽으면 시각만 '—'(로그) — 회의록 화면 전체를 막지 않는다
  const timeZone = await minuteScopeTimezone({ projectId: detail.minute.ownProjectId ?? null, workspaceId: head.minute.workspaceId })
    .catch((e: unknown) => { console.error('[minutes] 회의록 범위 달력 판독 실패 — 시각 표시 생략', { id, cause: String(e) }); return null })
  return (
    <MinuteViewer
      minute={displayMinute} canManage={canManage}
      files={detail.files.ok ? detail.files.rows : []} filesError={detail.files.ok ? null : detail.files.error}
      annotations={displayAnnotations} userId={user?.id ?? null} projects={projects}
      sourceAnchor={sourceAnchor} initialFontSize={prefs.minuteFontSize ?? null}
      versions={versions.ok ? versions.rows : []} versionsError={versions.ok ? null : versions.error}
      wikiImpact={wikiImpact}
      historicalVersion={historicalVersion}
      issueMembers={issueMembers} issueMembersError={issueMembersError} linkedIssues={linkedIssues}
      folderPath={folderPath} myProjectIds={myProjectIds}
      projectWorkspaces={Object.fromEntries(m?.projectWorkspace ?? [])}
      timeZone={timeZone}
    />
  )
}
