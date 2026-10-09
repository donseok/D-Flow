'use server'
// 비밀번호 분실 — 재설정 메일 요청(로그인 전 화면 /login/forgot). 로그인 세션이 없는 공개 액션이다.
// 메일은 Supabase Auth 가 보낸다(resetPasswordForEmail). 링크를 열면 새 비밀번호 화면(/login/reset)으로 돌아온다.
import { passwordResetMailAvailable } from '@/lib/auth/passwordResetMail'
import { canonicalEmail } from '@/lib/domain/email'
import { createAuthMailClient } from '@/lib/supabase/server'

export type PasswordResetRequestResult = { ok: true } | { ok: false; code: 'invalid_email' | 'unavailable' }

/**
 * 링크가 돌아올 주소. NEXT_PUBLIC_APP_URL 이 있을 때만 적는다 — 요청의 Host 헤더로 만들면 헤더를 꾸민 요청이 남의 메일에 엉뚱한 호스트의
 * 링크를 싣게 된다(메일에 실린 토큰이 그 호스트로 간다). 없으면 적지 않는다: 인증 서버가 자기 기본 주소로 돌려보내고, 로그인 화면이
 * 재설정 조각을 알아보고 새 비밀번호 화면으로 넘긴다(src/app/login/page.tsx).
 */
function resetRedirect(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim()
  return raw ? `${raw.replace(/\/+$/, '')}/login/reset` : undefined
}

/**
 * 재설정 메일 요청. **계정이 있는지 알리지 않는다** — 주소 형식이 맞으면 결과와 무관하게 늘 같은 응답이다. 인증 서버의 오류(같은 주소의
 * 연속 요청 제한은 계정이 있을 때만 걸린다)를 돌려주면 그 차이가 곧 가입 여부다. 오류는 서버 로그에만 남긴다(주소는 적지 않는다).
 * 메일을 보내지 않는 배포에서는 화면이 링크를 숨기고, 액션도 같은 판정으로 닫는다(링크만 숨기고 길을 열어 두지 않는다).
 * 남용 방지는 인증 서버의 발송 제한에 기댄다 — 앱 계층의 요청 제한은 없다(화면은 연속 제출만 막는다).
 */
export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  // 이름을 적어 읽는다 — next.config.ts 가 APP_ENV 를 빌드 때 이 식에 박는다
  if (!passwordResetMailAvailable({ APP_ENV: process.env.APP_ENV, NODE_ENV: process.env.NODE_ENV })) return { ok: false, code: 'unavailable' }
  const address = typeof email === 'string' ? canonicalEmail(email) : null
  if (!address) return { ok: false, code: 'invalid_email' }
  try {
    const redirectTo = resetRedirect()
    const { error } = await createAuthMailClient().auth.resetPasswordForEmail(address, redirectTo ? { redirectTo } : undefined)
    if (error) console.error('[requestPasswordReset] 인증 서버가 요청을 받지 않았다:', error.status ?? '', error.code ?? error.name)
  } catch (e) {
    console.error('[requestPasswordReset] 인증 서버에 닿지 못했다:', e instanceof Error ? e.name : 'unknown')
  }
  return { ok: true }
}
