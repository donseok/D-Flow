// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from './_dom'
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ t: (k: string) => k, locale: 'ko' }) }))
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
})
