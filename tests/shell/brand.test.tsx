import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { accentStyle } from '@/lib/settings/accentCss'
import { BrandSlot } from '@/components/app/BrandSlot'

const set = (c: string) => ({ bg: c, fg: '#ffffff', hover: c, pressed: c, soft: '#eef2ff', focus: c })
describe('accentStyle — D23', () => {
  it('여섯 값이 모두 소문자 hex 면 :root 한 블록 — 다크 블록은 없다(라이트 전용 2026-10-10)', () => {
    const css = accentStyle({ light: set('#2244aa') })
    expect(css).toMatch(/^:root\{[^{}]*\}$/)
    expect(css).not.toContain('.dark')
    expect(css).toContain('--color-action:#2244aa'); expect(css).toContain('--color-border-focus:#2244aa')
  })
  it('하나라도 아니면 빈 문자열 — 주입 문자열(;}·</style>)을 내지 않는다', () => {
    expect(accentStyle({ light: { ...set('#2244aa'), soft: 'red;}' } })).toBe('')
    expect(accentStyle({ light: { ...set('#2244aa'), fg: '</style><script>' } })).toBe('')
    expect(accentStyle({ light: set('#2244AA') })).toBe('')     // 대문자도 거부(저장 형식은 소문자)
    expect(accentStyle(null)).toBe(''); expect(accentStyle(undefined)).toBe('')
  })
  it('옛 저장값의 dark 세트가 따라와도 내지 않는다 — 내용이 주입 문자열이어도 무시된다', () => {
    const legacy = { light: set('#2244aa'), dark: { ...set('#8899ff'), soft: 'red;}</style>' } } as never
    expect(accentStyle(legacy)).toBe(accentStyle({ light: set('#2244aa') }))
  })
})

describe('BrandSlot(★8, D24)', () => {
  it('전체 로고는 한 장 — 다크 로고·배경판·테마 클래스가 없다(라이트 전용 2026-10-10)', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: 'w1', hasFull: true, hasMark: true }} compact={false} />)
    expect(html.match(/<img /g)).toHaveLength(1)
    expect(html).toContain('/api/brand/w1/full')
    expect(html).not.toContain('/api/brand/w1/full_dark')
    expect(html).not.toMatch(/brand-logo-|data-logo-plate/)
  })
  it('접힘·좁은 바는 마크 28×28', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: 'w1', hasFull: true, hasMark: true }} compact />)
    expect(html).toContain('/api/brand/w1/mark'); expect(html).not.toContain('/api/brand/w1/full')
  })
  it('로고가 없으면 모노그램(워크스페이스 id 없음도 같은 길)', () => {
    const html = renderToString(<BrandSlot brand={{ productName: 'Acme', workspaceId: null, hasFull: true, hasMark: true }} compact={false} />)
    expect(html).not.toContain('/api/brand/')
  })
})
