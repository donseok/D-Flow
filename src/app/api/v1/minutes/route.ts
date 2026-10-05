import { after, NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BRAND } from '@/lib/branding'
import { folderPathOf, refileMinuteAfterProjectChange, resolveFolderPath } from '@/lib/minutes/folders'
import { loadRootFolders } from '@/lib/minutes/rootMode'
import type { RootFoldersSetting } from '@/lib/minutes/rootFolders'
import { fnv1a64 } from '@/lib/minutes/blocks'
import {
  enqueueMinuteWikiProcessing,
  rebuildProjectWikiFromActiveMinutes,
} from '@/lib/ai/wiki-ingest'
import { activeTeamCodesForMinuteScope, type MinuteScope } from '@/lib/minutes/teamScope'
import { teamCodesVisibleTo } from '@/lib/teams/source'
import { validateMinuteTeam } from '@/lib/domain/minutes'
import {
  apiBadRequest, apiFail, apiInternalError, apiModuleDisabled, apiNotFound, apiProjectNotAllowed,
  isMinutesWorkspaceMember, parseMinutePayload, parseUserEmail, resolveMinutesPrincipal,
  resolveUserByEmail, runMinutePostProcessing, type AdminClient, type ExternalMinutePayload,
  type MinutesPrincipal, type ResolvedUser,
} from '@/lib/minutes/externalApi'
import { requireModule, workspacesWithModule } from '@/lib/modules/gate'
import { resolveOrCreateExternalMeeting } from '@/lib/minutes/meetings'
import { actorFromUser } from '@/lib/authz'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { canEditMinute, canSeeProject, hasProjectRoleInWorkspace, isProjectMember, teamViewOf, type Actor } from '@/lib/domain/authz'
import type { TeamCode } from '@/lib/domain/types'
import { credentialAllows, resolveCredentialTeam } from '@/lib/authz/credentials'
import { projectTeams, workspaceTeams } from '@/lib/teams/source'

/**
 * POST /api/v1/minutes — 회의록 생성/갱신(upsert by external_id), GET — 목록/존재 확인.
 * 계약: docs/design/dflow-minutes-upload-api-spec.md §4·§5.1. 또박또박 서버가 호출한다.
 *
 * SP2(계약 v2.7) — 시크릿만으로는 호출자가 누구인지 모른다. 두 메서드 모두 user_email 의 권한 스냅샷
 * (actorFromUser)으로 좁힌다: 목록은 볼 수 있는 회의록만, 쓰기는 연결할 회의의 프로젝트 멤버·기존 회의록의
 * 편집 자격(canEditMinute)이 있을 때만. 자격이 없으면 없는 자원과 같은 404 다(존재 은닉).
 */

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 편집 자격이 없는 기존 회의록 — 없는 것과 구별하지 않는다(다른 워크스페이스 external_id 의 존재 은닉). */
const minuteNotFound = () => apiFail(404, 'not_found', '회의록을 찾을 수 없습니다.')

const MINUTE_SELECT = 'id, minute_date, team_code, title, body_md, meeting_id, project_id, meeting_occurrence_date, archived_at, external_id, folder_id, created_by, created_by_name, created_at, updated_at, workspace_id'

interface ExistingRow {
  id: string
  minute_date: string
  team_code: string
  title: string
  body_md: string
  meeting_id: string | null
  project_id: string | null
  meeting_occurrence_date: string | null
  archived_at: string | null
  external_id: string
  folder_id: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  workspace_id: string
}

/**
 * 편철 품질 신호(계약 v2.4 §4.3 · 결정 §2-C). 경로가 짧아지는 원인이 3개라 boolean 하나로는
 * 또박또박이 구분할 수 없고, 스스로 판정하려면 정규화 규칙과 팀 캐시를 재구현해야 한다.
 */
type FolderPathStatus = 'exact' | 'truncated' | 'partial' | 'unclassified'

/**
 * 계약 §4.3 응답. folder_id·folder_path 는 **둘 다 nullable**(v2.3 §3.3):
 *   folder_id: null + folder_path: null  → 미분류(시드 루트 부재 폴백)
 *   folder_id: <id> + folder_path: []    → 성립하지 않음 — 경로는 최소 [팀코드]다
 * `[]`(팀 루트 편철 성공)와 `null`(미분류)을 뭉개면 또박또박이 정반대 안내를 한다.
 */
function respondMinute(req: NextRequest, status: number, args: {
  id: string; action: 'created' | 'replaced' | 'skipped'
  title: string; date: string; team: string; meetingId: string | null
  externalId: string; createdByName: string | null; createdAt: string; updatedAt: string
  folderId: string | null; folderPath: string[] | null
  folderPathStatus: FolderPathStatus
  /** v2.5 §4.3 — inline meeting 처리 시에만 값이 있다. undefined 면 키 자체를 넣지 않아 기존 응답 불변. */
  meetingCreated?: boolean
  workspaceSlug?: string | null
}) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const minuteUrl = args.workspaceSlug
    ? `${origin}/w/${args.workspaceSlug}/minutes/${args.id}`
    : `${origin}/minutes/${args.id}`
  return NextResponse.json({
    ok: true, id: args.id, action: args.action,
    title: args.title, date: args.date, team: args.team,
    meeting_id: args.meetingId, external_id: args.externalId,
    ...(args.meetingCreated === undefined ? {} : { meeting_created: args.meetingCreated }),
    folder_id: args.folderId, folder_path: args.folderPath,
    folder_path_status: args.folderPathStatus,
    created_by_name: args.createdByName,
    url: minuteUrl,
    created_at: args.createdAt, updated_at: args.updatedAt,
  }, { status })
}

/** 이 요청이 쓰게 될 회의록의 범위와 그 범위의 활성 팀 — 담당 팀 검증·폴더 해석·재편철이 모두 이 값을 쓴다. */
interface WriteTarget {
  scope: MinuteScope
  activeTeamCodes: TeamCode[]
  /** 그 워크스페이스의 최상위 폴더 모드(SP5 B2) */
  rootMode: RootFoldersSetting
}

