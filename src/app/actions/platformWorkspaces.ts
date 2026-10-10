'use server'
// 플랫폼 관리 — 워크스페이스 목록·생성(개정 §5.3.1·§5.3.2, §2.2 "새 워크스페이스의 허용 모듈은 플랫폼 관리자가 고른다").
// 지금까지 워크스페이스는 scripts/dev-bootstrap.mjs 와 E2E 스크립트의 service_role insert 로만 생겼다 — 이 액션이 앱 안의 첫 생성 경로다.
// 생성은 create_workspace_with_admin RPC 한 번이다(0054 — 등급을 RPC 안에서 다시 판정한다. 액션 가드와 두 관문).
// 목록·생성·삭제는 requireSuperuser(플랫폼 가드 닫힌 목록 — tests/invariants/platform-guards.test.ts). 워크스페이스가 아직 없거나 전부를 보는 화면이라
// 스코프를 정할 id 가 없다 → service_role 클라이언트를 직접 만든다(docs/sp2-admin-client-audit.md '플랫폼').
// 이름 변경(renameWorkspace)만 requireWorkspaceAdmin(wid) 이다 — 그 워크스페이스의 관리자도 자기 워크스페이스의 이름을 바꾼다(워크스페이스 설정 '일반').
// 이름 변경·삭제는 RPC 한 번씩이다(0055 rename_workspace·delete_empty_workspace — 등급을 RPC 안에서 다시 판정한다).
// 보관·복원(archivePlatformWorkspace·restorePlatformWorkspace)도 requireSuperuser + RPC 한 번씩이다(0056 archive_workspace·restore_workspace).
// 보관된 워크스페이스는 세션에게 없는 것이다(플랫폼 관리자에게도 — 그 화면은 404). 이 목록만 service_role 로 읽어 "보관됨"으로 보인다.
// DB 오류 원문은 로그로만 남기고 응답에는 사유 코드와 고정 문구만 싣는다(문구는 화면이 사전에서 고른다).
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireSuperuser, requireWorkspaceAdmin } from '@/lib/authz'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllPages } from '@/lib/data/paging'
import { failWith } from '@/lib/errors/dbFail'
import { getWorkspaceConfig } from '@/lib/settings/workspaceConfig'
import { SETTINGS_SCHEMA_VERSION, settingDef } from '@/lib/settings/registry'
import { checkWorkspaceCreate, checkWorkspaceName, type WorkspaceCreateField, type WorkspaceCreateInputCode } from '@/lib/workspace/createInput'
import { workspaceRemainingItems, type WorkspaceRemainingItem } from '@/lib/workspace/deleteRemaining'
import { activeFirst, checkArchiveReason } from '@/lib/workspace/archiveInput'
import { SLUG_RE } from '@/lib/workspace/constants'
import type { ModuleId } from '@/lib/modules/defaults'
import { serverTranslator } from '@/lib/i18n/server'

export interface PlatformWorkspaceRow {
  id: string
  slug: string
  name: string
  createdAt: string
  memberCount: number
  projectCount: number
  /** 허용 모듈(비core). null = 설정을 읽지 못했거나 저장값이 손상 — 화면은 '확인 불가'로 그린다(빈 목록으로 위장하지 않는다) */
  allowedModules: ModuleId[] | null
  /** 보관 시각(null = 활성). 보관된 워크스페이스는 멤버·관리자에게 없는 것이고, 그 화면은 플랫폼 관리자에게도 404 다 — 목록의 "열기" 대신 "복원"만 보인다 */
  archivedAt: string | null
  /** 보관 사유(선택 입력) */
  archiveReason: string | null
}
export type PlatformWorkspaceListResult = { ok: true; rows: PlatformWorkspaceRow[] } | { ok: false; error: string }

/** 생성 거부 사유 — 입력 검증 코드 + 서버만 아는 사유. 문구는 사전(platform.ws.err.<code>) */
export type PlatformWorkspaceCreateCode =
  | WorkspaceCreateInputCode | 'denied' | 'slug_taken' | 'admin_not_found' | 'lookup_failed' | 'create_failed'
export type PlatformWorkspaceCreateResult =
  | { ok: true; workspace: { id: string; slug: string; name: string } }
  | { ok: false; code: PlatformWorkspaceCreateCode; field: WorkspaceCreateField | null; error?: string }

const ERR_LIST = 'srv.platformWorkspaces.couldNotLoadWorkspaceList'
const FORBIDDEN = '42501'

