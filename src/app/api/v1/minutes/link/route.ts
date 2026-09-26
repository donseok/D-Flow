import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BRAND } from '@/lib/branding'
import { actorFromUser } from '@/lib/authz'
import { canEditMinute } from '@/lib/domain/authz'
import {
  apiBadRequest, apiFail, apiInternalError, apiNotFound, EXTERNAL_ID_MAX, gateMinutesApi,
  isUuid, resolveUserByEmail,
} from '@/lib/minutes/externalApi'

/**
 * POST /api/v1/minutes/link — 수동 업로드된 기존 회의록(external_id null)에 external_id 부여(claim).
 * 계약 §4b. 본문·메타는 변경하지 않으므로 updated_at 도 후처리 파이프라인도 건드리지 않는다
 * (내용 편집이 아님 — setMinuteShare 관례와 동일).
 * 호출자(user_email)가 그 회의록을 변경할 수 있어야 한다 — 작성자 또는 그 프로젝트 관리자(SP2, 계약 v2.7).
 */

export const dynamic = 'force-dynamic'

const linked = (id: string, externalId: string) =>
  NextResponse.json({ ok: true, id, action: 'linked', external_id: externalId })

export async function POST(req: NextRequest) {
  const gate = gateMinutesApi(req)
  if (gate) return gate

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return apiBadRequest('잘못된 요청입니다.')
  }
  const b = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const userEmail = typeof b.user_email === 'string' ? b.user_email.trim() : ''
  if (!userEmail) return apiBadRequest('user_email이 필요합니다.')
  const minuteId = typeof b.minute_id === 'string' ? b.minute_id.trim() : ''
  if (!minuteId) return apiBadRequest('minute_id가 필요합니다.')
  if (!isUuid(minuteId)) return apiBadRequest('minute_id 형식이 올바르지 않습니다.')
  const externalId = typeof b.external_id === 'string' ? b.external_id : ''
  if (!externalId) return apiBadRequest('external_id가 필요합니다.')
  if (externalId.length > EXTERNAL_ID_MAX) return apiBadRequest(`external_id는 ${EXTERNAL_ID_MAX}자 이하여야 합니다.`)

  try {
    const admin = createAdminClient()
    const user = await resolveUserByEmail(admin, userEmail)
    if (!user) return apiFail(403, 'unknown_user', `해당 이메일의 ${BRAND.productName} 사용자가 없습니다.`)

    // 권한 조회 실패는 throw → 아래 catch 의 500(권한 없음 404 로 위장하지 않는다).
    const actor = await actorFromUser(admin, user.id)

    const { data: target, error: selErr } = await admin.from('minutes')
      .select('id, external_id, archived_at, created_by, project_id').eq('id', minuteId).maybeSingle()
    if (selErr) { console.error('[minutes-api] link 대상 조회 실패:', selErr.message); return apiInternalError() }
    // SP2 — 연결은 회의록 변경이다. 작성자 또는 그 프로젝트 관리자만(세션 checkOwner 와 같은 canEditMinute).
    // 자격이 없으면 없는 회의록과 같은 404 — 다른 워크스페이스 회의록의 존재·보관 여부를 드러내지 않는다.
    const row = target as { created_by: string | null; project_id: string | null } | null
    if (!row || !canEditMinute(actor, row)) return apiFail(404, 'not_found', '회의록을 찾을 수 없습니다.')
    if ((target as { archived_at: string | null }).archived_at) {
      return apiFail(409, 'archived', '보관된 회의록은 연결할 수 없습니다.')
    }

    const current = (target as { external_id: string | null }).external_id
    if (current === externalId) return linked(minuteId, externalId)  // 멱등 — 재호출 안전
    if (current !== null) return apiFail(409, 'link_conflict', '대상 회의록에 이미 다른 external_id가 연결되어 있습니다.')

    // 조건부 update — 경합 시 0행이 되고, 타 레코드 사용 중이면 부분 unique 위반(23505)
    const { data: updatedRows, error: upErr } = await admin.from('minutes')
      .update({ external_id: externalId }).eq('id', minuteId).is('external_id', null).select('id')
    if (upErr) {
      if (upErr.code === '23505') return apiFail(409, 'link_conflict', '이미 다른 회의록에 사용 중인 external_id 입니다.')
      console.error('[minutes-api] link 갱신 실패:', upErr.message)
      return apiInternalError()
    }
    if (!updatedRows || updatedRows.length === 0) {
      // 경합 — 그 사이 다른 값이 연결됐는지 재조회로 판별
      const { data: re } = await admin.from('minutes').select('external_id').eq('id', minuteId).maybeSingle()
      if (re && (re as { external_id: string | null }).external_id === externalId) return linked(minuteId, externalId)
      return apiFail(409, 'link_conflict', '대상 회의록에 이미 다른 external_id가 연결되어 있습니다.')
    }
    return linked(minuteId, externalId)
  } catch (e) {
    console.error('[minutes-api] link 처리 실패:', e instanceof Error ? e.message : e)
    return apiInternalError()
  }
}

// 미정의 메서드도 404 — 405 + Allow 응답이 비활성 라우트의 존재를 노출하지 않게(§3.4 존재 은닉 보강).
export const GET = apiNotFound
export const PUT = apiNotFound
export const DELETE = apiNotFound
export const PATCH = apiNotFound
export const OPTIONS = apiNotFound
