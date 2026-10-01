// @vitest-environment jsdom
// 초대 수령 카드의 분기 계약. 핵심은 **이메일 대조를 클라이언트가 하지 않는다**는 것 —
// 마스킹은 앞 2자와 길이만 남아 다른 주소끼리 충돌하므로('이름.이니셜@' 같은 주소 관례),
// 판정은 서버(getInviteSessionState·redeemInvite)만 한다.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InvitePreview } from '@/app/actions/inviteRedeem'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  getInviteSessionState: vi.fn(),
  redeemInvite: vi.fn(),
  redeemInviteWithSignup: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  // 라우터 호출 순서 — 성공 이동 뒤 refresh(라우터 캐시의 직전 사용자 RSC 페이로드 무효화)를 본다.
  nav: [] as string[],
  push: vi.fn((href: string) => { mocks.nav.push(`push:${href}`) }),
  refresh: vi.fn(() => { mocks.nav.push('refresh') }),
  toast: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}))
vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
}))
vi.mock('@/app/actions/inviteRedeem', () => ({
  getInviteSessionState: mocks.getInviteSessionState,
  redeemInvite: mocks.redeemInvite,
  redeemInviteWithSignup: mocks.redeemInviteWithSignup,
}))

import { InviteRedeemCard } from '@/components/invite/InviteRedeemCard'

const TOKEN = '11111111-2222-4333-8444-555555555555'
const E_OTHER_ACCOUNT = '이 초대는 다른 이메일 주소를 위한 것입니다. 초대받은 계정으로 로그인해 주세요.'

