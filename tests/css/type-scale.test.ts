// 글자 크기 8단계와 12px 미만·uppercase 제거 범위(D14·E22). UI-1 은 공용 클래스 넷과 공용 컴포넌트 다섯만 고친다 —
// 나머지 368건은 그 화면을 만지는 SP 가 지운다(개정 §6.1-4). 과제 15 가 COMPONENTS 를 채운다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readGlobals, stripComments, tokenMaps, topBlocks } from './lib/cssTokens'

export const SCALE: Record<string, [size: string, lineHeight: string, weight?: string]> = {
  title: ['1.5rem', '2rem', '600'], 'title-sm': ['1.375rem', '1.875rem', '600'], section: ['1rem', '1.5rem', '600'], body: ['0.875rem', '1.375rem'],
  control: ['0.875rem', '1.25rem'], meta: ['0.75rem', '1.125rem'], kpi: ['1.75rem', '2.125rem', '600'], doc: ['1rem', '1.625rem'],
}
const SMALL_OR_CAPS = /text-\[(?:9|10|10\.5|11)px\]|\buppercase\b|tracking-\[0\.1\d?em\]|tracking-wide(?:st|r)?\b/
/** 공용 컴포넌트 다섯(D14) */
export const COMPONENTS: string[] = [
  'src/components/ui/KpiCard.tsx', 'src/components/ui/SectionCard.tsx', 'src/components/ui/Modal.tsx', 'src/components/app/InboxPanel.tsx', 'src/components/ui/PageHero.tsx',
]

describe('글자 크기 8단계(@theme)', () => {
  const theme = tokenMaps().theme
  const v = (n: string) => theme.find((d) => d.name === n)?.value
  it.each(Object.entries(SCALE))('text-%s', (name, [size, lh, w]) => {
    expect(v(`--text-${name}`)).toBe(size)
    expect(v(`--text-${name}--line-height`)).toBe(lh)
    expect(v(`--text-${name}--font-weight`)).toBe(w)
  })
})

describe('12px 미만·uppercase·넓은 자간 — 공용 클래스 넷', () => {
  const comps = topBlocks(stripComments(readGlobals())).filter((b) => b.prelude === '@layer components').flatMap((b) => topBlocks(b.body))
  it.each(['.eyebrow', '.chip', '.badge', '.lvl-badge'])('%s', (sel) => {
    const body = comps.find((b) => b.prelude === sel)?.body
    expect(body, `${sel} 규칙이 없다`).toBeDefined()
    expect(body).not.toMatch(SMALL_OR_CAPS)
  })
  // 부정형만으로는 text-[11.5px]·font-size: 11px·크기 유틸 삭제(상속)가 통과한다(U1a 리뷰 R3 P3) — 12px 이상 크기 토큰을 직접 단다
  it.each(['.eyebrow', '.chip', '.badge', '.lvl-badge'])('%s 는 12px 이상 크기 토큰(text-xs·text-meta 이상)을 단다', (sel) => {
    const body = comps.find((b) => b.prelude === sel)?.body ?? ''
    expect(body).toMatch(/(?:^|\s)text-(?:xs|meta|sm|control|body|base)(?:\s|;|$)/)
    expect(body).not.toMatch(/text-\[|font-size\s*:/)
  })
  it.each(COMPONENTS.map((f) => [f]))('공용 컴포넌트 %s', (f) => {
    expect(readFileSync(join(process.cwd(), f), 'utf8')).not.toMatch(SMALL_OR_CAPS)
  })
})
