import { notFound, unstable_rethrow } from 'next/navigation'
import {
  getMinuteDetail, getMinuteAnnotations, getMinuteVersions, getMinuteWikiImpact,
  getMinuteVersionBody, getMinuteFolderPath,
} from '@/lib/data/minutes'
import { getSession } from '@/lib/auth'
import { loadWorkspaceScope } from '@/lib/authz/workspaceScope'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { adminProjectIds, canEditMinute } from '@/lib/domain/authz'
import { listProjects } from '@/app/actions/project'
import { getAccountPrefs } from '@/app/actions/preferences'
import { MinuteViewer } from '@/components/minutes/MinuteViewer'
import { parseMinuteSourceAnchor } from '@/lib/minutes/source'
import { getMinuteLinkedIssues } from '@/lib/data/issues'
import { getMinuteLinkedWbsItems } from '@/lib/data/wbsLinks'
import { getProjectRoster, getMyProjectIds } from '@/lib/data/members'
import { requireModulePage } from '@/lib/modules/pageGate'
import { minuteScopeTimezone } from '@/lib/minutes/timeFix.server'
import { moduleSetFor } from '@/lib/modules/gate'
import { UUID_RE } from '@/lib/domain/validate'
import { wsHref } from '@/lib/workspace/paths'
import { t as tDict } from '@/lib/i18n/dict'
import { serverTranslator } from '@/lib/i18n/server'

