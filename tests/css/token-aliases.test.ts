// 옛 토큰 이름의 별칭 표와 지운 이름 0건(SP3b 스펙 §4.1 블록 4·개정 §5.5.5, 계획 Review Focus 1).
// Tailwind 는 없는 유틸을 오류 없이 버린다 — 지운 이름이 소스에 남으면 그 요소는 조용히 색을 잃는다.
import { describe, expect, it } from 'vitest'
import { readGlobals, semanticNames, srcFiles, tokenMaps } from './lib/cssTokens'

/** 옛 이름 → 새 의미 토큰(25 — SP4 B 가 팀 별칭 열을 지웠다) */
export const ALIASES: Record<string, string> = {
  'surface-2': 'surface-subtle', line: 'border', 'line-strong': 'border-input', ink: 'fg', 'ink-muted': 'fg-secondary', 'ink-subtle': 'fg-muted',
  brand: 'action', 'brand-hover': 'action-hover', 'brand-weak': 'action-soft', 'brand-fg': 'action-fg', 'brand-ring': 'border-focus',
  'accent-secondary': 'warning', 'accent-ink': 'action', 'accent-warning': 'warning', done: 'success', 'done-weak': 'success-weak',
  delayed: 'danger', 'delayed-weak': 'danger-weak', grid: 'border', 'grid-strong': 'border-input', 'sheet-head': 'surface-subtle', zebra: 'surface-zebra',
  'hero-ink': 'fg', 'hero-ink-muted': 'fg-secondary', 'hero-line': 'border',
}
/** 이행 중(@theme inline 의 hex) — 과제 10 이 사이드바 마크업과 함께 지웠다(비어 있어야 한다) */
export const TRANSITIONAL: string[] = []
/** 지운 이름 — 유틸(접두 뒤)·var() 어디에도 없다. 과제마다 늘어난다(Review Focus 1) */
export const DELETED_TOKENS = ['hero-from', 'hero-via', 'hero-to', 'sheet-gutter', 'sidebar', 'sidebar-2', 'sidebar-3', 'sidebar-line', 'sidebar-ink', 'sidebar-ink-muted', 'sidebar-ink-subtle',
  // SP4 B — 팀 화면 색은 category-N 슬롯(teamColor.ts)
  ...[1, 2, 3, 4, 5].flatMap((n) => [`team-${n}`, `team-${n}-weak`])]
/** 지운 클래스(globals.css 규칙과 src 의 사용 모두 0) — 과제 8·9·14 가 더한다 */
export const DELETED_CLASSES = ['app-backdrop', 'kpi-tile', 'btn-accent', 'login-float-1', 'login-float-2', 'login-float-3', 'login-float-4']
/** 지운 비색 변수(선언과 var() 사용 모두 0) — 과제 8·9·13 이 더한다 */
export const DELETED_VARS = ['--gradient-secondary', '--gradient-surface', '--shadow-glow', '--ring-soft', '--gradient-accent', '--color-accent-fg', '--gradient-dark']
const UTIL = '(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|decoration|placeholder|shadow|accent|caret)'

