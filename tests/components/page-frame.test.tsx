// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PageFrame } from '@/components/app/PageFrame'
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const cleanups: (() => void)[] = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })
function render(el: ReactNode): HTMLDivElement {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(el))
  cleanups.push(() => { act(() => root.unmount()); host.remove() })
  return host
}

describe('PageFrame', () => {
  it('문서형 — 세로 overflow 없음, 도구 줄 sticky, --frame-sticky-top 기본 0px', () => {
    const container = render(<PageFrame header={<h1>t</h1>} toolbar={<div>도구</div>}>본문</PageFrame>)
    const root = container.firstElementChild as HTMLElement
    expect(root.dataset.frame).toBe('document')
    expect(root.className).not.toMatch(/overflow-(y-)?auto/)
    expect(root.style.getPropertyValue('--frame-sticky-top')).toBe('0px')
    expect(container.querySelector('[data-frame-toolbar]')?.className).toMatch(/\bsticky\b/)
    expect(container.querySelector('[data-frame-toolbar]')?.className).toContain('z-(--z-sticky)')
  })
  // 도구 줄은 py-2 라 contentRect(내용 상자)는 테두리 상자보다 16px 작다 — 그 값을 쓰면 페이지 안 고정 요소가 도구 줄 아래 16px 에 숨는다(과제 33 측정)
  it('--frame-sticky-top 은 도구 줄의 테두리 상자 높이(contentRect 아님)', () => {
    let cb: ResizeObserverCallback | null = null
    vi.stubGlobal('ResizeObserver', class { constructor(c: ResizeObserverCallback) { cb = c } observe() {} disconnect() {} unobserve() {} })
    cleanups.push(() => vi.unstubAllGlobals())
    const container = render(<PageFrame header={<h1>t</h1>} toolbar={<div>도구</div>}>본문</PageFrame>)
    const root = container.firstElementChild as HTMLElement
    const bar = container.querySelector('[data-frame-toolbar]') as HTMLElement
    act(() => cb!([{ target: bar, contentRect: { height: 27 } as DOMRectReadOnly, borderBoxSize: [{ blockSize: 42.4, inlineSize: 800 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver))
    expect(root.style.getPropertyValue('--frame-sticky-top')).toBe('43px')
    // borderBoxSize 가 없는 엔진 — 요소의 테두리 상자 높이로
    bar.getBoundingClientRect = () => ({ height: 50 } as DOMRect)
    act(() => cb!([{ target: bar, contentRect: { height: 34 } as DOMRectReadOnly } as unknown as ResizeObserverEntry], {} as ResizeObserver))
    expect(root.style.getPropertyValue('--frame-sticky-top')).toBe('50px')
  })
  // BB4 — 초점이 도구 줄 뒤로 숨지 않게: 스크롤 상자(main)의 scroll-padding-top 이 도구 줄 높이 + 8 을 따른다. 요소의 scroll-margin 은
  // 크로미움의 초점 스크롤이 따르지 않았다(실측 — qa/sp3b/u2-bb/measure-bb4.json)
  it('도구 줄이 있으면 감싼 main 에 --main-scroll-pad(테두리 높이 + 8px)를 쓰고, 사라지면 지운다', () => {
    let cb: ResizeObserverCallback | null = null
    vi.stubGlobal('ResizeObserver', class { constructor(c: ResizeObserverCallback) { cb = c } observe() {} disconnect() {} unobserve() {} })
    cleanups.push(() => vi.unstubAllGlobals())
    const main = document.createElement('main'); document.body.appendChild(main)
    const root = createRoot(main)
    act(() => root.render(<PageFrame header={<h1>t</h1>} toolbar={<div>도구</div>}>본문</PageFrame>))
    const bar = main.querySelector('[data-frame-toolbar]') as HTMLElement
    act(() => cb!([{ target: bar, contentRect: { height: 27 } as DOMRectReadOnly, borderBoxSize: [{ blockSize: 42.4, inlineSize: 800 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver))
    expect(main.style.getPropertyValue('--main-scroll-pad')).toBe('51px')
    act(() => root.unmount())
    expect(main.style.getPropertyValue('--main-scroll-pad')).toBe('')
    main.remove()
  })
  it('채움형 — data-frame="fill", 본문 min-h-0 flex-1', () => {
    const container = render(<PageFrame variant="fill" header={<h1>t</h1>}>본문</PageFrame>)
    const root = container.firstElementChild as HTMLElement
    expect(root.dataset.frame).toBe('fill')
    expect(container.querySelector('[data-frame-body]')?.className).toMatch(/min-h-0 flex-1/)
    // main 의 첫 자식(위 간격 자리) 뒤 남은 높이를 쓴다 — h-full 만이면 그 간격·열화 알림만큼 넘쳐 main(overflow hidden)이 바닥을 자른다
    expect(root.className.split(' ')).toContain('flex-1')
  })
  it('폭 — portal 1440·doc 760·form 800·full 제한 없음', () => {
    const w = (width: 'portal' | 'doc' | 'form' | 'full') => (render(<PageFrame width={width} header={null}>x</PageFrame>).firstElementChild as HTMLElement).className
    expect(w('portal')).toContain('max-w-[1440px]'); expect(w('doc')).toContain('max-w-[760px]'); expect(w('form')).toContain('max-w-[800px]')
    expect(w('full')).not.toContain('max-w-')
  })
})
