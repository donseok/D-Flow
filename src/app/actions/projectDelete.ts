'use server'
// 프로젝트 삭제(사용자 테스트 BUG-18) — 되돌릴 수 없다. 지우는 길은 delete_project RPC 하나다(0058 — 세션의 projects DELETE 는 그 마이그레이션이 거뒀다).
// 등급: 그 프로젝트의 워크스페이스 관리자(플랫폼 관리자는 승계). 프로젝트 관리자는 지우지 못한다. 액션 가드(requireWorkspaceAdmin)와
// RPC 안의 재판정(actor_is_workspace_admin) 두 관문이다 — p_actor 는 가드 결과의 userId 만 넘긴다.
// 회의록이 하나라도 있으면(보관된 것 포함) 지우지 않는다 — 회의록은 지우지도, 연결을 풀지도 않는다(연결을 풀면 비공개 프로젝트의 회의록이 워크스페이스에 드러난다).
// 순서: 범위 확인(세션 — 다른 워크스페이스의 프로젝트는 '없음') → 가드 → 사전 조회(실패면 중단) → RPC → 저장소 정리 → 캐시 무효화.
// 저장소 정리는 DB 삭제가 끝난 뒤다 — 실패해도 프로젝트는 이미 없다. 숨기지 않고 남은 파일 수를 결과에 싣고 로그를 남긴다.
// DB 오류 원문은 로그로만 남기고 응답에는 사유 코드와 고정 문구만 싣는다. core 액션이라 모듈 관문은 없다(프로젝트 자체의 수명이다).
import { revalidatePath } from 'next/cache'
import { requireWorkspaceAdmin, resolveScope } from '@/lib/authz'
import { ERR_LOOKUP } from '@/lib/authz/errors'
import { isUuidLike } from '@/lib/domain/validate'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'
import { adminFor } from '@/lib/supabase/adminFor'
import { purgeableBuckets, readProjectDeleteCounts, readProjectDeleteSummary, type ProjectDeleteCounts, type ProjectDeleteSummary } from '@/lib/project/deleteSummary'
import { purgeProjectFiles } from '@/lib/storage/purgeProjectFiles'

/** 거부 사유 — 문구(error)는 서버 사전(srv.projectDelete.*) */
export type ProjectDeleteCode =
  | 'denied' | 'not_found' | 'lookup_failed' | 'name_mismatch' | 'has_minutes' | 'credential_blocked' | 'delete_failed'
export type ProjectDeleteSummaryResult =
  | ({ ok: true } & ProjectDeleteSummary)
  | { ok: false; code: 'denied' | 'not_found' | 'lookup_failed'; error: string }
export type ProjectDeleteResult =
  | { ok: true; name: string; removed: ProjectDeleteCounts; orphanedFiles: number; filesUnchecked: boolean }
  | { ok: false; code: ProjectDeleteCode; error: string; minutes?: number; minutesArchived?: number }

const FORBIDDEN = '42501'
type Translate = Awaited<ReturnType<typeof serverTranslator>>
type Scope =
  | { ok: true; workspaceId: string }
  | { ok: false; code: 'not_found' | 'lookup_failed'; error: string }

/** 그 프로젝트의 워크스페이스 — 가드에 넘길 범위. 세션으로 읽는다(RLS 가 다른 워크스페이스의 행을 가려 '없음'이 된다). 조회 실패는 '없음'이 아니다 */
async function projectWorkspace(projectId: unknown, t: Translate): Promise<Scope> {
  if (typeof projectId !== 'string' || !isUuidLike(projectId)) return { ok: false, code: 'not_found', error: t('srv.projectDelete.notFound') }
  const scope = await resolveScope('projects', projectId)
  if (scope.ok) return { ok: true, workspaceId: scope.workspaceId }
  return scope.error === ERR_LOOKUP
    ? { ok: false, code: 'lookup_failed', error: t('srv.projectDelete.lookupFailed') }
    : { ok: false, code: 'not_found', error: t('srv.projectDelete.notFound') }
}

