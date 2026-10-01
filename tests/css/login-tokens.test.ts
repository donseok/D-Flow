// 로그인은 토큰을 하나도 쓰지 않았다 — 별칭 전환이 아무 영향이 없었다(스펙 E14). 다시 쓴 뒤의 고정(스펙 §4.4, 판정 Q21).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(process.cwd(), 'src/app/login/page.tsx'), 'utf8')
const smoke = readFileSync(join(process.cwd(), 'scripts/smoke-prod.mjs'), 'utf8')

describe('로그인 — 의미 토큰만', () => {
  it('hex·rgb(a)·흰 배경·흰 글자·방사 그라데이션이 없다', () => {
    expect(page).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(page).not.toMatch(/rgba?\(/)
    expect(page).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border)-white\b/)
    expect(page).not.toMatch(/radial-gradient|linear-gradient/)
  })
  it('h1 은 하나다(브레이크포인트마다 하나씩 두지 않는다)', () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1)
  })
  it('부유 장식을 지웠다 — globals 의 login-float·loginFloat 도 없고 smoke 하한은 이유와 함께 4', () => {
    expect(page).not.toMatch(/login-float/)
    expect(readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')).not.toMatch(/loginFloat|login-float/)
    expect(smoke).toMatch(/keyframes: 4,/)
  })
})
