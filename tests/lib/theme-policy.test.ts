// @vitest-environment jsdom
// 테마 정책과 no-flash 스크립트(SP3b 스펙 D10·§4.2·§8.1 ⑨) — 스크립트 문자열과 TS 규칙이 같은 결과를 내는지 40조합으로 본다.
// 현행 결함 둘을 막는다: localStorage 가 던지면 쿠키를 안 읽던 것, 'dark' 만 알아듣던 것.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { THEME_KEY, THEME_PREFS, THEME_UNSET_DEFAULT, isThemePref, noFlashScript, readStoredPreference, resolveTheme } from '@/lib/theme/policy'

const setCookie = (v: string | null) => {
  document.cookie = v === null ? `${THEME_KEY}=; max-age=0; path=/` : `${THEME_KEY}=${v}; path=/`
}
const stubOs = (dark: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: dark && q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }))
const runScript = () => {
  document.documentElement.classList.remove('dark')
  new Function(noFlashScript())()
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

beforeEach(() => { localStorage.clear(); setCookie(null); document.documentElement.classList.remove('dark') })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('resolveTheme·isThemePref', () => {
  it('미설정은 THEME_UNSET_DEFAULT(SP9 전 light), system 은 OS 를 따른다', () => {
    expect(THEME_UNSET_DEFAULT).toBe('light')
    expect(resolveTheme(null, true)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })
  it('선호 값은 닫힌 셋', () => {
    expect(THEME_PREFS).toEqual(['system', 'light', 'dark'])
    expect(['system', 'light', 'dark'].every(isThemePref)).toBe(true)
    expect([null, undefined, 'purple', 'Dark', 1].some(isThemePref)).toBe(false)
  })
})

describe('noFlashScript — 페인트 전 규칙', () => {
  it('미설정 → light(OS 다크여도 — SP9 전)', () => { stubOs(true); expect(runScript()).toBe('light') })
  it('system + OS 다크 → dark', () => { stubOs(true); localStorage.setItem(THEME_KEY, 'system'); expect(runScript()).toBe('dark') })
  it('localStorage 가 던지면 쿠키를 읽는다(현행 결함)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    setCookie('dark')
    expect(runScript()).toBe('dark')
  })
  it('형식 밖 localStorage 값은 건너뛰고 쿠키로', () => { localStorage.setItem(THEME_KEY, 'purple'); setCookie('dark'); expect(runScript()).toBe('dark') })
  it('matchMedia 가 없으면 system 은 light 이고 던지지 않는다', () => { localStorage.setItem(THEME_KEY, 'system'); expect(runScript()).toBe('light') })
  // 우선순위는 절대값으로 고정한다 — 40조합은 '스크립트 = TS 규칙'만 보므로 둘이 함께 쿠키를 먼저 읽게 바뀌어도 초록이다(U1c 리뷰 R2 P3)
  it('localStorage 가 쿠키보다 먼저다 — LS light + 쿠키 dark → light, LS dark + 쿠키 light → dark', () => {
    stubOs(true)
    localStorage.setItem(THEME_KEY, 'light'); setCookie('dark')
    expect(readStoredPreference()).toBe('light')
    expect(runScript()).toBe('light')
    localStorage.setItem(THEME_KEY, 'dark'); setCookie('light')
    expect(readStoredPreference()).toBe('dark')
    expect(runScript()).toBe('dark')
  })
  it('40조합 — 스크립트 결과 = resolveTheme(readStoredPreference(), OS)', () => {
    const LS = [null, 'light', 'dark', 'system', 'THROW'] as const
    const CK = [null, 'light', 'dark', 'system'] as const
    let n = 0
    for (const ls of LS) for (const ck of CK) for (const os of [false, true]) {
      vi.restoreAllMocks()
      localStorage.clear()
      setCookie(ck)
      stubOs(os)
      if (ls === 'THROW') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
      else if (ls !== null) localStorage.setItem(THEME_KEY, ls)
      const osDark = os
      expect(runScript(), `${ls}/${ck}/${os}`).toBe(resolveTheme(readStoredPreference(), osDark))
      n++
    }
    expect(n).toBe(40)
  })
  it('루트 레이아웃은 이 스크립트를 쓴다(옛 문자열이 남지 않는다)', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/layout.tsx'), 'utf8')
    expect(layout).toContain('noFlashScript()')
    expect(layout).not.toContain("localStorage.getItem('dflow-theme')")
  })
})