/** 지워질 것의 건수와 삭제를 막는 회의록 수 — 위험 구역이 그린다. 읽지 못하면 실패다("0건"으로 위장하지 않는다) */
export async function getProjectDeleteSummary(projectId: string): Promise<ProjectDeleteSummaryResult> {
  const t = await serverTranslator()
  const scope = await projectWorkspace(projectId, t)
  if (!scope.ok) return scope
  const g = await requireWorkspaceAdmin(scope.workspaceId)
  if (!g.ok) return { ok: false, code: 'denied', error: g.error }   // 가드 문구 그대로(로그인 필요·권한 없음·대상 없음)
  const { admin } = adminFor({ workspaceId: scope.workspaceId })
  const { data, error } = await admin.rpc('project_delete_summary', { p_project_id: projectId })
  const summary = error ? null : readProjectDeleteSummary(data)
  if (!summary) {
    console.error('[getProjectDeleteSummary] 요약 조회 실패', { projectId, cause: error ? `${error.code ?? ''} ${error.message}` : '결과 형태가 어긋났다' })
    return { ok: false, code: 'lookup_failed', error: t('srv.projectDelete.lookupFailed') }
  }
  return { ok: true, ...summary }
}

/**
 * 프로젝트 삭제. typedName 은 확인 대화상자에서 사람이 직접 적은 이름이다(RPC 가 그 id 의 이름과 대조한다 — 양끝 공백만 뗀다).
 * 성공해도 저장소 정리가 덜 됐을 수 있다 — orphanedFiles(지우지 못한 파일 수)·filesUnchecked(나열하지 못한 버킷이 있다)로 알린다.
 */
