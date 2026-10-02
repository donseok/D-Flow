// 컨트롤러 보충 3(UI-2 계획 끝) — 프레즌스 아바타의 흰 글자 대비 3.52:1 이 UI-1 axe 라이트·다크 위반의 최대 원인이었다.
// 글자색을 아바타 배경에 맞춘 전경 짝으로 고르고, 팔레트 전부가 본문 글자 기준(4.5:1)을 넘는지 본다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRESENCE_COLORS, presenceColor, presenceForeground, presenceStyle } from '@/lib/domain/sheetPresence'
import { contrastRatio } from '@/lib/settings/accent'

describe('프레즌스 아바타 전경 짝', () => {
  it('팔레트의 모든 배경에서 전경 대비 4.5:1 이상', () => {
    for (const bg of PRESENCE_COLORS) expect(contrastRatio(presenceForeground(bg), bg), bg).toBeGreaterThanOrEqual(4.5)
  })
  it('흰 글자가 충분한 진한 배경은 흰 글자를 그대로 쓴다', () => {
    expect(presenceForeground('#a142f4')).toBe('#ffffff')
  })
  it('밝은 배경은 어두운 글자', () => {
    expect(presenceForeground('#f9ab00')).not.toBe('#ffffff')
  })
  it('presenceStyle 은 같은 사용자에게 배경·전경 짝을 함께 준다', () => {
    const s = presenceStyle('user-1')
    expect(s.background).toBe(presenceColor('user-1'))
    expect(s.color).toBe(presenceForeground(s.background))
  })
})

// SP4 B-4 리뷰 I3 — 시트가 테마를 따르면서(SP4 B 과제 11) 다크 종이(surface = night-900) 위 위치 링(SheetCell border-2, 팔레트 색 그대로)이
// 비텍스트 대비 3:1(WCAG 1.4.11)에 못 미치는 색이 생겼다(갈색 #7b5e57 ≈ 2.8:1). 다크 종이 값은 globals.css 토큰에서 읽는다(값 사본 금지).
describe('프레즌스 위치 링 — 다크 시트 대비', () => {
  const css = readFileSync('src/app/globals.css', 'utf8')
  const night900 = css.match(/--p-night-900:\s*(#[0-9A-Fa-f]{6})/)?.[1]
  it('다크 surface 는 night-900 이다(이 단언이 보는 배경)', () => {
    expect(night900).toBeDefined()
    expect(css).toMatch(/--color-surface:\s*var\(--p-night-900\)/)
  })
  it.each(PRESENCE_COLORS)('%s — 다크 종이 위 3:1 이상', (c) => {
    expect(contrastRatio(c, night900 as `#${string}`)).toBeGreaterThanOrEqual(3)
  })
})
