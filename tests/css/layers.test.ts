// 떠 있는 층의 z 토큰(SP3b 스펙 D56·§4.5, 계획 판정 Q32) — 모달·토스트·툴팁·보관 챗(모달과 같은 층)은 임의 z-[…] 대신 사다리를 쓴다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')

describe('층 토큰', () => {
  it.each([
    ['src/components/ui/Modal.tsx', 'z-(--z-modal)'],
    ['src/components/ui/Toast.tsx', 'z-(--z-toast)'],
    ['src/components/ui/Tooltip.tsx', 'z-(--z-toast)'],
    ['src/components/minutes/ArchiveChatPanel.tsx', 'z-(--z-modal)'],
  ])('%s — %s, z-[…] 없음', (f, token) => {
    const t = read(f)
    expect(t).toContain(token)
    expect(t).not.toMatch(/\bz-\[/)
  })
  it('모달 등장 전환은 --motion-menu(판정 Q38 — reduced-motion 블록이 덮는다, 중첩은 body 끝 포털의 문서 순서)', () => {
    const t = read('src/components/ui/Modal.tsx')
    expect(t).toContain('duration-(--motion-menu)')
    expect(t).toContain('starting:opacity-0')
    expect(t).toContain('document.body')
  })
  it('페이드는 배경·패널에 따로 건다 — 흐림을 가진 배경의 조상에 opacity 전환을 두면 전환 동안 backdrop-blur 가 꺼진다(U1b 리뷰 R2 P3)', () => {
    const t = read('src/components/ui/Modal.tsx')
    const tag = (re: RegExp) => t.match(re)?.[0] ?? ''
    const root = tag(/<div className="[^"]*\bz-\(--z-modal\)[^"]*"/)
    const backdrop = tag(/<button className="[^"]*\bbackdrop-blur[^"]*"/)
    const panel = tag(/<div ref=\{panelRef\}[^>]*className=\{`[^`]*`\}/)
    expect(root).not.toBe('')
    expect(root).not.toMatch(/starting:opacity|transition-opacity/)
    for (const el of [backdrop, panel]) {
      expect(el).toContain('starting:opacity-0')
      expect(el).toContain('duration-(--motion-menu)')
    }
  })
  it('토스트는 role="status"·aria-live="polite"(스펙 §4.5)', () => {
    const t = read('src/components/ui/Toast.tsx')
    expect(t).toContain('role="status"')
    expect(t).toContain('aria-live="polite"')
  })
})