/** 회의록의 워크스페이스는 바뀌지 않는다 — 다른 워크스페이스 프로젝트의 회의로 옮기는 요청의 400 문구. */
const CROSS_WORKSPACE_MSG = '다른 워크스페이스의 프로젝트(회의)로는 회의록을 옮길 수 없습니다.'

/**
 * 쓰기 대상 확정 — 쓰기(inline 회의 생성·폴더 생성·RPC) 전에 부른다.
 * 프로젝트는 새로 연결할 회의(inline meeting·meeting_id)가 정하고, 없으면 기존 행의 것. 워크스페이스는 기존 행이면 그 행의
 * 것이다 — 다른 워크스페이스 프로젝트로의 연결은 400(예전에는 상대 워크스페이스 트리에 폴더를 만든 뒤 0006 트리거
 * WORKSPACE_SCOPE_MISMATCH 로 500 이었다). 새 회의록이면 프로젝트의 것, 없으면 호출자의 유일 워크스페이스(전환 UI 는 SP3).
 * 담당 팀은 그 범위의 활성 팀이어야 한다 — 전 워크스페이스 공용 목록이면 다른 워크스페이스의 팀 코드가 통과한다. 목록은 팀
 * 원천(SP4 A2 — 요청 범위, 세션이 없으므로 service_role)에서 읽는다. 팀 원천 실패는 throw → 라우트 catch 의 500(빈 목록으로 위장하지 않는다).
 */
async function resolveWriteTarget(
  p: ExternalMinutePayload, ex: ExistingRow | null, meetingProjectId: string | null, authz: Actor, admin: AdminClient,
  principal?: MinutesPrincipal,
): Promise<{ ok: true; target: WriteTarget } | { ok: false; response: NextResponse }> {
  let scope: MinuteScope
  const linkProjectId = p.meeting ? p.meeting.projectId : p.meetingId ? meetingProjectId : null
  if (linkProjectId) {
    if (principal?.kind === 'minutes_api') {
      if (!credentialAllows(principal.credential, linkProjectId)) {
        return { ok: false, response: apiProjectNotAllowed() }
      }
    }
    // 연결 자격(그 프로젝트의 멤버 이상)이 팀·워크스페이스 판정보다 먼저다 — 뒤에 두면 같은 워크스페이스의 비멤버가
    // 400(팀 불일치)과 404 를 갈라 비공개 프로젝트의 팀 구성을 떠볼 수 있다. meeting_id 는 호출부가 이미 같은 판정을
    // 했고, inline meeting 은 resolveOrCreateExternalMeeting 과 같은 404 다(남의·없는 프로젝트를 구별하지 않는다).
    // 스냅샷은 호출자 워크스페이스의 프로젝트 전부다(플랫폼 관리자는 전부) — 멤버면 워크스페이스가 있다.
    const linkWs = authz.projectWorkspace.get(linkProjectId)
    if (!linkWs || !isProjectMember(authz, linkProjectId)) {
      return { ok: false, response: apiFail(404, 'not_found', '프로젝트를 찾을 수 없습니다.') }
    }
    if (principal?.kind === 'minutes_api' && linkWs !== principal.credential.workspaceId) {
      return { ok: false, response: apiFail(404, 'not_found', '프로젝트를 찾을 수 없습니다.') }
    }
    if (ex && linkWs !== ex.workspace_id) return { ok: false, response: apiBadRequest(CROSS_WORKSPACE_MSG) }
    scope = { projectId: linkProjectId, workspaceId: linkWs }
  } else if (ex) {
    if (principal?.kind === 'minutes_api') {
      if (ex.workspace_id !== principal.credential.workspaceId) {
        return { ok: false, response: minuteNotFound() }
      }
      if (ex.project_id && !credentialAllows(principal.credential, ex.project_id)) {
        return { ok: false, response: apiProjectNotAllowed() }
      }
    }
    scope = { projectId: ex.project_id, workspaceId: ex.workspace_id }
  } else if (principal?.kind === 'minutes_api') {
    const defaultPid = principal.credential.defaultProjectId
    scope = { projectId: defaultPid, workspaceId: principal.credential.workspaceId }
  } else {
    const w = resolveSoleWorkspaceId(authz)
    if (!w.ok) {
      return {
        ok: false,
        response: apiBadRequest('프로젝트 없는 회의록은 소속 워크스페이스가 하나인 계정만 등록할 수 있습니다. meeting_id 로 프로젝트를 지정하세요.'),
      }
    }
    // 세션 createMinute 과 같은 자격 — 그 워크스페이스에 역할(명단 권한 또는 워크스페이스 관리자)이 있어야 한다. 조회 전용은 프로젝트
    // 분기와 같은 404(조회 전용이 만든 회의록은 canEditMinute 로 본인도 다시 보낼 수 없었다).
    if (!hasProjectRoleInWorkspace(authz, w.workspaceId)) {
      return { ok: false, response: apiFail(404, 'not_found', '프로젝트를 찾을 수 없습니다.') }
    }
    scope = { projectId: null, workspaceId: w.workspaceId }
  }

  if (principal?.kind === 'minutes_api') {
    const candidateTeams = scope.projectId
      ? await projectTeams(scope.projectId, { client: admin })
      : await workspaceTeams(scope.workspaceId, { client: admin })
    const teamRes = resolveCredentialTeam(principal.credential, p.teamCode, candidateTeams)
    if (!teamRes.ok) {
      if (teamRes.reason === 'inactive') {
        return { ok: false, response: apiFail(400, 'team_inactive', '비활성화된 담당 팀입니다.') }
      }
      return { ok: false, response: apiBadRequest('잘못된 담당입니다.') }
    }
    const chosen = candidateTeams.find(t => t.id === teamRes.teamId)
    if (chosen) {
      p.teamCode = chosen.code as TeamCode
    }
  } else {
    const activeTeamCodes = await activeTeamCodesForMinuteScope(scope, { client: admin })
    const teamErr = validateMinuteTeam(p.teamCode, activeTeamCodes)
    if (teamErr) return { ok: false, response: apiBadRequest(teamErr) }
  }

  const activeTeamCodes = await activeTeamCodesForMinuteScope(scope, { client: admin })
  // 최상위 폴더 모드(SP5 B2 — 계약 v2.9) — 편철 정규화가 모드로 갈리므로 못 읽으면 쓰지 않는다(새 오류 code 없이 500 — Q6)
  const roots = await loadRootFolders(scope.workspaceId, { client: admin })
  if (!roots.ok) return { ok: false, response: apiInternalError() }
  return { ok: true, target: { scope, activeTeamCodes, rootMode: roots.value } }
}

