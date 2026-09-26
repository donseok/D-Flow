'use server'
import { createServerClient } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { requireProjectMember, resolveProjectId } from '@/lib/authz'
import { isProjectAdmin } from '@/lib/domain/authz'
import { actorTeamIdsFor } from '@/lib/domain/permissions'
import { isDeliverablePathValid } from '@/lib/domain/deliverables'
import { LIST_SIGNED_URL_TTL_SEC } from '@/lib/domain/signedUrl'
import { revalidatePath } from 'next/cache'
import type { DeliverableAttachment } from '@/lib/domain/types'

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
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  const myTeamIds = actorTeamIdsFor(g.actor, found.projectId ?? '')
  if (!owners.some(o => myTeamIds.includes(o.team_id as string))) return { ok: false, error: '권한 없음' }
  return granted
}

export type AttachmentDownload = 'allowed' | 'denied' | 'unknown'
export type AttachmentList =
  | { ok: true; rows: DeliverableAttachment[]; download: AttachmentDownload }
  | { ok: false; error: string }

const ERR_LIST = '첨부 목록을 불러오지 못했습니다.'

/**
 * 항목의 첨부 목록(최신순)과 다운로드 판정. 목록은 그 항목을 읽을 수 있으면 보이고(RLS), 다운로드(서명)는 Storage 읽기 정책과
 * 같은 can_attach 로 판정한다 — 조회 전용 사용자에게 막힐 링크를 주지 않는다(정본 :860, 개정 스펙 §8.2 ②).
 * 정책의 술어는 can_attach(storage_entity_id(경로))이고 recordAttachment 가 경로의 엔터티를 이 항목으로 고정하므로 같은 판정이다.
 * 규약 밖 경로의 행은 서명이 행별로 실패해 linkError 로 드러난다(서명도 사용자 세션으로 정책을 통과한다).
 * 조회 실패를 빈 목록으로 위장하지 않는다(3원칙 ①). 판정 오류는 unknown 으로 두고 서명하지 않는다(fail-closed).
 */
export async function listAttachments(itemId: string): Promise<AttachmentList> {
  if (!(await getSession())) {
    console.error('[listAttachments] 비로그인 호출')
    return { ok: false, error: ERR_LIST }
  }
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('deliverable_attachments')
    .select('*')
    .eq('wbs_item_id', itemId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[listAttachments] 첨부 조회 실패:', error.message)
    return { ok: false, error: ERR_LIST }
  }
  const { data: can, error: canErr } = await sb.rpc('can_attach', { item: itemId })
  if (canErr) console.error('[listAttachments] 다운로드 권한 판정 실패 — 서명하지 않는다:', canErr.message)
  const download: AttachmentDownload = canErr ? 'unknown' : can === true ? 'allowed' : 'denied'
  const rows = (data ?? []) as Array<Record<string, unknown>>
  const urlOf = new Map<string, string | null>()
  let signFailed = false
  if (download === 'allowed' && rows.length > 0) {
    const { data: signed, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrls(rows.map(r => r.file_path as string), LIST_SIGNED_URL_TTL_SEC)
    if (signErr) {
      console.error('[listAttachments] 서명 URL 일괄 발급 실패:', signErr.message)
      signFailed = true
    }
    for (const s of signed ?? []) if (s.path) urlOf.set(s.path, s.error ? null : s.signedUrl)
  }
  return {
    ok: true,
    download,
    rows: rows.map(r => {
      const url = download === 'allowed' && !signFailed ? (urlOf.get(r.file_path as string) ?? null) : null
      return {
        id: r.id as string,
        wbsItemId: r.wbs_item_id as string,
        fileName: r.file_name as string,
        filePath: r.file_path as string,
        size: (r.size as number) ?? null,
        mime: (r.mime as string) ?? null,
        createdAt: r.created_at as string,
        url,
        ...(download === 'allowed' && url === null ? { linkError: true } : {}),
      }
    }),
  }
}

/** 클라이언트가 Storage 업로드를 끝낸 뒤 메타데이터 기록. */
export async function recordAttachment(
  itemId: string,
  file: { fileName: string; filePath: string; size: number; mime: string },
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireAttachPermission(itemId)
  if (!g.ok) return { ok: false, error: g.error }
  const sb = await createServerClient()
  // 경로 검증 — scope 는 클라이언트 입력이 아니라 DB 의 항목 행(→ 프로젝트 → 워크스페이스)에서 얻는다.
  // 이게 없으면 첨부 권한이 있는 항목 하나로 임의 경로(타 프로젝트·타 워크스페이스)의 객체를 메타에 꽂을 수 있다.
  // 워크스페이스를 모르면 검증할 수 없으므로 중단한다(쓰기 전 선행 조회 실패는 중단).
  if (!g.projectId) {
    console.error('[recordAttachment] 항목의 프로젝트를 확정하지 못했습니다:', itemId)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  const { data: proj, error: projErr } = await sb
    .from('projects').select('workspace_id').eq('id', g.projectId).maybeSingle()
  const workspaceId = (proj as { workspace_id?: string } | null)?.workspace_id
  if (projErr || !workspaceId) {
    console.error('[recordAttachment] 프로젝트 워크스페이스 조회 실패:', projErr?.message ?? 'no row')
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (!isDeliverablePathValid({ workspaceId, projectId: g.projectId }, itemId, file.filePath)) {
    return { ok: false, error: '잘못된 파일 경로입니다.' }
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
  const sb = await createServerClient()
  // 어느 항목의 첨부인지 모르면 권한을 판정할 수 없다 — 조회 실패는 '없음'으로 위장하지 않고 중단한다.
  const { data: att, error: attErr } = await sb
    .from('deliverable_attachments').select('id, file_path, wbs_item_id').eq('id', id).maybeSingle()
  if (attErr) {
    console.error('[removeAttachment] 첨부 조회 실패:', attErr.message)
    return { ok: false, error: '권한을 확인할 수 없어 중단했습니다.' }
  }
  if (!att) return { ok: false, error: '첨부 없음' }
  const g = await requireAttachPermission(att.wbs_item_id as string)
  if (!g.ok) return { ok: false, error: g.error }
  // remove 는 RLS 가 막아도 오류 없이 빈 배열을 돌려준다 — 0건을 성공으로 읽고 행을 지우면 고아 객체가 남는다
  // (회의록 removeMinuteFile 과 같은 규칙). 객체 1건 삭제를 확인한 뒤에만 행을 지운다.
  const { data: removed, error: rmErr } = await sb.storage.from(BUCKET).remove([att.file_path as string])
  if (rmErr || (removed ?? []).length !== 1) {
    console.error('[removeAttachment] Storage 삭제 실패 — 행을 남긴다:', rmErr?.message ?? `${(removed ?? []).length}건 삭제`)
    return { ok: false, error: '첨부 파일을 지우지 못했습니다 — 권한이나 저장소 상태를 확인한 뒤 다시 시도하세요.' }
  }
  // 행 삭제도 0건(RLS 거부·경합)이면 error 없이 끝난다 — 지워진 행을 돌려받아 확인한다.
  const { data: gone, error } = await sb.from('deliverable_attachments').delete().eq('id', id).select('id')
  if (error) return { ok: false, error: error.message }
  if ((gone ?? []).length === 0) {
    console.error('[removeAttachment] 행 삭제 0건(객체는 지워짐):', id)
    return { ok: false, error: '첨부 기록을 지우지 못했습니다 — 새로고침한 뒤 확인하세요.' }
  }
  return { ok: true }
}
