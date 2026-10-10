// smoke:prod 의 토큰 블록 존재 검사. 다크·인쇄 재정의 블록 검사는 라이트 전용 결정(2026-10-10)으로 블록과 함께 지웠다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = readFileSync(join(process.cwd(), 'scripts/smoke-prod.mjs'), 'utf8')
const re = (name: string): RegExp => {
  const m = src.match(new RegExp(`const ${name} = (/.+/[a-z]*)\\n`))
  expect(m, name).not.toBeNull()
  return new Function(`return ${m![1]}`)() as RegExp
}

describe('smoke:prod — 다크·인쇄 재정의 검사는 없다(라이트 전용)', () => {
  it('지운 블록을 요구하지 않는다 — 남아 있으면 배포 스모크가 늘 실패한다', () => {
    expect(src).not.toMatch(/DARK_BLOCK_RE|PRINT_BLOCK_RE/)
  })
})

// UI-1 최종 리뷰 N2 — 라이트 의미 토큰은 전부 원색 :root(--p-*) 하나를, 층·조작 높이·반경·모션은 비색 :root 하나를 거친다.
// 그 블록이 규칙 경계에서 깔끔하게 빠지면(07-27형) 하한 검사를 통과한 채 전체 색 또는 겹침·높이가 무너진다.
describe('smoke:prod — 원색·비색 :root 블록(N2)', () => {
  const prim = re('ROOT_PRIMITIVE_RE')
  const nonColor = re('ROOT_NONCOLOR_RE')
  it('빌드 산출 모양을 알아본다', () => {
    expect(prim.test('}:root{color-scheme:light;--p-gray-0:#fff;--p-gray-25:#f4f6fa}')).toBe(true)
    expect(nonColor.test('}:root{--z-sticky:20;--z-modal:150;--z-toast:200;--control-h:36px;--radius-control:8px}')).toBe(true)
  })
  it('블록이 없거나 다른 블록의 선언만 있으면 잡는다', () => {
    expect(prim.test('}:root{--font-sans:x;--color-red-50:oklch(1 0 0)}')).toBe(false)
    expect(prim.test('}.x{--p-gray-0:#fff}')).toBe(false)
    expect(nonColor.test('}:root{--z-modal:150}.y{--control-h:36px}')).toBe(false)
  })
  it('검사가 실제로 실패로 이어진다(bad)', () => {
    expect(src).toMatch(/ROOT_PRIMITIVE_RE\.test\(css\)\) ok\([^)]*\)\s*\n\s*else bad\(/)
    expect(src).toMatch(/ROOT_NONCOLOR_RE\.test\(css\)\) ok\([^)]*\)\s*\n\s*else bad\(/)
  })
  it('커스텀 프로퍼티 하한은 라이트 전용으로 줄어든 CSS(약 −160 선언)에 맞춰 내렸다 — 옛 하한 480 이면 정상 배포가 실패한다', () => {
    const m = src.match(/customProps:\s*([\d_]+)/)
    const floor = Number(m![1].replace(/_/g, ''))
    expect(floor).toBeGreaterThanOrEqual(300)
    expect(floor).toBeLessThanOrEqual(400)
  })
})
