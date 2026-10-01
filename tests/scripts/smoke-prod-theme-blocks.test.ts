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

// UI-1 최종 리뷰 N2 — 라이트 의미 토큰은 전부 원색 :root(--p-*) 하나를, 층·조작 높이·반경·모션은 비색 :root 하나를 거친다.
// 그 블록이 규칙 경계에서 깔끔하게 빠지면(07-27형) 하한·.dark·print 검사를 모두 통과한 채 라이트·다크 전체 색 또는 겹침·높이가 무너진다.
describe('smoke:prod — 원색·비색 :root 블록(N2)', () => {
  const prim = re('ROOT_PRIMITIVE_RE')
  const nonColor = re('ROOT_NONCOLOR_RE')
  it('빌드 산출 모양을 알아본다', () => {
    expect(prim.test('}:root{color-scheme:light;--p-gray-0:#fff;--p-gray-25:#f5f7fa}')).toBe(true)
    expect(nonColor.test('}:root{--z-sticky:20;--z-modal:150;--z-toast:200;--control-h:36px;--radius-control:8px}')).toBe(true)
  })
  it('블록이 없거나 다른 블록의 선언만 있으면 잡는다', () => {
    // 인쇄 블록의 .dark,:root{color-scheme:light;…} 는 원색이 없다 — 원색 블록으로 치지 않는다
    expect(prim.test('@media print{.dark,:root{color-scheme:light;--color-surface:var(--p-gray-0)}}')).toBe(false)
    expect(prim.test('}:root{--font-sans:x;--color-red-50:oklch(1 0 0)}')).toBe(false)
    expect(prim.test('}.x{--p-gray-0:#fff}')).toBe(false)
    expect(nonColor.test('}:root{--z-modal:150}.y{--control-h:36px}')).toBe(false)
    expect(nonColor.test('}.dark{--shadow-modal:0 0 #000;--z-modal:150;--control-h:36px}')).toBe(false)
  })
  it('검사가 실제로 실패로 이어진다(bad)', () => {
    expect(src).toMatch(/ROOT_PRIMITIVE_RE\.test\(css\)\) ok\([^)]*\)\s*\n\s*else bad\(/)
    expect(src).toMatch(/ROOT_NONCOLOR_RE\.test\(css\)\) ok\([^)]*\)\s*\n\s*else bad\(/)
  })
  it('커스텀 프로퍼티 하한은 UI-1 실측(616)에 맞춰 올렸다 — UI-0 비율(380/493 ≈ 0.77) 근처', () => {
    const m = src.match(/customProps:\s*([\d_]+)/)
    const floor = Number(m![1].replace(/_/g, ''))
    expect(floor).toBeGreaterThanOrEqual(470)
    expect(floor).toBeLessThanOrEqual(490)
  })
})
