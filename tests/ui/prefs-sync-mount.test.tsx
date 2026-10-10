// @vitest-environment jsdom
// PrefsSync 배선 — 제품이 라이트 전용이 된 뒤(2026-10-10) 옛 테마 선호가 어디에 남아 있어도(서버 행·localStorage·쿠키·OS 설정)
// 화면을 어둡게 만들거나 서버로 되돌아가지 않는지를 실제 마운트로 본다. computePrefsSync 단위 테스트는 이 배선을 보지 못한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ queueUiPref: vi.fn() }))
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: mocks.queueUiPref }))

import { PrefsSync } from '@/components/app/PrefsSync'
import type { UiPrefs } from '@/lib/domain/types'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  localStorage.clear(); document.cookie = 'dflow-theme=; max-age=0; path=/'; document.documentElement.className = ''
  mocks.queueUiPref.mockClear()
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals() })
const mount = async (server: UiPrefs) => { await act(async () => root.render(<PrefsSync server={server} />)) }
const sentKeys = () => mocks.queueUiPref.mock.calls.flatMap(([p]) => Object.keys(p ?? {}))

describe('PrefsSync 마운트 — 옛 테마 선호는 읽지도 쓰지도 않는다', () => {
  it('서버 행에 theme: dark 가 남아 있어도 <html> 에 dark 를 달지 않고 서버로 theme 을 보내지 않는다', async () => {
    await mount({ theme: 'dark' } as unknown as UiPrefs)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(sentKeys()).not.toContain('theme')
  })
  it('옛 탭이 남긴 localStorage·쿠키의 dark 와 OS 다크가 겹쳐도 같다', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }))
    localStorage.setItem('dflow-theme', 'dark'); document.cookie = 'dflow-theme=dark; path=/'
    await mount({})
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(sentKeys()).not.toContain('theme')
  })
  it('사이드바 접힘은 그대로 백필한다(남은 동기화 키)', async () => {
    await mount({})
    expect(mocks.queueUiPref).toHaveBeenCalledWith({ sidebarCollapsed: false })
  })
})
