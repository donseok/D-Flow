// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from './_dom'
const h = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
import { WorkspaceSwitcher } from '@/components/app/WorkspaceSwitcher'

const A = { id: 'a', slug: 'acme', name: 'Acme', role: 'member' as const, joinedAt: '1' }
const B = { id: 'b', slug: 'beta', name: 'Beta', role: 'admin' as const, joinedAt: '2' }
beforeEach(() => vi.clearAllMocks())

describe('WorkspaceSwitcher(D4)', () => {
  it('소속 하나면 목록 표지·메뉴 없음(이름만)', () => {
    const { container } = render(<WorkspaceSwitcher current={A} workspaces={[A]} viewingAsPlatformAdmin={false} />)
    expect(container.querySelector('[data-ws-switcher="list"]')).toBeNull()
    expect(container.querySelector('[aria-haspopup]')).toBeNull()
    expect(screen.getByText('Acme')).toBeTruthy()
  })
  it('둘 이상 — 열면 첫 항목에 초점, 고르면 /w/<slug>, Esc 는 닫고 트리거로', () => {
    const { container } = render(<WorkspaceSwitcher current={A} workspaces={[A, B]} viewingAsPlatformAdmin={false} />)
    const trigger = container.querySelector('[data-ws-switcher="list"]') as HTMLButtonElement
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(trigger)
    const items = screen.getAllByRole('menuitemradio')
    expect(document.activeElement).toBe(items[0])
    expect(items[0].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull(); expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger); fireEvent.click(screen.getAllByRole('menuitemradio')[1])
    expect(h.push).toHaveBeenCalledWith('/w/beta')
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('지금 워크스페이스를 고르면 이동하지 않는다', () => {
    const { container } = render(<WorkspaceSwitcher current={A} workspaces={[A, B]} viewingAsPlatformAdmin={false} />)
    fireEvent.click(container.querySelector('[data-ws-switcher="list"]')!)
    fireEvent.click(screen.getAllByRole('menuitemradio')[0])
    expect(h.push).not.toHaveBeenCalled()
  })
  it('바깥을 누르면 닫힌다', () => {
    const { container } = render(<WorkspaceSwitcher current={A} workspaces={[A, B]} viewingAsPlatformAdmin={false} />)
    fireEvent.click(container.querySelector('[data-ws-switcher="list"]')!)
    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('플랫폼 관리자가 비소속을 보면 칩, 목록에는 넣지 않는다', () => {
    const { container } = render(<WorkspaceSwitcher current={{ id: 'x', slug: 'other', name: 'Other' }} workspaces={[A, B]} viewingAsPlatformAdmin />)
    expect(screen.getByText('플랫폼 관리자로 보는 중')).toBeTruthy()
    fireEvent.click(container.querySelector('[data-ws-switcher="list"]')!)
    expect(screen.getAllByRole('menuitemradio').map((i) => i.textContent)).toEqual(['Acme', 'Beta'])
  })
})
