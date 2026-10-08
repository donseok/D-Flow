// @vitest-environment jsdom
// ProjectPageShell = PageFrame 어댑터(D18·D19) — 스크롤은 main 하나라 안쪽 스크롤 영역이 없고, 컴팩트에서도 머리(h1)를 버리지 않는다.
// 머리(PageHeader)는 모든 뷰포트에서 보이는 h1(스펙 §9 ④).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PageHeader } from '@/components/app/PageHeader'
import { ProjectPageShell } from '@/components/app/ProjectPageShell'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** matchMedia 스텁 — (max-width|max-height) OR 조합 쿼리를 실제 크기로 평가한다. */
function stubViewport(width: number, height: number) {
  vi.stubGlobal('matchMedia', vi.fn((q: string) => ({
    matches: q.split(',').some(part => {
      const mw = part.match(/max-width:\s*(\d+)px/)
      const mh = part.match(/max-height:\s*(\d+)px/)
      if (mw) return width <= Number(mw[1])
      if (mh) return height <= Number(mh[1])
      return false
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
}

describe('ProjectPageShell — PageFrame 어댑터', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })

  it.each([[390, 844], [1280, 720], [1366, 768], [1920, 1080]])('%ix%i 에서도 머리의 h1 을 그린다', async (w, h) => {
    stubViewport(w, h)
    await act(async () => root.render(<ProjectPageShell hero={<PageHeader title="Acme 작업 계획" />}><div>본문</div></ProjectPageShell>))
    const h1 = container.querySelectorAll('h1')
    expect(h1).toHaveLength(1)
    expect(h1[0].textContent).toBe('Acme 작업 계획')
  })

  it('PageHeader 는 숨김 클래스 없이 그린다(조상 포함)', async () => {
    await act(async () => root.render(<PageHeader title="Acme" />))
    let el: Element | null = container.querySelector('h1')
    while (el && el !== container) {
      expect(el.className).not.toMatch(/\bhidden\b|sr-only/)
      el = el.parentElement
    }
  })

  it('안쪽 스크롤 영역이 없다 — 문서형 PageFrame(data-frame="document")', async () => {
    await act(async () => root.render(<ProjectPageShell hero={<PageHeader title="t" />}><div>본문</div></ProjectPageShell>))
    expect(container.querySelector('[data-project-scroll-region]')).toBeNull()
    expect(container.querySelector('[data-frame="document"]')).not.toBeNull()
    expect(container.innerHTML).not.toMatch(/overflow-(?:y-)?auto/)
  })

  it('pinned 는 PageFrame 의 고정 도구 줄(data-frame-toolbar)에, 본문은 data-frame-body 에', async () => {
    await act(async () => root.render(
      <ProjectPageShell hero={<PageHeader title="t" />} pinned={<div data-testid="tools">도구</div>}><div data-testid="body">본문</div></ProjectPageShell>,
    ))
    expect(container.querySelector('[data-frame-toolbar]')!.contains(container.querySelector('[data-testid="tools"]'))).toBe(true)
    expect(container.querySelector('[data-frame-body]')!.contains(container.querySelector('[data-testid="body"]'))).toBe(true)
  })

  it('variant="fill" 은 채움형 프레임(data-frame="fill"), flush 는 아래 여백 0', async () => {
    await act(async () => root.render(<ProjectPageShell variant="fill" flush hero={<PageHeader title="t" />}><div data-testid="b">본문</div></ProjectPageShell>))
    expect(container.querySelector('[data-frame="fill"]')).not.toBeNull()
    const wrap = container.querySelector('[data-testid="b"]')!.parentElement!
    expect(wrap.className).toContain('pb-0')
    expect(wrap.className).toContain('h-full')
  })

  it('문서형 기본 본문은 아래 여백 pb-6(마지막 카드가 바닥에 붙지 않게)', async () => {
    await act(async () => root.render(<ProjectPageShell hero={<PageHeader title="t" />}><div data-testid="b">본문</div></ProjectPageShell>))
    expect(container.querySelector('[data-testid="b"]')!.parentElement!.className).toContain('pb-6')
  })
})
