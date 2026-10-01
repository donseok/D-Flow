import { describe, expect, it } from 'vitest'
import { accentStyle } from '@/lib/settings/accentCss'

const set = (c: string) => ({ bg: c, fg: '#ffffff', hover: c, pressed: c, soft: '#eef2ff', focus: c })
describe('accentStyle — D23', () => {
  it('두 세트 열두 값이 모두 소문자 hex 면 :root 다음 .dark', () => {
    const css = accentStyle({ light: set('#2244aa'), dark: set('#8899ff') })
    expect(css.indexOf(':root{')).toBe(0)
    expect(css.indexOf('.dark{')).toBeGreaterThan(css.indexOf(':root{'))
    expect(css).toContain('--color-action:#2244aa'); expect(css).toContain('--color-border-focus:#8899ff')
  })
  it('하나라도 아니면 빈 문자열 — 주입 문자열(;}·</style>)을 내지 않는다', () => {
    expect(accentStyle({ light: set('#2244aa'), dark: { ...set('#8899ff'), soft: 'red;}' } })).toBe('')
    expect(accentStyle({ light: { ...set('#2244aa'), fg: '</style><script>' }, dark: set('#8899ff') })).toBe('')
    expect(accentStyle({ light: set('#2244AA'), dark: set('#8899ff') })).toBe('')     // 대문자도 거부(저장 형식은 소문자)
    expect(accentStyle(null)).toBe(''); expect(accentStyle(undefined)).toBe('')
  })
  it('한 세트만 유효해도 빈 문자열(다크에서 라이트 accent 가 .dark 를 덮지 않게)', () => {
    expect(accentStyle({ light: set('#2244aa'), dark: null as never })).toBe('')
  })
})
