// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from './_dom'
const h = vi.hoisted(() => ({ signOut: vi.fn(async () => {}) }))
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/lib/auth/signOut', () => ({ signOutAndClear: h.signOut }))
import { AccountMenu } from '@/components/app/AccountMenu'

describe('AccountMenu(★10)', () => {
  it('관리 링크 없음, 내 계정·로그아웃(테마 선택은 없다 — 라이트 전용 2026-10-10), Esc → 트리거 초점', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '관리자', teamCodes: ['ERP'] }} />)
    const trigger = screen.getByRole('button', { name: /alice/ })
    fireEvent.click(trigger)
    expect(screen.getByText('내 계정').closest('a')?.getAttribute('href')).toBe('/account')
    expect(document.activeElement).toBe(screen.getByText('내 계정').closest('a'))
    expect(screen.queryByRole('radiogroup')).toBeNull()
    for (const gone of ['/admin/accounts', '/admin/teams', '/admin/llm-config']) expect(document.querySelector(`a[href="${gone}"]`)).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('로그아웃은 signOutAndClear 하나로(W16)', () => {
    render(<AccountMenu identity={{ displayName: null, roleLabel: '멤버', teamCodes: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /멤버/ }))
    fireEvent.click(screen.getByText('chrome.logout').closest('button')!)
    expect(h.signOut).toHaveBeenCalledTimes(1)
  })
  it('소속은 팀 이름(teamLabels)으로 보인다 — code 가 아니다. 여럿이면 첫 이름 외 n-1, 전체는 title', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '멤버', teamCodes: ['OPS', 'QA'], teamLabels: ['운영', '품질'] }} />)
    fireEvent.click(screen.getByRole('button', { name: /alice/ }))
    const sub = document.querySelector('[data-profile-subtitle]')!
    expect(sub.textContent).toBe('멤버 · 운영 외 1')
    expect(sub.getAttribute('title')).toBe('운영, 품질')
    expect(sub.textContent).not.toContain('OPS')
  })
  it('teamLabels 가 없으면(옛 호출부) code 로 보인다', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '멤버', teamCodes: ['ERP'] }} />)
    fireEvent.click(screen.getByRole('button', { name: /alice/ }))
    expect(document.querySelector('[data-profile-subtitle]')!.textContent).toBe('멤버 · ERP')
  })
  it('팀 모름(null)은 미지정이라 주장하지 않는다', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '멤버', teamCodes: null }} />)
    fireEvent.click(screen.getByRole('button', { name: /alice/ }))
    expect(document.body.textContent).not.toContain('소속 미지정')
  })
  it('Z4 — 팝오버는 비모달 dialog(테마 라디오·머리를 담으므로 menu 계약이 아니다), 트리거는 aria-haspopup="dialog"', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '멤버', teamCodes: null }} />)
    const trigger = document.querySelector('[data-account-trigger]')!
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '계정' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull(); expect(document.querySelector('[role="menuitem"]')).toBeNull()
  })
  it('Z5 — 트리거는 640 미만(이름 글자 숨김)에서도 접근 가능한 이름을 갖는다', () => {
    render(<AccountMenu identity={{ displayName: 'alice', roleLabel: '멤버', teamCodes: null }} />)
    expect(document.querySelector('[data-account-trigger]')!.getAttribute('aria-label')).toBe('alice — 계정 메뉴')
    render(<AccountMenu identity={null} />)
    expect(document.querySelectorAll('[data-account-trigger]')[1].getAttribute('aria-label')).toBe('게스트 — 계정 메뉴')
  })
})

