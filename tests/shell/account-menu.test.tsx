// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from './_dom'
const h = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/components/account/ThemeRadioGroup', () => ({ ThemeRadioGroup: () => <div data-theme-radio /> }))
vi.mock('@/lib/auth/signOut', () => ({ signOutAndClear: h.signOut }))
import { AccountMenu } from '@/components/app/AccountMenu'

describe('AccountMenu(★10)', () => {
  it('관리 링크 없음, 내 계정·테마·로그아웃, Esc → 트리거 초점', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '관리자', teamCodes: ['ERP'] }} />)
    const trigger = screen.getByRole('button', { name: /alice/ })
    fireEvent.click(trigger)
    expect(screen.getByText('내 계정').closest('a')?.getAttribute('href')).toBe('/account')
    expect(document.activeElement).toBe(screen.getByText('내 계정').closest('a'))
    expect(document.querySelector('[data-theme-radio]')).toBeTruthy()
    for (const gone of ['/admin/accounts', '/admin/teams', '/admin/llm-config']) expect(document.querySelector(`a[href="${gone}"]`)).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('로그아웃은 signOutAndClear 하나로(W16)', () => {
    render(<AccountMenu identity={{ displayName: null, roleLabel: '멤버', teamCodes: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /멤버/ }))
    fireEvent.click(screen.getByText('chrome.logout').closest('button')!)
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })
  it('팀 모름(null)은 미지정이라 주장하지 않는다', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '멤버', teamCodes: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /alice/ }))
    expect(document.body.textContent).not.toContain('소속 미지정')
  })
})
