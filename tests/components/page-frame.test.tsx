// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
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
  it('채움형 — data-frame="fill", 본문 min-h-0 flex-1', () => {
    const container = render(<PageFrame variant="fill" header={<h1>t</h1>}>본문</PageFrame>)
    const root = container.firstElementChild as HTMLElement
    expect(root.dataset.frame).toBe('fill')
    expect(container.querySelector('[data-frame-body]')?.className).toMatch(/min-h-0 flex-1/)
  })
  it('폭 — portal 1440·doc 760·form 800·full 제한 없음', () => {
    const w = (width: 'portal' | 'doc' | 'form' | 'full') => (render(<PageFrame width={width} header={null}>x</PageFrame>).firstElementChild as HTMLElement).className
    expect(w('portal')).toContain('max-w-[1440px]'); expect(w('doc')).toContain('max-w-[760px]'); expect(w('form')).toContain('max-w-[800px]')
    expect(w('full')).not.toContain('max-w-')
  })
})
