'use server'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { getActor, resolveProjectId, resolveScope } from '@/lib/authz'
import {
  canEditMinute, isMinuteMember, isProjectAdmin, isProjectMember, hasProjectRoleInWorkspace, isWorkspaceAdmin, type Actor,
} from '@/lib/domain/authz'
import { resolveSoleWorkspaceId } from '@/lib/authz/workspace'
import { ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { requireModule, requireSessionModule } from '@/lib/modules/gate'
import { displayNameFrom } from '@/lib/domain/display-name'
import {
  validateMinuteFields, validateMinuteTeam, isMinuteFilePathValid, validateFolderName, folderDepthOf, MINUTE_FOLDER_DEPTH_MAX,
  isTeamRootName, isTeamRootFolder, teamSubOfFolder, normalizeFolderName,
  MINUTES_PROJECT_BULK_MAX, MINUTE_FILE_URL_TTL_SEC, MINUTE_ATTACHMENTS_MAX_COUNT,
  type MinuteInput,
} from '@/lib/domain/minutes'
import { resolveFolderDrop, type MinuteDropReject } from '@/lib/domain/minutes-drop'
import {
  getMinuteDetail, getMinuteFavorites, getMinutesExplorer, getMinutesPage, searchMinutes,
} from '@/lib/data/minutes'
import type { ExplorerData, Minute, MinuteFolder, TeamCode } from '@/lib/domain/types'
import { getProjectMeetingData } from '@/lib/data/meetings'
import { ingestMinute } from '@/lib/ai/minutes-ingest'
import { splitMinuteBlocks, isMarkableBlock, fnv1a64 } from '@/lib/minutes/blocks'
import { ensureMinuteInsights, generateMinuteInsights } from '@/lib/ai/minutes-insights'
import { rematchHighlights, type HighlightRow } from '@/lib/minutes/rematch'
import { nextShareState, type ShareOp, type ShareState } from '@/lib/minutes/share'
import { createAdminClient } from '@/lib/supabase/admin'
import { removeStoredAttachment } from '@/lib/attachments/removeStoredAttachment'
import { serviceRoleConfigured } from '@/lib/supabase/env'
import { correctMinuteBodyTime } from '@/lib/minutes/timeFix'
import { resolveTeamRootFolderId, refileMinuteAfterProjectChange, loadFolderSnapshot } from '@/lib/minutes/folders'
import { getHiddenProjectIds } from '@/lib/authz/visibility'
import { activeTeamCodesForMinuteScope, teamCodesForMinuteScope, type MinuteScope } from '@/lib/minutes/teamScope'
import { resolveMinuteProject } from '@/lib/minutes/project'
import {
  type MinuteVersionFile,
} from '@/lib/minutes/versions'
import {
  enqueueMinuteWikiProcessing, processMinuteWikiJob,
  rebuildProjectWikiFromActiveMinutes,
} from '@/lib/ai/wiki-ingest'

const BUCKET = 'minutes'

export interface MinuteActionResult {
  ok: boolean
  error?: string
  id?: string
  /** 녹취툴 시간대(+9h) 보정이 적용됐으면 보정 전/후 시각. UI 토스트용. */
  timeFix?: { from: string; to: string }
}

type Sb = Awaited<ReturnType<typeof createServerClient>>

export interface MinuteCreateSource {
  /** 클라이언트가 Storage 경로를 만들 때 선발급한 회의록 UUID. */
  minuteId: string
  file: MinuteVersionFile
}

/** 정본(@/lib/domain/validate 의 UUID_RE)을 버전·변형 니블까지 좁힌 지역 사본 — 정본으로 교체 금지.
 *  여기 통과하는 id 는 클라이언트가 crypto.randomUUID() 로 선발급해 그대로 Storage 경로 접두사이자
 *  minutes PK(create_minute_with_version 의 p_minute_id)가 되는 값이라, 손으로 지어낸 16진 문자열은
 *  느슨한 정본을 통과해도 여기서 걸러야 한다. DB 기본값도 gen_random_uuid()(=v4)라 기존 행은 전부 통과. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 이 파일 전용 로그인+Actor 게이트. minutes 계열은 RLS 쓰기 정책이 0개이고 앱이
 * service_role 로 쓰므로(스펙 §1.5) **여기 게이트가 유일한 방어선**이다.
 * 권한 조회 실패는 통과도 거부 위장도 아닌 별도 문구로 중단한다(에러 처리 3원칙).
 */
async function requireActor(): Promise<{ ok: true; actor: Actor } | { ok: false; error: string }> {
  let actor: Actor | null
  try {
    actor = await getActor()
  } catch {
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!actor) return { ok: false, error: '로그인 필요' }
  return { ok: true, actor }
}

/** 회의록을 다른 워크스페이스로 보내는 이동의 거부 문구 — 회의록의 워크스페이스는 바뀌지 않는다(0006 트리거
 *  WORKSPACE_SCOPE_MISMATCH 가 막는다). 트리거까지 가지 않도록 쓰기 전에 같은 판정을 한다. */
const CROSS_WORKSPACE_MOVE_MSG = '다른 워크스페이스의 프로젝트·폴더로는 옮길 수 없습니다.'
const TEAMS_UNAVAILABLE_MSG = '팀 목록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const FILE_LOOKUP_FAILED_MSG = '첨부 파일 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'
const VERSION_LOOKUP_FAILED_MSG = '버전 원본 정보를 불러오지 못했습니다. 잠시 후 다시 시도하세요.'

/** 팀 목록 조회를 결과로 감싼다 — 팀 원천 실패는 오류 문구로(빈 목록으로 위장하지 않는다). */
async function teamsResult(read: () => Promise<TeamCode[]>): Promise<{ codes: TeamCode[] } | { error: string }> {
  try {
    return { codes: await read() }
  } catch (e) {
    console.error('[minutes] 팀 목록 조회 실패:', e instanceof Error ? e.message : e)
    return { error: TEAMS_UNAVAILABLE_MSG }
  }
}
/** 회의록 범위의 활성 팀 코드 — 담당 팀 검증·재편철용. */
const activeTeamsOr = (scope: MinuteScope) => teamsResult(() => activeTeamCodesForMinuteScope(scope))
/** 회의록 범위의 등록 팀 코드(비활성 포함) — 폴더 루트의 팀 기본 폴더명 예약어 판정용. */
const teamCodesOr = (scope: MinuteScope) => teamsResult(() => teamCodesForMinuteScope(scope))

/**
 * 회의록 id 를 받는 액션의 범위 관문 — resolveScope 로 대상 행의 워크스페이스·프로젝트를 확정하고(클라이언트 입력 불신)
 * 그 범위의 멤버 이상(isMinuteMember)인지 본다. 다른 워크스페이스에만 역할이 있으면 거부.
 * 조회 실패는 ERR_LOOKUP(중단), 없거나 RLS 가 가리면 ERR_MISSING.
 */
async function requireMinuteMember(
  actor: Actor, minuteId: string,
): Promise<{ ok: true; scope: MinuteScope } | { ok: false; error: string }> {
  const s = await resolveScope('minutes', minuteId)
  if (!s.ok) return s
  if (!isMinuteMember(actor, { project_id: s.projectId, workspace_id: s.workspaceId })) return { ok: false, error: ERR_DENIED }
  const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')   // 회의록은 워크스페이스 모듈 — 행의 워크스페이스로(스펙 §4.2)
  if (!mod.ok) return { ok: false, error: mod.error }
  return { ok: true, scope: { projectId: s.projectId, workspaceId: s.workspaceId } }
}

/** 소유권 사전 확인 — RLS 0행 침묵 실패 방지. 범위는 resolveScope 가 대상 행에서 확정하고(조회 실패 ERR_LOOKUP·없음
 *  ERR_MISSING), 판정은 그 범위의 canEditMinute(범위의 멤버 이상 ∧ (작성자 ∨ 그 프로젝트 관리자 이상))다 — 다른
 *  워크스페이스에만 역할이 있는 작성자는 거부된다. 프로젝트 미지정(project_id null) 회의록은 isProjectAdmin(actor, null)=
 *  슈퍼유저만 통과 — '작성자 본인 또는 슈퍼유저'로 좁아지는 것은 의도된 fail-closed 다(스펙 §3.5).
 *  extra 는 같은 왕복에 실을 열 — 호출부가 같은 행을 다시 읽지 않게 한다. */
async function checkOwner(
  sb: Sb, minuteId: string, actor: Actor,
  opts: { extra?: string; archivedError?: string } = {},
): Promise<{ ok: true; scope: MinuteScope; row: Record<string, unknown> } | { ok: false; error: string }> {
  const s = await resolveScope('minutes', minuteId)
  if (!s.ok) return s
  const { data, error } = await sb.from('minutes')
    .select(opts.extra ? `created_by, archived_at, ${opts.extra}` : 'created_by, archived_at')
    .eq('id', minuteId)
    .maybeSingle()
  // 보안 가드 조회 — 실패 시 소유자 판정 자체가 불가능하므로 거부(fail-closed).
  if (error) {
    console.error('[checkOwner] 소유권 조회 실패:', error.message)
    return { ok: false, error: '권한 확인에 실패했습니다. 잠시 후 다시 시도하세요.' }
  }
  if (!data) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  const row = data as unknown as Record<string, unknown>
  if (row.archived_at) return { ok: false, error: opts.archivedError ?? '보관된 회의록은 변경할 수 없습니다.' }
  if (!canEditMinute(actor, {
    created_by: (row.created_by as string | null) ?? null, project_id: s.projectId, workspace_id: s.workspaceId,
  })) return { ok: false, error: ERR_DENIED }
  const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')   // 회의록은 워크스페이스 모듈 — 행의 워크스페이스로(스펙 §4.2)
  if (!mod.ok) return { ok: false, error: mod.error }
  return { ok: true, scope: { projectId: s.projectId, workspaceId: s.workspaceId }, row }
}

/** 본문 교체 후 하이라이트 재배정 — 실패는 로그만(표시 규칙이 오표시를 차단). service_role. */
async function rematchMinuteHighlights(minuteId: string, newBodyMd: string): Promise<void> {
  try {
    if (!serviceRoleConfigured()) return
    const admin = createAdminClient()
    const { data: rows, error: rowsErr } = await admin.from('minute_highlights')
      .select('id, created_by, created_by_name, block_index, block_hash, created_at')
      .eq('minute_id', minuteId)
    if (rowsErr) { console.error('[minutes] 재매칭 대상 하이라이트 조회 실패:', rowsErr.message); return }
    if (!rows || rows.length === 0) return
    const { reinserts, deleteIds } = rematchHighlights(rows as unknown as HighlightRow[], splitMinuteBlocks(newBodyMd))
    if (deleteIds.length === 0 && reinserts.length === 0) return
    // delete 선실행 → insert — unique (minute_id, created_by, block_index) 충돌 원천 차단(스펙 §5)
    if (deleteIds.length) {
      const { error } = await admin.from('minute_highlights').delete().in('id', deleteIds)
      if (error) { console.error('[minutes] 재매칭 삭제 실패:', error.message); return }
    }
    if (reinserts.length) {
      const { error } = await admin.from('minute_highlights').insert(
        reinserts.map(r => ({ ...r, minute_id: minuteId })),
      )
      if (error) console.error('[minutes] 재매칭 삽입 실패:', error.message)
    }
  } catch (e) {
    console.error('[minutes] 재매칭 실패(무시):', e instanceof Error ? e.message : e)
  }
}

/** service_role 클라이언트 확보 — 생성 실패(env 미설정 등)는 각 액션 문맥의 안내 문구로 돌려준다.
 *  Error 가 아니어서 원인 문구를 얻지 못할 때만 fallback 을 쓴다(기존 9곳 동일 try/catch 추출). */
function adminOr(fallback: string): { admin: ReturnType<typeof createAdminClient> } | { error: string } {
  try {
    return { admin: createAdminClient() }
  } catch (e) {
    return { error: e instanceof Error ? e.message : fallback }
  }
}

/** §6.3 — 폴더가 주어지면 team 은 **폴더에서 파생**한다(클라이언트 teamCode 불신 — 그대로 믿으면
 *  "폴더는 MES 인데 team_code 는 ERP" 인 데이터를 서버가 직접 만든다). 자식=부모 프로젝트 불변식도
 *  여기서 함께 검사한다 — moveMinuteToFolder 와 동일하게 회의록이 속할 프로젝트와 명시 지정된
 *  폴더의 프로젝트가 다르면 거절(무스코프면 다른 프로젝트 폴더에 새로 꽂힌다). 파생 불가 폴더
 *  (시드 체인 밖)는 추측하지 않고 거절한다. createMinute·updateMinuteMeta 공용.
 *  workspaceId 는 회의록의 워크스페이스(생성이면 확정한 쓰기 대상) — 회의록의 워크스페이스는 바뀌지 않는다. */
async function deriveTeamFromFolder(
  sb: Sb, folderId: string, projectId: string | null, workspaceId: string,
): Promise<{ team: TeamCode } | { error: string }> {
  const folders = await loadFolders(sb)
  if (!folders) return { error: '폴더 목록을 불러오지 못했습니다.' }
  const targetFolder = folders.find(f => f.id === folderId)
  if (!targetFolder) return { error: '폴더를 찾을 수 없습니다.' }
  if ((targetFolder.projectId ?? null) !== projectId) {
    return { error: '다른 프로젝트 폴더로는 이동할 수 없습니다.' }
  }
  // 프로젝트 없는 폴더끼리는 워크스페이스가 경계다(0006) — RPC 의 MINUTE_FOLDER_WORKSPACE_MISMATCH 를 미리 거른다.
  if (targetFolder.workspaceId !== workspaceId) {
    return { error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' }
  }
  const derived = teamSubOfFolder(folders, folderId)
  if (!derived) return { error: '담당 팀을 판정할 수 없는 폴더입니다.' }
  return { team: derived.team }
}

export async function createMinute(
  input: MinuteInput, folderId: string | null = null, source?: MinuteCreateSource,
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  // 모듈 관문(스펙 §4.2) — 쓰기 대상의 범위로: 프로젝트를 고르면 그 프로젝트(워크스페이스 모듈이라 곧 그 워크스페이스의 판정), 회의만 고르면
  // 그 회의의 프로젝트(쓰기 대상을 resolveMinuteProject 가 회의의 프로젝트로 정한다 — fetchMeetingMinutesLite 와 같은 해석), 둘 다 없으면
  // 세션 유일 워크스페이스. 프로젝트 id 의 형식·소속은 뒤의 기존 검증이 본다 — 관문은 없는 프로젝트를 설정 0행 → 닫힘으로 판정한다
  let gateProjectId = input?.projectId ?? null
  if (!gateProjectId && input?.meetingId) {
    const found = await resolveProjectId('meetings', input.meetingId)
    if (!found.ok || !found.projectId) return { ok: false, error: found.ok ? ERR_LOOKUP : found.error }
    gateProjectId = found.projectId
  }
  const mod = gateProjectId ? await requireModule({ projectId: gateProjectId }, 'minutes') : await requireSessionModule(null, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  // 담당 팀은 쓰기 대상 범위가 정해진 뒤(아래 targetWs) 그 범위의 팀으로 본다.
  const err = validateMinuteFields(input)
  if (err) return { ok: false, error: err }
  if (source) {
    // 경로 스코프 검증은 워크스페이스·프로젝트가 확정된 뒤(아래 targetWs) — 여기서는 형식만 본다.
    if (!UUID_RE.test(source.minuteId)) {
      return { ok: false, error: '잘못된 원본 파일 경로입니다.' }
    }
    if (!/\.(md|markdown)$/i.test(source.file.fileName)) {
      return { ok: false, error: '.md 파일만 가능합니다.' }
    }
  }
  const sb = await createServerClient()
  const resolvedProject = await resolveMinuteProject(sb, {
    meetingId: input.meetingId,
    projectId: input.projectId,
  })
  if (resolvedProject.error) return { ok: false, error: resolvedProject.error }
  // 회의록 생성은 멤버 이상(스펙 D8). 프로젝트가 정해지면 그 프로젝트의 멤버여야 하고,
  // 미지정이면 쓰기 대상 워크스페이스에 역할이 있어야 한다(0006 에서 폐기된 옛 전역 역할 판정의 워크스페이스판).
  let workspaceId: string | null = null
  if (!resolvedProject.projectId) {
    const w = resolveSoleWorkspaceId(g.actor)
    if (!w.ok) return { ok: false, error: w.error }
    workspaceId = w.workspaceId
  }
  if (resolvedProject.projectId
    ? !isProjectMember(g.actor, resolvedProject.projectId)
    : !hasProjectRoleInWorkspace(g.actor, workspaceId)) return { ok: false, error: '권한 없음' }
  // 폴더 해석에 넘길 워크스페이스 — 프로젝트가 있으면 그 프로젝트의 것(가드를 통과했으니 projectWorkspace 에 있다;
  // 플랫폼 관리자는 buildActor 가 전 프로젝트를 싣는다).
  const targetWs = workspaceId
    ?? (resolvedProject.projectId ? g.actor.projectWorkspace.get(resolvedProject.projectId) ?? null : null)
  if (!targetWs) return { ok: false, error: ERR_MISSING }
  // 담당 팀은 그 범위(프로젝트, 미지정이면 워크스페이스)의 활성 팀이어야 한다 — 다른 워크스페이스의 팀 코드는 거부.
  const teams = await activeTeamsOr({ projectId: resolvedProject.projectId ?? null, workspaceId: targetWs })
  if ('error' in teams) return { ok: false, error: teams.error }
  const teamErr = validateMinuteTeam(input.teamCode, teams.codes)
  if (teamErr) return { ok: false, error: teamErr }
  // 원본 파일 경로 — 생성이라 읽을 행이 없으므로 scope 는 방금 확정한 워크스페이스·프로젝트다(RPC 의 minute_body_path_ok 와 같은 판정).
  if (source && !isMinuteFilePathValid(
    { workspaceId: targetWs, projectId: resolvedProject.projectId ?? null }, source.minuteId, source.file.filePath, 'minutes',
  )) {
    return { ok: false, error: '잘못된 원본 파일 경로입니다.' }
  }
  // §6.3 — 폴더가 주어지면 team 은 폴더에서 파생한다(파생·불변식 검사는 deriveTeamFromFolder).
  let effectiveTeam = input.teamCode
  if (folderId) {
    const derived = await deriveTeamFromFolder(sb, folderId, resolvedProject.projectId ?? null, targetWs)
    if ('error' in derived) return { ok: false, error: derived.error }
    effectiveTeam = derived.team
  }
  // 폴더 미지정이면 담당 팀 루트 폴더로 자동 편철(0043) — 부재·실패는 미분류(null) 폴백.
  // sb 는 사용자 세션 클라이언트라(admin 아님) resolveTeamRootFolderId 는 읽기만 한다 —
  // 프로젝트 루트가 아직 없으면(지연 생성 미적용) null → 미분류 폴백으로 등록 자체는 막지 않는다.
  const effectiveFolderId = folderId ?? await resolveTeamRootFolderId(sb, effectiveTeam, resolvedProject.projectId, targetWs)
  // 녹취툴 산출물이면 시간 줄 +9h(UTC→KST) 보정 — DB·다운스트림 전부 보정본 사용
  const fix = correctMinuteBodyTime(input.bodyMd)
  if (fix.corrected) console.info(`[minutes] 시간 보정 적용: ${fix.from} → ${fix.to} (${input.title.trim()})`)
  const bodyMd = fix.body
  const createdByName = displayNameFrom(user.user_metadata, user.email)
  const adm = adminOr('버전 저장 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm
  // minutes + v1 + 현재 body 파일 포인터를 한 트랜잭션으로 만든다. 일반 인증
  // 사용자의 minutes 직접 쓰기는 0045에서 닫혀 있어 모든 생성 경로가 이 불변식을 거친다.
  const { data: createdRaw, error: createError } = await admin.rpc('create_minute_with_version', {
    p_minute_id: source?.minuteId ?? null,
    p_minute_date: input.minuteDate,
    p_team_code: effectiveTeam,
    p_title: input.title.trim(),
    p_body_md: bodyMd,
    p_body_hash: fnv1a64(bodyMd),
    p_meeting_id: input.meetingId,
    p_project_id: resolvedProject.projectId,
    p_meeting_occurrence_date: input.meetingId
      ? (input.meetingOccurrenceDate ?? input.minuteDate)
      : null,
    p_folder_id: effectiveFolderId,
    p_external_id: null,
    p_actor_id: user.id,
    p_actor_name: createdByName,
    p_file_name: source?.file.fileName ?? null,
    p_file_path: source?.file.filePath ?? null,
    p_file_size: source?.file.size ?? null,
    p_file_mime: source?.file.mime ?? null,
    // 프로젝트가 있으면 null — RPC 가 프로젝트에서 얻는다(0006).
    p_workspace_id: workspaceId,
  }).single()
  if (createError || !createdRaw) {
    // RPC 영문 상수(0006 MINUTE_FOLDER_WORKSPACE_MISMATCH 등)는 사용자 문구로, 그 밖은 종전처럼 원문 그대로.
    return { ok: false, error: rpcErrorMessage(createError?.message, createError?.message ?? '회의록 생성에 실패했습니다.') }
  }
  const created = createdRaw as unknown as {
    minute_id: string
    version_id: string
    wiki_rebuild_required: boolean
  }
  const minuteId = created.minute_id
  const versionId = created.version_id
  const wikiJobId = await enqueueMinuteWikiProcessing({
    projectId: resolvedProject.projectId,
    minuteId,
    minuteVersionId: versionId,
    bodyMd,
  })
  revalidatePath('/minutes')
  if (resolvedProject.projectId) revalidatePath(`/p/${resolvedProject.projectId}/wiki`)
  after(async () => {
    await Promise.all([
      ingestMinute(minuteId, bodyMd),
      generateMinuteInsights(minuteId, bodyMd),
      created.wiki_rebuild_required && resolvedProject.projectId
        ? rebuildProjectWikiFromActiveMinutes(resolvedProject.projectId)
        : wikiJobId === null ? Promise.resolve(null) : processMinuteWikiJob(wikiJobId),
    ])
  })
  return { ok: true, id: minuteId, timeFix: fix.corrected ? { from: fix.from!, to: fix.to! } : undefined }
}

export async function updateMinuteMeta(
  id: string, patch: Omit<MinuteInput, 'bodyMd'>, folderId?: string | null,
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const err = validateMinuteFields({ ...patch, bodyMd: '' })
  if (err) return { ok: false, error: err }
  const sb = await createServerClient()
  // 프로젝트 이동 시 자동 재편철(아래)의 old 값(folder_id)을 소유권 조회에 싣는다 — RPC 뒤에 읽으면 왕복이 하나 늘고
  // 그 사이 다른 갱신이 끼어들 여지가 생긴다. folderId 가 명시되면(사용자가 폴더를 직접 골랐다) 그 선택이 우선이라
  // 재편철 자체를 돌리지 않으므로 싣지 않는다.
  const own = await checkOwner(sb, id, g.actor, folderId === undefined ? { extra: 'folder_id' } : {})
  if (!own.ok) return { ok: false, error: own.error }
  const resolvedProject = await resolveMinuteProject(sb, {
    meetingId: patch.meetingId,
    projectId: patch.projectId,
  })
  if (resolvedProject.error) return { ok: false, error: resolvedProject.error }
  // **옮겨 넣을 프로젝트의 권한도 본다.** checkOwner 는 현재 프로젝트 기준이라, 작성자면
  // 자기 회의록을 아무 프로젝트로나 옮길 수 있었다 — 그 프로젝트 위키에 지식이 적재되므로
  // 일괄 지정(assignMinutesProject)이 요구하는 '대상 프로젝트 관리자' 조건이 단건 수정으로
  // 우회된다. resolveMinuteProject 는 실재만 확인하고 역할은 보지 않는다.
  if (resolvedProject.projectId && !isProjectMember(g.actor, resolvedProject.projectId)) {
    return { ok: false, error: '그 프로젝트에 회의록을 넣을 권한이 없습니다.' }
  }
  // 회의록의 워크스페이스는 바뀌지 않는다 — 다른 워크스페이스 프로젝트(회의)로 옮기면 트리거가 WORKSPACE_SCOPE_MISMATCH 로
  // 막는다. 쓰기 전에 같은 판정을 한다(멤버 판정을 통과했으니 그 프로젝트는 스냅샷에 있다).
  if (resolvedProject.projectId
    && g.actor.projectWorkspace.get(resolvedProject.projectId) !== own.scope.workspaceId) {
    return { ok: false, error: CROSS_WORKSPACE_MOVE_MSG }
  }
  // 담당 팀은 옮겨 갈 범위(새 프로젝트, 미지정이면 회의록의 워크스페이스)의 활성 팀이어야 한다.
  const teams = await activeTeamsOr({ projectId: resolvedProject.projectId ?? null, workspaceId: own.scope.workspaceId })
  if ('error' in teams) return { ok: false, error: teams.error }
  const teamErr = validateMinuteTeam(patch.teamCode, teams.codes)
  if (teamErr) return { ok: false, error: teamErr }
  // §6.3 — 폴더가 주어지면 team 은 폴더에서 파생한다(파생·불변식 검사는 deriveTeamFromFolder).
  // 프로젝트 없는 회의록은 워크스페이스가 폴더 경계다(0006) — 회의록의 워크스페이스 폴더만 허용한다.
  // 메타 RPC·minutes 트리거는 이 불일치를 잡지 않는다.
  let effectiveTeam = patch.teamCode
  if (folderId) {
    const derived = await deriveTeamFromFolder(sb, folderId, resolvedProject.projectId ?? null, own.scope.workspaceId)
    if ('error' in derived) return { ok: false, error: derived.error }
    effectiveTeam = derived.team
  }
  // folderId 미전달(undefined) = 폴더 무접촉(수동 편철 존중). null = 미분류로 이동.
  // 문자열 = 해당 폴더로 이동. RPC 는 p_metadata 에 folder_id 키 존재 여부로 무접촉을 판정하므로
  // 무접촉일 때는 키 자체를 넣지 않는다(값을 null 로 넣는 것과는 다르다).
  const upd: Record<string, unknown> = {
    minute_date: patch.minuteDate, team_code: effectiveTeam, title: patch.title.trim(),
    meeting_id: patch.meetingId,
    project_id: resolvedProject.projectId,
    meeting_occurrence_date: patch.meetingId
      ? (patch.meetingOccurrenceDate ?? patch.minuteDate)
      : null,
  }
  if (folderId !== undefined) upd.folder_id = folderId
  const curFolderId = (own.row.folder_id as string | null | undefined) ?? null
  const adm = adminOr('회의록 수정 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm
  const { data: updateRaw, error } = await admin.rpc('update_minute_metadata_with_wiki_retraction', {
    p_minute_id: id,
    p_metadata: upd,
  }).single()
  // RPC 영문 상수(WORKSPACE_SCOPE_MISMATCH 등)는 사용자 문구로, 그 밖은 종전처럼 원문 그대로.
  if (error || !updateRaw) {
    return { ok: false, error: rpcErrorMessage(error?.message, error?.message ?? '회의록 수정에 실패했습니다.') }
  }
  const updateResult = updateRaw as unknown as {
    old_project_id: string | null
    new_project_id: string | null
    wiki_rebuild_required: boolean
  }
  const projectChanged = updateResult.old_project_id !== updateResult.new_project_id
  const wikiRebuildRequired = projectChanged || updateResult.wiki_rebuild_required === true
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  if (updateResult.old_project_id) {
    revalidatePath(`/p/${updateResult.old_project_id}/wiki`)
  }
  if (updateResult.new_project_id) {
    revalidatePath(`/p/${updateResult.new_project_id}/wiki`)
  }
  // 프로젝트 이동 시 폴더 자동 추종 — 사용자가 폴더를 직접 고르지 않았을 때만(folderId===undefined).
  // 위키 재적재보다 먼저·동기로 끝내 재적재가 새 folder_id 반영 이후 상태를 본다.
  if (projectChanged && folderId === undefined) {
    // 팀 목록은 위에서 확보한 옮겨 간 범위의 것 — RPC 의 new_project_id 는 보낸 project_id 그대로다.
    await refileMinuteAfterProjectChange(admin, {
      minuteId: id, teamCode: effectiveTeam, oldFolderId: curFolderId,
      newProjectId: updateResult.new_project_id, actorId: g.actor.userId,
      activeTeamCodes: teams.codes,
    })
  }
  if (
    resolvedProject.projectId
    || (projectChanged && updateResult.old_project_id)
    || wikiRebuildRequired
  ) {
    after(async () => {
      await Promise.all([
        projectChanged && updateResult.old_project_id
          ? rebuildProjectWikiFromActiveMinutes(updateResult.old_project_id, id)
          : Promise.resolve(),
        wikiRebuildRequired && updateResult.new_project_id
          // 과거 회의록이 새 프로젝트의 후속 지식보다 늦게 단독 적용돼 거짓 충돌을
          // 만들지 않도록, 프로젝트 이동/시간축 변경은 회의 시점 순으로 다시 구성한다.
          ? rebuildProjectWikiFromActiveMinutes(updateResult.new_project_id)
          : Promise.resolve(),
      ])
    })
  }
  return { ok: true }
}

type BulkProjectResult = {
  ok: boolean
  error?: string
  /** 실제로 project_id 가 바뀐 건수 */
  updated: number
  /** 이미 그 프로젝트라 건드리지 않은 건수 */
  unchanged: number
  /** 건별 실패·거절 — 조용히 빠뜨리면 '전부 됐다'로 오인한다 */
  skipped: { id: string; reason: string }[]
}

/**
 * 여러 회의록의 프로젝트를 한 번에 지정/해제 — 탐색기 다중 선택.
 *
 * 건별로 updateMinuteMeta 와 **같은 메타 RPC** 를 태운다. raw update 로 하면 위키 회수·재적재가
 * 빠져 옛 프로젝트 위키에 그 회의록 지식이 남는다(0045 §위키 연동).
 *
 * 회의에 연결된 회의록은 회의의 프로젝트가 정본이라(resolveMinuteProject 와 같은 규칙) 다른
 * 프로젝트로 지정하는 것을 거절한다 — 조용히 덮으면 회의와 회의록이 서로 다른 프로젝트를 가리킨다.
 *
 * 위키 재적재는 프로젝트 단위로 **한 번씩만** 돈다(건별로 돌리면 200건이 200회 재적재가 된다).
 */
export async function assignMinutesProject(
  ids: string[], projectId: string | null,
): Promise<BulkProjectResult> {
  const empty = { updated: 0, unchanged: 0, skipped: [] as { id: string; reason: string }[] }
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error, ...empty }
  // 대상 프로젝트로 지정하는 것은 그 프로젝트의 관리자 이상(스펙 §4.3). 해제(null)는 건별 판정만.
  if (projectId && !isProjectAdmin(g.actor, projectId)) return { ok: false, error: '권한 없음', ...empty }
  const mod = await requireSessionModule(null, 'minutes')                    // 일괄 지정은 회의록 화면 전용 — 화면과 같은 유일 워크스페이스(P13)
  if (!mod.ok) return { ok: false, error: mod.error, ...empty }
  const targets = [...new Set(ids)].filter(id => UUID_RE.test(id))
  if (targets.length === 0) return { ok: false, error: '선택된 회의록이 없습니다.', ...empty }
  if (targets.length > MINUTES_PROJECT_BULK_MAX) {
    return { ok: false, error: `한 번에 ${MINUTES_PROJECT_BULK_MAX}건까지 지정할 수 있습니다.`, ...empty }
  }
  const sb = await createServerClient()
  // 대상 프로젝트 실재 확인 — 없는 id 로 200건을 돌리고 전건 실패하는 것을 막는다.
  // 그 워크스페이스도 함께 읽는다 — 회의록의 워크스페이스는 바뀌지 않으므로 다른 워크스페이스 회의록은 건별로 거절한다.
  let targetWs: string | null = null
  if (projectId) {
    const { data: p, error: pErr } = await sb.from('projects').select('id, workspace_id').eq('id', projectId).maybeSingle()
    if (pErr) {
      console.error('[assignMinutesProject] 프로젝트 조회 실패:', pErr.message)
      return { ok: false, error: '프로젝트를 확인하지 못했습니다.', ...empty }
    }
    if (!p) return { ok: false, error: '프로젝트를 찾을 수 없습니다.', ...empty }
    targetWs = (p as { workspace_id: string }).workspace_id
  }
  // 가드 선행조회 — 실패하면 소유권·보관 판정이 불가능하므로 중단(fail-closed, 건별 N회 왕복 회피).
  // workspace_id 는 건별 범위 판정(canEditMinute)과 교차 워크스페이스 거절의 근거다(resolveScope 의 일괄판).
  const { data: rows, error: rowsErr } = await sb.from('minutes')
    .select('id, created_by, archived_at, project_id, workspace_id, meeting_id, team_code, folder_id')
    .in('id', targets)
  if (rowsErr) {
    console.error('[assignMinutesProject] 대상 조회 실패:', rowsErr.message)
    return { ok: false, error: '회의록을 불러오지 못했습니다.', ...empty }
  }
  type MinuteRow = {
    id: string; created_by: string | null; archived_at: string | null
    project_id: string | null; workspace_id: string; meeting_id: string | null
    team_code: TeamCode; folder_id: string | null
  }
  const byId = new Map((rows ?? []).map(r => [(r as MinuteRow).id, r as MinuteRow]))
  // 재편철 팀 목록 — 옮겨 간 범위(대상 프로젝트, 해제면 각 회의록의 워크스페이스)의 것. 쓰기 전에 전부 확보한다 —
  // 팀 캐시 실패가 몇 건을 쓴 뒤에 터지면 일부만 바뀐 채 결과를 돌려주지 못한다.
  const refileTeams = new Map<string, TeamCode[]>()
  for (const r of byId.values()) {
    if (refileTeams.has(r.workspace_id)) continue
    const teams = await activeTeamsOr({ projectId, workspaceId: r.workspace_id })
    if ('error' in teams) return { ok: false, error: teams.error, ...empty }
    refileTeams.set(r.workspace_id, teams.codes)
  }

  // 연결된 회의의 프로젝트 — 회의별 1회만 읽는다
  const meetingIds = [...new Set([...byId.values()].map(r => r.meeting_id).filter((v): v is string => !!v))]
  const meetingProject = new Map<string, string | null>()
  if (meetingIds.length > 0) {
    const { data: ms, error: msErr } = await sb.from('meetings').select('id, project_id').in('id', meetingIds)
    if (msErr) {
      console.error('[assignMinutesProject] 회의 조회 실패:', msErr.message)
      return { ok: false, error: '연결된 회의를 확인하지 못했습니다.', ...empty }
    }
    for (const r of ms ?? []) {
      meetingProject.set((r as { id: string }).id, (r as { project_id: string | null }).project_id ?? null)
    }
  }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '프로젝트 지정 설정을 확인하세요.', ...empty }
  }
  // 재편철용 폴더 스냅샷 — 건별 로드 대신 배치 전체가 1회 공유(200건 상한이라 필수는 아니지만,
  // 하면 왕복이 크게 준다). 실패해도 재편철만 생략될 뿐 지정 자체는 계속 진행한다.
  const folderSnapshot = (await loadFolderSnapshot(admin)) ?? undefined

  const skipped: { id: string; reason: string }[] = []
  const rebuildProjects = new Set<string>()
  let updated = 0
  let unchanged = 0

  for (const id of targets) {
    const row = byId.get(id)
    if (!row) { skipped.push({ id, reason: '회의록을 찾을 수 없습니다.' }); continue }
    if (row.archived_at) { skipped.push({ id, reason: '보관된 회의록' }); continue }
    // 미지정(project_id null) 회의록은 isProjectAdmin(actor, null)=슈퍼유저만 — 의도된 fail-closed.
    if (!canEditMinute(g.actor, row)) { skipped.push({ id, reason: '권한 없음' }); continue }
    if (row.meeting_id) {
      const mp = meetingProject.get(row.meeting_id) ?? null
      if (mp !== projectId) { skipped.push({ id, reason: '연결된 회의의 프로젝트와 다릅니다.' }); continue }
    }
    if (row.project_id === projectId) { unchanged += 1; continue }
    // 회의록의 워크스페이스는 바뀌지 않는다 — 트리거(WORKSPACE_SCOPE_MISMATCH)까지 가지 않고 쓰기 전에 거절한다.
    if (targetWs && row.workspace_id !== targetWs) { skipped.push({ id, reason: CROSS_WORKSPACE_MOVE_MSG }); continue }

    const { data: raw, error } = await admin.rpc('update_minute_metadata_with_wiki_retraction', {
      p_minute_id: id,
      p_metadata: { project_id: projectId },
    }).single()
    if (error || !raw) {
      console.error('[assignMinutesProject] 갱신 실패:', id, error?.message ?? 'no row')
      skipped.push({ id, reason: rpcErrorMessage(error?.message, '지정에 실패했습니다.') })
      continue
    }
    const res = raw as unknown as {
      old_project_id: string | null; new_project_id: string | null; wiki_rebuild_required: boolean
    }
    // 프로젝트가 실제로 바뀐 건만 폴더도 추종시킨다(위에서 unchanged 는 이미 걸러졌지만,
    // res.new_project_id 는 RPC 가 정한 정본이라 그 값을 기준으로 한다).
    await refileMinuteAfterProjectChange(admin, {
      minuteId: id, teamCode: row.team_code, oldFolderId: row.folder_id,
      newProjectId: res.new_project_id, actorId: g.actor.userId,
      // 위에서 이 회의록의 워크스페이스 몫을 채웠다(new_project_id 는 보낸 projectId 그대로다).
      activeTeamCodes: refileTeams.get(row.workspace_id)!,
      snapshot: folderSnapshot,
    })
    if (res.old_project_id) rebuildProjects.add(res.old_project_id)
    if (res.new_project_id) rebuildProjects.add(res.new_project_id)
    updated += 1
    revalidatePath(`/minutes/${id}`)
  }

  revalidatePath('/minutes')
  for (const pid of rebuildProjects) revalidatePath(`/p/${pid}/wiki`)
  if (updated > 0 && rebuildProjects.size > 0) {
    const projects = [...rebuildProjects]
    after(async () => {
      // 순차 — 프로젝트별 재적재는 무겁고, 동시에 돌리면 같은 위키를 두 경로가 함께 만진다
      for (const pid of projects) await rebuildProjectWikiFromActiveMinutes(pid)
    })
  }
  return { ok: true, updated, unchanged, skipped }
}

/** 또박또박 연결 초기화 — external_id 를 null 로. 0045 이후 minutes 직접 쓰기가 닫혀 있어
 *  admin(service_role) 경유. moveMinuteToFolder 와 동일하게 소유권 선확인 후 update. */
export async function resetMinuteExternalId(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (!own.ok) return { ok: false, error: own.error }
  const adm = adminOr('연결 초기화 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm
  const { data, error } = await admin.from('minutes')
    .update({ external_id: null, updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) { console.error('[resetMinuteExternalId] 실패:', error.message); return { ok: false, error: error.message } }
  // service_role 경로라 RLS 가 없다 — 소유자·관리자 판정은 checkOwner 가 먼저 했고, 0행은 회의록이 사라진 경우다.
  // 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 회의록이 없습니다.' }
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  return { ok: true }
}

/** 폴더 전량(라이트). **실패는 null** — 폴더 선택이 필수가 된 §6 이후로는 빈 배열이 곧
 *  "고를 것이 없는 막다른 모달"이라 조회 실패와 구분되지 않으면 원인 표시가 불가능하다
 *  (fetchMinutesExplorer 와 같은 관례).
 *  모듈 관문은 목록형(스펙 §4.2 첫 문단 '꺼진 곳의 행을 뺀다'·P13) — RLS 가 보여 준 폴더 행의 워크스페이스마다 판정해 꺼진 곳의 행을 뺀다.
 *  행위자 소속이 아니라 행으로 보므로 여러 워크스페이스 사용자도, 소속 밖 워크스페이스 회의록을 /minutes/[id] 로 연 플랫폼 관리자도
 *  켜진 곳의 폴더를 잃지 않는다(메타 모달·업로드 모달·챗 패널이 부른다 — 탐색기 전용이 아니다). 행이 있는 곳이 모두 꺼지면 null.
 *  폴더 읽기는 관문 앞이지만 읽기뿐이다(getMyMeetings 의 행 거르기와 같은 모양, 쓰기 0). */
export async function fetchMinuteFoldersLite(): Promise<MinuteFolder[] | null> {
  const user = await getSession()
  if (!user) return null
  const sb = await createServerClient()
  const [folders, hidden] = await Promise.all([loadFolders(sb), getHiddenProjectIds()])
  if (!folders) return null
  const ids = [...new Set(folders.map(f => f.workspaceId))]
  // 보이는 행이 없으면 판정할 워크스페이스가 없다 — 세션 판정으로 '켜졌지만 폴더 없음'([], 전과 같다)과 '꺼짐'(null)을 가른다
  if (ids.length === 0) return (await requireSessionModule(null, 'minutes')).ok ? [] : null
  // 워크스페이스마다 관문(workspacesWithModule 과 같은 판정) — 액션의 관문은 판정 결과를 조건으로 보는 requireModule 로 부른다(deny 정적 검사)
  const verdicts = await Promise.all(ids.map(async (workspaceId) => (await requireModule({ workspaceId }, 'minutes')).ok))
  const on = new Set(ids.filter((_, i) => verdicts[i]))
  if (on.size === 0) return null
  // 숨김 프로젝트의 폴더 제거 — getMinutesExplorer 와 같은 필터(§chat 패널이 이 액션으로
  // 폴더명을 노출하므로 비공개 프로젝트 하위 폴더명이 이름만으로도 새면 안 된다).
  return folders.filter(f => on.has(f.workspaceId) && (f.projectId === null || !hidden.has(f.projectId)))
}

/** 본문 교체 — 클라이언트가 새 .md 를 Storage 업로드한 뒤 호출. 기존 body 파일 0건 허용(복구 경로). */
export async function replaceMinuteBody(
  id: string, bodyMd: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (bodyMd.length > 100_000) return { ok: false, error: '본문은 100,000자 이하여야 합니다.' }
  if (!/\.(md|markdown)$/i.test(file.fileName)) return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (!own.ok) return { ok: false, error: own.error }
  const { projectId } = own.scope
  // 경로 scope 는 DB 의 회의록 행(워크스페이스·현재 프로젝트, resolveScope) — 클라이언트 입력을 믿지 않는다.
  if (!isMinuteFilePathValid(own.scope, id, file.filePath, 'minutes')) {
    return { ok: false, error: '잘못된 파일 경로입니다.' }
  }
  // 녹취툴 산출물이면 시간 줄 +9h(UTC→KST) 보정 — DB·재매칭·재인제스트 전부 보정본 사용
  const fix = correctMinuteBodyTime(bodyMd)
  if (fix.corrected) console.info(`[minutes] 본문 교체 시간 보정 적용: ${fix.from} → ${fix.to} (id=${id})`)
  const body = fix.body

  const adm = adminOr('버전 저장 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm
  // 버전 append + 현재 파일 포인터 + current body를 DB 함수 한 트랜잭션으로 커밋한다.
  // 어느 단계에서든 실패하면 전부 롤백되며, 이전 Storage 객체는 함수가 삭제하지 않는다.
  const { data: committedRaw, error: commitError } = await admin.rpc('commit_minute_body_version', {
    p_minute_id: id,
    p_body_md: body,
    p_body_hash: fnv1a64(body),
    p_file_name: file.fileName,
    p_file_path: file.filePath,
    p_file_size: file.size,
    p_file_mime: file.mime,
    p_actor_id: user.id,
    p_actor_name: displayNameFrom(user.user_metadata, user.email),
  }).single()
  if (commitError || !committedRaw) {
    console.error('[replaceMinuteBody] 원자 커밋 실패:', commitError?.message ?? 'no row')
    return { ok: false, error: commitError?.message ?? '새 버전 저장에 실패했습니다.' }
  }
  const committed = committedRaw as unknown as {
    version_id: string
    wiki_rebuild_required: boolean
  }
  const versionId = committed.version_id as string
  const wikiJobId = committed.wiki_rebuild_required
    ? await enqueueMinuteWikiProcessing({
        projectId,
        minuteId: id,
        minuteVersionId: versionId,
        bodyMd: body,
      })
    : null
  revalidatePath('/minutes'); revalidatePath(`/minutes/${id}`)
  // ① 하이라이트 재매칭 → ② 검색/요약/Wiki 갱신. Wiki는 새 버전 ID를 근거로 보존한다.
  after(async () => {
    await rematchMinuteHighlights(id, body)
    await Promise.all([
      ingestMinute(id, body),
      generateMinuteInsights(id, body),
      committed.wiki_rebuild_required && projectId
        ? rebuildProjectWikiFromActiveMinutes(projectId)
        : wikiJobId === null ? Promise.resolve(null) : processMinuteWikiJob(wikiJobId),
    ])
  })
  return { ok: true, timeFix: fix.corrected ? { from: fix.from!, to: fix.to! } : undefined }
}

/** 첨부 확정 가드(0011 minute_files_attachment_guard)의 거부 사유 → 사용자 문구. 모르는 사유는 원문을 싣지 않는다. */
const ATTACHMENT_GUARD_TEXT: ReadonlyArray<readonly [string, string]> = [
  ['MINUTE_ATTACHMENT_LIMIT', `첨부는 회의록당 ${MINUTE_ATTACHMENTS_MAX_COUNT}개까지입니다.`],
  ['MINUTE_ATTACHMENT_DUPLICATE', '같은 파일이 이미 첨부돼 있습니다.'],
  ['MINUTE_ATTACHMENT_ARCHIVED', '보관된 회의록에는 첨부할 수 없습니다.'],
  ['MINUTE_ATTACHMENT_PATH', '잘못된 파일 경로입니다.'],
  ['MINUTE_ATTACHMENT_OBJECT', '업로드한 파일을 확인하지 못했습니다 — 다시 올려 주세요.'],
]
/** 로그에도 남기는 사유 — 앱의 경로 검사를 통과한 뒤에 DB 가 거부한 것. 화면 흐름(업로드 뒤 기록)에서는 앱과 DB 의 경로 검사가
 *  어긋났거나 Storage 가 객체 메타(size)를 남기지 않게 됐다는 신호다. 나머지(개수·중복·보관)는 사용자 몫의 거부라 남기지 않는다. */
const ATTACHMENT_GUARD_LOGGED: ReadonlySet<string> = new Set(['MINUTE_ATTACHMENT_PATH', 'MINUTE_ATTACHMENT_OBJECT'])

/** 클라이언트 Storage 업로드 후 메타 기록. file_path 는 그 회의록 스코프(본문 minutes·첨부 minute-files) 강제. */
export async function recordMinuteFile(
  minuteId: string,
  file: { role: 'body' | 'attachment'; fileName: string; filePath: string; size: number; mime: string },
): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  if (file.role === 'body' && !/\.(md|markdown)$/i.test(file.fileName))
    return { ok: false, error: '.md 파일만 가능합니다.' }
  const sb = await createServerClient()
  // 본문 연결이면 현재 본문을 소유권 조회에 싣는다 — 같은 행을 다시 읽지 않는다.
  const own = await checkOwner(sb, minuteId, g.actor, file.role === 'body' ? { extra: 'body_md' } : {})
  if (!own.ok) return { ok: false, error: own.error }
  const { projectId } = own.scope
  // 경로 scope 는 DB 의 회의록 행(resolveScope) — 클라이언트 입력을 믿지 않는다.
  if (!isMinuteFilePathValid(own.scope, minuteId, file.filePath,
    file.role === 'body' ? 'minutes' : 'minute-files')) {
    return { ok: false, error: '잘못된 파일 경로입니다.' }
  }
  if (file.role === 'body') {
    const adm = adminOr('버전 저장 설정을 확인하세요.')
    if ('error' in adm) return { ok: false, error: adm.error }
    const { admin } = adm
    // 파일 없는 기존 본문에 원본을 연결하는 경우에도 과거 버전을 수정하지 않고,
    // 같은 본문+새 파일의 새 버전을 원자적으로 append한다.
    const bodyMd = own.row.body_md as string
    const { data: committedRaw, error: commitError } = await admin.rpc('commit_minute_body_version', {
      p_minute_id: minuteId,
      p_body_md: bodyMd,
      p_body_hash: fnv1a64(bodyMd),
      p_file_name: file.fileName,
      p_file_path: file.filePath,
      p_file_size: file.size,
      p_file_mime: file.mime,
      p_actor_id: user.id,
      p_actor_name: displayNameFrom(user.user_metadata, user.email),
    }).single()
    if (commitError || !committedRaw) {
      return { ok: false, error: commitError?.message ?? '원본 버전 기록에 실패했습니다.' }
    }
    const committed = committedRaw as unknown as {
      version_id: string
      wiki_rebuild_required: boolean
    }
    const wikiJobId = committed.wiki_rebuild_required
      ? await enqueueMinuteWikiProcessing({
          projectId,
          minuteId,
          minuteVersionId: committed.version_id,
          bodyMd,
        })
      : null
    after(async () => {
      if (committed.wiki_rebuild_required && projectId) {
        await rebuildProjectWikiFromActiveMinutes(projectId)
      } else if (wikiJobId !== null) {
        await processMinuteWikiJob(wikiJobId)
      }
    })
    revalidatePath(`/minutes/${minuteId}`)
    return { ok: true }
  }

  const { error } = await sb.from('minute_files').insert({
    minute_id: minuteId, role: file.role, file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: user.id,
  })
  if (error) {
    // minuteId 는 checkOwner 가 행으로 확인한 값이다. 파일 경로는 싣지 않는다(끝이 사용자 파일 이름).
    const head = `[recordMinuteFile minute=${minuteId}]`
    const known = ATTACHMENT_GUARD_TEXT.find(([code]) => error.message.includes(code))
    if (!known) console.error(`${head} 첨부 기록 실패:`, error.message)
    else if (ATTACHMENT_GUARD_LOGGED.has(known[0])) console.error(`${head} 첨부 확정 가드 거부: ${known[0]}`)
    return { ok: false, error: known?.[1] ?? '첨부 기록에 실패했습니다.' }
  }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true }
}

/** 첨부 삭제(role='attachment' 전용 — body 는 replaceMinuteBody 로만). 경로는 DB 해석. */
export async function removeMinuteFile(fileId: string): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const { data: f, error: fErr } = await sb.from('minute_files')
    .select('id, minute_id, role, file_path').eq('id', fileId).maybeSingle()
  // 조회 실패를 '파일 없음'으로 위장하지 않는다(3원칙 ①) — 어느 회의록의 첨부인지 모르면 판정도 못 한다.
  if (fErr) {
    console.error('[removeMinuteFile] 첨부 조회 실패:', fErr.message)
    return { ok: false, error: FILE_LOOKUP_FAILED_MSG }
  }
  if (!f) return { ok: false, error: '파일 없음' }
  if ((f.role as string) === 'body') return { ok: false, error: '본문 파일은 교체로만 변경할 수 있습니다.' }
  const own = await checkOwner(sb, f.minute_id as string, g.actor)
  if (!own.ok) return { ok: false, error: own.error }
  // 객체 삭제 → 행 삭제. 버킷 정책(minute-files 삭제 = 관리 권한 ∨ ws 관리자 ∨ 소유자∧미참조, 0011 H2-g)이 행 삭제
  // (can_manage_minute)와 같은 선이 됐다. 객체가 이미 없으면 행만 지운다(존재 확인 RPC).
  const r = await removeStoredAttachment(sb, { kind: 'minute', id: fileId, filePath: f.file_path as string, tag: 'removeMinuteFile' })
  if (!r.ok) return r
  revalidatePath(`/minutes/${f.minute_id as string}`)
  return { ok: true }
}

export async function deleteMinute(id: string): Promise<MinuteActionResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const own = await checkOwner(sb, id, g.actor)
  if (!own.ok) return { ok: false, error: own.error }
  const { projectId } = own.scope
  const adm = adminOr('보관 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm
  // 사용자에게는 목록에서 사라지지만 원본·모든 버전·Storage 객체·Wiki 감사 근거는
  // 삭제하지 않는다. Wiki 출처 철회와 보관 시각 기록도 DB 한 트랜잭션에서 수행한다.
  const { error } = await admin.rpc('archive_minute_with_wiki_retraction', {
    p_minute_id: id,
    p_reason: '사용자가 회의록을 보관했습니다.',
  })
  if (error) {
    console.error('[deleteMinute] 보관 실패:', error.message)
    return { ok: false, error: error.message }
  }
  revalidatePath('/minutes')
  revalidatePath(`/minutes/${id}`)
  if (projectId) {
    revalidatePath(`/p/${projectId}/wiki`)
    after(async () => {
      await rebuildProjectWikiFromActiveMinutes(projectId, id)
    })
  }
  return { ok: true }
}

/** 뷰어 새로고침용 얇은 래퍼 — 세션 게이트 후 위임. */
export async function fetchMinuteDetail(id: string) {
  const user = await getSession()
  if (!user) return null
  const s = await resolveScope('minutes', id)                                 // 행의 워크스페이스로 판정(스펙 §4.2)
  if (!s.ok) return null
  const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')
  if (!mod.ok) return null
  return getMinuteDetail(id)
}

/** 다운로드 클릭 시 서명 URL 발급(MINUTE_FILE_URL_TTL_SEC — 발급 때 RLS 재검사, 회수 창 = TTL). */
export async function getMinuteFileUrl(fileId: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: f, error: fErr } = await sb.from('minute_files').select('file_path, file_name, minute_id').eq('id', fileId).maybeSingle()
  // 조회 실패를 '파일 없음'으로 위장하지 않는다(3원칙 ①).
  if (fErr) {
    console.error('[getMinuteFileUrl] 첨부 조회 실패:', fErr.message)
    return { ok: false, error: FILE_LOOKUP_FAILED_MSG }
  }
  if (!f) return { ok: false, error: '파일 없음' }
  const s = await resolveScope('minutes', f.minute_id as string)             // 파일 행의 회의록 → 그 워크스페이스(스펙 §4.2 첫 문단 — 대상 행)
  if (!s.ok) return { ok: false, error: s.error }
  const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  // download 지정 → Content-Disposition: attachment. 인라인 렌더 시 charset 미지정으로
  // 한글이 깨져 보이는 문제를 피하고, 원본 파일명으로 바로 내려받게 한다.
  const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
    .createSignedUrl(f.file_path as string, MINUTE_FILE_URL_TTL_SEC, { download: (f.file_name as string) || true })
  if (signErr) console.error('[getMinuteFileUrl] 서명 URL 발급 실패:', signErr.message)
  if (!signed?.signedUrl) return { ok: false, error: 'URL 발급 실패' }
  return { ok: true, url: signed.signedUrl }
}

/** 버전 원본 클릭 시 서명 URL 발급 — getMinuteFileUrl 과 같은 TTL·download 이름. 버전 목록은 서명하지 않는다(P8-H1-4).
 *  minute_id·id 두 조건으로 읽어 그 회의록의 버전만 서명한다. 열람 권한은 세션 클라이언트의 RLS 가 판정한다. */
export async function getMinuteVersionFileUrl(
  minuteId: string, versionId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const s = await resolveScope('minutes', minuteId)                           // 행의 워크스페이스로 판정(스펙 §4.2)
  if (!s.ok) return { ok: false, error: s.error }
  const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  const sb = await createServerClient()
  const { data: v, error: vErr } = await sb.from('minute_versions')
    .select('file_path, file_name').eq('minute_id', minuteId).eq('id', versionId).maybeSingle()
  // 조회 실패를 '원본 없음'으로 위장하지 않는다(3원칙 ①).
  if (vErr) {
    console.error('[getMinuteVersionFileUrl] 버전 조회 실패:', vErr.message)
    return { ok: false, error: VERSION_LOOKUP_FAILED_MSG }
  }
  if (!v?.file_path) return { ok: false, error: '원본 파일이 없습니다.' }
  const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
    .createSignedUrl(v.file_path as string, MINUTE_FILE_URL_TTL_SEC, { download: (v.file_name as string | null) || true })
  if (signErr) console.error('[getMinuteVersionFileUrl] 서명 URL 발급 실패:', signErr.message)
  if (!signed?.signedUrl) return { ok: false, error: 'URL 발급 실패' }
  return { ok: true, url: signed.signedUrl }
}

/** 업로드 모달의 회의 연결 드롭다운용 — 프로젝트 회의 목록(가벼운 필드만).
 *  조회 실패는 결과로 돌려준다 — 드롭다운이 '연결할 회의 없음'으로 보이지 않게 모달이 사유를 띄운다. */
export async function fetchProjectMeetingsLite(
  projectId: string,
): Promise<{ ok: true; meetings: { id: string; title: string; meetingDate: string }[] } | { ok: false; error: string }> {
  const user = await getSession()
  if (!user) return { ok: true, meetings: [] }
  const mod = await requireModule({ projectId }, ['minutes', 'meetings'])     // 회의록 폼의 회의 선택 — 둘 다 켜져야. 꺼지면 연결할 회의 없음
  if (!mod.ok) return { ok: true, meetings: [] }
  const res = await getProjectMeetingData(projectId)
  if (!res.ok) return res
  return { ok: true, meetings: res.meetings.map(mt => ({ id: mt.id, title: mt.title, meetingDate: mt.meetingDate })) }
}

/** 회의 상세 모달의 '연결된 회의록' 바로가기용 — 역방향 조회(회의 → 회의록). */
export async function fetchMeetingMinutesLite(
  meetingId: string,
): Promise<{ id: string; title: string; minuteDate: string }[]> {
  const user = await getSession()
  if (!user) return []
  const found = await resolveProjectId('meetings', meetingId)                 // 회의 행의 프로젝트로 판정(스펙 §4.2)
  if (!found.ok || !found.projectId) return []
  const mod = await requireModule({ projectId: found.projectId }, ['minutes', 'meetings'])
  if (!mod.ok) return []
  const sb = await createServerClient()
  const { data, error } = await sb.from('minutes')
    .select('id, title, minute_date')
    .eq('meeting_id', meetingId)
    .is('archived_at', null)
    .order('minute_date', { ascending: false })
  if (error) console.error('[fetchMeetingMinutesLite] 연결된 회의록 조회 실패:', error.message)
  return (data ?? []).map(r => ({
    id: r.id as string,
    title: r.title as string,
    minuteDate: r.minute_date as string,
  }))
}

/** 월 이동 시 클라이언트 호출용. */
export async function fetchMinutesRange(
  rangeStart: string, rangeEnd: string, team: TeamCode | null,
): Promise<Minute[]> {
  const user = await getSession()
  if (!user) return []
  const mod = await requireSessionModule(null, 'minutes')                    // 행이 없는 목록 — 세션 유일 워크스페이스(P13)
  if (!mod.ok) return []
  return getMinutesPage(rangeStart, rangeEnd, team)
}

/** 검색 입력 시 클라이언트 호출용(전 기간, 100건 캡). */
export async function fetchMinutesSearch(q: string, team: TeamCode | null): Promise<Minute[]> {
  const user = await getSession()
  if (!user) return []
  const mod = await requireSessionModule(null, 'minutes')
  if (!mod.ok) return []
  return searchMinutes(q, team, 100)
}

/** 탐색기 진입/재시도/업로드 후 클라이언트 호출용.
 *  기존 액션들의 [] 폴백과 달리 에러 상태를 UI까지 전달하기 위해 null을 반환한다(의도적 관례 이탈).
 *  미로그인/세션 만료도 v1에서는 구분하지 않는다 — 이 페이지는 인증 하에 있어 실사용상 만료 엣지뿐이며
 *  에러 카드+재시도로 수용(스펙 '서버 액션' 절). */
export async function fetchMinutesExplorer(): Promise<ExplorerData | null> {
  const user = await getSession()
  if (!user) return null
  const mod = await requireSessionModule(null, 'minutes')
  if (!mod.ok) return null
  return getMinutesExplorer()
}

/** 액션 내부용 폴더 행 — 가드가 RLS 와 같은 워크스페이스 판정을 하도록 workspace_id 를 싣는다(0006). */
type FolderRow = MinuteFolder & { workspaceId: string }

/** 폴더 전량 로드(액션 내부용) — 깊이 검증에 사용. 실패 시 null. */
async function loadFolders(sb: Awaited<ReturnType<typeof createServerClient>>): Promise<FolderRow[] | null> {
  const { data, error } = await sb.from('minute_folders').select('id, name, parent_id, sort, created_by, project_id, workspace_id')
  if (error) { console.error('[loadFolders] 조회 실패:', error.message); return null }
  return (data ?? []).map((f: Record<string, unknown>) => ({
    id: f.id as string, name: f.name as string,
    parentId: (f.parent_id as string | null) ?? null,
    sort: f.sort as number, createdBy: (f.created_by as string | null) ?? null,
    projectId: (f.project_id as string | null) ?? null,
    workspaceId: f.workspace_id as string,
  }))
}

const FOLDER_DUP_MSG = '같은 폴더에 같은 이름이 이미 있습니다.'

export async function createMinuteFolder(
  name: string, parentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireSessionModule(null, 'minutes')                    // 폴더 조작은 /minutes 탐색기 전용 — 화면과 같은 유일 워크스페이스(P28)
  if (!mod.ok) return { ok: false, error: mod.error }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  // W18(§6.3) — 루트 폴더 생성 금지. 회의록의 team_code 를 폴더에서 파생하려면 "모든 폴더는
  // 시드 팀 루트의 서브트리"라는 불변식이 필요한데, 사용자 루트 폴더가 하나라도 생기면 그
  // 서브트리 회의록의 팀 파생이 끊긴다(teamSubOfFolder 가 null). 팀 축은 팀 마스터가 만든다.
  // 이 가드가 기존 팀코드 동명 스쿼팅 가드를 포섭한다(루트 자체가 막히므로).
  if (parentId === null) {
    return { ok: false, error: '폴더는 담당 팀 폴더 안에만 만들 수 있습니다.' }
  }
  const sb = await createServerClient()
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const parent = folders.find(f => f.id === parentId)
  if (!parent) return { ok: false, error: '상위 폴더를 찾을 수 없습니다.' }
  // 폴더는 부모의 워크스페이스에 생긴다(트리거가 채운다) — 그 워크스페이스에 역할(조회 전용 차단)이 있어야 한다.
  // RLS insert_own_minute_folders(0006)와 같은 판정.
  if (!hasProjectRoleInWorkspace(g.actor, parent.workspaceId)) return { ok: false, error: '권한 없음' }
  // 자식=부모 프로젝트 불변식 — 부모가 프로젝트 폴더면 그 프로젝트 멤버만 하위를 만들 수 있다.
  if (parent.projectId && !isProjectMember(g.actor, parent.projectId)) {
    return { ok: false, error: '권한 없음' }
  }
  if (folderDepthOf(folders, parentId) + 1 > MINUTE_FOLDER_DEPTH_MAX)
    return { ok: false, error: `폴더는 최대 ${MINUTE_FOLDER_DEPTH_MAX}단까지 만들 수 있습니다.` }
  const { error } = await sb.from('minute_folders')
    .insert({
      name: normalizeFolderName(name), parent_id: parentId, created_by: g.actor.userId,
      project_id: parent.projectId,
    })
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    if (error.code === '23503') return { ok: false, error: '상위 폴더가 방금 삭제되었습니다. 새로고침 후 다시 시도하세요.' }
    console.error('[createMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  revalidatePath('/minutes')
  return { ok: true }
}

export async function renameMinuteFolder(
  id: string, name: string,
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireSessionModule(null, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  const nameErr = validateFolderName(name)
  if (nameErr) return { ok: false, error: nameErr }
  const sb = await createServerClient()
  // 개명 가드 선행조회 — 실패하면 판정 불가이므로 중단(쓰기 선행조회 원칙)
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  // 팀 루트 시드만 개명 금지(팀명=자동 편철 앵커) — 하위 구분은 실폴더에서 동적 유도되므로
  // 하위 폴더 개명은 곧 옵션 변경으로 반영된다(허용)
  if (isTeamRootFolder(target))
    return { ok: false, error: '팀 기본 폴더는 이름을 변경할 수 없습니다.' }
  // 자식=부모 프로젝트 불변식 — 프로젝트 폴더는 그 프로젝트 멤버만 개명할 수 있다(RLS 는 이
  // 계열 쓰기 정책이 없으므로 여기가 유일한 방어선).
  if (target.projectId && !isProjectMember(g.actor, target.projectId)) {
    return { ok: false, error: '권한 없음' }
  }
  // 루트에서 팀코드 동명으로의 개명도 차단(앵커 사칭 방지) — 그 폴더 범위(프로젝트, 미지정이면 워크스페이스)의
  // 등록 팀(비활성 포함)으로 본다. 다른 워크스페이스 팀 이름은 이 트리의 앵커가 아니다.
  if (target.parentId === null) {
    const teams = await teamCodesOr({ projectId: target.projectId, workspaceId: target.workspaceId })
    if ('error' in teams) return { ok: false, error: teams.error }
    if (isTeamRootName(name, teams.codes))
      return { ok: false, error: `팀 기본 폴더명(${teams.codes.join('·')})은 루트에 사용할 수 없습니다.` }
  }
  const { data, error } = await sb.from('minute_folders')
    .update({ name: normalizeFolderName(name), updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    console.error('[renameMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  // RLS 의 관리자 판정(작성자 ∨ 그 워크스페이스 관리자, 0006)이 아니면 0행 — 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/**
 * 폴더 삭제 — **비우기 우선**(결정 §6 「폴더 삭제 가드」).
 *
 * 종전에는 FK cascade 로 하위 폴더가 함께 지워지고 소속 회의록은 `folder_id set null` 로
 * **미분류 강등**됐다. §6.3 이후 `team_code` 를 폴더에서 파생하므로 미분류 강등은 곧
 * **팀 파생이 끊긴 데이터**가 된다. 게다가 외부 API·배치가 만든 폴더는 `isTeamRootFolder`
 * 보호 밖이라 전송자 1명이 지우면 그 안 회의록이 전부 미분류가 될 수 있었다.
 *
 * → 삭제 전에 자식 폴더와 소속 회의록을 **부모로 승격**시킨다. 스키마 변경 없이 UX 유지.
 */
export async function deleteMinuteFolder(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireSessionModule(null, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  const sb = await createServerClient()
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  if (isTeamRootFolder(target))
    return { ok: false, error: '팀 기본 폴더는 삭제할 수 없습니다.' }
  // 자식=부모 프로젝트 불변식 — 프로젝트 폴더는 그 프로젝트 멤버만 삭제할 수 있다. 승격(비우기)
  // 전에 걸어야 남의 프로젝트 트리를 조용히 재편철하지 않는다.
  if (target.projectId && !isProjectMember(g.actor, target.projectId)) {
    return { ok: false, error: '권한 없음' }
  }
  // 승격 대상 = 부모. W18 이후 루트 폴더는 생기지 않으므로 삭제 가능한 폴더엔 항상 부모가 있다.
  const parentId = target.parentId
  if (!parentId) return { ok: false, error: '최상위 폴더는 삭제할 수 없습니다.' }
  // RLS(0040)와 **같은 조건**을 명시 선판정한다 — 승격을 먼저 하기 때문에, 삭제가 나중에
  // 권한으로 막히면 옮겨만 놓고 폴더가 남는 상태가 된다. 같은 조건이면 그 일이 없다.
  // RLS 의 관리자 판정(작성자 ∨ 그 워크스페이스 관리자, 0006)과 같다.
  if (target.createdBy !== g.actor.userId && !isWorkspaceAdmin(g.actor, target.workspaceId)) {
    return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  }

  const adm = adminOr('폴더 삭제 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm
  // ① 자식 폴더 승격 — 같은 부모에 동명이 생기면 부분 유니크 인덱스가 23505 로 막는다.
  //    그 경우 사용자가 이름을 바꾸도록 안내한다(조용히 cascade 로 지우지 않는다).
  const children = folders.filter(f => f.parentId === id)
  if (children.length > 0) {
    const clash = children.find(c => folders.some(f => f.parentId === parentId && f.name === c.name))
    if (clash) {
      return { ok: false, error: `상위 폴더에 같은 이름('${clash.name}')이 있어 비울 수 없습니다. 먼저 이름을 바꾸세요.` }
    }
    const { error: cErr } = await admin.from('minute_folders')
      .update({ parent_id: parentId, updated_at: new Date().toISOString() }).eq('parent_id', id)
    if (cErr) {
      console.error('[deleteMinuteFolder] 하위 폴더 승격 실패:', cErr.message)
      return { ok: false, error: '하위 폴더를 옮기지 못해 삭제를 중단했습니다.' }
    }
  }
  // ② 소속 회의록 승격 — updated_at 은 건드리지 않는다(조직 정리가 외부 연동 GET 에
  //    '방금 수정됨'으로 비치면 안 된다 — 0043 4단계·배치와 같은 규칙).
  const { error: mErr } = await admin.from('minutes').update({ folder_id: parentId }).eq('folder_id', id)
  if (mErr) {
    console.error('[deleteMinuteFolder] 회의록 승격 실패:', mErr.message)
    return { ok: false, error: '회의록을 옮기지 못해 삭제를 중단했습니다.' }
  }
  // ③ 이제 빈 폴더다 — cascade 가 지울 것이 없다.
  const { data, error } = await sb.from('minute_folders').delete().eq('id', id).select('id')
  if (error) { console.error('[deleteMinuteFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/** 0045 메타 RPC 가 raise 하는 영문 상수 → 사용자 문구. 매핑이 없으면 'MINUTE_ARCHIVED' 같은
 *  내부 상수가 그대로 화면에 노출된다. */
const RPC_ERROR_MESSAGES: ReadonlyArray<[string, string]> = [
  ['MINUTE_NOT_FOUND', '회의록을 찾을 수 없습니다.'],
  ['MINUTE_ARCHIVED', '보관된 회의록은 변경할 수 없습니다.'],
  ['MINUTE_TEAM_INVALID', '비활성 팀의 폴더로는 이동할 수 없습니다.'],
  ['MINUTE_FOLDER_WORKSPACE_MISMATCH', '다른 워크스페이스 폴더로는 이동할 수 없습니다.'],
  // 0006 트리거 — 액션이 쓰기 전에 같은 판정을 하므로 경합에서만 닿는다.
  ['WORKSPACE_SCOPE_MISMATCH', CROSS_WORKSPACE_MOVE_MSG],
  ['MINUTE_METADATA_REQUIRED', '회의록 필수 항목이 비어 있습니다.'],
  ['MINUTE_METADATA_KEY_NOT_ALLOWED', '허용되지 않은 항목이 포함됐습니다.'],
]
function rpcErrorMessage(message: string | undefined, fallback: string): string {
  if (!message) return fallback
  for (const [code, text] of RPC_ERROR_MESSAGES) if (message.includes(code)) return text
  return fallback
}

/** 드롭 거부 사유 → 사용자 문구. 클라이언트도 같은 사유 코드로 토스트를 고르지만, 서버가
 *  최종 판정자라 여기서도 사유별 안내를 돌려준다(원인을 모른 채 '실패'만 보이지 않게). */
const FOLDER_MOVE_REJECT_MSG: Record<MinuteDropReject, string> = {
  'team-root': '팀 기본 폴더는 이동할 수 없습니다.',
  'not-found': '이동할 상위 폴더를 찾을 수 없습니다.',
  cycle: '폴더를 자기 자신이나 하위 폴더로 옮길 수 없습니다.',
  depth: `폴더는 최대 ${MINUTE_FOLDER_DEPTH_MAX}단까지 만들 수 있습니다.`,
  'anchor-squat': '팀 기본 폴더명은 루트에 사용할 수 없습니다.',
  'cross-project': '다른 프로젝트 폴더로는 이동할 수 없습니다.',
}

/** 폴더를 다른 폴더(또는 루트) 아래로 이동 — 탐색기 드래그앤드롭.
 *  클라이언트가 이미 같은 규칙으로 걸렀더라도 서버에서 전부 다시 판정한다(fail-closed).
 *  teamCodes 는 비활성 포함 전체 등록 팀 — 활성 팀만 아는 클라이언트보다 넓다. */
export async function moveMinuteFolder(
  id: string, newParentId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const mod = await requireSessionModule(null, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  const sb = await createServerClient()
  // 이동 가드 선행조회 — 실패하면 판정 불가이므로 중단(쓰기 선행조회 원칙)
  const folders = await loadFolders(sb)
  if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
  const target = folders.find(f => f.id === id)
  if (!target) return { ok: false, error: '폴더가 없습니다.' }
  // 루트 예약어(앵커 사칭)는 루트로 옮길 때만 본다 — 그 폴더 범위(프로젝트, 미지정이면 워크스페이스)의 등록 팀으로.
  let teamCodes: string[] = []
  if (newParentId === null) {
    const teams = await teamCodesOr({ projectId: target.projectId, workspaceId: target.workspaceId })
    if ('error' in teams) return { ok: false, error: teams.error }
    teamCodes = teams.codes
  }
  const verdict = resolveFolderDrop(target, newParentId, folders, teamCodes)
  if (verdict.kind === 'noop') return { ok: true }        // 제자리 — 쓰기 없이 성공
  if (verdict.kind === 'reject') return { ok: false, error: FOLDER_MOVE_REJECT_MSG[verdict.reason] }
  // 새 부모는 같은 워크스페이스여야 한다(0006) — 프로젝트 없는 폴더끼리는 cross-project 판정을 통과하므로 여기서 거른다.
  // 다르면 트리거가 WORKSPACE_SCOPE_MISMATCH 로 막는다 — 쓰기 전에 같은 판정을 한다.
  const newParent = newParentId === null ? undefined : folders.find(f => f.id === newParentId)
  if (newParent && newParent.workspaceId !== target.workspaceId) {
    return { ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' }
  }
  const { data, error } = await sb.from('minute_folders')
    .update({ parent_id: newParentId, updated_at: new Date().toISOString() })
    .eq('id', id).select('id')
  if (error) {
    if (error.code === '23505') return { ok: false, error: FOLDER_DUP_MSG }
    console.error('[moveMinuteFolder] 실패:', error.message)
    return { ok: false, error: error.message }
  }
  // RLS 의 관리자 판정(작성자 ∨ 그 워크스페이스 관리자, 0006)이 아니면 0행 — 조용한 no-op 을 성공으로 위장하지 않는다
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 폴더가 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/**
 * 회의록을 폴더로 이동 — 탐색기 드래그앤드롭·이동 메뉴.
 *
 * §6.4: 폴더가 team 의 유일한 출처가 되므로 **팀 루트를 넘어가면 team_code 도 따라가야** 한다.
 * 아니면 "폴더는 MES인데 team_code 는 ERP"인 불일치가 생겨 목록 필터(?team=)와 트리가 서로
 * 다른 답을 준다. 같은 팀 안 이동(대부분)은 종전처럼 raw update — 싸고 위키에 무영향.
 *
 * 권한은 기존 checkOwner(작성자 또는 그 회의록 프로젝트의 관리자 이상) 유지 — archived 차단도 checkOwner 가 한다.
 */
export async function moveMinuteToFolder(
  minuteId: string, folderId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  // 미분류(null)로 빼내는 것은 탐색기 D&D 가 제공하는 조작이라 허용한다. 팀 파생은 대상
  // 폴더가 있을 때만 다시 하고, 미분류면 현재 team_code 를 그대로 둔다(추측 금지).
  const sb = await createServerClient()
  let folders: FolderRow[] | null = null
  let targetFolder: FolderRow | undefined
  if (folderId) {
    folders = await loadFolders(sb)
    if (!folders) return { ok: false, error: '폴더 목록을 불러오지 못했습니다.' }
    targetFolder = folders.find(f => f.id === folderId)
    if (!targetFolder) return { ok: false, error: '이동할 폴더를 찾을 수 없습니다.' }
  }
  // 현재 팀은 소유권 조회에 싣고, 프로젝트·워크스페이스는 resolveScope 가 확정한 범위다 — 쓰기 선행조회 실패는 중단(추측 금지).
  const own = await checkOwner(sb, minuteId, g.actor, { extra: 'team_code' })
  if (!own.ok) return { ok: false, error: own.error }
  const currentTeam = own.row.team_code as string
  const minuteProjectId = own.scope.projectId

  // 자식=부모 프로젝트 불변식 — 대상 폴더의 프로젝트와 회의록의 프로젝트가 다르면 거부한다
  // (미분류 폴더로의 이동은 targetFolder 가 없으므로 이 검사를 건너뛴다).
  if (targetFolder && (targetFolder.projectId ?? null) !== minuteProjectId) {
    return { ok: false, error: '다른 프로젝트 폴더로는 이동할 수 없습니다.' }
  }
  // 프로젝트 없는 폴더끼리는 워크스페이스가 경계다(0006) — raw update·메타 RPC 모두 이 불일치를 잡지 않는다.
  if (targetFolder && targetFolder.workspaceId !== own.scope.workspaceId) {
    return { ok: false, error: '다른 워크스페이스 폴더로는 이동할 수 없습니다.' }
  }

  // 대상 폴더에서 팀 파생. 시드 체인 밖(§6.3 불변식 위반)이면 추측하지 않고 거절한다.
  let nextTeam = currentTeam
  if (folderId && folders) {
    const derived = teamSubOfFolder(folders, folderId)
    if (!derived) return { ok: false, error: '담당 팀을 판정할 수 없는 폴더입니다.' }
    nextTeam = derived.team
  }

  const adm = adminOr('폴더 이동 설정을 확인하세요.')
  if ('error' in adm) return { ok: false, error: adm.error }
  const { admin } = adm

  if (nextTeam !== currentTeam) {
    // 팀이 바뀌면 team_code 는 v_index_content_changed 대상이라 검색 인덱스 재적재가 따라야
    // 한다. raw update 로 하면 ai_documents 가 옛 팀으로 남는다. updateMinuteMeta 와 같은
    // 경로를 재사용한다(부분 patch — 보낸 키만 덮으므로 나머지 메타는 보존된다).
    const { data: updateRaw, error } = await admin.rpc('update_minute_metadata_with_wiki_retraction', {
      p_minute_id: minuteId,
      p_metadata: { team_code: nextTeam, folder_id: folderId },
    }).single()
    if (error || !updateRaw) {
      console.error('[moveMinuteToFolder] 팀 이동 실패:', error?.message ?? 'no row')
      return { ok: false, error: rpcErrorMessage(error?.message, '폴더 이동에 실패했습니다.') }
    }
    const result = updateRaw as unknown as {
      old_project_id: string | null
      new_project_id: string | null
      wiki_rebuild_required: boolean
    }
    revalidatePath('/minutes'); revalidatePath(`/minutes/${minuteId}`)
    if (result.old_project_id) revalidatePath(`/p/${result.old_project_id}/wiki`)
    if (result.new_project_id) revalidatePath(`/p/${result.new_project_id}/wiki`)
    if (result.wiki_rebuild_required && result.new_project_id) {
      const projectId = result.new_project_id
      after(async () => { await rebuildProjectWikiFromActiveMinutes(projectId) })
    }
    return { ok: true }
  }

  const { data, error } = await admin.from('minutes')
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq('id', minuteId).select('id')
  if (error) { console.error('[moveMinuteToFolder] 실패:', error.message); return { ok: false, error: error.message } }
  if (!data || data.length === 0) return { ok: false, error: '권한이 없거나 회의록이 없습니다.' }
  revalidatePath('/minutes')
  return { ok: true }
}

/** 탐색기 즐겨찾기 목록 — 미로그인/실패 null (fetchMinutesExplorer 관례와 동일). */
export async function fetchMinuteFavorites(): Promise<string[] | null> {
  const user = await getSession()
  if (!user) return null
  const mod = await requireSessionModule(null, 'minutes')                    // 행이 없는 목록 — 세션 유일 워크스페이스(P13)
  if (!mod.ok) return null
  return getMinuteFavorites()
}

/** 회의록 즐겨찾기 토글 — 성공 여부만 반환(실패 시 호출부가 낙관적 갱신 롤백 + 토스트). */
export async function toggleMinuteFavorite(minuteId: string, on: boolean): Promise<boolean> {
  const user = await getSession()
  if (!user) return false
  const s = await resolveScope('minutes', minuteId)                           // 행의 워크스페이스로 판정(스펙 §4.2)
  if (!s.ok) return false
  const mod = await requireModule({ workspaceId: s.workspaceId }, 'minutes')
  if (!mod.ok) return false
  const sb = await createServerClient()
  if (on) {
    const { error } = await sb.from('minute_favorites')
      .upsert({ user_id: user.id, minute_id: minuteId }, { onConflict: 'user_id,minute_id', ignoreDuplicates: true })
    if (error) { console.error('[toggleMinuteFavorite] 저장 실패:', error.message); return false }
  } else {
    const { error } = await sb.from('minute_favorites')
      .delete().eq('user_id', user.id).eq('minute_id', minuteId)
    if (error) { console.error('[toggleMinuteFavorite] 삭제 실패:', error.message); return false }
  }
  return true
}

/** 블록 하이라이트 토글 — 스펙 §6.7. 서버가 현재 본문 기준으로 (인덱스, 해시) 재검증. */
export async function toggleMinuteHighlight(
  minuteId: string, blockIndex: number, blockHash: string,
): Promise<{ ok: boolean; on?: boolean; error?: string }> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  // 하이라이트는 다른 사용자에게도 보이는 공유 표식 — 그 회의록 범위의 멤버 이상(조회 전용·다른 워크스페이스 차단).
  const m = await requireMinuteMember(g.actor, minuteId)
  if (!m.ok) return { ok: false, error: m.error }
  const user = await getSession()
  if (!user) return { ok: false, error: '로그인 필요' }
  const sb = await createServerClient()
  const { data: minute, error: minuteErr } = await sb.from('minutes')
    .select('body_md, archived_at')
    .eq('id', minuteId)
    .maybeSingle()
  // 조회 실패를 '없음'으로 위장하지 않는다(3원칙 ①).
  if (minuteErr) {
    console.error('[toggleMinuteHighlight] 회의록 조회 실패:', minuteErr.message)
    return { ok: false, error: '회의록을 불러오지 못했습니다.' }
  }
  if (!minute) return { ok: false, error: '회의록을 찾을 수 없습니다.' }
  if (minute.archived_at) return { ok: false, error: '보관된 회의록은 변경할 수 없습니다.' }
  const blocks = splitMinuteBlocks(minute.body_md as string)
  const block = blocks[blockIndex]
  if (!block || !isMarkableBlock(block) || block.hash !== blockHash)
    return { ok: false, error: '본문이 변경되었습니다. 새로고침 해주세요.' }

  const { data: existing, error: exErr } = await sb.from('minute_highlights')
    .select('id, block_hash').eq('minute_id', minuteId)
    .eq('created_by', user.id).eq('block_index', blockIndex).maybeSingle()
  // 토글 방향(끄기/켜기)을 정하는 선행 조회 — 실패를 '없음'으로 오인하면 끄기가 켜기로 뒤집히고,
  // 뒤이은 insert 의 unique 위반(23505)이 멱등 처리에 삼켜져 ok:true 로 보고된다.
  if (exErr) {
    console.error('[toggleMinuteHighlight] 기존 하이라이트 조회 실패:', exErr.message)
    return { ok: false, error: exErr.message }
  }

  if (existing && (existing.block_hash as string) === blockHash) {
    // 끄기
    const { error } = await sb.from('minute_highlights').delete().eq('id', existing.id as string)
    if (error) return { ok: false, error: error.message }
    revalidatePath(`/minutes/${minuteId}`)
    return { ok: true, on: false }
  }
  if (existing) {
    // stale 행(재매칭 실패 잔존, 해시 불일치) — 지우고 새로 켠다(스펙 §6.7)
    // 삭제 실패를 삼키면 뒤이은 insert 가 unique(minute_id, created_by, block_index) 위반(23505)을 내고,
    // 그것이 아래 멱등 처리에 삼켜져 하이라이트가 갱신되지 않았는데도 ok:true 로 보고된다. 실패는 실패로 중단한다.
    const { error: staleErr } = await sb.from('minute_highlights').delete().eq('id', existing.id as string)
    if (staleErr) {
      console.error('[toggleMinuteHighlight] stale 하이라이트 삭제 실패:', staleErr.message)
      return { ok: false, error: staleErr.message }
    }
  }
  const { error } = await sb.from('minute_highlights').insert({
    minute_id: minuteId, block_index: blockIndex, block_hash: blockHash,
    created_by: user.id, created_by_name: displayNameFrom(user.user_metadata, user.email),
  })
  // 동시 토글 경합: unique 위반은 "이미 하이라이트됨"으로 멱등 처리
  if (error && error.code !== '23505') return { ok: false, error: error.message }
  revalidatePath(`/minutes/${minuteId}`)
  return { ok: true, on: true }
}

/** 요약 카드 self-heal 트리거 — 스펙 §4.3. 멤버십 게이트(무료 쿼터 보호). */
export async function ensureMinuteInsightsAction(
  minuteId: string,
): Promise<{ status: 'ready' | 'generated' | 'unavailable'; error?: string }> {
  // 멤버십 게이트(무료 쿼터 보호) — 그 회의록 범위의 멤버 이상만. 조회 전용·다른 워크스페이스는 self-heal 을 트리거하지 못한다.
  // 조회 실패는 '자격 없음'과 같은 unavailable 이되 error 문구를 싣는다 — 화면이 원인을 보인다(3원칙 ①).
  // 모듈 꺼짐도 사유를 싣는다 — 화면이 '지금 사용할 수 없음'을 보인다(ERR_DENIED 는 사유 없는 모양 그대로)
  const refused = (error: string) =>
    error === ERR_LOOKUP || error === ERR_MODULE_DISABLED ? { status: 'unavailable' as const, error } : { status: 'unavailable' as const }
  const g = await requireActor()
  if (!g.ok) return refused(g.error)
  const m = await requireMinuteMember(g.actor, minuteId)
  if (!m.ok) return refused(m.error)
  const sb = await createServerClient()
  const { data: minute, error: minuteErr } = await sb.from('minutes')
    .select('body_md, archived_at')
    .eq('id', minuteId)
    .maybeSingle()
  if (minuteErr) {
    console.error('[ensureMinuteInsightsAction] 회의록 조회 실패:', minuteErr.message)
    return { status: 'unavailable', error: '회의록을 불러오지 못했습니다. 잠시 후 다시 시도하세요.' }
  }
  if (!minute) return { status: 'unavailable' }
  if (minute.archived_at) return { status: 'ready' }
  const bodyMd = minute.body_md as string
  if (!bodyMd.trim()) return { status: 'ready' }
  const status = await ensureMinuteInsights(minuteId, bodyMd, fnv1a64(bodyMd))
  if (status === 'generated') revalidatePath(`/minutes/${minuteId}`)
  return { status }
}

/** 공유 상태를 못 읽었거나(share_lookup) 못 썼다(share_save) — 모달이 사전 문구를 고르는 사유. 판정의 거부(권한·보관)에는 없다. */
export type MinuteShareCode = 'share_lookup' | 'share_save'
export interface MinuteShareResult { ok: boolean; enabled?: boolean; token?: string | null; error?: string; code?: MinuteShareCode }

const ERR_SHARE_LOOKUP = '공유 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
const ERR_SHARE_SAVE = '공유 설정을 저장하지 못했습니다.'

/** 소유자/관리자 검증 + 공유 컬럼 조회 — get/set 공용(소유권 규칙 한 곳). 판정은 checkOwner 그대로다(resolveScope 범위의
 *  canEditMinute) — 미지정(project_id null) 회의록은 작성자 본인 또는 슈퍼유저만.
 *  share_token 은 세션이 읽지 못한다(0011 H2-c — minutes 는 share_token 을 뺀 열 단위 SELECT). 판정을 통과한 뒤 service_role 로
 *  그 회의록 id 한 행만 읽는다. 조회 실패·0행은 공유 상태를 모른다는 뜻이라 거부한다(fail-closed). */
async function readShareRow(sb: Sb, id: string, actor: Actor):
  Promise<{ state: ShareState; admin: ReturnType<typeof createAdminClient> } | { error: string; code?: MinuteShareCode }> {
  const own = await checkOwner(sb, id, actor, { archivedError: '보관된 회의록은 공유 설정을 바꿀 수 없습니다.' })
  if (!own.ok) return { error: own.error }
  const adm = adminOr('공유 설정을 확인하세요.')
  if ('error' in adm) return { error: adm.error }
  const { data, error } = await adm.admin.from('minutes').select('share_token, share_enabled').eq('id', id).maybeSingle()
  if (error || !data) {
    console.error(`[readShareRow minute=${id}] 공유 상태 조회 실패:`, error?.message ?? '0행')
    return { error: ERR_SHARE_LOOKUP, code: 'share_lookup' }
  }
  const row = data as { share_token: string | null; share_enabled: boolean | null }
  return { state: { token: row.share_token ?? null, enabled: !!row.share_enabled }, admin: adm.admin }
}

/** readShareRow 의 거부를 응답으로 — code 는 있을 때만 싣는다(판정의 거부에는 없다). */
const refusedShare = (r: { error: string; code?: MinuteShareCode }): MinuteShareResult =>
  (r.code ? { ok: false, error: r.error, code: r.code } : { ok: false, error: r.error })

/** 공유 상태 조회 — 토큰은 이 액션으로만 클라이언트에 전달(페이지 payload 미포함, 소유자/관리자 한정). */
export async function getMinuteShare(id: string): Promise<MinuteShareResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, g.actor)
  if ('error' in row) return refusedShare(row)
  return { ok: true, enabled: row.state.enabled, token: row.state.token }
}

/** 공유 토글/재발급 — 서버에서 소유권을 확인한 뒤 service role로 허용 컬럼만 쓴다. */
export async function setMinuteShare(id: string, op: ShareOp): Promise<MinuteShareResult> {
  const g = await requireActor()
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  const row = await readShareRow(sb, id, g.actor)
  if ('error' in row) return refusedShare(row)
  const next = nextShareState(row.state, op, crypto.randomUUID())
  const { error } = await row.admin.from('minutes')
    .update({ share_token: next.token, share_enabled: next.enabled }).eq('id', id)
  if (error) {
    console.error(`[setMinuteShare minute=${id}] 공유 설정 저장 실패:`, error.message)
    return { ok: false, error: ERR_SHARE_SAVE, code: 'share_save' }
  }
  return { ok: true, enabled: next.enabled, token: next.token }
}
