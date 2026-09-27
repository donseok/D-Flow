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

import Login from '@/app/login/page'

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
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function submit() {
    await act(async () => root.render(<Login />))
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>('#email')!, 'alice@example.com')
      setValue(container.querySelector<HTMLInputElement>('#password')!, 'pw')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }

  it('성공하면 /projects 로 이동한 뒤 라우터 캐시를 새로 고친다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    await submit()
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'pw' })
    expect(mocks.calls).toEqual(['push:/projects', 'refresh'])
  })

  it('실패하면 이동·새로 고침 없이 오류를 보인다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await submit()
    expect(mocks.calls).toEqual([])
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('이메일 또는 비밀번호가 올바르지 않습니다.')
  })
})