/**
 * 팀 루트 폴더 id — folder_path 키 부재 폴백 전용(§3.2-5 의 등록/이동 경로).
 * `resolveTeamRootFolderId`(순수 select)와 달리 `resolveFolderPath(path: [])`를 태워
 * **팀 루트가 없으면 지연 생성**한다(공유 `ensureTeamRoot` 구현 — custom 모드면 만들지 않고 미분류) — 0076 시드는
 * "회의록이 이미 있던 프로젝트"만 커버해, 회의록 0건 프로젝트의 첫 업로드나 0076 이후 신설
 * 팀에서는 시드가 없다. 여기서 생성하지 않으면 그 경로가 전부 미분류로 떨어진다.
 */
async function resolveTeamRootWithLazyCreate(
  admin: AdminClient, teamCode: TeamCode, target: WriteTarget, actorId: string,
): Promise<string | null> {
  const res = await resolveFolderPath(admin, teamCode, [], {
    actorId, activeTeamCodes: target.activeTeamCodes,
    projectId: target.scope.projectId, workspaceId: target.scope.workspaceId, rootMode: target.rootMode,
  })
  return res.ok ? res.folderId : null
}

/**
 * folder_path → 편철 대상 확정 (§3.1 3값 규약 · §3.2 정규화).
 * `provided: false` = 키 부재 → 호출부가 "기존 위치 유지 / 팀 루트 폴백"을 각자 정한다.
 * validation 실패만 400 이고, 시드 루트 부재(no_team_root)는 **등록을 막지 않는다**(§3.2-5).
 */
async function resolvePayloadFolder(
  admin: AdminClient, p: ExternalMinutePayload, actorId: string,
  /** 0076·0006 — 회의록이 속할 프로젝트 트리, 미지정이면 그 워크스페이스의 미지정 트리에서 해석한다. */
  target: WriteTarget,
): Promise<
  | { ok: true; provided: false }
  | {
      ok: true; provided: true
      folderId: string | null; folderPath: string[] | null; status: FolderPathStatus
    }
  | { ok: false; error: string }
> {
  if (!p.folderPathProvided || p.folderPath === null) return { ok: true, provided: false }
  const res = await resolveFolderPath(admin, p.teamCode, p.folderPath, {
    actorId,
    activeTeamCodes: target.activeTeamCodes,
    projectId: target.scope.projectId,
    workspaceId: target.scope.workspaceId,
    rootMode: target.rootMode,
  })
  if (!res.ok) {
    if (res.kind === 'validation_failed') return { ok: false, error: res.error }
    // no_team_root(팀 루트 부재·지연 생성 실패)·unmatched_root(custom 모드 루트 불일치 — v2.9) — 편철 실패가 등록 자체를
    // 막으면 안 된다. 미분류 + folder_id null(v2.8 §4.7-5 규약 그대로)
    console.error(`[minutes-api] ${res.error} 미분류 폴백(${res.kind}).`)
    return { ok: true, provided: true, folderId: null, folderPath: null, status: 'unclassified' }
  }
  if (!res.complete) {
    console.error(
      `[minutes-api] 폴더 경로 일부만 편철됨: ${res.resolvedPath.join('/')} (목표 ${res.targetPath.join('/')})`,
    )
  }
  // 심각한 쪽부터 — partial(생성 실패로 조상에 떨어짐)은 종전에 완전히 침묵하던 경로다.
  const status: FolderPathStatus = res.failed ? 'partial' : res.truncated ? 'truncated' : 'exact'
  return { ok: true, provided: true, folderId: res.folderId, folderPath: res.resolvedPath, status }
}

