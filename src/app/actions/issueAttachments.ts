'use server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { getActor, requireProjectAdmin, resolveProjectId } from '@/lib/authz'
import { ERR_LOOKUP, ERR_DENIED, ERR_ANON } from '@/lib/authz/errors'
import {
  ISSUE_ATTACHMENT_MAX_COUNT,
  isIssueAttachmentPathValid,
  isIssueAttachmentSizeAllowed,
  remainingIssueAttachmentSlots,
  type IssueAttachment,
} from '@/lib/domain/issueAttachments'
import { SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'
import { removeStoredAttachment } from '@/lib/attachments/removeStoredAttachment'
import { requireModule } from '@/lib/modules/gate'
import { createServerClient } from '@/lib/supabase/server'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'

const BUCKET = 'issue-attachments'

export type IssueAttachmentList =
  | { ok: true; items: IssueAttachment[] }
  | { ok: false; error: string }

/**
 * 첨부 추가·삭제 게이트 — 이슈 수정 권한과 같다(작성자 또는 프로젝트 관리자).
 * 0068 의 `can_edit_issue()` SQL 헬퍼와 같은 정의이며, RLS 가 2차 방어선으로 한 번 더 본다.
 *
 * export 하지 않는다. 이 파일은 'use server' 라서 export 하면 그 자체가 브라우저에서
 * 호출 가능한 서버 액션 엔드포인트가 된다(attachments.ts 의 requireAttachPermission 과 같은 이유).
 *
 * 기존 `adminOrOwnerGate` 를 쓰지 않는 이유: 그것은 created_by 를 비교하지 않고
 * projectId 도 돌려주지 않아 여기서 필요한 것을 채우지 못한다.
 */
async function requireIssueEditable(issueId: string): Promise<
  { ok: true; projectId: string; userId: string } | { ok: false; error: string }
> {
  const t = await serverTranslator()
  const found = await resolveProjectId('issues', issueId)
  if (!found.ok) return { ok: false, error: found.error }
  // issues.project_id 는 not null 이지만 타입이 nullable 이다. null 이면 첨부의 not null
  // 컬럼을 채울 수 없으므로 '권한 없음'이 아니라 중단한다.
  if (!found.projectId) {
    console.error('[issueAttachments] 이슈의 프로젝트를 확정하지 못했습니다:', issueId)
    return { ok: false, error: ERR_LOOKUP }
  }
  const projectId = found.projectId

  let pass: { ok: true; projectId: string; userId: string }
  const admin = await requireProjectAdmin(projectId)
  if (admin.ok) pass = { ok: true, projectId, userId: admin.actor.userId }
  else {
    let actor: Awaited<ReturnType<typeof getActor>> = null
    try { actor = await getActor() } catch { actor = null }
    if (!actor) return { ok: false, error: admin.error }

    const sb = await createServerClient()
    const { data, error } = await sb.from('issues').select('created_by').eq('id', issueId).maybeSingle()
    if (error) {
      console.error('[issueAttachments] 이슈 작성자 조회 실패:', error.message)
      return { ok: false, error: ERR_LOOKUP }
    }
    if (!data) return { ok: false, error: t('err.issueNotFound') }
    if ((data.created_by as string | null) !== actor.userId) return { ok: false, error: ERR_DENIED }
    pass = { ok: true, projectId, userId: actor.userId }
  }
  // 모듈 관문(스펙 §4.2) — 관리자·작성자 두 성공을 모아 한 번 판정한다
  const mod = await requireModule({ projectId }, 'issues')
  if (!mod.ok) return { ok: false, error: mod.error }
  return pass
}

/**
 * 이슈의 첨부 목록(메타만, 최신순). SP5 B3 과제7: 목록은 서명하지 않는다 — 내려받기는 클릭 때 getIssueAttachmentUrl 이
 * 60초 링크를 발급한다(열어 둔 화면의 1시간짜리 링크가 권한 회수 뒤에도 살아 있던 창을 없앤다).
 *
 * 빈 배열이 아니라 에러 채널을 둔 이유: 목록 화면의 클립 배지는 getIssues 의 **별도 쿼리**에서
 * 오므로, 여기서 실패를 [] 로 뭉개면 목록은 '첨부 3개'라고 하는데 상세는 '첨부 없음'이 된다.
 * 사용자는 파일이 소실됐다고 읽는다(에러 3원칙 ①).
 */
export async function listIssueAttachments(issueId: string): Promise<IssueAttachmentList> {
  if (!(await getSession())) {
    console.error('[listIssueAttachments] 비로그인 호출')
    return { ok: false, error: ERR_ANON }
  }
  // 모듈 관문(스펙 §4.2) — 이슈 행의 프로젝트로 판정한다
  const scope = await resolveProjectId('issues', issueId)
  if (!scope.ok || !scope.projectId) return { ok: false, error: scope.ok ? ERR_LOOKUP : scope.error }
  const mod = await requireModule({ projectId: scope.projectId }, 'issues')
  if (!mod.ok) return { ok: false, error: mod.error }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('issue_attachments')
    .select('id, issue_id, file_name, file_path, size, mime, created_at')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[listIssueAttachments] 첨부 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  return {
    ok: true,
    items: (data ?? []).map(r => ({
      id: r.id as string,
      issueId: r.issue_id as string,
      fileName: r.file_name as string,
      filePath: r.file_path as string,
      size: (r.size as number) ?? null,
      mime: (r.mime as string) ?? null,
      createdAt: r.created_at as string,
    })),
  }
}

/**
 * 이슈 첨부 클릭 시 60초 내려받기 링크(SP5 B3 과제7). 첨부 id 와 이슈 id 를 함께 받아 그 이슈의 첨부일 때만 서명한다 —
 * 다른 이슈의 첨부 id 를 끼워 넣어도 0행이다. 이슈 행의 프로젝트로 모듈 관문을 다시 보고, 서명은 사용자 세션이라
 * Storage 읽기 정책을 이 순간 다시 통과한다(권한 회수 즉시 반영).
 */
export async function getIssueAttachmentUrl(
  issueId: string, attachmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const t = await serverTranslator()
  if (!(await getSession())) return { ok: false, error: ERR_ANON }
  const scope = await resolveProjectId('issues', issueId)
  if (!scope.ok || !scope.projectId) return { ok: false, error: scope.ok ? ERR_LOOKUP : scope.error }
  const mod = await requireModule({ projectId: scope.projectId }, 'issues')
  if (!mod.ok) return { ok: false, error: mod.error }
  const sb = await createServerClient()
  const { data: row, error } = await sb.from('issue_attachments')
    .select('file_path, file_name').eq('id', attachmentId).eq('issue_id', issueId).maybeSingle()
  if (error) {
    console.error('[getIssueAttachmentUrl] 첨부 조회 실패:', error.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!row) return { ok: false, error: t('err.noAttachment') }
  // 빈 파일명이면 true 로 폴백해 Content-Disposition 자체는 붙게 한다.
  const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
    .createSignedUrl(row.file_path as string, SIGNED_URL_TTL_SEC, { download: (row.file_name as string) || true })
  if (signErr || !signed?.signedUrl) {
    console.error(`[getIssueAttachmentUrl attachment=${attachmentId}] 서명 실패:`, signErr?.message ?? 'no url')
    return { ok: false, error: t('err.couldNotCreateDownloadLink') }
  }
  return { ok: true, url: signed.signedUrl }
}

/**
 * 브라우저가 Storage 업로드를 끝낸 뒤 메타데이터를 기록한다.
 * 파일 바이트는 서버 액션으로 넘어오지 않는다 — 본문 상한(1MB/4.5MB)에 걸린다.
 */
export async function recordIssueAttachment(
  issueId: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await serverTranslator()
  const g = await requireIssueEditable(issueId)
  if (!g.ok) return { ok: false, error: g.error }

  const sb = await createServerClient()
  // 경로 검증의 scope 는 클라이언트 입력이 아니라 DB — 게이트가 이슈 행에서 확정한 프로젝트의 워크스페이스다.
  // 모르면 검증할 수 없으므로 중단한다(쓰기 전 선행 조회 실패는 중단).
  const { data: proj, error: projErr } = await sb
    .from('projects').select('workspace_id').eq('id', g.projectId).maybeSingle()
  const workspaceId = (proj as { workspace_id?: string } | null)?.workspace_id
  if (projErr || !workspaceId) {
    console.error('[recordIssueAttachment] 프로젝트 워크스페이스 조회 실패:', projErr?.message ?? 'no row')
    return { ok: false, error: ERR_LOOKUP }
  }
  // 이게 없으면 편집 권한이 있는 이슈 하나로 임의 경로의 객체를 메타에 꽂을 수 있다.
  if (!isIssueAttachmentPathValid({ workspaceId, projectId: g.projectId }, issueId, file.filePath)) {
    return { ok: false, error: t('srv.issueAttachments.attachmentPathNotValid') }
  }
  if (!isIssueAttachmentSizeAllowed(file.size)) {
    return { ok: false, error: t('srv.issueAttachments.fileSizeExceedsLimit') }
  }

  const { data: existing, error: countErr } = await sb
    .from('issue_attachments').select('id').eq('issue_id', issueId)
  if (countErr || !existing) {
    // 개수를 모르면 통과시키지 않는다(쓰기 전 선행 조회 실패는 중단).
    console.error('[recordIssueAttachment] 기존 첨부 개수 조회 실패:', countErr?.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (remainingIssueAttachmentSlots(existing.length) < 1) {
    return { ok: false, error: fill(t('srv.issueAttachments.upAttachmentsAllowedPerIssue'), { issueAttachmentMaxCount: ISSUE_ATTACHMENT_MAX_COUNT }) }
  }

  // project_id 는 클라이언트가 보내는 값이 아니라 게이트가 이슈에서 확정한 값이다.
  const { error } = await sb.from('issue_attachments').insert({
    issue_id: issueId,
    project_id: g.projectId,
    file_name: file.fileName,
    file_path: file.filePath,
    size: file.size,
    mime: file.mime,
    uploaded_by: g.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${g.projectId}/issues`)
  return { ok: true }
}

/** 첨부 삭제(Storage 객체 + 메타). */
export async function removeIssueAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = await serverTranslator()
  const sb = await createServerClient()
  // 어느 이슈의 첨부인지 모르면 권한을 판정할 수 없다 — 조회 실패를 '없음'으로 위장하지 않는다.
  const { data: att, error: attErr } = await sb
    .from('issue_attachments').select('id, file_path, issue_id').eq('id', id).maybeSingle()
  if (attErr) {
    console.error('[removeIssueAttachment] 첨부 조회 실패:', attErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!att) return { ok: false, error: t('err.noAttachment') }

  const g = await requireIssueEditable(att.issue_id as string)
  if (!g.ok) return { ok: false, error: g.error }

  // Storage 를 먼저 지운다 — 반대로 하면 메타를 잃은 객체를 다시 찾을 수 없다. 객체가 이미 없으면 메타만 지우고,
  // 남아 있으면(삭제 권한 불일치) 메타를 남긴다(0011 H2-g 존재 확인 RPC).
  const r = await removeStoredAttachment(sb, { kind: 'issue', id, filePath: att.file_path as string, tag: 'removeIssueAttachment' })
  if (!r.ok) return r
  revalidatePath(`/p/${g.projectId}/issues`)
  return { ok: true }
}
