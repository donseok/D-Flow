// @vitest-environment jsdom
// 내 계정 비밀번호 변경 — 인증 서버의 오류 원문(영어 등)은 화면에 내지 않고 한국어 문구로 바꾼다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { getUser: mocks.getUser, signInWithPassword: mocks.signInWithPassword, updateUser: mocks.updateUser } }),
}))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  const api = { t: (k: Parameters<typeof t>[0]) => t(k) }
  return { useLocale: () => api }
})

import { ChangePasswordModal } from '@/components/account/ChangePasswordModal'
import { reauthErrorKey, updateErrorKey } from '@/lib/auth/passwordChangeError'
import { t } from '@/lib/i18n/dict'

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.getUser.mockReset(); mocks.getUser.mockResolvedValue({ data: { user: { email: 'a@b.c' } } })
  mocks.signInWithPassword.mockReset(); mocks.signInWithPassword.mockResolvedValue({ error: null })
  mocks.updateUser.mockReset(); mocks.updateUser.mockResolvedValue({ data: {}, error: null })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

async function submitWith() {
  await act(async () => { root.render(<ChangePasswordModal open onClose={() => {}} />) })
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  await act(async () => { setValue(inputs[0], 'old-password'); setValue(inputs[1], 'new-password-1') })
  const submit = Array.from(document.querySelectorAll('button')).find(b => b.textContent === t('account.pw.submit'))!
  await act(async () => { submit.click() })
  await act(async () => { await Promise.resolve() })
  return document.querySelector('[role="alert"]')?.textContent ?? null
}

describe('C3b — 비밀번호 변경 오류 문구', () => {
  it('새 비밀번호 저장 실패: 알려진 코드는 한국어 문구, 원문은 화면에 없다', async () => {
    mocks.updateUser.mockResolvedValue({ data: {}, error: Object.assign(new Error('New password should be different from the old password.'), { code: 'same_password' }) })
    const text = await submitWith()
    expect(text).toBe(t('account.pw.err.same'))
    expect(document.body.textContent).not.toContain('should be different')
  })
  it('모르는 오류는 일반 문구 + 콘솔 기록, 원문은 화면에 없다', async () => {
    mocks.updateUser.mockResolvedValue({ data: {}, error: Object.assign(new Error('Database error saving'), { code: 'unexpected_failure' }) })
    const text = await submitWith()
    expect(text).toBe(t('account.pw.err.failed'))
    expect(document.body.textContent).not.toContain('Database error')
    expect(console.error).toHaveBeenCalled()
  })
  it('기존 비밀번호 확인 실패: 모르는 오류의 원문은 화면에 없다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: Object.assign(new Error('Email logins are disabled'), { code: 'email_provider_disabled' }) })
    const text = await submitWith()
    expect(text).toBe(t('account.pw.err.reauthFailed'))
    expect(document.body.textContent).not.toContain('disabled')
  })
  it('코드 → 문구 키', () => {
    expect(reauthErrorKey('invalid_credentials')).toBe('account.pw.err.currentWrong')
    expect(updateErrorKey('weak_password')).toBe('account.pw.err.weak')
    expect(updateErrorKey('over_request_rate_limit')).toBe('account.pw.err.rateLimit')
    expect(updateErrorKey('session_not_found')).toBe('account.pw.err.noSession')
    expect(updateErrorKey(undefined)).toBe('account.pw.err.failed')
  })
})
