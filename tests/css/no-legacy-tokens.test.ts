// 옛 색 토큰 별칭 0건(SP3b UI-6, 개정 §5.5.7·§5.12.5 SP9 ③). 별칭 25개는 2026-10-09 에 의미 토큰 이름으로 일괄 개명되고
// globals.css 의 `@theme inline` 별칭 블록이 지워졌다. Tailwind 는 없는 유틸을 오류 없이 버린다 — 옛 이름이 다시 들어오면
// 그 요소는 조용히 색을 잃는다. 판정은 개명에 쓴 정규식(scripts/codemod-legacy-tokens.mjs) 그대로다.
import { describe, expect, it } from 'vitest'
import { LEGACY_ALIASES, LEGACY_UTIL, LEGACY_VAR, rewrite } from '../../scripts/codemod-legacy-tokens.mjs'
import { readGlobals, semanticNames, srcFiles, tokenMaps } from './lib/cssTokens'

const OLD = Object.keys(LEGACY_ALIASES)
const hits = (text: string): string[] => [...text.matchAll(LEGACY_UTIL), ...text.matchAll(LEGACY_VAR)].map((m) => m[0])

describe('옛 별칭 이름 0건', () => {
  it('별칭은 25개이고 새 이름은 전부 @theme 의 의미 토큰이다(옛 이름과 겹치지 않는다 — 개명이 멱등)', () => {
    const names = semanticNames()
    expect(OLD).toHaveLength(25)
    for (const [old, target] of Object.entries(LEGACY_ALIASES)) {
      expect(names, old).toContain(target)
      expect(OLD, target).not.toContain(target)
    }
  })
  it('globals.css 에 별칭 선언이 없다(@theme inline 블록도 없다)', () => {
    const css = readGlobals()
    for (const old of OLD) expect(css, old).not.toMatch(new RegExp(`--color-${old}\\s*:`))
    expect(tokenMaps().inline).toEqual([])
  })
  it('src 에 옛 이름의 색 유틸·--color-* 참조가 없다', () => {
    expect(srcFiles().flatMap(([f, t]) => hits(t).map((h) => `${f} ${h}`))).toEqual([])
  })
})

describe('판정기가 살아 있다 — 모양별 표본', () => {
  it('유틸의 색 자리만 잡는다(변형·불투명도·방향 변·임의 변수)', () => {
    expect(hits("text-ink hover:text-ink-muted/50 dark:border-t-line !bg-brand-weak ring-offset-brand accent-brand 'divide-line'")).toEqual(
      ['text-ink', 'text-ink-muted', 'border-t-line', 'bg-brand-weak', 'ring-offset-brand', 'accent-brand', 'divide-line'])
    expect(hits('text-(--color-ink) shadow-[0_0_0_2px_var(--color-brand)] fill="var(--color-delayed)"')).toEqual(['--color-ink', '--color-brand', '--color-delayed'])
  })
  it('무관한 유틸·식별자·낱말은 잡지 않는다', () => {
    expect(hits('line-clamp-2 underline outline leading-6 inline-grid grid grid-cols-2 timeline lineHeight data-done eslint-disable-next-line')).toEqual([])
    expect(hits("const line = done ? brand : ink; status === 'delayed'; 'surface-2' text-fg border-border bg-surface-zebra --color-border-input")).toEqual([])
    expect(hits('text-ink-${tone} text-inkwell xtext-ink my-text-ink')).toEqual([])
  })
  it('개명 결과 — 긴 이름 먼저, accent 접두와 accent-* 별칭을 구분한다', () => {
    const r = rewrite('text-ink text-ink-muted border-line-strong accent-ink text-accent-ink bg-zebra/40 var(--color-grid-strong)')
    expect(r.out).toBe('text-fg text-fg-secondary border-border-input accent-fg text-action bg-surface-zebra/40 var(--color-border-input)')
    expect(rewrite(r.out).out).toBe(r.out)
  })
})
