import { describe, expect, it } from 'vitest'
import { readRecoveryLink, recoveryFragment } from '@/lib/auth/recoveryLink'

describe('readRecoveryLink — 재설정 링크가 브라우저에 남긴 결과', () => {
  it('성공: 조각의 두 토큰과 type=recovery', () => {
    expect(readRecoveryLink('#access_token=at&expires_in=3600&refresh_token=rt&token_type=bearer&type=recovery', ''))
      .toEqual({ kind: 'session', accessToken: 'at', refreshToken: 'rt' })
  })
  it('실패(만료·이미 사용): 조각이든 질의든 error 표지가 있으면 실패가 우선이다', () => {
    expect(readRecoveryLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', ''))
      .toEqual({ kind: 'error', code: 'otp_expired' })
    expect(readRecoveryLink('', '?error=access_denied&error_code=otp_expired')).toEqual({ kind: 'error', code: 'otp_expired' })
    expect(readRecoveryLink('#access_token=at&refresh_token=rt&type=recovery', '?error=server_error')).toEqual({ kind: 'error', code: 'server_error' })
    expect(readRecoveryLink('#error_description=x', '')).toEqual({ kind: 'error', code: 'unknown' })
  })
  it('재설정이 아닌 링크·반쪽 토큰·빈 주소는 none — 다른 종류의 링크로 비밀번호를 바꾸게 두지 않는다', () => {
    expect(readRecoveryLink('#access_token=at&refresh_token=rt&type=magiclink', '')).toEqual({ kind: 'none' })
    expect(readRecoveryLink('#access_token=at&refresh_token=rt', '')).toEqual({ kind: 'none' })
    expect(readRecoveryLink('#access_token=at&type=recovery', '')).toEqual({ kind: 'none' })
    expect(readRecoveryLink('', '')).toEqual({ kind: 'none' })
    expect(readRecoveryLink('', '?access_token=at&refresh_token=rt&type=recovery')).toEqual({ kind: 'none' })   // 토큰은 조각에서만 받는다
  })
})

describe('recoveryFragment — 로그인 화면이 넘길 조각', () => {
  it('재설정 성공·실패 조각은 원문 그대로, 그 밖은 null', () => {
    expect(recoveryFragment('#access_token=at&refresh_token=rt&type=recovery')).toBe('#access_token=at&refresh_token=rt&type=recovery')
    expect(recoveryFragment('#error=access_denied&error_code=otp_expired')).toBe('#error=access_denied&error_code=otp_expired')
    expect(recoveryFragment('#access_token=at&type=signup')).toBeNull()
    expect(recoveryFragment('#section-2')).toBeNull()
    expect(recoveryFragment('#')).toBeNull()
    expect(recoveryFragment('')).toBeNull()
  })
})
