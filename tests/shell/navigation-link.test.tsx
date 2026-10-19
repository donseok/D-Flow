// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from './_dom'

const h = vi.hoisted(() => ({ prefetch: false }))
vi.mock('next/link', () => ({ default: ({ prefetch, children, ...rest }: { prefetch: boolean; children: React.ReactNode }) => {
  h.prefetch = prefetch
  return <a {...rest}>{children}</a>
} }))
import { NavigationLink } from '@/components/app/NavigationLink'

beforeEach(() => { vi.useFakeTimers(); h.prefetch = false })
afterEach(() => vi.useRealTimers())

describe('메뉴 목적지 미리 읽기', () => {
  it('메뉴가 보이는 것만으로는 조회하지 않고, 잠시 가리킨 목적지만 본문까지 읽는다', async () => {
    const r = render(<NavigationLink href="/w/acme/projects">프로젝트</NavigationLink>)
    const link = r.container.querySelector('a')!
    expect(h.prefetch).toBe(false)
    act(() => link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(async () => { await vi.advanceTimersByTimeAsync(119) })
    expect(h.prefetch).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(h.prefetch).toBe(true)
    act(() => link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    expect(h.prefetch).toBe(false)
  })

  it('짧게 스쳐간 메뉴는 조회하지 않고 키보드 초점에서는 즉시 읽는다', async () => {
    const r = render(<NavigationLink href="/w/acme/projects">프로젝트</NavigationLink>)
    const link = r.container.querySelector('a')!
    act(() => { link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); link.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(h.prefetch).toBe(false)
    act(() => link.focus())
    expect(h.prefetch).toBe(true)
  })

  it('현재 페이지는 미리 조회하지 않고 클릭 동작을 유지한다', () => {
    const click = vi.fn((e: React.MouseEvent) => e.preventDefault())
    const r = render(<NavigationLink href="/w/acme/projects" aria-current="page" onClick={click}>프로젝트</NavigationLink>)
    const link = r.container.querySelector('a')!
    act(() => link.focus())
    expect(h.prefetch).toBe(false)
    fireEvent.click(link)
    expect(click).toHaveBeenCalledTimes(1)
  })
})
