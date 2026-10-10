// @vitest-environment jsdom
// 화면 테마 3단 라디오와 /account 화면 구역(사용자 결정 #21, SP3b 스펙 §4.2·D10·§8.1 ⑨).
// 하이드레이션 판정은 두 수집기가 필요하다 — 속성 불일치는 act 뒤 한 틱에 console.error, 텍스트 불일치는 onRecoverableError(map-dark D-11).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, hydrateRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ queueUiPref: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: mocks.queueUiPref }))
vi.mock('@/components/providers/LocaleProvider', () => ({
  useLocale: () => ({ locale: 'ko',
    t: (k: string) => ({ 'chrome.theme': '화면 테마', 'chrome.themeSystem': '시스템', 'chrome.themeLight': '라이트', 'chrome.themeDark': '다크', 'chrome.display': '화면' } as Record<string, string>)[k] ?? k }),
}))
vi.mock('@/components/account/MyTokensSection', () => ({ MyTokensSection: () => null }))
vi.mock('@/components/account/ChangePasswordModal', () => ({ ChangePasswordModal: () => null }))

import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { ThemeRadioGroup } from '@/components/account/ThemeRadioGroup'
import { AccountView } from '@/components/account/AccountView'

let container: HTMLDivElement
let root: Root | null
beforeEach(() => {
  localStorage.clear(); document.cookie = 'dflow-theme=; max-age=0; path=/'; document.documentElement.classList.remove('dark')
  mocks.queueUiPref.mockClear()
  container = document.createElement('div'); document.body.appendChild(container); root = null
})
afterEach(() => { if (root) act(() => root!.unmount()); container.remove(); vi.restoreAllMocks() })

const radios = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="화면 테마"] [role="radio"]')]
const checked = () => radios().find((r) => r.getAttribute('aria-checked') === 'true')?.textContent
const tick = () => new Promise((r) => setTimeout(r, 20))

describe('ThemeRadioGroup', () => {
  async function mount() {
    root = createRoot(container)
    await act(async () => root!.render(<ThemeProvider><ThemeRadioGroup /></ThemeProvider>))
  }
  it('radiogroup 에 시스템·라이트·다크 셋, 저장된 선호가 선택된다', async () => {
    localStorage.setItem('dflow-theme', 'dark')
    await mount()
    expect(radios().map((r) => r.textContent)).toEqual(['시스템', '라이트', '다크'])
    expect(checked()).toBe('다크')
    expect(radios().filter((r) => r.tabIndex === 0)).toHaveLength(1)
  })
  it('미설정이면 마운트 뒤 기본값(system)을 선택으로 보이되 저장하지 않는다(판정 Q23)', async () => {
    await mount()
    expect(checked()).toBe('시스템')
    expect(mocks.queueUiPref).not.toHaveBeenCalled()
    expect(localStorage.getItem('dflow-theme')).toBeNull()
  })
  it('방향키는 이동과 동시에 선택하고(→·↓ 다음, ←·↑ 이전, Home·End), 초점이 따라간다', async () => {
    localStorage.setItem('dflow-theme', 'light')
    await mount()
    const key = async (k: string) => { await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })) }) }
    radios()[1].focus()
    await key('ArrowRight')
    expect(checked()).toBe('다크')
    expect(document.activeElement?.textContent).toBe('다크')
    await key('ArrowRight')
    expect(checked()).toBe('시스템')
    await key('End')
    expect(checked()).toBe('다크')
    await key('ArrowUp')
    expect(checked()).toBe('라이트')
    expect(mocks.queueUiPref).toHaveBeenLastCalledWith({ theme: 'light' })
  })
  it('클릭은 선택 + 저장(3값)', async () => {
    await mount()
    await act(async () => radios()[0].click())
    expect(checked()).toBe('시스템')
    expect(mocks.queueUiPref).toHaveBeenLastCalledWith({ theme: 'system' })
  })
})

describe('하이드레이션 — 첫 렌더는 선택 없음 + aria-busy, 경고 0(D10)', () => {
  it('서버 HTML 을 저장된 선호가 있는 브라우저에서 hydrate 해도 경고가 없고, 마운트 뒤 선택된다', async () => {
    const html = renderToString(<ThemeProvider><ThemeRadioGroup /></ThemeProvider>)
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('aria-checked="true"')
    localStorage.setItem('dflow-theme', 'dark')
    container.innerHTML = html
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a) })
    await act(async () => { root = hydrateRoot(container, <ThemeProvider><ThemeRadioGroup /></ThemeProvider>, { onRecoverableError: (e) => errors.push(e) }) })
    await tick()
    expect(errors).toEqual([])
    expect(checked()).toBe('다크')
    expect(container.querySelector('[role="radiogroup"]')!.hasAttribute('aria-busy')).toBe(false)
    spy.mockRestore()
  })
  it('대조 — 첫 렌더에 선택을 그리면 판정기가 불일치를 잡는다(판정기가 살아 있다)', async () => {
    function Bad() {
      const [v] = useState(() => (typeof window === 'undefined' ? null : localStorage.getItem('dflow-theme')))
      return <div role="radio" aria-checked={v === 'dark'} />
    }
    const html = renderToString(<Bad />)
    localStorage.setItem('dflow-theme', 'dark')
    container.innerHTML = html
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a) })
    await act(async () => { root = hydrateRoot(container, <Bad />, { onRecoverableError: (e) => errors.push(e) }) })
    await tick()
    expect(errors.length).toBeGreaterThan(0)
    spy.mockRestore()
  })
})

describe('/account 화면 구역', () => {
  async function mountAccount() {
    root = createRoot(container)
    await act(async () => root!.render(<ThemeProvider><AccountView email="alice@example.com" displayName="alice" projects={[]} /></ThemeProvider>))
  }
  it('화면 구역에는 테마 3단만 있다 — 언어 선택은 없다(제품은 한국어 전용, 2026-10-10 결정)', async () => {
    await mountAccount()
    const section = container.querySelector('[data-account-display]')!
    expect([...section.querySelectorAll('h2, [data-account-label]')].map((e) => e.textContent)).toEqual(['화면', '화면 테마'])
    expect([...section.querySelectorAll('[role="radiogroup"]')].map((g) => g.getAttribute('aria-label'))).toEqual(['화면 테마'])
    expect(container.querySelector('[data-locale-option]')).toBeNull()
  })
})
