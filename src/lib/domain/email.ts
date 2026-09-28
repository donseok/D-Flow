// 이메일 정규형 — 초대 행(domain/invites canonicalInviteEmail)과 인물 원장(명단·계정)이 같은 규칙을 쓴다.
// 수락 RPC(consume_project_invite)가 인물을 이메일 정확 일치로 찾으므로, 두 값이 다르면 한 사람이 명단에 둘로 갈린다(P-1).
import { isValidEmail } from '@/lib/domain/validate'
import { toAsciiHostname } from '@/lib/domain/hostname'

/** 끝의 '.' 하나만 벗겨낸다(FQDN 표기 'example.com.' 흡수). 두 개 이상 연속이면 그대로 두어
 *  아래 호스트명 형태 검사에서 걸러지게 한다. */
function stripTrailingDot(s: string): string {
  return s.length > 1 && s.endsWith('.') && !s.endsWith('..') ? s.slice(0, -1) : s
}

/** 메일 호스트를 저장값의 규칙(소문자·끝 점 하나 제거·퓨니코드 — settings/defs/workspace.ts normalizeDomain)으로 바꾼다.
 *  형태가 아니면 null — URL 구분자·%xx 등을 잘라 다른 호스트로 읽지 않는다(domain/hostname). */
export function normalizeEmailHost(host: string): string | null {
  const v = stripTrailingDot(host.trim().toLowerCase())
  return v ? toAsciiHostname(v) : null
}

/** trim·소문자(DB check email = lower(btrim(email))) 뒤 호스트만 정규화한 한 문자열 — 'kim@한글.kr' → 'kim@xn--bj0bj06e.kr'.
 *  로컬 파트 규칙은 형식(isValidEmail)뿐이다 — 초대(canonicalInviteEmail)는 여기에 ASCII atext·길이를 더 건다.
 *  형식이 아니거나 '@' 가 둘 이상이거나 호스트가 형태가 아니면 null(형식 오류). 이미 정규형이면 그대로다(멱등). */
export function canonicalEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (!isValidEmail(email) || email.indexOf('@') !== at) return null
  const host = normalizeEmailHost(email.slice(at + 1))
  return host ? `${email.slice(0, at)}@${host}` : null
}
