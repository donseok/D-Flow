import type { SupabaseClient } from '@supabase/supabase-js'
import { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE } from './removeErrors'

/** 첨부 세 종류 — RPC attachment_object_exists(p_kind) 의 값과 같다(0011 H2-g). */
export type AttachmentKind = 'deliverable' | 'issue' | 'minute'

const TARGET: Record<AttachmentKind, { bucket: string; table: string }> = {
  deliverable: { bucket: 'deliverables', table: 'deliverable_attachments' },
  issue: { bucket: 'issue-attachments', table: 'issue_attachments' },
  minute: { bucket: 'minutes', table: 'minute_files' },
}

// 문구는 화면이 사전 키를 고를 때도 쓴다 — 서버 코드와 떨어진 모듈(removeErrors)에 둔다.
export { ERR_OBJECT_REMOVE, ERR_ROW_REMOVE }

type Db = Pick<SupabaseClient, 'from' | 'rpc' | 'storage'>

/**
 * 첨부 행과 그 Storage 객체를 함께 지운다 — 산출물·이슈·회의록 첨부 세 삭제 경로의 공용 도우미. 권한 판정은 호출부가 먼저 끝낸다.
 * 순서: 객체 삭제 → 1건이면 행 삭제. remove 는 RLS 가 막아도 오류 없이 빈 배열을 돌려주고, 세션의 exists() 는 '없음'과 '읽을 수
 * 없음'을 가르지 못한다(회의록을 옮기거나 옛 형식 경로면 세션은 객체를 못 읽는다). 그래서 0건이면 SECURITY DEFINER RPC
 * attachment_object_exists 에 묻는다 — 객체가 정말 없으면 행만 지우고(이미 사라진 객체의 행이 영영 남지 않게), 남아 있거나 확인이
 * 실패하면 행을 남기고 오류다(fail-closed — 고아 객체를 만들지 않는다). DB 오류 원문은 로그에만 남긴다.
 * 로그 머리는 [tag 종류=행 id] — 같은 시각의 실패 두 줄을 가르고, ATTACHMENT_FORBIDDEN(위조·옛 형식 경로 행)을 행 id 로 찾게 한다.
 * id 는 호출부가 행 조회로 확인한 값이다. 파일 경로는 싣지 않는다 — 끝이 사용자가 올린 파일 이름이다.
 */
export async function removeStoredAttachment(
  db: Db, input: { kind: AttachmentKind; id: string; filePath: string; tag: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { bucket, table } = TARGET[input.kind]
  const head = `[${input.tag} ${input.kind}=${input.id}]`
  const { data: removed, error: rmErr } = await db.storage.from(bucket).remove([input.filePath])
  if (rmErr) {
    console.error(`${head} Storage 삭제 실패 — 행을 남긴다:`, rmErr.message)
    return { ok: false, error: ERR_OBJECT_REMOVE }
  }
  if ((removed ?? []).length !== 1) {
    const { data: exists, error: exErr } = await db.rpc('attachment_object_exists', { p_kind: input.kind, p_id: input.id })
    if (exErr || typeof exists !== 'boolean') {
      console.error(`${head} 객체 존재 확인 실패 — 행을 남긴다:`, exErr?.message ?? `응답 ${JSON.stringify(exists)}`)
      return { ok: false, error: ERR_OBJECT_REMOVE }
    }
    if (exists) {
      console.error(`${head} Storage 삭제 ${(removed ?? []).length}건인데 객체가 남아 있다(삭제 권한 불일치) — 행을 남긴다`)
      return { ok: false, error: ERR_OBJECT_REMOVE }
    }
  }
  const { data: gone, error } = await db.from(table).delete().eq('id', input.id).select('id')
  if (error) {
    console.error(`${head} 행 삭제 실패:`, error.message)
    return { ok: false, error: ERR_ROW_REMOVE }
  }
  if ((gone ?? []).length === 0) {
    console.error(`${head} 행 삭제 0건`)
    return { ok: false, error: ERR_ROW_REMOVE }
  }
  return { ok: true }
}