/** 탭 제목 — 사전에서 꺼낸다('회의록') */
export async function generateMetadata() { return { title: tDict('nav.minutes') } }   // 레이아웃 템플릿이 ' · {워크스페이스} | {제품}' 을 붙인다(V6)

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
  // 명단 밖 비공개 프로젝트의 회의록은 id(북마크·알림·출처 링크)로도 열지 않는다 — 목록·검색·내보내기와 같은 화면 숨김(FA1).
  // 기준은 행 자신의 project_id(목록의 거르기와 같다 — 회의 폴백 projectId 아님). 판정 실패는 던져 범위 오류 경계로(fail-closed).
  // 모듈 관문 바로 뒤·본문/판/주석 로더 앞(페이지 관문 불변식 — 첫 데이터 await 는 관문, 꺼짐도 같은 404 라 존재가 갈리지 않는다)
  if (head.minute.ownProjectId && (await getHiddenProjectIds()).has(head.minute.ownProjectId)) notFound()
  const sourceAnchor = parseMinuteSourceAnchor(query)
  const requestedVersionId = typeof query.version === 'string' ? query.version : null
  // P20 — 연결 이슈·위키 영향은 그 회의록의 프로젝트(없으면 워크스페이스)에서 모듈이 켜졌을 때만. 판정 실패는 core 만(= 숨김, 로그는 moduleSetFor)
  const modScope = head.minute.projectId ? { projectId: head.minute.projectId } : { workspaceId: head.minute.workspaceId }
  // 명단 밖 비공개 프로젝트 — 연결 목록(이슈·WBS)을 거르는 재료. 연결 표의 읽기는 범위(accessible_project_ids)라 워크스페이스의 비공개 프로젝트
  // 연결도 온다(코드·이름이 배지·팝오버·카드로 새는 것을 막는다 — 목록·검색과 같은 화면 숨김 FA1). 요청 캐시라 위 상세 숨김의 판정과 같은 값이다.
  // 못 하면 던지지 않고 연결을 싣지 않는다(fail-closed — 본문은 그대로 연다)
  const hiddenLookup = getHiddenProjectIds().then(
    (set) => ({ ok: true as const, set }),
    (e: unknown) => {
      unstable_rethrow(e)
      console.error(`[minutes] 비공개 프로젝트 판정 실패 — 회의록 ${id} 의 연결 목록을 싣지 않는다`, e instanceof Error ? e.message : e)
      return { ok: false as const }
    },
  )
  // prefs 는 기존 병렬 묶음에 합류 — 직렬 왕복 단수는 그대로다(스펙 §4.5)
  const [detail, annotations, versions, requestedVersion, user, projects, prefs, linkedIssuesRaw, linkedWbs, mods, hidden] = await Promise.all([
    getMinuteDetail(id), getMinuteAnnotations(id), getMinuteVersions(id, wsHref(scope.ws.slug, 'minutes')),
    requestedVersionId ? getMinuteVersionBody(id, requestedVersionId) : Promise.resolve(null),
    getSession(), listProjects(), getAccountPrefs(), getMinuteLinkedIssues(id), getMinuteLinkedWbsItems(id),
    moduleSetFor(modScope), hiddenLookup,
  ])
  const m = scope.actor
  const visibleLink = (link: { projectId: string }) => hidden.ok && !hidden.set.has(link.projectId)
  const linkedIssues = mods.has('issues') && hidden.ok ? linkedIssuesRaw.filter(visibleLink) : []
  // 회의록 문단 → WBS 작업 연결(설계 2026-10-21-minutes-to-wbs §3.3·§5.6) — 연결 표는 회의록 모듈 소유라 그 범위에서 회의록이 켜졌을 때만 싣는다.
  // 못 읽으면(연결 조회·비공개 판정) 빈 목록이 아니라 사유를 넘긴다 — "등록됨"을 판정할 수 없으므로 뷰어가 WBS 등록을 열지 않고 사유를 보인다(§8).
  // 꺼진 범위는 연결도 사유도 등록 가능 프로젝트도 싣지 않는다 — 준비 액션이 모듈 관문에서 막히므로 단추를 보이지 않는다.
  const wbsOn = mods.has('minutes')
  const linkedWbsItems = wbsOn && linkedWbs.ok && hidden.ok ? linkedWbs.rows.filter(visibleLink) : []
  const linkedWbsItemsError = !wbsOn ? null
    : !linkedWbs.ok ? linkedWbs.error
      : !hidden.ok ? (await serverTranslator())('srv.minuteWbs.linksUnavailable') : null
  if (linkedWbsItemsError !== null) console.error(`[minutes] 연결된 WBS 작업 조회 실패 — 회의록 ${id} 에서 WBS 등록을 막고 사유를 알린다`)
  // WBS 로 등록할 수 있는 프로젝트 — 액션 가드(requireProjectAdmin)와 같은 판정(플랫폼 관리자는 전부, 워크스페이스 관리자는 승계)을
  // 보이는 프로젝트(listProjects) 안에서만. 권한을 모르면(actor null — 열화) 없음: 등록 단추를 열지 않는다.
  const wbsAdminProjectIds: string[] = m && wbsOn
    ? (m.isSuperuser ? projects.map(p => p.id) : adminProjectIds(m).filter(pid => projects.some(p => p.id === pid)))
    : []
  if (!detail) notFound()
  if (requestedVersionId && !requestedVersion) notFound()
  // 판을 고른 링크(WBS 상세의 「원문 위치 보기」·이슈 원문 — minuteSourceHref 가 version= 을 단다)가 지금 판을 가리키면 지난 판 화면(읽기 전용
  // 배너·팝오버/등록 없음)이 아니라 평소 화면으로 연다 — 앵커 점프는 같다. 옛 판만 지난 판 화면이다. 버전 목록을 못 읽으면 지금 판인지 알 수 없어
  // 지난 판 화면 그대로 둔다(읽기 전용 쪽이 안전). 목록은 판 번호 내림차순이라 첫 행이 지금 판이다
  const latestVersionId = versions.ok ? versions.rows[0]?.id ?? null : null
  const pinnedVersion = requestedVersion && requestedVersion.id !== latestVersionId ? requestedVersion : null
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
  const historicalVersion = pinnedVersion
    ? { id: pinnedVersion.id, versionNo: pinnedVersion.versionNo }
    : null
  const displayMinute = pinnedVersion
    ? {
      ...detail.minute,
      bodyMd: pinnedVersion.bodyMd,
      title: pinnedVersion.title ?? detail.minute.title,
      minuteDate: pinnedVersion.minuteDate ?? detail.minute.minuteDate,
      teamCode: pinnedVersion.teamCode ?? detail.minute.teamCode,
      meetingId: pinnedVersion.meetingId,
      projectId: pinnedVersion.projectId,
      projectName: projects.find(project => project.id === pinnedVersion.projectId)?.name ?? null,
      meetingOccurrenceDate: pinnedVersion.meetingOccurrenceDate,
      updatedAt: pinnedVersion.createdAt,
    }
    : detail.minute
  const displayAnnotations = pinnedVersion ? { highlights: [], insights: [] } : annotations
  // 서버 checkOwner 와 같은 canEditMinute — 행의 project_id·workspace_id 로 판정한다(회의 폴백 projectId 아님).
  // 멤버가 아닌 작성자·무프로젝트 회의록의 비슈퍼유저에게는 버튼을 열지 않는다.
  const canManage = !pinnedVersion && !detail.minute.archivedAt
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
      linkedWbsItems={linkedWbsItems} linkedWbsItemsError={linkedWbsItemsError} wbsAdminProjectIds={wbsAdminProjectIds}
      folderPath={folderPath} myProjectIds={myProjectIds}
      projectWorkspaces={Object.fromEntries(m?.projectWorkspace ?? [])}
      timeZone={timeZone}
    />
  )
}
