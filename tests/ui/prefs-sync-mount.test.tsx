// @vitest-environment jsdom
// PrefsSync 배선(SP3b 스펙 D10, U1c 리뷰 R2 P2) — readLocal 이 DOM 해석값이 아니라 저장된 **선호**를 읽는지를 실제 마운트로 본다.
// 옛 결함: readLocal 이 <html class="dark"> 유무를 로컬 선호로 읽어 미설정 사용자 전원에게 theme:'light' 를 백필했다
// (그러면 SP9 의 "선호 없음 = system" 이 적용될 사용자가 0 이 된다). computePrefsSync 단위 테스트는 theme 을 직접 넣어 이 배선을 보지 못한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ queueUiPref: vi.fn(), setLocale: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: mocks.queueUiPref }))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', setLocale: mocks.setLocale, t: (k: string) => k }) }))

import { ThemeProvider } from '@/components/providers/ThemeProvider'
import { PrefsSync } from '@/components/app/PrefsSync'
import type { UiPrefs } from '@/lib/domain/types'

const stubOs = (dark: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }))
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear(); document.cookie = 'dflow-theme=; max-age=0; path=/'; document.documentElement.classList.remove('dark')
  mocks.queueUiPref.mockClear(); mocks.setLocale.mockClear()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })
const mount = async (server: UiPrefs) => { await act(async () => root.render(<ThemeProvider><PrefsSync server={server} /></ThemeProvider>)) }
const sentThemes = () => mocks.queueUiPref.mock.calls.filter(([p]) => p && 'theme' in p).map(([p]) => p.theme)

describe('PrefsSync + ThemeProvider 마운트', () => {
  it('저장소가 비어 있으면 서버로 theme 을 보내지 않는다(해석값 light 를 백필하지 않는다 — html 이 라이트여도)', async () => {
    stubOs(false)
    await mount({})
    expect(sentThemes()).toEqual([])
    expect(localStorage.getItem('dflow-theme')).toBeNull()
  })
  it('html 에 dark 가 붙어 있어도(앞 페이지 잔상) 저장소가 비면 보내지 않는다', async () => {
    stubOs(false)
    document.documentElement.classList.add('dark')
    await mount({})
    expect(sentThemes()).toEqual([])
  })
  it('서버 system + 로컬 없음 → system 을 적용한다(localStorage = system, OS 다크면 다크)', async () => {
    stubOs(true)
    await mount({ theme: 'system' })
    expect(localStorage.getItem('dflow-theme')).toBe('system')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
  it('로컬 선호가 있고 서버에 없으면 그 선호만 백필한다', async () => {
    stubOs(false)
    localStorage.setItem('dflow-theme', 'system')
    await mount({})
    expect(sentThemes()).toEqual(['system'])
  })
})
