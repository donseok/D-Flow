// @vitest-environment jsdom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from './_dom'
import { RightRail, RightRailProvider, useRailHost, useRightRail } from '@/components/app/RightRail'

let host: HTMLElement | null = null
function Probe() { host = useRailHost(); return null }
describe('useRailHost(D56)', () => {
  it('평소 #app-rail, WBS 전체 화면이 열려 있으면 그 안의 레일 자리, 닫히면 다시 #app-rail', async () => {
    document.body.innerHTML = '<div id="app-rail"></div>'
    render(<Probe />); expect(host?.id).toBe('app-rail')
    const fs = document.createElement('div'); fs.setAttribute('data-wbs-fullscreen', 'open')
    const slot = document.createElement('div'); slot.setAttribute('data-rail-host', 'fullscreen'); fs.appendChild(slot)
    await act(async () => { document.body.appendChild(fs); await Promise.resolve() })
    expect(host).toBe(slot)
    await act(async () => { fs.remove(); await Promise.resolve() })
    expect(host?.id).toBe('app-rail')
  })
  it('레일 자리가 없으면 null(옛 셸)', () => {
    document.body.innerHTML = ''
    render(<Probe />); expect(host).toBeNull()
  })
})

describe('RightRail — 점유자 하나·병치/오버레이', () => {
  let api: ReturnType<typeof useRightRail> | null = null
  function Api() { api = useRightRail(); return null }
  it('하나를 열면 다른 하나는 닫힌다, beforeSwitch 가 거절하면 그대로', () => {
    render(<RightRailProvider><Api /></RightRailProvider>)
    act(() => api!.open('inspector')); expect(api!.occupant).toBe('inspector')
    act(() => api!.open('ai', { beforeSwitch: () => false })); expect(api!.occupant).toBe('inspector')
    act(() => api!.open('ai')); expect(api!.occupant).toBe('ai')
    act(() => api!.close('inspector')); expect(api!.occupant).toBe('ai')     // 남의 점유는 닫지 않는다
    act(() => api!.close()); expect(api!.occupant).toBeNull()
  })
  it('넓으면 complementary 열(비모달), 좁으면 dialog(aria-modal) — Esc 로 닫힘', () => {
    document.body.innerHTML = '<div id="app-rail"></div>'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    let closed = 0
    const { unmount } = render(<RightRail occupant="ai" title="도우미" sidebarWidth={232} onClose={() => { closed += 1 }}><button>안</button></RightRail>)
    const side = document.querySelector('#app-rail [role="complementary"]')
    expect(side?.getAttribute('aria-label')).toBe('도우미')
    unmount()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 })
    render(<RightRail occupant="ai" title="도우미" sidebarWidth={232} onClose={() => { closed += 1 }}><button>안</button></RightRail>)
    const dlg = document.querySelector('#app-rail [role="dialog"]') as HTMLElement
    expect(dlg.getAttribute('aria-modal')).toBe('true')
    expect(dlg.contains(document.activeElement)).toBe(true)
    act(() => { dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(closed).toBe(1)
  })
})

describe('RightRail 첫 커밋(U2b-2 충실도 리뷰 Z6·Z11)', () => {
  it('열린 첫 커밋에 본문이 붙는다 — 그 커밋의 효과가 입력창 ref 를 본다(한 커밋 늦게 그리지 않는다)', () => {
    document.body.innerHTML = '<div id="app-rail"></div>'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    let seenInEffect: HTMLElement | null = null
    // 부모(AssistantChat 꼴)의 효과는 레일이 열린 첫 커밋에 한 번 돈다 — 그때 본문이 DOM 에 있어야 입력 초점·맨 아래 스크롤이 된다
    function Parent() {
      useLayoutEffectLike(() => { seenInEffect = document.querySelector('#app-rail textarea') }, [])
      return <RightRail occupant="ai" title="도우미" sidebarWidth={232} onClose={() => {}}><textarea /></RightRail>
    }
    render(<Parent />)
    expect(seenInEffect).not.toBeNull()
  })
  it('오버레이 첫 초점은 입력창([data-autofocus])이지 머리의 버튼(대화 초기화)이 아니다', () => {
    document.body.innerHTML = '<div id="app-rail"></div>'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 })
    render(<RightRail occupant="ai" title="도우미" sidebarWidth={232} onClose={() => {}} header={<button data-reset>초기화</button>}><textarea data-autofocus /></RightRail>)
    expect((document.activeElement as HTMLElement).hasAttribute('data-autofocus')).toBe(true)
  })
  it('전체 화면도 같은 사이드바 판정 — 1280 오버레이(R4)', () => {
    document.body.innerHTML = '<div data-wbs-fullscreen="open"><div data-rail-host="fullscreen"></div></div><div id="app-rail"></div>'
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    render(<RightRail occupant="ai" title="도우미" sidebarWidth={232} onClose={() => {}}><button>안</button></RightRail>)
    expect(document.querySelector('[data-rail-host="fullscreen"] [role="dialog"]')).not.toBeNull()
  })
})

import { useEffect as useLayoutEffectLike } from 'react'
