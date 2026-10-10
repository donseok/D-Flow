// 서버가 가드·관문의 실패를 응답에 싣는 자리의 도우미.
// lib·가드의 문구는 한국어 그대로 싣는다(감쌀 것이 없다). 가드 사유의 비교는 문구가 아니라 코드(guardCodeOf)로 한다.
import 'server-only'
import type { GuardCode } from '@/lib/authz/errors'

/**
 * 실패한 가드·관문·lib 결과를 액션의 실패 결과로 — `if (!g.ok) return denied(g)`. `{ ok: false, error }` 만 돌려준다
 * (가드의 `code`·그 밖의 필드는 싣지 않는다 — 액션 계약은 그대로다).
 */
export function denied(g: { ok: false; error: string; code?: GuardCode }): { ok: false; error: string } {
  return { ok: false, error: g.error }
}
