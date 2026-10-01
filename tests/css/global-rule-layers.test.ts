// 전역 규칙의 층(SP3b 스펙 D50·§4.1, §8.1 global-rule-layers). unlayered 는 모든 named layer 를 이긴다 —
// :focus-visible 을 @layer base 로 옮기면 outline-none 유틸(24곳)에 포커스 링이 사라지고 빌드·jsdom 어디에서도 안 잡힌다.
import { describe, expect, it } from 'vitest'
import { declsOf, readGlobals, srcFiles, stripComments, topBlocks, tokenMaps, type Block } from './lib/cssTokens'

const css = stripComments(readGlobals())
const top = topBlocks(css)
/** 개정 §5.5.2 원색 34 — 닫힌 집합 */
export const PRIMITIVES = [
  'gray-0', 'gray-25', 'gray-50', 'gray-75', 'gray-100', 'gray-150', 'gray-200', 'gray-400', 'gray-450', 'gray-500', 'gray-600', 'gray-900',
  'night-950', 'night-900', 'night-850', 'night-800', 'night-780', 'night-700',
  'cobalt-50', 'cobalt-300', 'cobalt-400', 'cobalt-450', 'cobalt-600', 'cobalt-700', 'cobalt-800', 'cobalt-900', 'cobalt-950',
  'mint-300', 'mint-700', 'ink-d50', 'ink-d200', 'ink-d300', 'ink-d350', 'ink-d400',
]
const UNLAYERED = [':focus-visible', '::selection', 'body', '*', '.dark', ':root', '@media print', '@media (prefers-reduced-motion: reduce)']

