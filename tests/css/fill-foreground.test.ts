// 채움 배경 위 흰 글자 금지(D12·계획 판정 Q13) — 새 다크 채움색은 밝아서 흰 글자가 1.7~2.3:1 이다. 채움과 같은 줄에는 *-fg 전경을 쓴다.
// 줄 단위로 본다(채움 유틸 또는 teamStyle( 보간과 text-white 가 한 줄). 허용 목록은 사유와 함께 줄기만 한다.
import { describe, expect, it } from 'vitest'
import { srcFiles } from './lib/cssTokens'

const FILL = /(?<![\w-])(?:[a-z-]+:)*bg-(?:action|brand|success|done|warning|danger|delayed|progress|today|critical|phasebar|pending|accent-secondary|accent-warning|team-[1-5]|category-[1-8])(?![\w-])/
const WHITE = /(?<![\w-])(?:[a-z-]+:)*text-white(?![\w-])/
/** 파일 → [허용 줄 수, 사유] — 남은 BrandMark 는 주인 C 의 UI-2b 이동 커밋이 지운다.
 *  판정은 줄 단위다: 채움 유틸과 text-white 가 여러 줄 className 의 다른 줄에 있으면 못 잡는다(2026-10 현재 src 에 그런 곳 0 — U1b 리뷰 R3 P3) */
export const ALLOW: Record<string, [number, string]> = {
  'src/components/ui/BrandMark.tsx': [1, '주인 C — UI-2b 이동 커밋'],
}

describe('hover 이동 0 — 콘텐츠를 옮기지 않는다(개정 §5.5.6, 스펙 §4.1 끝)', () => {
  it('src 에 hover:(-)translate 가 없다(C 소유 projects/page.tsx 는 UI-2b 이동 커밋 — 로그인은 과제 14 가 다시 썼다)', () => {
    const LATER = ['src/app/(app)/projects/page.tsx']
    expect(srcFiles(/\.tsx?$/).filter(([f, t]) => !LATER.includes(f) && /hover:-?translate/.test(t)).map(([f]) => f)).toEqual([])
  })
})

describe('채움 + text-white 0(D12)', () => {
  const hits = new Map<string, number>()
  for (const [f, text] of srcFiles(/\.tsx?$/)) {
    const n = text.split('\n').filter((l) => WHITE.test(l) && (FILL.test(l) || l.includes('teamStyle('))).length
    if (n) hits.set(f, n)
  }
  it('허용 목록 밖에서 0줄', () => {
    expect([...hits].filter(([f]) => !(f in ALLOW)).map(([f, n]) => `${f}: ${n}줄`)).toEqual([])
  })
  it('허용 목록의 줄 수는 적힌 수 이하이고, 0이 된 파일은 목록에서 뺀다', () => {
    for (const [f, [max]] of Object.entries(ALLOW)) {
      expect(hits.get(f) ?? 0, f).toBeLessThanOrEqual(max)
      expect(hits.get(f) ?? 0, `${f} 는 0줄 — 목록에서 뺀다`).toBeGreaterThan(0)
    }
  })
})