/** 모든 워크스페이스(플랫폼 관리자 전용). 멤버·프로젝트 수는 행을 끝까지 읽어 센다(fetchAllPages — 서버 상한에 잘린 수를 사실처럼 내지 않는다) */
export async function listPlatformWorkspaces(): Promise<PlatformWorkspaceListResult> {
  const t = await serverTranslator()
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  try {
    const [workspaces, members, projects] = await Promise.all([
      fetchAllPages<{ id: string; slug: string; name: string; created_at: string; archived_at: string | null; archive_reason: string | null }>('워크스페이스', (from, to) =>
        admin.from('workspaces').select('id, slug, name, created_at, archived_at, archive_reason', { count: 'exact' }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      fetchAllPages<{ workspace_id: string }>('워크스페이스 멤버', (from, to) =>
        admin.from('workspace_members').select('workspace_id', { count: 'exact' }).order('workspace_id', { ascending: true }).order('user_id', { ascending: true }).range(from, to)),
      fetchAllPages<{ workspace_id: string }>('프로젝트', (from, to) =>
        admin.from('projects').select('workspace_id', { count: 'exact' }).order('id', { ascending: true }).range(from, to)),
    ])
    const tally = (rows: { workspace_id: string }[]) => {
      const m = new Map<string, number>()
      for (const r of rows) m.set(r.workspace_id, (m.get(r.workspace_id) ?? 0) + 1)
      return m
    }
    const memberCount = tally(members)
    const projectCount = tally(projects)
    // 허용 모듈은 해석기(설정 표의 유일한 읽기 경로)로 읽는다. 한 워크스페이스의 설정이 손상돼도 목록 전체를 막지 않고 그 칸만 null 로 표시한다
    const allowed = await Promise.all(workspaces.map(async (w): Promise<ModuleId[] | null> => {
      try {
        // 보관된 행의 설정도 읽는다(includeArchived) — 그 밖의 호출부에서는 보관이 곧 읽기 실패다
        const key = (await getWorkspaceConfig(w.id, { client: admin, includeArchived: true })).keys['modules.allowed']
        return key.status === 'set' || key.status === 'default' ? [...key.value] : null
      } catch (e) {
        console.error('[platformWorkspaces] 허용 모듈 판독 실패', { workspaceId: w.id, cause: e instanceof Error ? e.message : e })
        return null
      }
    }))
    return {
      ok: true,
      // 활성 먼저, 보관된 것은 뒤(각 묶음 안은 만든 순). archived_at 이 문자열이 아니면(열이 없는 응답 등) 활성으로 읽지 않는다 —
      // undefined 를 null 로 뭉개면 보관된 행에 "열기"가 보인다
      rows: activeFirst(workspaces.map((w, i) => ({
        id: w.id, slug: w.slug, name: w.name, createdAt: w.created_at,
        memberCount: memberCount.get(w.id) ?? 0, projectCount: projectCount.get(w.id) ?? 0, allowedModules: allowed[i],
        archivedAt: w.archived_at === null ? null : String(w.archived_at),
        archiveReason: typeof w.archive_reason === 'string' ? w.archive_reason : null,
      }))),
    }
  } catch (e) {
    return { ok: false, error: failWith('platformWorkspaces', e, t(ERR_LIST)) }
  }
}

/**
 * 설정 값을 레지스트리의 parse 로 저장 형태로 바꾼다 — 설정 RPC 는 값을 검사하지 않는다(검사는 앱의 레지스트리 한 곳).
 * 모르는 키·검사에 걸린 값이 하나라도 있으면 null 을 돌려주고 호출부는 아무것도 만들지 않는다(원인은 로그로).
 */
function parseWorkspaceValues(raw: Record<string, unknown>): Record<string, unknown> | null {
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    const def = settingDef('workspace', key)
    const parsed = def?.parse(value)
    if (!parsed?.ok) {
      console.error('[createPlatformWorkspace] 설정 값 검사 실패', { key, cause: parsed ? parsed.error : '모르는 키' })
      return null
    }
    values[key] = parsed.value
  }
  return values
}

/** 생성 RPC 의 사유 토큰 → 응답 코드. 표에 없는 오류는 create_failed(원문은 로그로만) */
function createFailure(error: { code?: string; message: string }): PlatformWorkspaceCreateResult {
  if (error.message.includes('WORKSPACE_SLUG_TAKEN')) return { ok: false, code: 'slug_taken', field: 'slug' }
  if (error.message.includes('WORKSPACE_ADMIN_NOT_FOUND')) return { ok: false, code: 'admin_not_found', field: 'adminEmail' }
  if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied', field: null }
  console.error('[createPlatformWorkspace] 워크스페이스 생성 실패:', error.code ?? '', error.message)
  return { ok: false, code: 'create_failed', field: null }
}

/**
 * 워크스페이스 생성 — 행 + 첫 관리자 멤버십 + 그 관리자의 인물 행 + 허용 모듈(·시간대·초대 허용 도메인) 설정.
 * 순서: ① 입력 검증 ② 첫 관리자 계정 확인(이메일 → 계정 id. 없으면 아무것도 만들지 않는다 — 계정을 여기서 만들지 않는다)
 * ③ 설정 값 검사(레지스트리 parse) ④ create_workspace_with_admin RPC 한 번(0054 — 네 쓰기가 한 트랜잭션이라 실패하면 아무것도 남지 않는다.
 * 예전의 "만든 행을 지우는 보상"은 그 삭제가 실패하면 관리자 없는 워크스페이스가 남았다). slug 중복·첫 관리자 없음·등급은 RPC 가 다시 판정한다.
 */
export async function createPlatformWorkspace(input: unknown): Promise<PlatformWorkspaceCreateResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, code: 'denied', field: null, error: g.error }
  const checked = checkWorkspaceCreate(input)
  if (!checked.ok) return { ok: false, code: checked.code, field: checked.field }
  const { name, slug, adminEmail, modules, timezone, inviteDomains } = checked.value
  const admin = createAdminClient()

  // ② 첫 관리자 — 이메일을 주면 그 계정, 비우면 만드는 사람 자신. 조회 실패는 '없음'으로 바꾸지 않고 멈춘다
  const profileQuery = admin.from('profiles').select('user_id')
  const { data: profile, error: profileErr } = await (adminEmail ? profileQuery.eq('email', adminEmail) : profileQuery.eq('user_id', g.actor.userId)).maybeSingle()
  if (profileErr) {
    console.error('[createPlatformWorkspace] 첫 관리자 계정 조회 실패:', profileErr.message)
    return { ok: false, code: 'lookup_failed', field: 'adminEmail' }
  }
  if (!profile) return { ok: false, code: 'admin_not_found', field: 'adminEmail' }

  // ③ 설정 — 허용 모듈은 늘 명시로 적는다(빈 배열 = core 만). 시간대는 줬을 때만(비우면 제품 기본값 — 설정 화면이 브라우저 시간대를 제안한다)
  const set: Record<string, unknown> = { 'modules.allowed': modules }
  if (timezone) set['calendar.timezone'] = timezone
  // 초대 허용 도메인 — 생성 폼에서 명시로 적었을 때만. 적지 않으면 미설정으로 남는다(정책 기본값은 초대 불가 — 첫 초대 전에 워크스페이스 설정에서 정한다)
  if (inviteDomains) set['invites.allowed_domains'] = inviteDomains
  const values = parseWorkspaceValues(set)
  if (!values) return { ok: false, code: 'create_failed', field: null }

  // ④ 한 트랜잭션 — 워크스페이스·멤버십·인물·설정(설정 값은 RPC 안에서 apply_workspace_settings 가 쓴다 — 설정 쓰기 한 길)
  const { data, error } = await admin.rpc('create_workspace_with_admin', {
    p_actor: g.actor.userId, p_slug: slug, p_name: name, p_admin_user_id: (profile as { user_id: string }).user_id,
    p_values: values, p_command_id: randomUUID(), p_schema_version: SETTINGS_SCHEMA_VERSION,
  })
  if (error) return createFailure(error)
  const workspaceId = (data as { workspace_id?: string } | null)?.workspace_id
  if (!workspaceId) {
    // 성공인데 id 가 없다 — 만든 것을 '없음'으로 위장하지 않는다(목록 화면에서 확인하게 실패로 알린다)
    console.error('[createPlatformWorkspace] RPC 가 워크스페이스 id 를 돌려주지 않았다')
    return { ok: false, code: 'create_failed', field: null }
  }

  // 목록 화면과, 만든 사람이 첫 관리자일 때 바뀌는 전환기 목록(레이아웃 데이터)을 함께 새로 읽게 한다
  revalidatePath('/', 'layout')
  return { ok: true, workspace: { id: workspaceId, slug, name } }
}

