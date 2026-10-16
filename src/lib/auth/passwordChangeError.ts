// 비밀번호 변경(내 계정)에서 인증 서버가 돌려준 오류를 화면 문구 키로 바꾼다.
// 인증 서버의 오류 원문(영어 등)은 화면에 내지 않는다 — 알려진 코드만 사용자가 할 일을 말하는 문구로, 모르는 것은 일반 문구로 보낸다.
import type { DictKey } from '@/lib/i18n/dict'

/** 현재 비밀번호 재확인(signInWithPassword) 실패 */
export function reauthErrorKey(code: string | undefined): DictKey {
  if (code === 'invalid_credentials') return 'account.pw.err.currentWrong'
  if (code === 'over_request_rate_limit') return 'account.pw.err.rateLimit'
  return 'account.pw.err.reauthFailed'
}

/** 새 비밀번호 저장(updateUser) 실패 */
export function updateErrorKey(code: string | undefined): DictKey {
  if (code === 'same_password') return 'account.pw.err.same'
  if (code === 'weak_password') return 'account.pw.err.weak'
  if (code === 'over_request_rate_limit') return 'account.pw.err.rateLimit'
  if (code === 'session_not_found' || code === 'session_expired' || code === 'reauthentication_needed') return 'account.pw.err.noSession'
  return 'account.pw.err.failed'
}
