// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
const queueUiPref = vi.fn()
vi.mock('@/lib/prefs/debouncedSave', () => ({ queueUiPref: (...a: unknown[]) => queueUiPref(...(a as [])) }))

import { ThemeProvider, useTheme } from '@/components/providers/ThemeProvider'

function Probe({ to }: { to: 'dark' | 'system' }) {
  const { setPreference } = useTheme()
  return <button onClick={() => setPreference(to)}>go</button>
}

describe('ThemeProvider 서버 쓰기', () => {
  let container: HTMLDivElement, root: Root
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); queueUiPref.mockClear(); localStorage.clear() })
  afterEach(() => { act(() => root.unmount()); container.remove(); document.documentElement.classList.remove('dark') })

  it('테마 변경 시 queueUiPref({theme}) 를 호출한다', async () => {
    await act(async () => root.render(<ThemeProvider><Probe to="dark" /></ThemeProvider>))
    await act(async () => { container.querySelector('button')!.click() })
    expect(queueUiPref).toHaveBeenCalledWith({ theme: 'dark' })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
  it("'system' 도 선호로 저장한다(3값)", async () => {
    await act(async () => root.render(<ThemeProvider><Probe to="system" /></ThemeProvider>))
    await act(async () => { container.querySelector('button')!.click() })
    expect(queueUiPref).toHaveBeenCalledWith({ theme: 'system' })
    expect(localStorage.getItem('dflow-theme')).toBe('system')
  })
})