/** 이름 변경 거부 사유 — 문구는 사전(platform.ws.err.<code>) */
export type WorkspaceRenameCode = 'denied' | 'name_required' | 'name_too_long' | 'not_found' | 'rename_failed'
export type WorkspaceRenameResult =
  | { ok: true; name: string; unchanged: boolean }
  | { ok: false; code: WorkspaceRenameCode; error?: string }

/**
 * 워크스페이스 이름 변경 — 그 워크스페이스의 관리자(플랫폼 관리자 포함). slug 는 바꾸지 않는다(주소·연동이 slug 를 쓴다).
 * 쓰기는 rename_workspace RPC 한 번(0055 — 등급·이름 규칙을 RPC 가 다시 본다). 이름은 셸·탭 제목·전환기·메일에 쓰이므로 레이아웃 데이터까지 새로 읽게 한다.
 */
export async function renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceRenameResult> {
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, code: 'not_found' }
  const g = await requireWorkspaceAdmin(workspaceId)
  if (!g.ok) return { ok: false, code: 'denied', error: g.error }
  const checked = checkWorkspaceName(name)
  if (!checked.ok) return { ok: false, code: checked.code }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('rename_workspace', { p_actor: g.actor.userId, p_workspace_id: workspaceId, p_name: checked.name })
  if (error) {
    if (error.message.includes('WORKSPACE_NOT_FOUND')) return { ok: false, code: 'not_found' }
    if (error.message.includes('WORKSPACE_NAME_INVALID')) return { ok: false, code: 'name_too_long' }
    if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied' }
    console.error('[renameWorkspace] 이름 변경 실패:', error.code ?? '', error.message)
    return { ok: false, code: 'rename_failed' }
  }
  const row = data as { status?: string; name?: string } | null
  if (!row || typeof row.name !== 'string' || (row.status !== 'applied' && row.status !== 'unchanged')) {
    // 성공인데 결과를 읽지 못했다 — 바뀌었는지 모르는 채로 성공이라 하지 않는다
    console.error('[renameWorkspace] RPC 결과 형태가 어긋났다')
    return { ok: false, code: 'rename_failed' }
  }
  if (row.status === 'applied') revalidatePath('/', 'layout')
  return { ok: true, name: row.name, unchanged: row.status === 'unchanged' }
}