/** 모든 깊이의 블록을 [조상 prelude 목록, 블록] 으로 */
function walkAll(blocks: Block[], parents: string[] = []): [string[], Block][] {
  return blocks.flatMap((b) => [[parents, b] as [string[], Block], ...(/[{]/.test(b.body) ? walkAll(topBlocks(b.body), [...parents, b.prelude]) : [])])
}

describe('전역 규칙은 @layer 밖(D50)', () => {
  it.each(UNLAYERED)('%s 가 최상위(unlayered)에 있다', (sel) => {
    expect(top.some((b) => b.prelude === sel)).toBe(true)
  })
  it('@layer 블록 안에 전역 셀렉터·인쇄·모션 블록이 없다', () => {
    const offenders = top.filter((b) => b.prelude.startsWith('@layer')).flatMap((b) => topBlocks(b.body))
      .filter((inner) => UNLAYERED.includes(inner.prelude) || inner.prelude === 'html,\nbody' || inner.prelude.startsWith('@media print'))
    expect(offenders.map((b) => b.prelude)).toEqual([])
  })
})

describe('원색 --p-*(D11·판정 Q14)', () => {
  const m = tokenMaps()
  it('최상위 :root 에만, 개정 §5.5.2 의 34개와 같다', () => {
    expect(m.primitives.map((d) => d.name.slice(4)).sort()).toEqual([...PRIMITIVES].sort())
    const elsewhere = walkAll(top).filter(([parents, b]) => !(parents.length === 0 && b.prelude === ':root'))
      .flatMap(([, b]) => declsOf(b.body)).filter((d) => d.name.startsWith('--p-'))
    expect(elsewhere).toEqual([])
  })
  it('컴포넌트·페이지는 원색을 직접 참조하지 않는다(src 에 var(--p- 0건)', () => {
    expect(srcFiles(/\.(tsx?)$/).filter(([, t]) => t.includes('var(--p-')).map(([f]) => f)).toEqual([])
  })
})

describe('var(--color-…) 를 값으로 가진 커스텀 프로퍼티의 자리(스펙 §4.1 블록 8, 비평 ui-risk I4)', () => {
  it('@theme inline 안이거나, 선언 셀렉터 목록에 .dark 와 [data-theme-scope] 가 함께 있다', () => {
    const bad = walkAll(top).flatMap(([, b]) => declsOf(b.body).filter((d) => d.value.includes('var(--color-')).map((d) => ({ sel: b.prelude, d })))
      .filter(({ sel }) => sel !== '@theme inline' && !(sel.split(',').map((s) => s.trim()).includes('.dark') && sel.includes('[data-theme-scope]')))
    expect(bad.map(({ sel, d }) => `${sel} ${d.name}`)).toEqual([])
  })
})

describe('비색 토큰 값(스펙 §4.1 블록 6·D56)', () => {
  const m = tokenMaps()
  const val = (n: string) => m.rootOther.find((d) => d.name === n)?.value
  it.each([
    ['--z-sticky', '20'], ['--z-shell', '70'], ['--z-rail', '90'], ['--z-popover', '100'], ['--z-overlay', '110'], ['--z-fullscreen', '120'],
    ['--z-modal', '150'], ['--z-toast', '200'], ['--z-skip', '250'], ['--radius-control', '8px'], ['--radius-panel', '12px'], ['--control-h', '36px'],
    ['--motion-fast', '110ms'], ['--motion-menu', '140ms'], ['--motion-panel', '180ms'], ['--icon-menu', '18px'], ['--icon-toolbar', '16px'],
    ['--shadow-sm', '0 0 #0000'], ['--shadow-md', '0 0 #0000'], ['--shadow-lg', 'var(--shadow-popover)'], ['--shadow-xl', 'var(--shadow-modal)'],
  ])('%s = %s', (n, v) => { expect(val(n)).toBe(v) })
  it('층 사다리는 오름차순이다', () => {
    const z = ['sticky', 'shell', 'rail', 'popover', 'overlay', 'fullscreen', 'modal', 'toast', 'skip'].map((k) => Number(val(`--z-${k}`)))
    expect([...z].sort((a, b) => a - b)).toEqual(z)
  })
  it('옛 --shadow-sm·md 는 "그림자 없음"이되 none 이 아니다 — shadow-[var(--shadow-sm)] 의 box-shadow 쉼표 목록에 none 이 들면 선언 전체가 무효(IACVT)라 같은 요소의 ring 까지 사라진다(U1a 리뷰 R2 P2, Tailwind 의 shadow-none 과 같은 0 0 #0000)', () => {
    for (const n of ['--shadow-sm', '--shadow-md']) expect(val(n)).not.toMatch(/\bnone\b/)
  })
  it('.freeze-edge 그림자는 다크에서 다시 정의된다 — fg(다크에서 밝은 색)를 섞지 않는다(U1a 리뷰 R1 P3)', () => {
    expect(val('--shadow-freeze-edge')).toBeDefined()
    expect(m.dark.find((d) => d.name === '--shadow-freeze-edge')?.value).toBeDefined()
    const comps = top.filter((b) => b.prelude === '@layer components').flatMap((b) => topBlocks(b.body))
    const body = comps.find((b) => b.prelude === '.freeze-edge')?.body ?? ''
    expect(body).toMatch(/box-shadow\s*:\s*var\(--shadow-freeze-edge\)/)
    expect(body).not.toMatch(/--color-fg\b/)
  })
  it('--gradient-primary 는 두 테마 공통 고정 코발트다(판정 Q15 — .dark 가 다시 정의하지 않는다)', () => {
    expect(val('--gradient-primary')).toBe('linear-gradient(var(--p-cobalt-600), var(--p-cobalt-600))')
    expect(m.dark.some((d) => d.name === '--gradient-primary')).toBe(false)
  })
})

/** 최상위 :root·.dark 가 같은 이름(커스텀 프로퍼티·color-scheme)을 선언할 때 :root 가 .dark 뒤에 오는 쌍 — 같은 특이성은 뒤가 이긴다.
 *  contrast-tokens 의 해석기는 문맥 맵이라 소스 순서를 보지 않는다(판정 Q36) */
function orderViolations(src: string): string[] {
  const blocks = topBlocks(stripComments(src)).map((b, i) => ({
    i, sel: b.prelude,
    names: new Set([...declsOf(b.body).map((d) => d.name), ...(/(^|[\s;{])color-scheme\s*:/.test(b.body) ? ['color-scheme'] : [])]),
  }))
  const roots = blocks.filter((b) => b.sel === ':root')
  const darks = blocks.filter((b) => b.sel === '.dark')
  return roots.flatMap((r) => darks.flatMap((d) => [...r.names].filter((n) => d.names.has(n) && r.i > d.i).map((n) => `${n}: :root#${r.i} 가 .dark#${d.i} 뒤`)))
}

describe('소스 순서 — :root 와 .dark 가 같은 이름을 선언하면 :root 가 앞(판정 Q36)', () => {
  it('globals.css 에 위반 0, color-scheme 은 :root(light)·.dark(dark) 둘 다 있다', () => {
    const src = readGlobals()
    expect(orderViolations(src)).toEqual([])
    const blocks = topBlocks(stripComments(src))
    expect(blocks.some((b) => b.prelude === ':root' && /color-scheme\s*:\s*light/.test(b.body))).toBe(true)
    expect(blocks.some((b) => b.prelude === '.dark' && /color-scheme\s*:\s*dark/.test(b.body))).toBe(true)
  })
  it('검사가 살아 있다 — :root 가 .dark 뒤면 잡는다', () => {
    expect(orderViolations(':root { --a: 1; }\n.dark { --a: 2; color-scheme: dark; }\n:root { color-scheme: light; --a: 3; }')).toEqual([
      '--a: :root#2 가 .dark#1 뒤', 'color-scheme: :root#2 가 .dark#1 뒤',
    ])
  })
})

/** 인쇄 블록(@media print 의 :root, .dark)이 최상위 .dark 앞에 오는 쌍 — 특이성이 같아(0,1,0) 뒤가 이긴다.
 *  앞에 오면 다크 사용자의 인쇄가 다크 값이 된다. contrast-tokens 의 해석기는 print 가 늘 이긴다고 가정해 순서를 보지 않는다 */
function printOrderViolations(src: string): string[] {
  const blocks = topBlocks(stripComments(src)).map((b, i) => ({ i, b }))
  const prints = blocks.filter(({ b }) => b.prelude === '@media print' && topBlocks(b.body).some((x) => /^:root\s*,\s*\.dark$/.test(x.prelude)))
  const darks = blocks.filter(({ b }) => b.prelude === '.dark')
  return prints.flatMap((p) => darks.filter((d) => d.i > p.i).map((d) => `.dark#${d.i} 가 @media print#${p.i} 뒤`))
}

describe('소스 순서 — 인쇄 블록은 모든 최상위 .dark 뒤(스펙 §4.1 블록 10, U1a 리뷰 R2·R3)', () => {
  it('globals.css 에 위반 0, 인쇄 블록이 있다', () => {
    const src = readGlobals()
    expect(printOrderViolations(src)).toEqual([])
    expect(topBlocks(stripComments(src)).some((b) => b.prelude === '@media print' && /:root\s*,\s*\.dark/.test(b.body))).toBe(true)
  })
  it('검사가 살아 있다 — .dark 가 인쇄 블록 뒤면 잡는다', () => {
    expect(printOrderViolations('.dark { --a: 1; }\n@media print { :root, .dark { --a: 0; } }\n.dark { --b: 2; }')).toEqual(['.dark#2 가 @media print#1 뒤'])
  })
})

describe('컴포넌트 층 버튼(판정 Q16·개정 §5.5.5)', () => {
  const comps = top.filter((b) => b.prelude === '@layer components').flatMap((b) => topBlocks(b.body))
  const body = (sel: string) => comps.find((b) => b.prelude === sel)?.body ?? ''
  it('높이·반경은 .btn 기본에 있다 — 한 줄의 primary·ghost 가 같은 높이', () => {
    expect(body('.btn')).toMatch(/\bh-\(--control-h\)/)
    expect(body('.btn')).toMatch(/\brounded-\(--radius-control\)/)
  })
  it.each(['.btn-primary', '.btn-ghost'])('%s 는 높이·반경·그림자를 따로 두지 않는다', (sel) => {
    expect(body(sel), `${sel} 규칙이 없다`).not.toBe('')
    expect(body(sel)).not.toMatch(/(?:^|[\s:])(?:h-|min-h-|rounded|shadow)/)
  })
  it.each(['.btn', '.btn-primary', '.btn-ghost'])('%s 는 옛 이름(별칭)이 아니라 의미 토큰을 쓴다', (sel) => {
    // token-aliases.test 의 ALIASES 중 버튼에 쓰이던 이름(테스트 파일을 import 하면 그 describe 가 여기서도 돈다)
    expect(body(sel)).not.toMatch(/-(?:surface-2|line|line-strong|ink|ink-muted|ink-subtle|brand|brand-hover|brand-weak|brand-fg|brand-ring|accent-ink|delayed|done)(?![\w-])/)
  })
})
