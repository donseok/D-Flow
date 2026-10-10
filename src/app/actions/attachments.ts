'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { actorTeamIdsFor } from '@/lib/domain/permissions'
import { isDeliverablePathValid } from '@/lib/domain/deliverables'
import { SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'
import { removeStoredAttachment } from '@/lib/attachments/removeStoredAttachment'
import { revalidatePath } from 'next/cache'
import type { DeliverableAttachment } from '@/lib/domain/types'
import { serverTranslator } from '@/lib/i18n/server'
import { ERR_LOOKUP, ERR_DENIED, ERR_ANON } from '@/lib/authz/errors'

const BUCKET = 'deliverables'

/**
 * 산출물 첨부 권한 — 관리자는 프로젝트 전체, 멤버는 자기 팀이 담당인 항목만(can_attach RLS 와 같은 규칙).
 * 담당 조회가 실패하면 '담당 아님'도 '담당'도 아니므로 중단한다(fail-closed).
 */
async function requireAttachPermission(itemId: string): Promise<
  { ok: true; projectId: string | null; userId: string } | { ok: false; error: string }
> {
  const found = await resolveProjectId('wbs_items', itemId)
  if (!found.ok) return { ok: false, error: found.error }
  const g = await requireProjectMember(found.projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const granted = { ok: true, projectId: found.projectId, userId: g.actor.userId } as const
  if (isProjectAdmin(g.actor, found.projectId)) return granted

  const sb = await createServerClient()
  const { data: owners, error: ownErr } = await sb.from('item_owners').select('team_id').eq('wbs_item_id', itemId)
  if (ownErr || !owners) {
    console.error('[attachments] 담당 팀 조회 실패:', ownErr?.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  const myTeamIds = actorTeamIdsFor(g.actor, found.projectId ?? '')
  if (!owners.some(o => myTeamIds.includes(o.team_id as string))) return { ok: false, error: ERR_DENIED }
  return granted
}

export type AttachmentDownload = 'allowed' | 'denied' | 'unknown'
export type AttachmentList =
  | { ok: true; rows: DeliverableAttachment[]; download: AttachmentDownload }
  | { ok: false; error: string }

const ERR_LIST = 'err.couldNotLoadAttachments'

/**
 * 항목의 첨부 목록(최신순)과 다운로드 판정. 목록은 그 항목을 읽을 수 있으면 보이고(RLS), 다운로드 가능 여부는 Storage 읽기 정책과
 * 같은 can_attach 로 판정한다 — 조회 전용 사용자에게 막힐 링크를 주지 않는다(정본 :860, 개정 스펙 §8.2 ②).
 * SP5 B3 과제7: 목록은 서명하지 않는다 — 열어 둔 패널의 1시간짜리 링크가 권한 회수 뒤에도 살아 있던 창을 없앤다.
 * 내려받기는 클릭 때 getAttachmentUrl 이 60초 링크를 발급한다.
 * 조회 실패를 빈 목록으로 위장하지 않는다(3원칙 ①). 판정 오류는 unknown 으로 두고 내려받기를 열지 않는다(fail-closed).
 */
export async function listAttachments(itemId: string): Promise<AttachmentList> {
  const t = await serverTranslator()
  if (!(await getSession())) {
    console.error('[listAttachments] 비로그인 호출')
    return { ok: false, error: t(ERR_LIST) }
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('deliverable_attachments')
    .select('id, wbs_item_id, file_name, file_path, size, mime, created_at')
    .eq('wbs_item_id', itemId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[listAttachments] 첨부 조회 실패:', error.message)
    return { ok: false, error: t(ERR_LIST) }
  }
  const { data: can, error: canErr } = await sb.rpc('can_attach', { item: itemId })
  if (canErr) console.error('[listAttachments] 다운로드 권한 판정 실패 — 내려받기를 열지 않는다:', canErr.message)
  const download: AttachmentDownload = canErr ? 'unknown' : can === true ? 'allowed' : 'denied'
  return {
    ok: true,
    download,
    rows: ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string,
      wbsItemId: r.wbs_item_id as string,
      fileName: r.file_name as string,
      filePath: r.file_path as string,
      size: (r.size as number) ?? null,
      mime: (r.mime as string) ?? null,
      createdAt: r.created_at as string,
    })),
  }
}

export type AttachmentUrlResult = { ok: true; url: string } | { ok: false; error: string }
const ERR_LINK = 'err.couldNotCreateDownloadLink'

/**
 * 산출물 첨부 클릭 시 60초 내려받기 링크(SP5 B3 과제7). 첨부 id 와 항목 id 를 함께 받아 그 항목의 첨부일 때만 서명한다 —
 * 다른 항목의 첨부 id 를 끼워 넣어도 0행이다. 권한은 Storage 읽기 정책과 같은 can_attach 를 이 순간에 다시 판정한다(권한 회수 즉시 반영).
 * 서명도 사용자 세션이라 Storage 정책을 한 번 더 통과한다.
 */
export async function getAttachmentUrl(itemId: string, attachmentId: string): Promise<AttachmentUrlResult> {
  const t = await serverTranslator()
  if (!(await getSession())) return { ok: false, error: ERR_ANON }
  const sb = await createServerClient()
  const { data: row, error } = await sb.from('deliverable_attachments')
    .select('file_path, file_name').eq('id', attachmentId).eq('wbs_item_id', itemId).maybeSingle()
  if (error) {
    console.error('[getAttachmentUrl] 첨부 조회 실패:', error.message)
    return { ok: false, error: t(ERR_LIST) }
  }
  if (!row) return { ok: false, error: t('err.noAttachment') }
  const { data: can, error: canErr } = await sb.rpc('can_attach', { item: itemId })
  if (canErr) {
    console.error('[getAttachmentUrl] 다운로드 권한 판정 실패:', canErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (can !== true) return { ok: false, error: ERR_DENIED }
  const { data: signed, error: signErr } = await sb.storage.from(BUCKET)
    .createSignedUrl(row.file_path as string, SIGNED_URL_TTL_SEC, { download: (row.file_name as string) || true })
  if (signErr || !signed?.signedUrl) {
    console.error(`[getAttachmentUrl attachment=${attachmentId}] 서명 실패:`, signErr?.message ?? 'no url')
    return { ok: false, error: t(ERR_LINK) }
  }
  return { ok: true, url: signed.signedUrl }
}

/** 클라이언트가 Storage 업로드를 끝낸 뒤 메타데이터 기록. */
export async function recordAttachment(
  itemId: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<{ ok: boolean; error?: string }> {
  const t = await serverTranslator()
  const g = await requireAttachPermission(itemId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  // 경로 검증 — scope 는 클라이언트 입력이 아니라 DB 의 항목 행(→ 프로젝트 → 워크스페이스)에서 얻는다.
  // 이게 없으면 첨부 권한이 있는 항목 하나로 임의 경로(타 프로젝트·타 워크스페이스)의 객체를 메타에 꽂을 수 있다.
  // 워크스페이스를 모르면 검증할 수 없으므로 중단한다(쓰기 전 선행 조회 실패는 중단).
  if (!g.projectId) {
    console.error('[recordAttachment] 항목의 프로젝트를 확정하지 못했습니다:', itemId)
    return { ok: false, error: ERR_LOOKUP }
  }
  const { data: proj, error: projErr } = await sb
    .from('projects').select('workspace_id').eq('id', g.projectId).maybeSingle()
  const workspaceId = (proj as { workspace_id?: string } | null)?.workspace_id
  if (projErr || !workspaceId) {
    console.error('[recordAttachment] 프로젝트 워크스페이스 조회 실패:', projErr?.message ?? 'no row')
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!isDeliverablePathValid({ workspaceId, projectId: g.projectId }, itemId, file.filePath)) {
    return { ok: false, error: t('err.invalidFilePath') }
  }
  const { error } = await sb.from('deliverable_attachments').insert({
    wbs_item_id: itemId, file_name: file.fileName, file_path: file.filePath,
    size: file.size, mime: file.mime, uploaded_by: g.userId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/p/${g.projectId}`, 'layout')
  return { ok: true }
}

/** 첨부 삭제(Storage 객체 + 메타). */
export async function removeAttachment(id: string): Promise<{ ok: boolean; error?: string }> {
  const t = await serverTranslator()
  const sb = await createServerClient()
  // 어느 항목의 첨부인지 모르면 권한을 판정할 수 없다 — 조회 실패는 '없음'으로 위장하지 않고 중단한다.
  const { data: att, error: attErr } = await sb
    .from('deliverable_attachments').select('id, file_path, wbs_item_id').eq('id', id).maybeSingle()
  if (attErr) {
    console.error('[removeAttachment] 첨부 조회 실패:', attErr.message)
    return { ok: false, error: ERR_LOOKUP }
  }
  if (!att) return { ok: false, error: t('err.noAttachment') }
  const g = await requireAttachPermission(att.wbs_item_id as string)
  if (!g.ok) return { ok: false, error: g.error }
  // 객체 삭제 → 행 삭제. 객체가 이미 없으면 행만 지우고, 남아 있으면(삭제 권한 불일치) 행을 남긴다(0011 H2-g 존재 확인 RPC).
  return removeStoredAttachment(sb, { kind: 'deliverable', id, filePath: att.file_path as string, tag: 'removeAttachment' })
}
