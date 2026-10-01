import { notFound } from 'next/navigation'
import {
  getMinuteDetail, getMinuteAnnotations, getMinuteVersions, getMinuteWikiImpact,
  getMinuteVersionBody, getMinuteFolderPath,
} from '@/lib/data/minutes'
import { getSession } from '@/lib/auth'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { BRAND } from '@/lib/branding'
import { canEditMinute } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { getAccountPrefs } from '@/app/actions/preferences'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { parseMinuteSourceAnchor } from '@/lib/minutes/source'
import { getMinuteLinkedIssues } from '@/lib/data/issues'
import { getProjectRoster, getMyProjectIds } from '@/lib/data/members'
import { requireModulePage } from '@/lib/modules/pageGate'
import { moduleSetFor } from '@/lib/modules/gate'
import { UUID_RE } from '@/lib/domain/validate'
import { wsHref } from '@/lib/workspace/paths'

export const metadata = { title: `회의록 | ${BRAND.productName}` }   // V6 — C 레이아웃의 '설정' 제목을 덮는다

export default async function MinuteDetailPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; id: string }>
  searchParams: Promise<{
    block?: string | string[]
    hash?: string | string[]
    body?: string | string[]
    version?: string | string[]
  }>
}) {
  const [{ slug, id }, query] = await Promise.all([params, searchParams])
  const scope = await loadWorkspaceScope(slug)                              // 첫 await — 슬러그 판정(E19)
  // 형식 밖 id 는 조회 없이 404 — 옛 /minutes/<id> 스텁이 형식 밖 id 를 그대로 이 주소로 보낸다. 보내면 Postgres 22P02 가
  // 오류 경계가 되고 입력 문자열(공격자가 정한 값)이 서버 오류 로그에 실린다(U2a-3 리뷰 V1)
  if (!UUID_RE.test(id)) notFound()
  // ?version= 도 같다 — 판 본문 조회의 22P02 로그에 입력 문자열이 실리지 않게 조회 전에 404(U2a-4 리뷰 T5)
  if (typeof query.version === 'string' && !UUID_RE.test(query.version)) notFound()
  // 대상 행의 워크스페이스로 판정(스펙 §4.2 2행). getMinuteDetail 은 react cache — 아래 묶음이 다시 읽지 않는다
  const head = await getMinuteDetail(id)
  // 다른 워크스페이스의 행은 이 주소로 열지 않는다(D6 — 옛 /minutes/<id> 스텁이 행의 워크스페이스로 보낸다)
  if (!head?.minute.workspaceId || head.minute.workspaceId !== scope.ws.id) notFound()
  await requireModulePage({ workspaceId: head.minute.workspaceId }, 'minutes')
  const sourceAnchor = parseMinuteSourceAnchor(query)
  const requestedVersionId = typeof query.version === 'string' ? query.version : null
  // P20 — 연결 이슈·위키 영향은 그 회의록의 프로젝트(없으면 워크스페이스)에서 모듈이 켜졌을 때만. 판정 실패는 core 만(= 숨김, 로그는 moduleSetFor)
  const modScope = head.minute.projectId ? { projectId: head.minute.projectId } : { workspaceId: head.minute.workspaceId }
  // prefs 는 기존 병렬 묶음에 합류 — 직렬 왕복 단수는 그대로다(스펙 §4.5)
  const [detail, annotations, versions, requestedVersion, user, projects, prefs, linkedIssuesRaw, mods] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMinuteVersions(id, wsHref(scope.ws.slug, 'minutes')),
    requestedVersionId ? getMinuteVersionBody(id, requestedVersionId) : Promise.resolve(null),
    getSession(), listProjects(), getAccountPrefs(), getMinuteLinkedIssues(id),
    moduleSetFor(modScope),
  ])
  const m = scope.actor
  const linkedIssues = mods.has('issues') ? linkedIssuesRaw : []
  if (!detail) notFound()
  if (requestedVersionId && !requestedVersion) notFound()
  const issueProjectId = detail.minute.projectId ?? detail.minute.meetingProjectId ?? null
  // folderPath 는 folderId 를 알아야 풀 수 있어 이 2단 묶음에 합류시킨다 — 위 Promise.all 로
  // 끌어올릴 수 없고, 단독으로 await 하면 직렬 왕복이 한 단 더 붙는다.
  const [wikiImpact, issueRoster, folderPath, myProjectIds] = await Promise.all([
    // 위키 영향은 service_role 로더 — 권한 조회 열화(scope.degraded)에서는 부르지 않는다(workspaceScope 계약, U2a-3 리뷰 V3)
    mods.has('wiki') && !scope.degraded
      ? getMinuteWikiImpact(id, detail.minute.projectId ?? null, detail.minute.projectName ?? null)
      : Promise.resolve(null),
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
    />
  )
}
