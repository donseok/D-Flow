// @vitest-environment jsdom
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from './_dom'
vi.mock('@/components/providers/LocaleProvider', async () => (await import('../helpers/locale-mock')).movedKoLocale())
import { MobileNavDrawer } from '@/components/app/MobileNavDrawer'

const groups = [{ group: 'ws.main' as const, items: [{ id: 'ws.home' as const, href: '/w/a', label: '홈', icon: 'LayoutGrid' }] }]
describe('MobileNavDrawer', () => {
  it('dialog·aria-modal·초점 가둠·Esc 로 닫힘', () => {
    const onClose = vi.fn()
    render(<MobileNavDrawer open onClose={onClose} workspaceSwitcher={<button>ws</button>} groups={groups}
      pathname="/w/a" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    const focusables = dlg.querySelectorAll<HTMLElement>('a[href],button')
    expect(document.activeElement).toBe(focusables[0])
    focusables[focusables.length - 1].focus()
    fireEvent.keyDown(dlg, { key: 'Tab' })
    expect(document.activeElement).toBe(focusables[0])
    fireEvent.keyDown(dlg, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusables[focusables.length - 1])
    fireEvent.keyDown(dlg, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
  it('닫혀 있으면 아무것도 그리지 않는다, 배경을 누르면 닫힌다', () => {
    const onClose = vi.fn()
    const { container, rerender } = render(<MobileNavDrawer open={false} onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    expect(container.innerHTML).toBe('')
    rerender(<MobileNavDrawer open onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a" workspaceHome="/w/a" projectSwitcher={null} badges={{}} />)
    fireEvent.mouseDown(container.querySelector('[data-drawer-backdrop]')!)
    expect(onClose).toHaveBeenCalled()
  })
  it('Z11 — 패널 빈 곳에 초점이 있어도 Esc·Tab 이 동작한다(dialog 자체가 초점을 받는다 — tabIndex -1)', () => {
    const onClose = vi.fn()
    render(<MobileNavDrawer open onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    const dlg = screen.getByRole('dialog')
    expect(dlg.getAttribute('tabindex')).toBe('-1')
    dlg.focus(); expect(document.activeElement).toBe(dlg)
    fireEvent.keyDown(dlg, { key: 'Escape' }); expect(onClose).toHaveBeenCalled()
  })
  it('열 때 초점이 있던 곳(햄버거)으로 닫으면 돌려주고, 경로가 바뀌면 닫는다', () => {
    const opener = document.createElement('button'); document.body.appendChild(opener); opener.focus()
    const onClose = vi.fn()
    const { rerender } = render(<MobileNavDrawer open onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    rerender(<MobileNavDrawer open onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a/minutes" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    expect(onClose).toHaveBeenCalled()
    rerender(<MobileNavDrawer open={false} onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a/minutes" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
  it('열린 채 창이 1024 이상으로 넓어지면 닫는다(드로어는 1024 미만 전용)', () => {
    let listener: ((e: { matches: boolean }) => void) | null = null
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: (_: string, f: (e: { matches: boolean }) => void) => { listener = f }, removeEventListener: () => {} }))
    const onClose = vi.fn()
    render(<MobileNavDrawer open onClose={onClose} workspaceSwitcher={null} groups={groups} pathname="/w/a" workspaceHome={null} projectSwitcher={null} badges={{}} />)
    act(() => { listener!({ matches: true }) })
    expect(onClose).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})

