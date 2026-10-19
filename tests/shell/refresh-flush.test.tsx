// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from './_dom'
import { RefreshFlush } from '@/components/app/RefreshFlush'

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async () => new Response('ok'))) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('RSC 응답 후 갱신 보정', () => {
  it('미리 읽기와 일반 API 응답은 화면을 깨우는 타이머를 만들지 않는다', async () => {
    const r = render(<RefreshFlush />)
    await act(async () => {
      await fetch('/p/a/wbs', { headers: { rsc: '1', 'next-router-prefetch': '1' } })
      await fetch('/api/shell')
    })
    expect(vi.getTimerCount()).toBe(0)
    r.unmount()
  })

  it('중첩 RSC 응답의 타이머는 합치고 저장 응답의 보정·언마운트 정리를 유지한다', async () => {
    const original = window.fetch
    const r = render(<RefreshFlush />)
    await act(async () => {
      await fetch('/account', { headers: { 'next-action': 'save' } })
      await fetch('/account', { headers: { rsc: '1' } })
    })
    expect(vi.getTimerCount()).toBe(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(vi.getTimerCount()).toBe(0)
    r.unmount()
    expect(window.fetch).toBe(original)
  })
})
