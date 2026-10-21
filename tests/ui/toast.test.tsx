// @vitest-environment jsdom
// 토스트의 링크(action) — 등록 뒤 「작업 계획에서 보기」처럼 다음 화면으로 가는 길을 토스트에 단다(회의록 → WBS 계획 "설계와의 차이").
// 링크가 있는 토스트는 읽고 누를 틈을 주려고 8,000ms 뒤 닫히고(없는 토스트는 그대로 3,500ms), 초점이 안에 있는 동안은 닫히지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, type MouseEvent, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ t: (k: string) => k }),
}))
// next/link 대역 — 실제 Link 처럼 onClick 을 부르고 기본 이동은 막는다(jsdom 은 페이지 이동을 못 한다)
vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: ReactNode; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) => (
    <a href={href} {...rest} onClick={e => { onClick?.(e); e.preventDefault() }}>{children}</a>
  ),
}))

import { ToastProvider, useToast } from '@/components/ui/Toast'

describe('Toast — 링크(action)', () => {
  let container: HTMLDivElement, root: Root
  let api: ReturnType<typeof useToast>
  function Grab() { api = useToast(); return null }

  beforeEach(async () => {
    vi.useFakeTimers()
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<ToastProvider><Grab /></ToastProvider>))
  })
  afterEach(() => {
    act(() => root.unmount()); container.remove()
    vi.useRealTimers()
  })

  const cards = () => [...container.querySelectorAll('[role="status"]')]
  const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
  const LINKED = { title: 'min.wbs.created', variant: 'success' as const, action: { label: 'min.wbs.viewInPlan', href: '/p/p1/wbs?focus=w1' } }

  it('action 이 있으면 <a href> 가 그려지고(누를 수 있게 pointer-events-auto) 8,000ms 뒤 닫힌다', () => {
    act(() => api.toast(LINKED))
    const link = container.querySelector<HTMLAnchorElement>('a[href="/p/p1/wbs?focus=w1"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toBe('min.wbs.viewInPlan')
    expect(link!.className.split(/\s+/)).toContain('pointer-events-auto')
    expect(cards()[0].textContent).toContain('min.wbs.created')
    wait(3500)
    expect(cards()).toHaveLength(1)   // 기본 지연(3,500ms)으로는 닫히지 않는다
    wait(4499)
    expect(cards()).toHaveLength(1)
    wait(1)
    expect(cards()).toHaveLength(0)
  })

  it('action 이 없으면 링크 없이 3,500ms 뒤 닫힌다(기존 그대로)', () => {
    act(() => api.toast({ title: 'min.share.copied' }))
    expect(container.querySelector('a')).toBeNull()
    wait(3499)
    expect(cards()).toHaveLength(1)
    wait(1)
    expect(cards()).toHaveLength(0)
  })

  it('링크를 누르면 토스트를 닫는다 — 옮겨 간 화면에 남지 않게', () => {
    act(() => api.toast(LINKED))
    const link = container.querySelector<HTMLAnchorElement>('a[href="/p/p1/wbs?focus=w1"]')!
    act(() => link.click())
    expect(cards()).toHaveLength(0)
  })

  it('초점이 안에 있으면 마우스가 들어왔다 나가도, 다른 토스트가 오가도 닫히지 않는다 — 초점이 떠나야 다시 센다', () => {
    act(() => api.toast(LINKED))
    const card = cards()[0]
    const link = container.querySelector<HTMLAnchorElement>('a[href="/p/p1/wbs?focus=w1"]')!
    act(() => link.focus())
    // 마우스가 지나간다 — 초점이 남아 있으니 멈춤도 남는다
    act(() => { card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })) })
    act(() => { card.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })) })
    wait(10_000)
    expect(cards()).toHaveLength(1)
    // 다른 토스트가 와서 제 시간에 닫힌다 — 공급자가 다시 그려져도 초점 있는 토스트의 멈춤은 풀리지 않는다
    act(() => api.toast({ title: 'min.share.copied' }))
    expect(cards()).toHaveLength(2)
    wait(3500)
    expect(cards()).toHaveLength(1)
    expect(cards()[0].textContent).toContain('min.wbs.created')
    wait(20_000)
    expect(cards()).toHaveLength(1)
    act(() => link.blur())
    wait(7999)
    expect(cards()).toHaveLength(1)
    wait(1)
    expect(cards()).toHaveLength(0)
  })

  it('다른 토스트가 와도 먼저 뜬 토스트의 시간을 처음부터 다시 세지 않는다', () => {
    act(() => api.toast({ title: 'min.share.copied' }))
    wait(2000)
    act(() => api.toast({ title: 'min.share.copyFailed', variant: 'error' }))
    wait(1500)   // 첫 토스트는 3,500ms 째 — 닫힌다
    expect(cards().map(c => c.textContent)).toEqual([expect.stringContaining('min.share.copyFailed')])
    wait(2000)   // 둘째는 3,500ms 째
    expect(cards()).toHaveLength(0)
  })

  it('초점이 토스트 안에 있는 동안은 닫히지 않고, 초점이 떠나면 다시 8,000ms 를 센다', () => {
    act(() => api.toast(LINKED))
    const link = container.querySelector<HTMLAnchorElement>('a[href="/p/p1/wbs?focus=w1"]')!
    act(() => link.focus())
    wait(20_000)
    expect(cards()).toHaveLength(1)
    act(() => link.blur())
    wait(7999)
    expect(cards()).toHaveLength(1)
    wait(1)
    expect(cards()).toHaveLength(0)
  })
})
