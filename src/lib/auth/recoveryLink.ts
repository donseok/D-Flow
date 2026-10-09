// 재설정 메일 링크가 브라우저에 남기는 것을 읽는 순수 조각(브라우저·테스트 공용 — window 를 만지지 않는다).
// 인증 서버는 링크를 확인한 뒤 돌아갈 주소에 결과를 **조각(#…)** 으로 붙인다: 성공이면 access_token·refresh_token·type=recovery,
// 실패(만료·이미 사용)면 error·error_code·error_description. 실패는 질의(?…)에도 같이 실린다.

export type RecoveryLink =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; code: string }
  | { kind: 'none' }

const params = (raw: string): URLSearchParams => new URLSearchParams(raw.replace(/^[#?]/, ''))

/**
 * 주소의 조각·질의에서 재설정 결과를 읽는다. 실패 표지가 하나라도 있으면 실패가 우선이다(토큰이 같이 있어도 쓰지 않는다).
 * type 이 recovery 가 아닌 토큰(가입 확인·매직 링크 등)은 재설정 링크가 아니다 — 'none'. 이 화면이 다른 종류의 링크로
 * "현재 비밀번호 확인 없는 비밀번호 변경" 창구가 되지 않게 한다.
 */
export function readRecoveryLink(hash: string, search: string): RecoveryLink {
  const h = params(hash)
  const q = params(search)
  const code = h.get('error_code') ?? q.get('error_code') ?? h.get('error') ?? q.get('error')
  if (code || h.get('error_description') || q.get('error_description')) return { kind: 'error', code: code || 'unknown' }
  const accessToken = h.get('access_token')
  const refreshToken = h.get('refresh_token')
  if (accessToken && refreshToken && h.get('type') === 'recovery') return { kind: 'session', accessToken, refreshToken }
  return { kind: 'none' }
}

/**
 * 로그인 화면이 새 비밀번호 화면으로 넘길 조각 — 재설정 링크의 결과(성공 토큰 또는 그 실패)일 때만 원문 그대로, 아니면 null.
 * 실패는 조각에 error 가 있을 때만 넘긴다(질의만 있는 실패는 다른 흐름의 것일 수 있다).
 */
export function recoveryFragment(hash: string): string | null {
  if (!hash || hash === '#') return null
  const h = params(hash)
  const isRecovery = h.get('type') === 'recovery' && !!h.get('access_token')
  const isError = !!(h.get('error_code') || h.get('error')) && !h.get('access_token')
  return isRecovery || isError ? (hash.startsWith('#') ? hash : `#${hash}`) : null
}
