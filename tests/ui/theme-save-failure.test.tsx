// @vitest-environment jsdom
// 테마 서버 저장이 실패해도 로컬 적용(클래스·localStorage·쿠키)은 그대로이고 경고가 남는다(SP3b 스펙 §4.8, U1c 리뷰 R1 P2).
// debouncedSave 를 mock 하지 않는다 — 실제 /api/prefs POST 경로가 실패하는 모양을 본다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ThemeProvider, useTheme, type ThemeContextValue } from '@/components/providers/ThemeProvider'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let seen: ThemeContextValue
function Probe() { seen = useTheme(); return null }
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear(); document.cookie = 'dflow-theme=; max-age=0; path=/'; document.documentElement.classList.remove('dark')
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('테마 저장 실패', () => {
  it.each([
    ['500 응답', async () => ({ ok: false, status: 500 }) as Response, /500/],
    ['네트워크 실패', async () => { throw new TypeError('Failed to fetch') }, /Failed to fetch/],
  ])('%s — 다크는 그대로, 경고 한 줄', async (_n, impl, pattern) => {
    const fetchMock = vi.fn(impl)
    vi.stubGlobal('fetch', fetchMock)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await act(async () => root.render(<ThemeProvider><Probe /></ThemeProvider>))
    await act(async () => seen.setPreference('dark'))
    await act(async () => { await vi.advanceTimersByTimeAsync(600); for (let i = 0; i < 5; i++) await Promise.resolve() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('dflow-theme')).toBe('dark')
    expect(document.cookie).toMatch(/dflow-theme=dark/)
    expect(seen.preference).toBe('dark')
    expect(warn.mock.calls.map((c) => c.join(' ')).join('\n')).toMatch(pattern)
  })
})
