// 비밀번호 분실 — 재설정 메일 요청 액션(공개). 계정 존재 여부를 알리지 않는지, 메일을 보내지 않는 배포에서 닫히는지, 링크가 돌아올 주소를 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  available: vi.fn<(env: { APP_ENV?: string; NODE_ENV?: string }) => boolean>(() => true),
  resetPasswordForEmail: vi.fn(),
  createAuthMailClient: vi.fn(),
}))
vi.mock('@/lib/auth/passwordResetMail', () => ({ passwordResetMailAvailable: h.available }))
vi.mock('@/lib/supabase/server', () => ({ createAuthMailClient: h.createAuthMailClient }))

import { requestPasswordReset } from '@/app/actions/passwordReset'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL
let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  h.available.mockReset(); h.available.mockReturnValue(true)
  h.resetPasswordForEmail.mockReset(); h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
  h.createAuthMailClient.mockReset()
  h.createAuthMailClient.mockReturnValue({ auth: { resetPasswordForEmail: h.resetPasswordForEmail } })
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com/'
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  if (APP_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = APP_URL
  errorSpy.mockRestore()
})

describe('requestPasswordReset', () => {
  it('정규화한 주소로 재설정 메일을 요청한다 — 돌아올 주소는 NEXT_PUBLIC_APP_URL 의 새 비밀번호 화면', async () => {
    expect(await requestPasswordReset('  Mina.Park@Example.com ')).toEqual({ ok: true })
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith('mina.park@example.com', { redirectTo: 'https://app.example.com/login/reset' })
  })

  it('NEXT_PUBLIC_APP_URL 이 없으면 돌아올 주소를 적지 않는다 — 요청의 Host 로 지어내지 않는다(인증 서버의 기본 주소로 돌아온다)', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(await requestPasswordReset('a@example.com')).toEqual({ ok: true })
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', undefined)
  })

  it.each([
    ['없는 계정(인증 서버는 오류 없이 받는다)', { data: {}, error: null }],
    ['같은 주소의 연속 요청 제한(계정이 있을 때만 걸린다)', { data: null, error: { status: 429, code: 'over_email_send_rate_limit', name: 'AuthApiError', message: 'For security purposes, you can only request this after 42 seconds.' } }],
    ['인증 서버 오류', { data: null, error: { status: 500, name: 'AuthApiError', message: 'Error sending recovery email' } }],
  ])('계정 존재 여부를 알리지 않는다 — %s 도 같은 응답', async (_n, result) => {
    h.resetPasswordForEmail.mockResolvedValue(result)
    expect(await requestPasswordReset('a@example.com')).toEqual({ ok: true })
  })

  it('인증 서버에 닿지 못해도 같은 응답이다 — 실패는 서버 로그에만, 주소·원문은 로그에도 없다', async () => {
    h.resetPasswordForEmail.mockRejectedValue(new TypeError('fetch failed: secret-host.internal'))
    expect(await requestPasswordReset('a@example.com')).toEqual({ ok: true })
    h.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 429, code: 'over_email_send_rate_limit', name: 'AuthApiError', message: 'after 42 seconds for a@example.com' } })
    expect(await requestPasswordReset('a@example.com')).toEqual({ ok: true })
    expect(errorSpy).toHaveBeenCalledTimes(2)
    const logged = errorSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).not.toContain('a@example.com')
    expect(logged).not.toContain('secret-host')
    expect(logged).not.toContain('42 seconds')
  })

  it('주소 형식이 아니면 요청하지 않는다 — 형식 오류는 가입 여부와 무관하다', async () => {
    for (const bad of ['', 'not-an-email', 'a@b', 'a@@example.com', null as unknown as string, 42 as unknown as string]) {
      expect(await requestPasswordReset(bad)).toEqual({ ok: false, code: 'invalid_email' })
    }
    expect(h.createAuthMailClient).not.toHaveBeenCalled()
  })

  it('메일을 보내지 않는 배포에서는 닫는다 — 링크만 숨기고 액션을 열어 두지 않는다. 주소를 보기도 전에', async () => {
    h.available.mockReturnValue(false)
    expect(await requestPasswordReset('a@example.com')).toEqual({ ok: false, code: 'unavailable' })
    expect(await requestPasswordReset('not-an-email')).toEqual({ ok: false, code: 'unavailable' })
    expect(h.createAuthMailClient).not.toHaveBeenCalled()
  })
})