/** 삭제 거부 사유 — 문구는 사전(platform.ws.err.<code>). not_empty 는 남은 것(remaining)을 함께 준다 */
export type PlatformWorkspaceDeleteCode = 'denied' | 'slug_mismatch' | 'not_found' | 'not_empty' | 'referenced' | 'delete_failed'
export type PlatformWorkspaceDeleteResult =
  | { ok: true; workspace: { slug: string; name: string } }
  | { ok: false; code: PlatformWorkspaceDeleteCode; remaining?: WorkspaceRemainingItem[]; error?: string }

/**
 * 빈 워크스페이스 삭제 — 플랫폼 관리자만. 되돌릴 수 없다. confirmSlug 는 확인 대화상자에서 사람이 직접 적은 slug 다(RPC 가 그 id 의 slug 와 대조한다).
 * "비어 있음"의 판정과 삭제는 delete_empty_workspace RPC 한 트랜잭션이다(0055): 프로젝트 0·실행자 말고 멤버 0·워크스페이스 소유 자료 0 일 때만 지운다.
 * 남은 것이 있으면 아무것도 지우지 않고 표별 건수를 돌려준다 — 강제 삭제는 없다.
 */
export async function deletePlatformWorkspace(workspaceId: string, confirmSlug: string): Promise<PlatformWorkspaceDeleteResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, code: 'denied', error: g.error }
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, code: 'not_found' }
  // slug 는 다듬지 않는다 — 적은 글자 그대로 대조한다(형식 밖이면 DB 에 묻지 않는다)
  if (typeof confirmSlug !== 'string' || !SLUG_RE.test(confirmSlug)) return { ok: false, code: 'slug_mismatch' }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('delete_empty_workspace', { p_actor: g.actor.userId, p_workspace_id: workspaceId, p_expected_slug: confirmSlug })
  if (error) {
    if (error.message.includes('WORKSPACE_SLUG_MISMATCH')) return { ok: false, code: 'slug_mismatch' }
    if (error.message.includes('WORKSPACE_NOT_FOUND')) return { ok: false, code: 'not_found' }
    if (error.message.includes('WORKSPACE_DELETE_REFERENCED')) return { ok: false, code: 'referenced' }
    if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied' }
    // 셀 줄 모르는 참조(WORKSPACE_DELETE_UNKNOWN_REFERENCE)·잘못된 id 형식 등 — 원문은 로그로만
    console.error('[deletePlatformWorkspace] 워크스페이스 삭제 실패:', error.code ?? '', error.message)
    return { ok: false, code: 'delete_failed' }
  }
  const row = data as { status?: string; slug?: string; name?: string; remaining?: unknown; removed?: unknown } | null
  if (row?.status === 'blocked') {
    const remaining = workspaceRemainingItems(row.remaining)
    if (!remaining || remaining.length === 0) {
      // 거부인데 남은 것을 읽지 못했다 — "남은 것 없음"으로 그리지 않는다
      console.error('[deletePlatformWorkspace] 거부 결과의 remaining 형태가 어긋났다')
      return { ok: false, code: 'delete_failed' }
    }
    return { ok: false, code: 'not_empty', remaining }
  }
  if (row?.status !== 'deleted' || typeof row.slug !== 'string' || typeof row.name !== 'string') {
    console.error('[deletePlatformWorkspace] RPC 결과 형태가 어긋났다')
    return { ok: false, code: 'delete_failed' }
  }
  // 되돌릴 수 없는 조작의 흔적 — 권한 이력은 워크스페이스와 함께 지워지므로 서버 로그가 유일한 기록이다(이름·주소는 남기지 않는다: id 와 함께 지운 부속 행 수만)
  console.info('[deletePlatformWorkspace] 워크스페이스 삭제', { workspaceId, actor: g.actor.userId, removed: row.removed ?? {} })
  // 목록 화면과 전환기 목록(레이아웃 데이터)을 새로 읽게 한다
  revalidatePath('/', 'layout')
  return { ok: true, workspace: { slug: row.slug, name: row.name } }
}

