// @vitest-environment jsdom
// ThemeProvider 3값(SP3b 스펙 D10·§4.2) — 선호·해석값·ready, system 의 OS 구독, 저장소가 막혀도 쿠키는 쓴다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { ThemeProvider, useTheme, type ThemeContextValue } from '@/components/providers/ThemeProvider'

let seen: ThemeContextValue
function Probe() { seen = useTheme(); return <span>{seen.resolved}</span> }

function fakeMedia(initial: boolean) {
  const listeners = new Set<(e: { matches: boolean }) => void>()
  const mq = { matches: initial, media: '(prefers-color-scheme: dark)',
    addEventListener: vi.fn((_: string, f: (e: { matches: boolean }) => void) => listeners.add(f)),
    removeEventListener: vi.fn((_: string, f: (e: { matches: boolean }) => void) => listeners.delete(f)) }
  vi.stubGlobal('matchMedia', () => mq)
  return { mq, fire: (m: boolean) => { mq.matches = m; for (const f of listeners) f({ matches: m }) } }
}
const cookie = () => document.cookie.match(/(?:^|; )dflow-theme=([^;]+)/)?.[1] ?? null

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear(); document.cookie = 'dflow-theme=; max-age=0; path=/'; document.documentElement.classList.remove('dark')
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueUiPref.mockClear()
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const mount = async () => { await act(async () => root.render(<ThemeProvider><Probe /></ThemeProvider>)) }

describe('ThemeProvider', () => {
  it('서버 렌더는 ready=false·선호 null·해석 light(선호는 클라이언트에만 있다)', () => {
    localStorage.setItem('dflow-theme', 'dark')
    renderToString(<ThemeProvider><Probe /></ThemeProvider>)
    expect(seen).toMatchObject({ preference: null, resolved: 'light', ready: false })
  })
  it('마운트 뒤 저장된 선호를 읽고 ready=true', async () => {
    localStorage.setItem('dflow-theme', 'dark')
    await mount()
    expect(seen).toMatchObject({ preference: 'dark', resolved: 'dark', ready: true })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
  it.each(['light', 'dark', 'system'] as const)('setPreference(%s) — 상태·클래스·localStorage·쿠키·서버', async (p) => {
    fakeMedia(true)
    await mount()
    await act(async () => seen.setPreference(p))
    expect(seen.preference).toBe(p)
    expect(seen.resolved).toBe(p === 'light' ? 'light' : 'dark')
    expect(document.documentElement.classList.contains('dark')).toBe(p !== 'light')
    expect(localStorage.getItem('dflow-theme')).toBe(p)
    expect(cookie()).toBe(p)
    expect(queueUiPref).toHaveBeenLastCalledWith({ theme: p })
  })
  it('system 이면 OS 변경을 따라가고, 다른 선호로 바꾸면 구독을 푼다', async () => {
    const { mq, fire } = fakeMedia(false)
    localStorage.setItem('dflow-theme', 'system')
    await mount()
    expect(seen.resolved).toBe('light')
    await act(async () => fire(true))
    expect(seen.resolved).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    await act(async () => seen.setPreference('light'))
    expect(mq.removeEventListener).toHaveBeenCalled()
    await act(async () => fire(true))
    expect(seen.resolved).toBe('light')
  })
  it('localStorage 쓰기가 던져도 쿠키는 쓰고 로그를 남긴다(현행 결함 — 한 try 라 쿠키를 놓쳤다)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    await act(async () => seen.setPreference('dark'))
    expect(cookie()).toBe('dark')
    expect(warn).toHaveBeenCalled()
    expect(queueUiPref).toHaveBeenLastCalledWith({ theme: 'dark' })
  })
  it('matchMedia 가 없으면 system 은 light 로 해석하고 던지지 않는다', async () => {
    localStorage.setItem('dflow-theme', 'system')
    await mount()
    expect(seen).toMatchObject({ preference: 'system', resolved: 'light', ready: true })
  })
})
