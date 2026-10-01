// 셸 세 파일의 색·층(SP3b 스펙 §4.3·D56, 계획 판정 Q17·Q18·Q32) — 옛 팔레트 점·흰 글자 배지·임의 층이 돌아오지 않게.
// 구조(내비 두 층·전환기)는 UI-2b 가 파일째 다시 쓴다. 이 테스트는 그때 새 셸 테스트로 옮긴다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const FILES = ['src/components/app/Sidebar.tsx', 'src/components/app/HeaderChrome.tsx', 'src/app/(app)/layout.tsx']
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('셸 색·층', () => {
  it.each(FILES)('%s — 팔레트 유틸·흰 글자·z-[…]·sidebar 유틸이 없다', (f) => {
    const t = read(f)
    expect(t).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring)-(?:amber|emerald|rose|sky|slate)-\d{2,3}\b/)
    expect(t).not.toMatch(/\btext-white\b/)
    expect(t).not.toMatch(/\bz-\[/)
    expect(t).not.toMatch(/(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring)-sidebar\b/)
  })
  it('배지 세 계열 — 알림 수 action, 결재(검토) 대기 warning, 채움과 전경이 짝이다(판정 Q17)', () => {
    for (const f of FILES.slice(0, 2)) {
      const t = read(f)
      expect(t, f).toContain("bg: 'bg-action text-action-fg'")
      expect(t, f).toContain("bg: 'bg-warning text-warning-fg'")
    }
  })
  it('스킵 링크는 가장 위 층(--z-skip)이다 — 사다리 값은 global-rule-layers 가 지키고 여기서는 쓰임을 고정한다(U1b 리뷰 R3 P3)', () => {
    expect(read('src/app/(app)/layout.tsx')).toMatch(/href="#main-content"[^>]*\bz-\(--z-skip\)/)
  })
  it('사이드바 상태 점은 상태 토큰(판정 Q18 — WBS STATUS 와 같은 의미)', () => {
    const t = read(FILES[0])
    for (const [k, tone] of [['ready', 'pending'], ['active', 'progress'], ['overdue', 'danger'], ['done', 'success'], ['unknown', 'warning']]) {
      expect(t).toContain(`${k}: { dot: 'bg-${tone}'`)
    }
  })
})
