// @vitest-environment jsdom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from './_dom'
import { useRightRailOptional, useShellSidebarWidth } from '@/components/app/RightRail'
import { dispatchSidebarToggle, SIDEBAR_STORAGE_KEY } from '@/components/app/sidebarState'

let value = 0
function Probe() { value = useShellSidebarWidth(); return <i>{String(useRightRailOptional())}</i> }
const resize = (w: number) => act(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  window.dispatchEvent(new Event('resize'))
})
describe('공용 레일의 사이드바 폭(W17)', () => {
  beforeEach(() => localStorage.removeItem(SIDEBAR_STORAGE_KEY))
  it('공급자 밖은 null, 선호 없으면 CSS와 같은 폭', () => {
    const mounted = render(<Probe />)
    expect(mounted.container.textContent).toBe('null')
    for (const [w, want] of [[1440, 232], [1280, 232], [1279, 64], [1100, 64], [900, 0]]) {
      resize(w); expect(value, String(w)).toBe(want)
    }
  })
  it('명시 선호와 토글·리사이즈를 따라가며 모바일은 0', () => {
    resize(1440); render(<Probe />)
    act(() => dispatchSidebarToggle(true)); expect(value).toBe(64)
    resize(1100); act(() => dispatchSidebarToggle(false)); expect(value).toBe(232)
    resize(390); expect(value).toBe(0)
  })
})