export async function deleteProject(projectId: string, typedName: string): Promise<ProjectDeleteResult> {
  const t = await serverTranslator()
  const scope = await projectWorkspace(projectId, t)
  if (!scope.ok) return scope
  const g = await requireWorkspaceAdmin(scope.workspaceId)
  if (!g.ok) return { ok: false, code: 'denied', error: g.error }   // 가드 문구 그대로(로그인 필요·권한 없음·대상 없음)
  const workspaceId = scope.workspaceId
  if (typeof typedName !== 'string' || !typedName.trim()) return { ok: false, code: 'name_mismatch', error: t('srv.projectDelete.nameMismatch') }
  const { admin } = adminFor({ workspaceId })
  const hasMinutes = (minutes: number, minutesArchived?: number): ProjectDeleteResult =>
    ({ ok: false, code: 'has_minutes', error: fill(t('srv.projectDelete.hasMinutes'), { n: minutes }), minutes, ...(minutesArchived === undefined ? {} : { minutesArchived }) })

  // 사전 조회 — 실패하면 중단한다(쓰기 전 선행 조회). 회의록이 있으면 RPC 를 부르지 않는다(RPC 도 잠금 뒤 다시 센다)
  const pre = await admin.rpc('project_delete_summary', { p_project_id: projectId })
  const summary = pre.error ? null : readProjectDeleteSummary(pre.data)
  if (!summary) {
    console.error('[deleteProject] 사전 조회 실패', { projectId, cause: pre.error ? `${pre.error.code ?? ''} ${pre.error.message}` : '결과 형태가 어긋났다' })
    return { ok: false, code: 'lookup_failed', error: t('srv.projectDelete.lookupFailed') }
  }
  if (summary.minutes > 0) return hasMinutes(summary.minutes, summary.minutesArchived)

  const { data, error } = await admin.rpc('delete_project', { p_actor: g.actor.userId, p_project_id: projectId, p_expected_name: typedName })
  if (error) {
    if (error.message.includes('PROJECT_NAME_MISMATCH')) return { ok: false, code: 'name_mismatch', error: t('srv.projectDelete.nameMismatch') }
    if (error.message.includes('PROJECT_NOT_FOUND')) return { ok: false, code: 'not_found', error: t('srv.projectDelete.notFound') }
    if (error.code === FORBIDDEN && error.message.includes('AUTHZ_FORBIDDEN')) return { ok: false, code: 'denied', error: t('srv.projectDelete.denied') }
    if (error.message.includes('PROJECT_DELETE_CREDENTIAL_BLOCKED')) {
      console.error('[deleteProject] 연동 토큰 정리 거부', { projectId, cause: error.message })
      return { ok: false, code: 'credential_blocked', error: t('srv.projectDelete.credentialBlocked') }
    }
    // 모르는 참조(PROJECT_DELETE_UNKNOWN_REFERENCE)·붙든 행(PROJECT_DELETE_REFERENCED)·잠금 시간 초과 등 — 원문은 로그로만
    console.error('[deleteProject] 프로젝트 삭제 실패:', error.code ?? '', error.message)
    return { ok: false, code: 'delete_failed', error: t('srv.projectDelete.failed') }
  }
  const row = data as {
    status?: string; name?: string; minutes?: unknown; minutes_archived?: unknown; removed?: unknown; storage_prefix?: unknown; referenced?: unknown
  } | null
  if (row?.status === 'blocked') {
    // 사전 조회 뒤에 회의록이 생겼다 — RPC 가 잠금 뒤 다시 센 수
    if (typeof row.minutes !== 'number' || row.minutes <= 0) {
      console.error('[deleteProject] 거부 결과의 회의록 수를 읽지 못했다')
      return { ok: false, code: 'delete_failed', error: t('srv.projectDelete.failed') }
    }
    return hasMinutes(row.minutes, typeof row.minutes_archived === 'number' ? row.minutes_archived : undefined)
  }
  const removed = row?.status === 'deleted' ? readProjectDeleteCounts(row.removed) : null
  if (!row || !removed || typeof row.name !== 'string') {
    // 성공인데 결과를 읽지 못했다 — 지워졌는지 모르는 채로 성공이라 하지 않는다(화면이 목록에서 확인하게 한다)
    console.error('[deleteProject] RPC 결과 형태가 어긋났다', { projectId })
    return { ok: false, code: 'delete_failed', error: t('srv.projectDelete.failed') }
  }

  // 저장소 — 삭제 뒤에도 그 접두 아래 경로를 가리키는 행이 남은 버킷(다른 프로젝트로 옮긴 회의록의 첨부)과 판정을 읽지 못한 버킷은 건드리지 않는다
  const buckets = purgeableBuckets(row.referenced)
  let orphanedFiles = 0
  let filesUnchecked = buckets.unknown.length > 0
  if (typeof row.storage_prefix === 'string' && buckets.purge.length > 0) {
    try {
      const purged = await purgeProjectFiles(admin, row.storage_prefix, buckets.purge)
      orphanedFiles = purged.orphaned
      filesUnchecked = filesUnchecked || purged.unlisted.length > 0
    } catch (e) {
      console.error('[deleteProject] 저장소 정리 실패', { projectId, cause: e instanceof Error ? e.message : String(e) })
      filesUnchecked = true
    }
  } else if (typeof row.storage_prefix !== 'string') {
    filesUnchecked = true
  }
  if (orphanedFiles > 0 || filesUnchecked || buckets.kept.length > 0) {
    // 프로젝트는 이미 없다 — 남은 파일은 이 로그와 접두(ws/<wid>/p/<pid>/)로 찾는다. kept 는 살아 있는 행이 쓰는 파일이라 고아가 아니다
    console.error('[deleteProject] 저장소에 파일이 남았다', {
      projectId, workspaceId, orphanedFiles, filesUnchecked, keptBuckets: buckets.kept, unknownBuckets: buckets.unknown,
    })
  }
  // 되돌릴 수 없는 조작의 흔적 — DB 에는 권한 변경 이력에 삭제 기록 한 행이 남는다(RPC 가 쓴다). 서버 로그에는 id·실행자·건수만(이름은 남기지 않는다)
  console.info('[deleteProject] 프로젝트 삭제', { projectId, workspaceId, actor: g.actor.userId, removed })
  // 프로젝트 목록·전환기·사이드바(레이아웃 데이터)를 새로 읽게 한다
  revalidatePath('/', 'layout')
  return { ok: true, name: row.name, removed, orphanedFiles, filesUnchecked }
}
