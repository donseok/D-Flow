import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { accentStyle } from '@/lib/settings/accentCss'
import { BrandSlot } from '@/components/app/BrandSlot'

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

describe('BrandSlot(★8, D24)', () => {
  it('전체 로고 둘은 두 클래스, display 유틸 없음, 다크 로고가 없으면 배경판', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: 'w1', hasFull: true, hasFullDark: false, hasMark: true }} compact={false} />)
    expect(html).toContain('/api/brand/w1/full')
    expect(html).not.toContain('/api/brand/w1/full_dark')
    expect(html).toMatch(/class="[^"]*brand-logo-light[^"]*"/)
    expect(html).not.toMatch(/class="[^"]*brand-logo-(?:light|dark)[^"]*\b(?:hidden|block|flex|inline|inline-flex|grid)\b/)
    expect(html).toContain('data-logo-plate')
  })
  it('다크 로고가 있으면 두 장, 배경판 없음', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: 'w1', hasFull: true, hasFullDark: true, hasMark: false }} compact={false} />)
    expect(html).toContain('/api/brand/w1/full_dark'); expect(html).toMatch(/class="[^"]*brand-logo-dark[^"]*"/)
    expect(html).not.toContain('data-logo-plate')
  })
  it('접힘·좁은 바는 마크 28×28', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: 'w1', hasFull: true, hasFullDark: true, hasMark: true }} compact />)
    expect(html).toContain('/api/brand/w1/mark'); expect(html).not.toContain('/api/brand/w1/full')
  })
  it('로고가 없으면 모노그램(워크스페이스 id 없음도 같은 길)', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: null, hasFull: true, hasFullDark: true, hasMark: true }} compact={false} />)
    expect(html).not.toContain('/api/brand/')
  })
})
