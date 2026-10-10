// @vitest-environment jsdom
// 비밀번호 분실 두 화면 — 재설정 메일 요청(/login/forgot)과 새 비밀번호 설정(/login/reset).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type ReqResult = { ok: true } | { ok: false; code: 'invalid_email' | 'unavailable' }
const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  requestPasswordReset: vi.fn<(email: string) => Promise<ReqResult>>(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => { mocks.calls.push(`push:${href}`) }, refresh: () => { mocks.calls.push('refresh') } }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/app/actions/passwordReset', () => ({ requestPasswordReset: (email: string) => mocks.requestPasswordReset(email) }))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { setSession: mocks.setSession, updateUser: mocks.updateUser, signOut: mocks.signOut } }),
}))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
  return { useLocale: () => api }
})

import ForgotPassword from '@/app/login/forgot/page'
import ResetPassword from '@/app/login/reset/page'
import { LoginEnvProvider } from '@/components/login/LoginEnv'

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.calls.length = 0
  mocks.requestPasswordReset.mockReset(); mocks.requestPasswordReset.mockResolvedValue({ ok: true })
  mocks.setSession.mockReset(); mocks.setSession.mockResolvedValue({ data: {}, error: null })
  mocks.updateUser.mockReset(); mocks.updateUser.mockResolvedValue({ data: {}, error: null })
  mocks.signOut.mockReset(); mocks.signOut.mockResolvedValue({ error: null })
  window.history.replaceState(null, '', '/login/reset')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})
const text = () => container.textContent ?? ''
const submitForm = () => act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

describe('재설정 메일 요청(/login/forgot)', () => {
  const render = (mailReset = true) => act(async () => root.render(<LoginEnvProvider value={{ mailReset, localDev: false }}><ForgotPassword /></LoginEnvProvider>))
  const type = (v: string) => act(async () => { setValue(container.querySelector<HTMLInputElement>('#forgot-email')!, v) })

  it('보내면 폼을 치우고 같은 안내를 보인다 — 가입 여부를 말하지 않는다', async () => {
    await render()
    await type('alice@example.com')
    await submitForm()
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith('alice@example.com')
    expect(container.querySelector('[data-forgot-sent]')).not.toBeNull()
    expect(text()).toContain('입력한 주소로 가입된 계정이 있으면 재설정 링크를 보냈습니다.')
    expect(container.querySelector('form')).toBeNull()
  })

  it('보내는 동안 버튼이 잠긴다 — 연속 제출이 요청을 두 번 만들지 않는다', async () => {
    let release!: (v: ReqResult) => void
    mocks.requestPasswordReset.mockReturnValue(new Promise<ReqResult>((r) => { release = r }))
    await render()
    await type('alice@example.com')
    await submitForm()
    const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('보내는 중…')
    await submitForm()
    expect(mocks.requestPasswordReset).toHaveBeenCalledTimes(1)
    await act(async () => { release({ ok: true }) })
    expect(container.querySelector('[data-forgot-sent]')).not.toBeNull()
  })

  it('보낸 뒤 "다시 보내기"는 잠금 시간이 지나야 열린다', async () => {
    vi.useFakeTimers()
    await render()
    await type('alice@example.com')
    await submitForm()
    const again = () => container.querySelector<HTMLButtonElement>('[data-forgot-sent] button')!
    expect(again().disabled).toBe(true)
    expect(again().textContent).toContain('(60)')
    for (let i = 0; i < 60; i++) await act(async () => { vi.advanceTimersByTime(1000) })
    expect(again().disabled).toBe(false)
    await act(async () => { again().click() })
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('형식 오류는 그 자리에서 알린다(가입 여부와 무관한 오류)', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ ok: false, code: 'invalid_email' })
    await render()
    await type('nope')
    await submitForm()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('올바른 이메일을 입력하세요.')
    expect(container.querySelector('[data-forgot-sent]')).toBeNull()
  })

  it('요청이 던지면 일반 오류를 보이고 다시 누를 수 있다', async () => {
    mocks.requestPasswordReset.mockRejectedValue(new Error('network'))
    await render()
    await type('alice@example.com')
    await submitForm()
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false)
  })

  it('메일을 보내지 않는 배포에서 주소를 직접 열면 폼이 없다 — "관리자에게 문의"', async () => {
    await render(false)
    expect(container.querySelector('form')).toBeNull()
    expect(text()).toContain('이 배포에서는 메일로 비밀번호를 재설정할 수 없습니다. 관리자에게 문의하세요.')
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
  })
})

