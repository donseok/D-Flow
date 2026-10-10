// @vitest-environment jsdom
// 로그인 성공 뒤 이동은 클라이언트 라우터 캐시를 무효화한다 — staleTimes.dynamic(30초) 안에
// 같은 브라우저의 직전 사용자 RSC 페이로드(사이드바·프로젝트 목록)가 다음 사용자에게 잠깐 보이지 않게.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  signInWithPassword: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => { mocks.calls.push(`push:${href}`) },
    replace: (href: string) => { mocks.calls.push(`replace:${href}`) },
    refresh: () => { mocks.calls.push('refresh') },
  }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({ auth: { signInWithPassword: mocks.signInWithPassword } }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...rest}>{children}</a>,
}))
// 사전 문구로 확인한다(공급자 없는 기본 t 는 키를 돌려준다)
vi.mock('@/components/providers/LocaleProvider', async () => {
  const dict = await vi.importActual<typeof import('@/lib/i18n/dict')>('@/lib/i18n/dict')
  return { useLocale: () => ({ locale: 'ko', t: (k: Parameters<typeof dict.t>[1]) => dict.t('ko', k) }) }
})

import Login from '@/app/login/page'
import { LoginEnvProvider, type LoginEnv } from '@/components/login/LoginEnv'

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('로그인 화면 제출', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    mocks.calls.length = 0
    mocks.signInWithPassword.mockReset()
    window.location.hash = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  /** env 를 주지 않으면 공급자 없는 기본값(메일 재설정 없음·배포 화면)으로 그린다 */
  async function renderLogin(env?: LoginEnv) {
    await act(async () => root.render(env ? <LoginEnvProvider value={env}><Login /></LoginEnvProvider> : <Login />))
  }
  async function submit(env?: LoginEnv) {
    await renderLogin(env)
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>('#email')!, 'alice@example.com')
      setValue(container.querySelector<HTMLInputElement>('#password')!, 'pw')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }

  it('성공하면 / (루트 리졸버 — 현재 워크스페이스의 시작 화면)로 이동한 뒤 라우터 캐시를 새로 고친다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    await submit()
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'pw' })
    expect(mocks.calls).toEqual(['push:/', 'refresh'])
  })

  it('실패하면 이동·새로 고침 없이 오류를 보인다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await submit()
    expect(mocks.calls).toEqual([])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('이메일 또는 비밀번호가 올바르지 않습니다.')
  })

  it('네트워크 연결 실패 시 크래시 없이 안내 오류를 표시한다 — 배포 화면에는 개발자용 문구(로컬 DB·Docker)가 없다', async () => {
    mocks.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))
    await submit()
    expect(mocks.calls).toEqual([])
    const text = container.querySelector('[role="alert"]')?.textContent ?? ''
    expect(text).toBe('인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
    expect(text).not.toMatch(/Supabase|Docker|로컬/)
  })

  it('로컬 개발에서만 로컬 DB 확인 안내를 덧붙인다', async () => {
    mocks.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))
    await submit({ mailReset: false, localDev: true })
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toBe('인증 서버에 연결할 수 없습니다. 로컬 Supabase DB(Docker)가 실행 중인지 확인하세요.')
  })
})

describe('로그인 화면 — 비밀번호 분실 안내와 문구의 로캘', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    mocks.calls.length = 0
    window.location.hash = ''
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    window.location.hash = ''
  })
  const render = (env?: LoginEnv) => act(async () => root.render(env ? <LoginEnvProvider value={env}><Login /></LoginEnvProvider> : <Login />))

  it('메일을 보내지 않는 배포: 재설정 링크가 없고 "관리자에게 문의" 안내가 그대로다', async () => {
    await render({ mailReset: false, localDev: false })
    expect(container.querySelector('[data-forgot-link]')).toBeNull()
    expect(container.textContent).toContain('아이디(이메일) 또는 비밀번호를 잊으셨다면 관리자에게 문의하세요.')
  })

  it('메일 재설정이 되는 배포: "비밀번호를 잊으셨나요?" 가 /login/forgot 으로 가고, 안내는 아이디 분실만 말한다', async () => {
    await render({ mailReset: true, localDev: false })
    const link = container.querySelector<HTMLAnchorElement>('[data-forgot-link]')!
    expect(link.textContent).toBe('비밀번호를 잊으셨나요?')
    expect(link.getAttribute('href')).toBe('/login/forgot')
    expect(container.textContent).toContain('아이디(이메일)를 잊으셨다면 관리자에게 문의하세요.')
    expect(container.textContent).not.toContain('또는 비밀번호를 잊으셨다면')
  })

  it('재설정 링크가 이 화면으로 떨어지면 조각을 그대로 들고 새 비밀번호 화면으로 넘긴다', async () => {
    window.location.hash = '#access_token=at&refresh_token=rt&type=recovery'
    await render()
    expect(mocks.calls).toEqual(['replace:/login/reset#access_token=at&refresh_token=rt&type=recovery'])
  })

  it('재설정 링크의 실패(만료)도 넘긴다 — 다른 조각·빈 조각은 넘기지 않는다', async () => {
    window.location.hash = '#error=access_denied&error_code=otp_expired'
    await render()
    expect(mocks.calls).toEqual(['replace:/login/reset#error=access_denied&error_code=otp_expired'])
    mocks.calls.length = 0
    act(() => root.unmount()); root = createRoot(container)
    window.location.hash = '#access_token=at&refresh_token=rt&type=magiclink'
    await render()
    expect(mocks.calls).toEqual([])
  })
})