/** 동일 external_id 레코드가 이미 있을 때의 on_conflict 분기 — 계약 §4.2. */
async function handleExisting(
  req: NextRequest,
  admin: AdminClient,
  p: ExternalMinutePayload,
  existing: ExistingRow,
  actor: ResolvedUser,
  /** resolveWriteTarget 이 확정한 범위 — 워크스페이스는 기존 행의 것, 프로젝트는 연결할 회의 또는 기존 행의 것. */
  target: WriteTarget,
  meetingCreated?: boolean,
  workspaceSlug?: string | null,
): Promise<NextResponse> {
  if (existing.archived_at) {
    return apiFail(409, 'archived', '보관된 회의록입니다. 복원 후 다시 시도하세요.')
  }
  if (p.onConflict === 'error') return apiFail(409, 'conflict', '이미 존재하는 external_id 입니다.')
  if (p.onConflict === 'skip') {
    return respondMinute(req, 200, {
      id: existing.id, action: 'skipped', title: existing.title, date: existing.minute_date,
      team: existing.team_code, meetingId: existing.meeting_id, externalId: existing.external_id,
      createdByName: existing.created_by_name, createdAt: existing.created_at, updatedAt: existing.updated_at,
      folderId: existing.folder_id, folderPath: await folderPathOf(admin, existing.folder_id),
      folderPathStatus: existing.folder_id === null ? 'unclassified' : 'exact',
      workspaceSlug,
    })
  }
  // replace — §0 D3: created_by/created_by_name/external_id 는 갱신 범위 밖(소유권·멱등키 불변).
  // meeting_id 는 필드가 전송된 경우에만 갱신(부재=유지, null=해제 — v2.2) — 또박또박 v1은
  // 미전송이 기본이라 무조건 갱신하면 수동 연결분(E4)의 프로젝트 연관이 소리 없이 끊긴다.
  const nowIso = new Date().toISOString()
  const targetProjectId = target.scope.projectId
  // §3.1 D1=B: 재전송마다 또박또박이 폴더 위치의 SSOT다. 단 3값 — 키 부재면 metadata 에
  // folder_id 키를 **넣지 않아야** 기존 위치가 유지된다(RPC 는 키가 있으면 null 도 적용해
  // 미분류로 강등한다). 시드 루트 부재(folderId null)도 같은 이유로 키를 넣지 않는다 —
  // 되돌릴 위치가 없다고 회의록을 미분류로 빼내면 안 된다.
  // 미지정 트리는 이 회의록의 워크스페이스에서 고른다(0006 — 회의록 워크스페이스는 바뀌지 않는다). 다른 워크스페이스
  // 프로젝트로의 연결은 resolveWriteTarget 이 이미 거절했으므로 상대 트리에 폴더를 만들 일이 없다.
  const folder = await resolvePayloadFolder(admin, p, actor.id, target)
  if (!folder.ok) return apiBadRequest(folder.error)
  // ⚠️ 부분 편철(중간 폴더 생성 실패)이면 폴더를 **건드리지 않는다**. 신규 등록은 원래 자리가
  // 없으니 조상에 넣는 편이 미분류보다 낫지만, replace 는 이미 자리가 있는 회의록을 목표의
  // 조상으로 **강등**시키는 셈이다 — 배치가 failed(folder_error) 로 명시 금지한 바로 그 동작이다.
  const folderPartial = folder.provided && folder.status === 'partial'
  if (folderPartial) {
    console.error(`[minutes-api] 부분 편철 — 기존 위치를 유지한다(${p.externalId})`)
  }
  let folderUpdated = folder.provided && folder.folderId !== null && !folderPartial
  let teamMovedFolderId: string | null = null
  // 결정 §6 「구버전 replace 의 team 불일치」 — folder_path 키가 없는데 team 만 바뀐 재전송은
  // 폴더가 옛 팀 서브트리에 남아 "team=ERP 인데 폴더는 MES" 인 데이터를 만든다(§6.4 가 D&D
  // 에서 금지한 상태를 외부 API 가 정상 경로로 만드는 셈). 새 팀 루트로 옮긴다.
  // 400 거절은 구버전 클라이언트의 정상 조작(담당 정정)을 막으므로 채택하지 않는다.
  if (!folderUpdated && p.teamCode !== existing.team_code) {
    teamMovedFolderId = await resolveTeamRootWithLazyCreate(admin, p.teamCode, target, actor.id)
    if (teamMovedFolderId) folderUpdated = true
    else console.error(`[minutes-api] 담당 변경(${existing.team_code}→${p.teamCode}) 팀 루트 부재 — 폴더 유지`)
  }
  const metadata = {
    minute_date: p.minuteDate,
    team_code: p.teamCode,
    title: p.title,
    meeting_id: p.meetingIdProvided ? p.meetingId : existing.meeting_id,
    project_id: targetProjectId,
    meeting_occurrence_date: p.meetingIdProvided
      ? (p.meetingId ? p.minuteDate : null)
      : existing.meeting_occurrence_date,
    ...(folderUpdated ? { folder_id: teamMovedFolderId ?? (folder.provided ? folder.folderId : null) } : {}),
  }
  // 불변 버전 append + 본문/메타 갱신 + 파일 없는 현재 원본 포인터 해제를 한
  // DB 트랜잭션으로 처리한다. 이전 파일은 기존 minute_version이 계속 보존한다.
  const { data: committedRaw, error } = await admin.rpc('commit_minute_body_version', {
    p_minute_id: existing.id,
    p_body_md: p.bodyMd,
    p_body_hash: fnv1a64(p.bodyMd),
    p_file_name: null,
    p_file_path: null,
    p_file_size: null,
    p_file_mime: null,
    p_actor_id: actor.id,
    p_actor_name: actor.name,
    p_metadata: metadata,
  }).single()
  if (error || !committedRaw) {
    console.error('[minutes-api] replace 원자 커밋 실패:', error?.message ?? 'no row')
    // 계약 v2.4 ⑨ — 비활성 팀은 메타 갱신 RPC 가 t.active 를 요구해 반드시 실패한다.
    // 500 으로 두면 또박또박에서 원인 불명 장애로 보인다.
    if (error?.message?.includes('MINUTE_TEAM_INVALID')) {
      return apiFail(400, 'team_inactive', `비활성 팀(${p.teamCode})입니다. ${BRAND.productName}에서 팀을 활성화한 뒤 다시 시도하세요.`)
    }
    // 0006 트리거 — resolveWriteTarget 이 쓰기 전에 같은 판정을 하므로 경합(판정과 커밋 사이 회의 이동)에서만 닿는다.
    if (error?.message?.includes('WORKSPACE_SCOPE_MISMATCH')) return apiBadRequest(CROSS_WORKSPACE_MSG)
    return apiInternalError()
  }
  const committed = committedRaw as unknown as {
    version_id: string
    wiki_rebuild_required: boolean
  }
  const projectChanged = existing.project_id !== targetProjectId
  // 회의 연결이 바뀌어 프로젝트만 바뀐 경우 — RPC metadata 에는 folder_id 키를 넣지 않았으므로
  // (위 "무접촉" 규칙) 폴더는 그대로 옛 프로젝트 트리에 남아 있다. updateMinuteMeta 와 같은
  // 패턴으로 커밋 후 동기 재편철한다. teamMovedFolderId 가 이미 폴더를 옮겼으면(팀 변경 동시
  // 발생) 건드리지 않는다 — 그 경로는 새 위치가 이미 확정됐다. folder_path 를 보냈어도
  // (folder.provided) 해석이 실패해(unclassified/partial) 폴더를 못 옮겼으면 이 refile 이
  // 정리한다 — 조건에서 !folder.provided 를 뺐다(승인된 정리).
  if (projectChanged && !folderUpdated) {
    await refileMinuteAfterProjectChange(admin, {
      minuteId: existing.id, teamCode: p.teamCode, oldFolderId: existing.folder_id,
      newProjectId: targetProjectId, actorId: actor.id,
      activeTeamCodes: target.activeTeamCodes, rootMode: target.rootMode,
    })
  }
  const wikiJobId = committed.wiki_rebuild_required || projectChanged
    ? await enqueueMinuteWikiProcessing({
        projectId: targetProjectId,
        minuteId: existing.id,
        minuteVersionId: committed.version_id,
        bodyMd: p.bodyMd,
      })
    : null
  after(async () => {
    await Promise.all([
      runMinutePostProcessing(existing.id, p.bodyMd, {
        rematch: true,
        projectId: targetProjectId,
        minuteVersionId: committed.version_id,
        // 본문 교체/프로젝트 이동은 아래 전체 rebuild가 이 job까지 회의 시점 순서에
        // 맞춰 처리한다. 여기서 따로 실행하면 과거 회의가 늦게 적용돼 거짓 충돌이 생긴다.
        wikiJobId: committed.wiki_rebuild_required || projectChanged ? null : wikiJobId,
      }),
      projectChanged && existing.project_id
        ? rebuildProjectWikiFromActiveMinutes(existing.project_id, existing.id)
        : Promise.resolve(),
      (committed.wiki_rebuild_required || projectChanged) && targetProjectId
        ? rebuildProjectWikiFromActiveMinutes(targetProjectId)
        : Promise.resolve(),
    ])
  })
  // 에코는 **실제 편철 결과**다(§3.3) — 갱신했으면 새 위치, 아니면(키 부재·시드 루트 부재)
  // 손대지 않은 현재 위치. 요청한 경로를 그대로 되돌려주면 안 된다.
  const echoFolderId = folderUpdated
    ? (teamMovedFolderId ?? (folder.provided ? folder.folderId : null))
    : existing.folder_id
  return respondMinute(req, 200, {
    id: existing.id, action: 'replaced', title: p.title, date: p.minuteDate,
    team: p.teamCode, meetingId: p.meetingIdProvided ? p.meetingId : existing.meeting_id,
    externalId: p.externalId,
    // skipped 응답(위)에는 싣지 않는다 — v2.5 §4.3: created/replaced 전용.
    meetingCreated,
    createdByName: existing.created_by_name,
    createdAt: existing.created_at,
    updatedAt: nowIso,
    folderId: echoFolderId,
    folderPath: folderUpdated
      ? (teamMovedFolderId ? [p.teamCode] : (folder.provided ? folder.folderPath : null))
      : await folderPathOf(admin, existing.folder_id),
    folderPathStatus: echoFolderId === null
      ? 'unclassified'
      : (folder.provided && !teamMovedFolderId ? folder.status : 'exact'),
    workspaceSlug,
  })
}