describe('별칭 표(@theme inline)', () => {
  const m = tokenMaps()
  const names = semanticNames(m)
  it('@theme inline 의 이름 = 별칭 25 + 이행 중 목록', () => {
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

describe('지운 클래스·비색 변수 0건', () => {
  const css = readGlobals()
  it.each(DELETED_CLASSES)('.%s — globals.css 규칙과 src 사용이 없다', (c) => {
    expect(css).not.toMatch(new RegExp(`\\.${c}\\b`))
    expect(srcFiles().filter(([, t]) => new RegExp(`\\b${c}\\b`).test(t)).map(([f]) => f)).toEqual([])
  })
  it.each(DELETED_VARS)('%s — 선언과 var() 사용이 없다', (v) => {
    expect(css).not.toContain(`${v}:`)
    expect(srcFiles().filter(([, t]) => t.includes(`var(${v})`)).map(([f]) => f)).toEqual([])
  })
})

// 정의되지 않은 토큰 이름 0건(UI-1 최종 리뷰 N4). 지운 이름 목록(위)은 "알고 있는 이름"만 막는다 — 오타·상상 이름(`bg-surface-1`)도
// Tailwind 가 오류 없이 버려 그 요소는 조용히 색을 잃는다. 토큰 계열 접두로 시작하는 색 유틸 이름은 globals.css 가 선언한
// --color-* 이름 집합 안에 있어야 한다. Tailwind 기본 팔레트(neutral-100 같은 숫자 단계)는 no-raw-color 가 따로 본다.
const FAMILIES = 'surface|fg|action|success|warning|danger|progress|pending|neutral|today|critical|phasebar|plan|category|canvas|weekend|holiday|border|brand|accent|ink|line|done|delayed|grid|team|hero|zebra|sheet'
const COLOR_UTIL = new RegExp(`(?<![\\w-])(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|decoration|placeholder|caret|accent)-((?:${FAMILIES})(?:-[a-z0-9]+)*)(?![\\w$\\{-])`, 'g')

export function unknownTokenUtils(text: string, defined: Set<string>): string[] {
  return [...text.matchAll(COLOR_UTIL)].filter((m) => !/^neutral-\d+$/.test(m[1]) && !defined.has(m[1])).map((m) => m[0])
}
/** var(--x) 의 x 가 globals.css 에도, src 의 선언(CSS `--x:` · 인라인 style 키 `'--x':` · `setProperty('--x'`)에도 없으면 그 값은 조용히 무효다 */
export function undefinedVars(files: [string, string][], declared: Set<string>): string[] {
  const local = new Set(files.flatMap(([, t]) => [
    ...[...t.matchAll(/(?:^|[\s{;'"])(--[\w-]+)['"]?\s*:/gm)].map((m) => m[1]),
    ...[...t.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1]),
  ]))
  return files.flatMap(([f, t]) => [...t.matchAll(/var\(\s*(--[\w-]+)/g)].filter((m) => !declared.has(m[1]) && !local.has(m[1])).map((m) => `${f} ${m[1]}`))
}

describe('정의되지 않은 토큰 이름 0건(N4)', () => {
  const css = readGlobals()
  const defined = new Set([...css.matchAll(/--color-([\w-]+)\s*:/g)].map((m) => m[1]))
  const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))
  const files = srcFiles().filter(([f]) => f !== 'src/app/globals.css')
  it('src 의 토큰 계열 색 유틸은 선언된 --color-* 이름이다', () => {
    expect(files.flatMap(([f, t]) => unknownTokenUtils(t, defined).map((u) => `${f} ${u}`))).toEqual([])
  })
  it('src 의 var(--…) 는 globals.css 또는 src 안에서 선언된 변수다', () => {
    expect(undefinedVars(files, declared)).toEqual([])
  })
  it('판정기가 살아 있다 — 모양별 표본', () => {
    const d = new Set(['surface', 'surface-subtle', 'line', 'action'])
    expect(unknownTokenUtils("'bg-surface-1' 'bg-surface-1/40' hover:text-fg-faint", d)).toEqual(['bg-surface-1', 'bg-surface-1', 'text-fg-faint'])
    expect(unknownTokenUtils('bg-surface-subtle/40 border-line hover:bg-action bg-neutral-100 border-t-2 text-sm', d)).toEqual([])
    expect(unknownTokenUtils('bg-category-${n} text-${tone}', d)).toEqual([])
    expect(undefinedVars([['a.tsx', "accent-[var(--brand)] style={{ '--k': 1 }} w-[var(--k)]"]], new Set())).toEqual(['a.tsx --brand'])
    expect(undefinedVars([['a.module.css', '.x{--m:1;left:var(--m)}']], new Set())).toEqual([])
    expect(undefinedVars([['b.tsx', "el.style.setProperty('--s', '1px'); calc(var(--s, 0px))"]], new Set())).toEqual([])
  })
})
