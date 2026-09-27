import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// 라이트 테마 본문 텍스트 조합이 WCAG AA(4.5:1)를 넘는지 — 토큰 값을 바꿀 때 회귀를 잡는다(다크는 이후 디자인 시스템 SP).
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
const start = css.indexOf('@theme {')
const theme = css.slice(start, css.indexOf('}', start))
const token = (name: string): string => {
  const m = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)
  if (!m) throw new Error(`토큰 없음: ${name}`)
  return m[1]
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

const PAIRS: [string, string][] = [
  ['ink-subtle', 'canvas'], ['ink-subtle', 'surface'], ['ink-subtle', 'surface-2'], ['ink-subtle', 'sheet-head'],
  ['ink-subtle', 'weekend'], ['ink-subtle', 'holiday-band'],
  ['pending', 'pending-weak'], ['pending', 'canvas'], ['pending', 'surface'],
  ['sidebar-ink-subtle', 'sidebar'], ['sidebar-ink-subtle', 'sidebar-2'], ['sidebar-ink-subtle', 'sidebar-3'],
]
describe('라이트 토큰 대비 — 본문 텍스트 4.5:1', () => {
  it.each(PAIRS)('%s on %s', (fg, bg) => { expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5) })
  it('로그인 화면에 옛 보조 글자 하드코딩(#7a6f68)이 없다', () => {
    expect(readFileSync(join(process.cwd(), 'src/app/login/page.tsx'), 'utf8')).not.toMatch(/#7a6f68/i)
  })
  it('간트 주말·휴일 날짜 라벨은 반투명 위험색을 쓰지 않는다', () => {
    expect(readFileSync(join(process.cwd(), 'src/components/wbs/WbsGanttSheet.tsx'), 'utf8')).not.toContain('text-delayed/70')
  })
})