/** 보관 거부 사유 — 문구는 사전(platform.ws.err.<code>, denied 는 archive_denied) */
export type PlatformWorkspaceArchiveCode = 'denied' | 'slug_mismatch' | 'not_found' | 'reason_too_long' | 'archive_failed'
export type PlatformWorkspaceArchiveResult =
  | { ok: true; workspace: { slug: string; name: string }; archivedAt: string; unchanged: boolean }
  | { ok: false; code: PlatformWorkspaceArchiveCode; error?: string }

/**
 * 워크스페이스 보관 — 플랫폼 관리자만. 보관 = 숨김 + 동결: 그 워크스페이스는 멤버·관리자에게 없는 것이 되고(화면 404·목록에서 빠짐) 그 범위의 쓰기는
 * 전부 거부된다. 자료·토큰·초대·큐의 잡은 지우지 않는다 — 복원하면 그대로 돌아온다. 마지막 활성 워크스페이스도 보관할 수 있다.
 * confirmSlug 는 확인 대화상자에서 사람이 직접 적은 주소다(RPC 가 그 id 의 주소와 대조한다). 이미 보관이면 쓰지 않고 그 사실을 돌려준다(unchanged).
 * 쓰기는 archive_workspace RPC 한 번(0056 — 등급·주소·사유 길이를 RPC 가 다시 본다).
 */
