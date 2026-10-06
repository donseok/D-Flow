// 테마 정책(SP3b 스펙 D10·§4.2, 계획 판정 Q23) — 선호(system|light|dark|null)와 해석값(light|dark)을 가른다.
// no-flash 스크립트 문자열·ThemeProvider·PrefsSync 가 같은 상수와 규칙을 쓴다. 서버·클라이언트가 함께 import 한다('use client'·server-only 없음).
// 미설정(null)의 해석은 THEME_UNSET_DEFAULT 하나가 정한다 — SP9 가 'system' 으로 바꾼다(E16). 고른 값만 저장한다(백필 없음).
export type ThemePref = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'
export const THEME_KEY = 'dflow-theme'
export const THEME_UNSET_DEFAULT: ThemePref = 'system'
export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark']
export const isThemePref = (v: unknown): v is ThemePref => v === 'system' || v === 'light' || v === 'dark'

export function resolveTheme(pref: ThemePref | null, systemDark: boolean): ResolvedTheme {
  const p = pref ?? THEME_UNSET_DEFAULT
  return p === 'system' ? (systemDark ? 'dark' : 'light') : p
}

/** localStorage → 쿠키. 값이 없거나 형식 밖이면 null(미설정). 저장소 예외(사파리 사생활 모드 등)는 다음 원천으로 넘어간다 */
export function readStoredPreference(): ThemePref | null {
  try { const v = window.localStorage.getItem(THEME_KEY); if (isThemePref(v)) return v } catch { /* 저장소 없음 */ }
  try { const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_KEY}=([^;]+)`)); if (m && isThemePref(m[1])) return m[1] } catch { /* 쿠키 없음 */ }
  return null
}

/** OS 다크 여부 — matchMedia 가 없으면(jsdom·옛 브라우저) false */
export function systemPrefersDark(): boolean {
  try { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

/**
 * 페인트 전에 <html> 에 dark 를 붙이는 스크립트 — readStoredPreference·resolveTheme 과 같은 규칙을 문자열로 쓴다.
 * 함수 toString 으로 만들지 않는다(빌드 변환 헬퍼가 섞인다). 동치는 tests/lib/theme-policy.test.ts 의 40조합이 본다.
 */
export function noFlashScript(): string {
  const K = JSON.stringify(THEME_KEY)
  const D = JSON.stringify(THEME_UNSET_DEFAULT)
  return `(function(){var K=${K},D=${D};function ok(v){return v==='system'||v==='light'||v==='dark'}var p=null;`
    + `try{var s=localStorage.getItem(K);if(ok(s))p=s}catch(e){}`
    + `if(p===null){try{var m=document.cookie.match(new RegExp('(?:^|; )'+K+'=([^;]+)'));if(m&&ok(m[1]))p=m[1]}catch(e){}}`
    + `if(p===null)p=D;var d=p==='dark';`
    + `if(p==='system'){try{d=window.matchMedia('(prefers-color-scheme: dark)').matches}catch(e){d=false}}`
    + `if(d)document.documentElement.classList.add('dark')})();`
}