async function insertNew(
  req: NextRequest,
  admin: AdminClient,
  p: ExternalMinutePayload,
  user: ResolvedUser,
  authz: Actor,
  /** resolveWriteTarget 이 확정한 범위 — 프로젝트는 연결할 회의의 것(없으면 null), 워크스페이스는 그 프로젝트의 것 또는 유일 소속. */
  target: WriteTarget,
  meetingCreated?: boolean,
  workspaceSlug?: string | null,
): Promise<NextResponse> {
  const meetingProjectId = target.scope.projectId
  // folder_path 를 받았으면 팀 루트 아래에 같은 폴더 트리를 만들어 편철하고(§3.2), 키가 아예
  // 없으면(구버전 또박또박) 기존대로 담당 팀 루트로 편철한다(0043). 부재·실패는 미분류(null)
  // 폴백 — 편철 실패가 등록 자체를 막으면 안 된다.
  const folder = await resolvePayloadFolder(admin, p, user.id, target)
  if (!folder.ok) return apiBadRequest(folder.error)
  const folderId = folder.provided
    ? folder.folderId
    : await resolveTeamRootWithLazyCreate(admin, p.teamCode, target, user.id)
  const folderPath = folder.provided
    ? folder.folderPath
    : (folderId ? [p.teamCode] : null)
  const { data: createdRaw, error } = await admin.rpc('create_minute_with_version', {
    p_minute_id: null,
    p_minute_date: p.minuteDate,
    p_team_code: p.teamCode,
    p_title: p.title,
    p_body_md: p.bodyMd,
    p_body_hash: fnv1a64(p.bodyMd),
    p_meeting_id: p.meetingId,
    p_project_id: meetingProjectId,
    p_meeting_occurrence_date: p.meetingId ? p.minuteDate : null,
    p_folder_id: folderId,
    p_external_id: p.externalId,
    p_actor_id: user.id,
    p_actor_name: user.name,
    p_file_name: null,
    p_file_path: null,
    p_file_size: null,
    p_file_mime: null,
    // 프로젝트가 있으면 null — RPC 가 프로젝트에서 얻는다(0006).
    p_workspace_id: meetingProjectId ? null : target.scope.workspaceId,
  }).single()
  if (error || !createdRaw) {
    // 동시 전송 경합: 부분 unique 인덱스 위반(23505)이면 그 사이 생긴 레코드 기준으로 재분기.
    if (error?.code === '23505') {
      const { data: raced, error: reErr } = await admin.from('minutes')
        .select(MINUTE_SELECT).eq('external_id', p.externalId).maybeSingle()
      if (!reErr && raced) {
        const racedRow = raced as ExistingRow
        // 경합으로 생긴 행도 같은 편집 자격 판정을 거친다 — 남의 external_id 로의 우회 덮어쓰기 차단.
        if (!canEditMinute(authz, racedRow)) return minuteNotFound()
        // 범위도 그 행 기준으로 다시 정한다(워크스페이스는 그 행의 것).
        const racedTarget = await resolveWriteTarget(p, racedRow, meetingProjectId, authz, admin)
        if (!racedTarget.ok) return racedTarget.response
        // 모듈 판정도 그 행의 워크스페이스로 다시 — 위에서 판정한 새 회의록 대상과 다를 수 있다(플랫폼 관리자의 다른 워크스페이스 행)
        const racedMod = await requireModule({ workspaceId: racedTarget.target.scope.workspaceId }, 'minutes_integration', { client: admin })
        if (!racedMod.ok) return apiModuleDisabled()
        return handleExisting(req, admin, p, racedRow, user, racedTarget.target, meetingCreated)
      }
    }
    console.error('[minutes-api] insert 실패:', error?.message ?? 'no row')
    return apiInternalError()
  }
  const created = createdRaw as unknown as {
    minute_id: string
    version_id: string
    created_at: string
    updated_at: string
    wiki_rebuild_required: boolean
  }
  const wikiJobId = await enqueueMinuteWikiProcessing({
    projectId: meetingProjectId,
    minuteId: created.minute_id,
    minuteVersionId: created.version_id,
    bodyMd: p.bodyMd,
  })
  after(async () => {
    await Promise.all([
      runMinutePostProcessing(created.minute_id, p.bodyMd, {
        rematch: false,
        projectId: meetingProjectId,
        minuteVersionId: created.version_id,
        wikiJobId: created.wiki_rebuild_required ? null : wikiJobId,
      }),
      created.wiki_rebuild_required && meetingProjectId
        ? rebuildProjectWikiFromActiveMinutes(meetingProjectId)
        : Promise.resolve(),
    ])
  })
  return respondMinute(req, 201, {
    id: created.minute_id, action: 'created', title: p.title, date: p.minuteDate,
    team: p.teamCode, meetingId: p.meetingId, externalId: p.externalId,
    meetingCreated,
    createdByName: user.name,
    createdAt: created.created_at, updatedAt: created.updated_at,
    folderId, folderPath,
    folderPathStatus: folder.provided
      ? folder.status
      : (folderId === null ? 'unclassified' : 'exact'),
    workspaceSlug,
  })
}

