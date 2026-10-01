'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { queueUiPref } from '@/lib/prefs/debouncedSave'
import {
  THEME_KEY, THEME_UNSET_DEFAULT, readStoredPreference, resolveTheme, systemPrefersDark, type ResolvedTheme, type ThemePref,
} from '@/lib/theme/policy'

/**
 * 테마 — 선호(system|light|dark|null)와 해석값(light|dark)을 따로 낸다(SP3b 스펙 D10, 계획 판정 Q23).
 * 선호는 클라이언트(localStorage → 쿠키)에만 있어 서버가 모른다 — 첫 렌더는 ready=false(선택 표시를 하지 않는다).
 * <html> 의 dark 클래스는 no-flash 스크립트가 페인트 전에 붙이고, 마운트 뒤에는 이 공급자가 해석값으로 맞춘다.
 */
export type ThemeContextValue = {
  preference: ThemePref | null
  resolved: ResolvedTheme
  ready: boolean
  setPreference: (p: ThemePref) => void
}

const ThemeCtx = createContext<ThemeContextValue>({ preference: null, resolved: 'light', ready: false, setPreference: () => {} })

const applyClass = (r: ResolvedTheme) => document.documentElement.classList.toggle('dark', r === 'dark')

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPref] = useState<ThemePref | null>(null)
  const [systemDark, setSystemDark] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setPref(readStoredPreference())
    setSystemDark(systemPrefersDark())
    setReady(true)
  }, [])

  const resolved = resolveTheme(preference, systemDark)
  const effective = preference ?? THEME_UNSET_DEFAULT

  // 유효 선호가 system 일 때만 OS 변경을 구독한다 — 다른 선호로 바꾸면 해제된다
  useEffect(() => {
    if (!ready || effective !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [ready, effective])

  useEffect(() => { if (ready) applyClass(resolved) }, [ready, resolved])

  const setPreference = useCallback((p: ThemePref) => {
    setPref(p)
    const os = systemPrefersDark()
    setSystemDark(os)
    applyClass(resolveTheme(p, os))
    // 저장소 둘은 따로 시도한다 — localStorage 가 막혀도(사파리 사생활 모드) 쿠키는 쓴다. 서버 저장 실패는 로컬 적용을 되돌리지 않는다(스펙 §4.8)
    try { window.localStorage.setItem(THEME_KEY, p) } catch (e) { console.warn('[theme] localStorage 저장 실패 — 쿠키만 쓴다:', e instanceof Error ? e.message : e) }
    try { document.cookie = `${THEME_KEY}=${p};path=/;max-age=31536000;samesite=lax` } catch (e) { console.error('[theme] 쿠키 저장 실패:', e instanceof Error ? e.message : e) }
    queueUiPref({ theme: p })
  }, [])

  const value = useMemo(() => ({ preference, resolved, ready, setPreference }), [preference, resolved, ready, setPreference])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