/** 초대는 hong.gd@example.com 앞으로 나갔고, 마스킹은 'ho****@example.com' 이다. */
const PREVIEW: InvitePreview = {
  projectName: 'Acme Project',
  projectDescription: null,
  maskedEmail: 'ho****@example.com',
  status: 'active',
  accountExists: false,
  teamNames: [],
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('InviteRedeemCard 세션 분기', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.nav.length = 0
    mocks.signInWithPassword.mockResolvedValue({ error: null })
    mocks.signOut.mockResolvedValue({ error: null })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function render(preview: InvitePreview = PREVIEW) {
    await act(async () => root.render(
      <InviteRedeemCard token={TOKEN} preview={preview} loadError={null} />,
    ))
    await act(async () => { await Promise.resolve() })
  }

  it('판정 대기 중에는 폼 대신 로딩만 보여준다', async () => {
    mocks.getInviteSessionState.mockReturnValue(new Promise(() => {}))
    await render()

    expect(container.textContent).toContain('로그인 상태를 확인하는 중입니다')
    expect(container.querySelector('form')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
  })

  it('마스킹이 같아도 서버가 불일치라고 하면 합류 버튼을 주지 않는다', async () => {
    // 세션은 hong.gs@example.com — 마스킹하면 초대와 같은 'ho****@example.com' 이다.
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: true, emailMatches: false })
    await render()

    expect(container.textContent).toContain('해당 계정으로 로그인해 주세요')
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('a[href="/login"]')).not.toBeNull()
  })

  it('마스킹이 달라도 서버가 일치라고 하면 합류 버튼을 준다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: true, emailMatches: true })
    mocks.redeemInvite.mockResolvedValue({ ok: true, projectId: 'p1', alreadyMember: false })
    await render({ ...PREVIEW, maskedEmail: 'mi*******@example.com' })

    const button = container.querySelector<HTMLButtonElement>('button')!
    expect(button.textContent).toContain('합류하기')

    await act(async () => button.click())
    expect(mocks.redeemInvite).toHaveBeenCalledWith(TOKEN)
    expect(mocks.push).toHaveBeenCalledWith('/p/p1/dashboard')
    expect(mocks.nav).toEqual(['push:/p/p1/dashboard', 'refresh'])
    // 일치 경로에서는 세션을 건드리지 않는다.
    expect(mocks.signOut).not.toHaveBeenCalled()
  })

  it('판정 실패는 비로그인으로 폴백하지 않고 사유를 그대로 보여준다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: false, error: '초대를 확인할 수 없어 중단했습니다.' })
    await render({ ...PREVIEW, accountExists: true })

    expect(container.querySelector('[role="alert"]')!.textContent)
      .toBe('초대를 확인할 수 없어 중단했습니다.')
    expect(container.querySelector('form')).toBeNull()
  })

  it('로그인 폼은 이메일+비밀번호 2필드이고 마스킹 힌트를 유지한다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    await render({ ...PREVIEW, accountExists: true })

    expect(container.querySelector('#invite-email')).not.toBeNull()
    expect(container.querySelector('#invite-password')).not.toBeNull()
    expect(container.textContent).toContain('초대받은 주소: ho****@example.com')
  })

  it('로그인 후 서버가 E5 를 돌려주면 방금 만든 세션을 되돌린다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    mocks.redeemInvite.mockResolvedValue({ ok: false, error: E_OTHER_ACCOUNT })
    await render({ ...PREVIEW, accountExists: true })

    const emailInput = container.querySelector<HTMLInputElement>('#invite-email')!
    const passwordInput = container.querySelector<HTMLInputElement>('#invite-password')!
    await act(async () => {
      // 마스킹하면 초대와 같아 보이는 다른 주소 — 클라이언트 선검증이 있었다면 통과시켰을 값이다.
      setValue(emailInput, 'hong.gs@example.com')
      setValue(passwordInput, 'password123')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    // 선검증으로 막지 않고 서버까지 간다.
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'hong.gs@example.com', password: 'password123',
    })
    expect(mocks.redeemInvite).toHaveBeenCalledWith(TOKEN)
    // 초대와 무관한 계정으로 로그인만 되어 있는 상태를 남기지 않는다.
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(container.textContent).toContain('초대받은 계정으로 로그인해 주세요')
  })

  it('로그인 후 합류가 성공하면 세션을 되돌리지 않는다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    mocks.redeemInvite.mockResolvedValue({ ok: true, projectId: 'p1', alreadyMember: false })
    await render({ ...PREVIEW, accountExists: true })

    const emailInput = container.querySelector<HTMLInputElement>('#invite-email')!
    const passwordInput = container.querySelector<HTMLInputElement>('#invite-password')!
    await act(async () => {
      setValue(emailInput, 'hong.gd@example.com')
      setValue(passwordInput, 'password123')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.push).toHaveBeenCalledWith('/p/p1/dashboard')
    expect(mocks.nav).toEqual(['push:/p/p1/dashboard', 'refresh'])
  })

  it('로그인 폼에서 비밀번호가 틀리면 이동·refresh 없이 오류만 보인다', async () => {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } })
    await render({ ...PREVIEW, accountExists: true })

    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>('#invite-email')!, 'hong.gd@example.com')
      setValue(container.querySelector<HTMLInputElement>('#invite-password')!, 'wrong')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    expect(mocks.redeemInvite).not.toHaveBeenCalled()
    expect(mocks.nav).toEqual([])
    expect(container.textContent).toContain('이메일 또는 비밀번호가 올바르지 않습니다.')
  })

  async function submitSignup() {
    mocks.getInviteSessionState.mockResolvedValue({ ok: true, authed: false, emailMatches: false })
    await render()
    await act(async () => {
      setValue(container.querySelector<HTMLInputElement>('#invite-name')!, 'alice')
      setValue(container.querySelector<HTMLInputElement>('#invite-new-password')!, 'password123')
      setValue(container.querySelector<HTMLInputElement>('#invite-password-confirm')!, 'password123')
    })
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
  }

  it('가입·합류 뒤 자동 로그인이 성공하면 합류한 프로젝트 개요로 이동한 뒤 refresh 한다(D7)', async () => {
    mocks.redeemInviteWithSignup.mockResolvedValue({ ok: true, projectId: 'p1', email: 'hong.gd@example.com' })
    await submitSignup()

    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: 'hong.gd@example.com', password: 'password123' })
    expect(mocks.nav).toEqual(['push:/p/p1/dashboard', 'refresh'])
  })

  it('가입 뒤 자동 로그인만 실패하면 /login 으로 보내고 refresh 하지 않는다', async () => {
    mocks.redeemInviteWithSignup.mockResolvedValue({ ok: true, projectId: 'p1', email: 'hong.gd@example.com' })
    mocks.signInWithPassword.mockResolvedValue({ error: { message: 'boom' } })
    await submitSignup()

    expect(mocks.nav).toEqual(['push:/login'])
  })

  it('가입이 실패하면 이동·refresh 없이 사유를 보인다', async () => {
    mocks.redeemInviteWithSignup.mockResolvedValue({ ok: false, error: '가입을 처리하지 못했습니다.' })
    await submitSignup()

    expect(mocks.signInWithPassword).not.toHaveBeenCalled()
    expect(mocks.nav).toEqual([])
    expect(container.textContent).toContain('가입을 처리하지 못했습니다.')
  })

  it('초대에 담긴 팀을 이름 목록으로 안내한다(첫 팀이 대표)', async () => {
    mocks.getInviteSessionState.mockReturnValue(new Promise(() => {}))
    await render({ ...PREVIEW, teamNames: ['MES', 'ERP'] })

    const teams = container.querySelector('[data-invite-teams]')!
    expect(teams.textContent).toContain('MES, ERP')
  })

  it('팀 없는 초대는 팀 안내를 하지 않는다', async () => {
    mocks.getInviteSessionState.mockReturnValue(new Promise(() => {}))
    await render()

    expect(container.querySelector('[data-invite-teams]')).toBeNull()
  })

  it('비활성 초대에서는 세션을 묻지 않는다', async () => {
    await render({ ...PREVIEW, status: 'expired' })

    expect(mocks.getInviteSessionState).not.toHaveBeenCalled()
    expect(container.textContent).toContain('만료되었거나 유효하지 않은 초대 링크입니다.')
  })
})