export async function POST(req: NextRequest) {
  let adminClient: AdminClient | undefined
  const getAdmin = () => {
    if (!adminClient) adminClient = createAdminClient()
    return adminClient
  }
  const principal = await resolveMinutesPrincipal(req, getAdmin)
  if (principal instanceof NextResponse) return principal

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiBadRequest('잘못된 요청입니다.')
  }
  const userEmail = parseUserEmail(raw)
  if (!userEmail) return apiBadRequest('user_email이 필요합니다.')

  try {
    const admin = getAdmin()
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', `해당 이메일의 ${BRAND.productName} 사용자가 없습니다.`)

    if (principal.kind === 'minutes_api') {
      const isMember = await isMinutesWorkspaceMember(admin, principal.credential.workspaceId, user.id)
      if (!isMember) return apiFail(403, 'unknown_user', '해당 워크스페이스의 사용자가 아닙니다.')
    }

    const parsed = parseMinutePayload(raw)
    if ('error' in parsed) return apiBadRequest(parsed.error)
    const p = parsed.payload

    // 호출자 권한 스냅샷 — 회의 연결 자격·기존 회의록 편집 자격·무프로젝트 신규의 워크스페이스를 모두 여기서 판정한다.
    // 조회 실패는 throw → 아래 catch 의 500(권한 없음으로 위장하지 않는다).
    const authz = await actorFromUser(admin, user.id)

    let meetingProjectId: string | null = null
    if (p.meetingId) {
      const { data: mt, error: mtErr } = await admin.from('meetings')
        .select('id, project_id').eq('id', p.meetingId).maybeSingle()
      // 쓰기 선행조회 실패를 '회의 없음'으로 오인하면 정상 요청이 거짓 거절된다 — 실패는 실패로.
      if (mtErr) { console.error('[minutes-api] 회의 존재 확인 실패:', mtErr.message); return apiInternalError() }
      // 그 프로젝트의 멤버 이상만 연결한다(v2.7). 없는 회의와 남의 회의를 같은 404 로 — 다른 워크스페이스 회의의
      // 존재를 드러내지 않는다.
      if (!mt || !isProjectMember(authz, mt.project_id as string)) {
        return apiFail(404, 'not_found', '연결할 회의를 찾을 수 없습니다.')
      }
      meetingProjectId = mt.project_id as string
    }

    // upsert 는 사전 select 후 insert/update 분기 — DB ON CONFLICT 구문은 부분 unique 인덱스가
    // conflict 대상 추론에 매칭되지 않아 42P10 으로 실패한다(계약 §12 주의).
    const { data: existing, error: selErr } = await admin.from('minutes')
      .select(MINUTE_SELECT).eq('external_id', p.externalId).maybeSingle()
    if (selErr) { console.error('[minutes-api] 기존 레코드 조회 실패:', selErr.message); return apiInternalError() }

    // external_id 는 전역 유일이라 조회는 전역이지만, 판정은 호출자 기준이다 — 편집 자격(그 범위의 멤버 이상이면서
    // 작성자·그 프로젝트 관리자)이 없으면 skip·error·보관 분기까지 포함해 404. 회의 확보(inline meeting)보다 먼저라 고아 회의도 없다.
    const ex = existing as ExistingRow | null
    if (ex && !canEditMinute(authz, ex)) return minuteNotFound()

    // 쓰기 대상(범위·담당 팀) 확정 — 회의 확보·폴더 생성·RPC 어느 것보다 먼저다. 다른 워크스페이스 프로젝트로의 연결과
    // 그 범위에 없는 담당 팀은 여기서 400 이라 상대 워크스페이스에 회의·폴더가 생기지 않는다.
    const resolved = await resolveWriteTarget(p, ex, meetingProjectId, authz, admin, principal)
    if (!resolved.ok) return resolved.response
    const { target } = resolved
    // 쓰기 대상의 워크스페이스로 모듈 판정(스펙 §4.2) — 세션이 없으니 admin 으로. 담당 팀·교차 워크스페이스 400 은 위(resolveWriteTarget)가 먼저다.
    // 보관·skip 분기·회의 확보·폴더·RPC 어느 것보다 앞이다
    const mod = await requireModule({ workspaceId: target.scope.workspaceId }, 'minutes_integration', { client: admin })
    if (!mod.ok) return apiModuleDisabled()
    if (target.scope.projectId) {
      const prjMod = await requireModule({ projectId: target.scope.projectId }, 'minutes_integration', { client: admin })
      if (!prjMod.ok) return apiModuleDisabled()
    }

    let workspaceSlug: string | null = null
    if (principal.kind === 'minutes_api') {
      const { data: wsRow } = await admin.from('workspaces').select('slug').eq('id', target.scope.workspaceId).maybeSingle()
      if (wsRow) workspaceSlug = (wsRow as { slug: string }).slug
    }

    // v2.5 — skip/error/보관 분기가 회의 확보보다 먼저다. 이 분기들은 회의록을 갱신하지 않는
    // 응답이라 회의를 만들면 실패·무시 응답 뒤에 고아 회의가 남는다(409 archived 포함).
    if (ex && (ex.archived_at !== null || p.onConflict !== 'replace')) {
      return await handleExisting(req, admin, p, ex, user, target, undefined, workspaceSlug)
    }

    // created 또는 replace 진입 확정 후에만 회의를 확보(생성/dedup 재사용)한다. 확보되면
    // meeting_id 가 전송된 것과 완전히 같게 동작하도록 파싱 결과에 주입한다(v2.5 §4.2).
    let meetingCreated: boolean | undefined
    if (p.meeting) {
      const got = await resolveOrCreateExternalMeeting(admin, p.meeting, user, authz)
      if (!got.ok) return apiFail(got.status, got.code, got.error)
      // 프로젝트는 resolveWriteTarget 이 meeting.project_id 로 이미 확정했다(got.projectId 와 같다).
      p.meetingId = got.meetingId
      p.meetingIdProvided = true
      meetingCreated = got.created
    }

    if (ex) return await handleExisting(req, admin, p, ex, user, target, meetingCreated, workspaceSlug)
    return await insertNew(req, admin, p, user, authz, target, meetingCreated, workspaceSlug)
  } catch (e) {
    console.error('[minutes-api] POST 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

/**
 * 목록의 호출자 스코프 — 'all'(플랫폼 관리자), 'none'(소속 워크스페이스 없음 — 볼 회의록이 없다),
 * 또는 소속 워크스페이스들 + 그 안에서 볼 수 없는 비공개 프로젝트(canSeeProject 거짓). 무프로젝트 회의록은
 * 워크스페이스 멤버에게 보인다. 프로젝트 조회 실패는 'error'(빈 목록으로 위장하지 않는다).
 */
async function listScope(
  admin: AdminClient, actor: Actor,
): Promise<'all' | 'none' | 'error' | { workspaceIds: string[]; hiddenProjectIds: string[] }> {
  if (actor.isSuperuser) return 'all'
  const workspaceIds = [...actor.workspaceRoles.keys()]
  if (workspaceIds.length === 0) return 'none'
  // 내 워크스페이스들의 비공개 프로젝트만 읽는다(id 목록을 싣지 않아 URL 이 프로젝트 수에 비례해 늘지 않는다).
  const { data, error } = await admin.from('projects').select('id, is_private')
    .in('workspace_id', workspaceIds).eq('is_private', true)
  if (error) { console.error('[minutes-api] 목록 비공개 프로젝트 조회 실패:', error.message); return 'error' }
  const hiddenProjectIds = ((data ?? []) as Array<{ id: string; is_private: boolean | null }>)
    .filter(p => !canSeeProject(actor, p)).map(p => p.id)
  return { workspaceIds, hiddenProjectIds }
}

/** 숨길 프로젝트를 빼되 무프로젝트 회의록은 남긴다 — `not.in` 만 걸면 NULL 비교가 거짓이 돼 무프로젝트 행까지 빠진다. */
function hiddenProjectFilter(ids: string[]): string {
  return `project_id.is.null,project_id.not.in.(${ids.join(',')})`
}

function clampInt(v: string | null, min: number, max: number, def: number): number {
  const n = v === null ? Number.NaN : Number.parseInt(v, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

export async function GET(req: NextRequest) {
  let adminClient: AdminClient | undefined
  const getAdmin = () => {
    if (!adminClient) adminClient = createAdminClient()
    return adminClient
  }
  const principal = await resolveMinutesPrincipal(req, getAdmin)
  if (principal instanceof NextResponse) return principal

  const sp = req.nextUrl.searchParams
  const team = sp.get('team')
  const dateFrom = sp.get('date_from')
  const dateTo = sp.get('date_to')
  if ((dateFrom && !DATE_RE.test(dateFrom)) || (dateTo && !DATE_RE.test(dateTo))) {
    return apiBadRequest('날짜 형식이 올바르지 않습니다.')
  }
  const linked = sp.get('linked')
  if (linked && linked !== 'true' && linked !== 'false') return apiBadRequest('linked는 true 또는 false여야 합니다.')
  // v2.3 §5.1 — 보관분 포함 조회. 기본 false(현행 동작 유지). 이게 없으면 D-Flow 에서 보관만
  // 해도 또박또박의 exists_on_dflow 가 false 가 되어 '연결 초기화됨'으로 오진하고, 안내하는
  // 복구 두 갈래([D-Flow에서 찾기]·[새로 전송])가 **둘 다 막힌** 상태로 사용자를 보낸다.
  const includeArchivedRaw = sp.get('include_archived')
  if (includeArchivedRaw && includeArchivedRaw !== 'true' && includeArchivedRaw !== 'false') {
    return apiBadRequest('include_archived는 true 또는 false여야 합니다.')
  }
  const includeArchived = includeArchivedRaw === 'true'
  const page = clampInt(sp.get('page'), 1, Number.MAX_SAFE_INTEGER, 1)
  const perPage = clampInt(sp.get('per_page'), 1, 100, 20)
  // v2.7 — 호출자 필수. 없으면 전 워크스페이스 목록으로 되돌아가지 않는다(meta 와 같은 규칙).
  const userEmail = sp.get('user_email')?.trim() ?? ''
  if (!userEmail) return apiBadRequest('user_email 이 필요합니다.')

  try {
    const admin = getAdmin()
    // 계정·권한 조회 실패는 throw → 아래 catch 의 500(빈 목록으로 위장하지 않는다).
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', `해당 이메일의 ${BRAND.productName} 사용자가 없습니다.`)

    if (principal.kind === 'minutes_api') {
      const isMember = await isMinutesWorkspaceMember(admin, principal.credential.workspaceId, user.id)
      if (!isMember) return apiFail(403, 'unknown_user', '해당 워크스페이스의 사용자가 아닙니다.')
    }

    const authz = await actorFromUser(admin, user.id)

    let scope: 'all' | 'none' | 'error' | { workspaceIds: string[]; hiddenProjectIds: string[] }
    if (principal.kind === 'minutes_api') {
      const wsId = principal.credential.workspaceId
      const wsMod = await requireModule({ workspaceId: wsId }, 'minutes_integration', { client: admin })
      if (!wsMod.ok) return apiModuleDisabled()
      const { data: prjRows, error: prjErr } = await admin.from('projects').select('id, is_private').eq('workspace_id', wsId)
      if (prjErr) return apiInternalError()
      const hidden: string[] = []
      for (const prj of (prjRows ?? []) as Array<{ id: string; is_private: boolean | null }>) {
        if (!credentialAllows(principal.credential, prj.id) || !canSeeProject(authz, prj)) {
          hidden.push(prj.id)
        }
      }
      scope = { workspaceIds: [wsId], hiddenProjectIds: hidden }
    } else {
      scope = await listScope(admin, authz)
      if (scope === 'error') return apiInternalError()
    }

    // 담당 필터는 호출자가 볼 수 있는 활성 팀으로 본다 — 소속 워크스페이스들의 공용 팀 + 목록 범위에서 숨기지 않은 프로젝트의
    // 전용 팀, 플랫폼 관리자는 전부(teamViewOf). 전 워크스페이스 목록이면 다른 워크스페이스의 팀 코드가 통과하고, 공용 팀만
    // 보면 프로젝트 회의록의 담당(전용 팀)이 400 이 된다. 팀 원천 실패는 throw → 아래 catch 의 500(담당 필터를 버리지 않는다).
    const hiddenProjectIds = typeof scope === 'object' ? scope.hiddenProjectIds : []
    if (team && !(await teamCodesVisibleTo(teamViewOf(authz, hiddenProjectIds), { client: admin })).includes(team)) {
      return apiBadRequest('잘못된 담당입니다.')
    }
    if (scope === 'none') return NextResponse.json({ items: [], total: 0, page, per_page: perPage })
    // 목록형 — minutes_integration 이 허용된 워크스페이스만(스펙 §4.2). 하나도 없으면 닫는다(409). 플랫폼 관리자('all')도 허용된 것만 —
    // 단 전부 켜져 있으면 필터를 걸지 않는다(플랫폼 관리자 '워크스페이스 필터 없이 전부' 계약 — external-api.test.ts 의 케이스, P24)
    let candidates: string[]
    if (scope === 'all') {
      const { data: wsRows, error: wsErr } = await admin.from('workspaces').select('id')
      if (wsErr) { console.error('[minutes-api] 워크스페이스 목록 조회 실패:', wsErr.message); return apiInternalError() }   // 빈 목록으로 위장하지 않는다
      candidates = ((wsRows ?? []) as Array<{ id: string }>).map((w) => w.id)
    } else candidates = scope.workspaceIds
    const onWs = await workspacesWithModule(candidates, 'minutes_integration', { client: admin })
    if (onWs.length === 0) return apiModuleDisabled()

    let q = admin.from('minutes').select(
      'id, minute_date, team_code, title, external_id, archived_at, created_by_name, created_at, updated_at',
      { count: 'exact' },
    )
    if (principal.kind === 'minutes_api') {
      q = q.eq('workspace_id', principal.credential.workspaceId)
    } else if (scope !== 'all' || onWs.length < candidates.length) {
      q = q.in('workspace_id', onWs)   // 플랫폼 관리자는 꺼진 워크스페이스가 있을 때만 거른다
    }
    if (scope !== 'all' && scope.hiddenProjectIds.length > 0) q = q.or(hiddenProjectFilter(scope.hiddenProjectIds))
    if (!includeArchived) q = q.is('archived_at', null)
    const externalId = sp.get('external_id')
    if (externalId) q = q.eq('external_id', externalId)
    if (linked === 'true') q = q.not('external_id', 'is', null)
    if (linked === 'false') q = q.is('external_id', null)
    if (team) q = q.eq('team_code', team)
    if (dateFrom) q = q.gte('minute_date', dateFrom)
    if (dateTo) q = q.lte('minute_date', dateTo)

    const offset = (page - 1) * perPage
    const { data, error, count } = await q
      .order('minute_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + perPage - 1)
    if (error) {
      // 범위 초과 페이지는 PostgREST 가 416(PGRST103)을 에러로 넘긴다 — 정상 순회의 일부이므로
      // 같은 필터의 head 카운트로 total 만 채워 빈 페이지로 응답한다(500 아님).
      if (error.code === 'PGRST103') {
        let cq = admin.from('minutes').select('id', { count: 'exact', head: true })
        if (principal.kind === 'minutes_api') {
          cq = cq.eq('workspace_id', principal.credential.workspaceId)
        } else if (scope !== 'all' || onWs.length < candidates.length) {
          cq = cq.in('workspace_id', onWs)
        }
        if (scope !== 'all' && scope.hiddenProjectIds.length > 0) cq = cq.or(hiddenProjectFilter(scope.hiddenProjectIds))
        if (!includeArchived) cq = cq.is('archived_at', null)
        if (externalId) cq = cq.eq('external_id', externalId)
        if (linked === 'true') cq = cq.not('external_id', 'is', null)
        if (linked === 'false') cq = cq.is('external_id', null)
        if (team) cq = cq.eq('team_code', team)
        if (dateFrom) cq = cq.gte('minute_date', dateFrom)
        if (dateTo) cq = cq.lte('minute_date', dateTo)
        const { count: totalCount, error: cntErr } = await cq
        if (!cntErr) return NextResponse.json({ items: [], total: totalCount ?? 0, page, per_page: perPage })
      }
      console.error('[minutes-api] 목록 조회 실패:', error.message)
      return apiInternalError()
    }

    // 본문(body_md) 제외 — 연결 후보 화면용 최소 집합(계약 §5.1)
    const items = ((data ?? []) as Record<string, unknown>[]).map(row => ({
      id: row.id as string,
      title: row.title as string,
      date: row.minute_date as string,
      team: row.team_code as string,
      external_id: (row.external_id as string | null) ?? null,
      // 또박또박이 '초기화됨'과 '보관됨'을 구분해 안내하는 근거(§9.7 (a)).
      archived: row.archived_at != null,
      created_by_name: (row.created_by_name as string | null) ?? null,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      url: `${req.nextUrl.origin}/minutes/${row.id as string}`,
    }))
    return NextResponse.json({ items, total: count ?? 0, page, per_page: perPage })
  } catch (e) {
    console.error('[minutes-api] GET 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
