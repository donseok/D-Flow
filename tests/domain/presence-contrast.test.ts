// 컨트롤러 보충 3(UI-2 계획 끝) — 프레즌스 아바타의 흰 글자 대비 3.52:1 이 UI-1 axe 라이트·다크 위반의 최대 원인이었다.
// 글자색을 아바타 배경에 맞춘 전경 짝으로 고르고, 팔레트 전부가 본문 글자 기준(4.5:1)을 넘는지 본다.
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