describe('새 비밀번호 설정(/login/reset)', () => {
  const HASH = '#access_token=at-1&expires_in=3600&refresh_token=rt-1&token_type=bearer&type=recovery'
  const render = () => act(async () => root.render(<ResetPassword />))
  const state = () => container.querySelector('[data-reset-state]')?.getAttribute('data-reset-state')
  async function fill(pw: string, again = pw) {
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>('#reset-password')!, pw)
      setValue(container.querySelector<HTMLInputElement>('#reset-confirm')!, again)
    })
    await submitForm()
  }

  it('링크의 토큰을 세션으로 바꾸고 주소에서 지운 뒤 폼을 연다', async () => {
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'at-1', refresh_token: 'rt-1' })
    expect(window.location.hash).toBe('')
    expect(state()).toBe('ready')
  })

  it('성공: updateUser 로 바꾸고 완료를 알린다 — 시작 화면으로 갈 때 라우터 캐시를 새로 고친다', async () => {
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    await fill('new-password-1')
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'new-password-1' })
    expect(state()).toBe('done')
    expect(text()).toContain('비밀번호를 바꿨습니다')
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-reset-state="done"] button')!.click() })
    expect(mocks.calls).toEqual(['push:/', 'refresh'])
  })

  it('성공하면 이 사용자의 다른 세션만 끊는다(scope others) — 방금 만든 세션은 남는다', async () => {
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    await fill('new-password-1')
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'others' })
    // 변경이 먼저다 — 바꾸기 전에 끊으면 옛 비밀번호로 다시 들어온다
    expect(mocks.updateUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0])
    expect(text()).not.toContain('기존 로그인 세션을 끊지 못했습니다')
  })

  it('다른 세션을 끊지 못해도 재설정은 성공이다 — 완료 화면이 그 사실을 알리고 로그를 남긴다(오류 반환·던짐 둘 다)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const fail of [() => mocks.signOut.mockResolvedValue({ error: { message: 'boom' } }), () => mocks.signOut.mockRejectedValue(new Error('network'))]) {
        act(() => root.unmount()); root = createRoot(container)
        log.mockClear(); fail()
        window.history.replaceState(null, '', `/login/reset${HASH}`)
        await render()
        await fill('new-password-1')
        expect(state()).toBe('done')
        expect(text()).toContain('비밀번호를 바꿨습니다')
        expect(text()).toContain('기존 로그인 세션을 끊지 못했습니다')
        expect(log).toHaveBeenCalledTimes(1)
      }
    } finally { log.mockRestore() }
  })

  it('변경이 실패하면 세션을 끊지 않는다', async () => {
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    mocks.updateUser.mockResolvedValue({ data: null, error: { name: 'AuthApiError', code: 'unexpected_failure', message: 'x' } })
    await fill('new-password-1')
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('검증: 8자 미만·두 값 불일치는 인증 서버에 보내지 않는다(계정 생성·관리자 재설정과 같은 규칙)', async () => {
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    await fill('short')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('비밀번호는 8자 이상이어야 합니다.')
    await fill('new-password-1', 'new-password-2')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('두 비밀번호가 같지 않습니다.')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })

  it('만료 토큰: 링크가 실패 표지를 달고 오면 폼 없이 다시 요청하게 한다 — 토큰을 쓰지 않는다', async () => {
    window.history.replaceState(null, '', '/login/reset?error=access_denied&error_code=otp_expired#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    await render()
    expect(state()).toBe('expired')
    expect(text()).toContain('링크가 만료됐거나 이미 사용됐습니다')
    expect(container.querySelector('a[href="/login/forgot"]')).not.toBeNull()
    expect(container.querySelector('form')).toBeNull()
    expect(mocks.setSession).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })

  it('만료 토큰: 인증 서버가 토큰을 받지 않으면(setSession 오류) 같은 화면', async () => {
    mocks.setSession.mockResolvedValue({ data: { session: null }, error: { name: 'AuthApiError', message: 'invalid JWT' } })
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    expect(state()).toBe('expired')
    expect(text()).not.toContain('invalid JWT')
  })

  it('토큰 없이 열면 폼을 보이지 않는다 — 로그인한 사람이 현재 비밀번호 확인 없이 바꾸는 길이 되지 않는다', async () => {
    await render()
    expect(state()).toBe('invalid')
    expect(container.querySelector('form')).toBeNull()
    expect(mocks.setSession).not.toHaveBeenCalled()
    act(() => root.unmount()); root = createRoot(container)
    window.history.replaceState(null, '', '/login/reset#access_token=at&refresh_token=rt&type=magiclink')
    await render()
    expect(state()).toBe('invalid')
    expect(mocks.setSession).not.toHaveBeenCalled()
  })

  it('변경 거부: 쓸 수 없는 비밀번호는 다시 입력하게 하고, 세션이 사라졌으면 만료 화면 — 인증 서버 원문은 보이지 않는다', async () => {
    window.history.replaceState(null, '', `/login/reset${HASH}`)
    await render()
    mocks.updateUser.mockResolvedValue({ data: null, error: { name: 'AuthApiError', code: 'same_password', message: 'New password should be different from the old password.' } })
    await fill('new-password-1')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('이 비밀번호는 쓸 수 없습니다. 다른 비밀번호를 입력하세요.')
    mocks.updateUser.mockResolvedValue({ data: null, error: { name: 'AuthApiError', code: 'unexpected_failure', message: 'pq: connection refused 10.0.0.1' } })
    await fill('new-password-1')
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    expect(text()).not.toContain('10.0.0.1')
    mocks.updateUser.mockResolvedValue({ data: null, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } })
    await fill('new-password-1')
    expect(state()).toBe('expired')
  })
})