export async function archivePlatformWorkspace(workspaceId: string, confirmSlug: string, reason?: string | null): Promise<PlatformWorkspaceArchiveResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, code: 'denied', error: g.error }
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, code: 'not_found' }
  // 주소는 다듬지 않는다 — 적은 글자 그대로 대조한다(형식 밖이면 DB 에 묻지 않는다)
  if (typeof confirmSlug !== 'string' || !SLUG_RE.test(confirmSlug)) return { ok: false, code: 'slug_mismatch' }
  const checked = checkArchiveReason(reason)
  if (!checked.ok) return { ok: false, code: checked.code }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('archive_workspace', {
    p_actor: g.actor.userId, p_workspace_id: workspaceId, p_expected_slug: confirmSlug, p_reason: checked.reason,
  })
  if (error) {
    if (error.message.includes('WORKSPACE_SLUG_MISMATCH')) return { ok: false, code: 'slug_mismatch' }
    if (error.message.includes('WORKSPACE_NOT_FOUND')) return { ok: false, code: 'not_found' }
    if (error.message.includes('WORKSPACE_ARCHIVE_REASON_INVALID')) return { ok: false, code: 'reason_too_long' }
    if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied' }
    console.error('[archivePlatformWorkspace] 워크스페이스 보관 실패:', error.code ?? '', error.message)
    return { ok: false, code: 'archive_failed' }
  }
  const row = data as { status?: string; slug?: string; name?: string; archived_at?: string } | null
  if (!row || (row.status !== 'archived' && row.status !== 'unchanged')
      || typeof row.slug !== 'string' || typeof row.name !== 'string' || typeof row.archived_at !== 'string') {
    // 성공인데 결과를 읽지 못했다 — 보관됐는지 모르는 채로 성공이라 하지 않는다
    console.error('[archivePlatformWorkspace] RPC 결과 형태가 어긋났다')
    return { ok: false, code: 'archive_failed' }
  }
  if (row.status === 'archived') {
    // 누가 언제 접었는지는 행(archived_at·archived_by·archive_reason)에 남는다 — 서버 로그에는 id 와 실행자만(이름·주소·사유 본문은 남기지 않는다)
    console.info('[archivePlatformWorkspace] 워크스페이스 보관', { workspaceId, actor: g.actor.userId, hasReason: checked.reason !== null })
    // 목록 화면과 전환기 목록(레이아웃 데이터) — 그 워크스페이스가 모든 사람의 셸에서 빠진다
    revalidatePath('/', 'layout')
  }
  return { ok: true, workspace: { slug: row.slug, name: row.name }, archivedAt: row.archived_at, unchanged: row.status === 'unchanged' }
}

/** 복원 거부 사유 — 문구는 사전(platform.ws.err.<code>, denied 는 restore_denied) */
export type PlatformWorkspaceRestoreCode = 'denied' | 'not_found' | 'restore_failed'
export type PlatformWorkspaceRestoreResult =
  | { ok: true; workspace: { slug: string; name: string }; unchanged: boolean }
  | { ok: false; code: PlatformWorkspaceRestoreCode; error?: string }

/**
 * 보관된 워크스페이스 복원 — 플랫폼 관리자만. 숨김·동결이 풀리고 멤버·토큰·초대·큐의 잡이 그대로 다시 동작한다.
 * 이미 활성이면 쓰지 않고 그 사실을 돌려준다(unchanged). 쓰기는 restore_workspace RPC 한 번(0056).
 */
export async function restorePlatformWorkspace(workspaceId: string): Promise<PlatformWorkspaceRestoreResult> {
  const g = await requireSuperuser()
  if (!g.ok) return { ok: false, code: 'denied', error: g.error }
  if (typeof workspaceId !== 'string' || !workspaceId) return { ok: false, code: 'not_found' }
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('restore_workspace', { p_actor: g.actor.userId, p_workspace_id: workspaceId })
  if (error) {
    if (error.message.includes('WORKSPACE_NOT_FOUND')) return { ok: false, code: 'not_found' }
    if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied' }
    console.error('[restorePlatformWorkspace] 워크스페이스 복원 실패:', error.code ?? '', error.message)
    return { ok: false, code: 'restore_failed' }
  }
  const row = data as { status?: string; slug?: string; name?: string; previous?: { archived_at?: unknown; archived_by?: unknown } } | null
  if (!row || (row.status !== 'restored' && row.status !== 'unchanged') || typeof row.slug !== 'string' || typeof row.name !== 'string') {
    console.error('[restorePlatformWorkspace] RPC 결과 형태가 어긋났다')
    return { ok: false, code: 'restore_failed' }
  }
  if (row.status === 'restored') {
    // 복원하면 행의 보관 기록(시각·실행자·사유)이 비워진다 — 지워진 기록의 시각·실행자를 서버 로그에 남긴다(사유 본문은 남기지 않는다).
    // 행에는 마지막 복원의 시각·실행자(restored_at·restored_by)가 남는다
    console.info('[restorePlatformWorkspace] 워크스페이스 복원', {
      workspaceId, actor: g.actor.userId, archivedAt: row.previous?.archived_at ?? null, archivedBy: row.previous?.archived_by ?? null,
    })
    revalidatePath('/', 'layout')
  }
  return { ok: true, workspace: { slug: row.slug, name: row.name }, unchanged: row.status === 'unchanged' }
}
