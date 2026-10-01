// smoke:prod 의 테마 블록 존재 검사(U1b 리뷰 R2 P3·수정 G7) — 셸·표면이 이제 .dark 재정의 하나에 기대므로 .dark 나
// @media print 블록이 통째로 빠지면(07-27형 구간 소실) 다크·인쇄가 조용히 라이트 화면이 된다. 커스텀 프로퍼티 하한은 그 손실을 넘긴다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(process.cwd(), 'scripts/smoke-prod.mjs'), 'utf8')
const re = (name: string): RegExp => {
  const m = src.match(new RegExp(`const ${name} = (/.+/[a-z]*)\\n`))
  expect(m, name).not.toBeNull()
  return new Function(`return ${m![1]}`)() as RegExp
}

describe('smoke:prod — .dark·@media print 블록', () => {
  const dark = re('DARK_BLOCK_RE')
  const print = re('PRINT_BLOCK_RE')
  it('빌드 산출 모양을 알아본다', () => {
    expect(dark.test(':root{--a:1}.dark{color-scheme:dark;--color-canvas:var(--p-night-950);--color-surface:var(--p-night-900)}')).toBe(true)
    expect(print.test('@media print{.dark,:root{color-scheme:light;--color-surface:var(--p-gray-0);--color-fg:var(--p-gray-900)}}')).toBe(true)
  })
  it('블록이 없거나 다른 블록의 선언만 있으면 잡는다', () => {
    expect(dark.test(':root{--color-surface:#fff}.darkish{--x:1}')).toBe(false)
    expect(dark.test('.dark{--shadow-modal:0 0 #000}')).toBe(false)
    expect(print.test(':root{--color-fg:#000}@media print{.x{display:none}}')).toBe(false)
  })
  it('검사가 실제로 실패로 이어진다(bad)', () => {
    expect(src).toMatch(/DARK_BLOCK_RE\.test\(css\)\) ok\([^)]*\)\s*\n\s*else bad\(/)
    expect(src).toMatch(/PRINT_BLOCK_RE\.test\(css\)\) ok\([^)]*\)\s*\n\s*else bad\(/)
  })
})
