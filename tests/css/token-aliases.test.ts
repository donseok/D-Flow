// 옛 토큰 이름의 별칭 표와 지운 이름 0건(SP3b 스펙 §4.1 블록 4·개정 §5.5.5, 계획 Review Focus 1).
// Tailwind 는 없는 유틸을 오류 없이 버린다 — 지운 이름이 소스에 남으면 그 요소는 조용히 색을 잃는다.
import { describe, expect, it } from 'vitest'
import { readGlobals, semanticNames, srcFiles, tokenMaps } from './lib/cssTokens'

/** 옛 이름 → 새 의미 토큰(35) */
export const ALIASES: Record<string, string> = {
  'surface-2': 'surface-subtle', line: 'border', 'line-strong': 'border-input', ink: 'fg', 'ink-muted': 'fg-secondary', 'ink-subtle': 'fg-muted',
  brand: 'action', 'brand-hover': 'action-hover', 'brand-weak': 'action-soft', 'brand-fg': 'action-fg', 'brand-ring': 'border-focus',
  'accent-secondary': 'warning', 'accent-ink': 'action', 'accent-warning': 'warning', done: 'success', 'done-weak': 'success-weak',
  delayed: 'danger', 'delayed-weak': 'danger-weak', grid: 'border', 'grid-strong': 'border-input', 'sheet-head': 'surface-subtle', zebra: 'surface-zebra',
  'hero-ink': 'fg', 'hero-ink-muted': 'fg-secondary', 'hero-line': 'border',
  ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [[`team-${n}`, `category-${n}`], [`team-${n}-weak`, `category-${n}-weak`]])),
}
/** 이행 중(@theme inline 의 hex) — 과제 10 이 사이드바 마크업과 함께 지우고 이 목록을 비운다 */
export const TRANSITIONAL = ['sidebar', 'sidebar-2', 'sidebar-3', 'sidebar-line', 'sidebar-ink', 'sidebar-ink-muted', 'sidebar-ink-subtle']
/** 지운 이름 — 유틸(접두 뒤)·var() 어디에도 없다. 과제마다 늘어난다(Review Focus 1) */
export const DELETED_TOKENS = ['hero-from', 'hero-via', 'hero-to', 'sheet-gutter']
const UTIL = '(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|decoration|placeholder|shadow|accent|caret)'

describe('별칭 표(@theme inline)', () => {
  const m = tokenMaps()
  const names = semanticNames(m)
  it('@theme inline 의 이름 = 별칭 35 + 이행 중 목록', () => {
    expect(m.inline.map((d) => d.name.slice('--color-'.length)).sort()).toEqual([...Object.keys(ALIASES), ...TRANSITIONAL].sort())
  })
  it('별칭은 var(--color-<새 의미 토큰>) 하나이고 대상은 @theme 에 있다', () => {
    for (const [old, target] of Object.entries(ALIASES)) {
      expect(m.inline.find((d) => d.name === `--color-${old}`)?.value, old).toBe(`var(--color-${target})`)
      expect(names, old).toContain(target)
    }
  })
  it('옛 이름을 의미 층에 다시 두지 않는다', () => {
    expect(names.filter((n) => n in ALIASES || TRANSITIONAL.includes(n))).toEqual([])
  })
})

describe('지운 이름 0건', () => {
  const css = readGlobals()
  it.each(DELETED_TOKENS)('globals.css 에 --color-%s 선언이 없다', (n) => { expect(css).not.toContain(`--color-${n}:`) })
  it('src 에 지운 토큰의 유틸·var() 가 없다', () => {
    const re = new RegExp(`(?:${UTIL}-(?:${DELETED_TOKENS.join('|')})\\b|var\\(--color-(?:${DELETED_TOKENS.join('|')})\\))`)
    expect(srcFiles().filter(([, text]) => re.test(text)).map(([f]) => f)).toEqual([])
  })
})
