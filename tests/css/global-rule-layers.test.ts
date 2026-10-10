// 전역 규칙의 층(SP3b 스펙 D50·§4.1, §8.1 global-rule-layers). unlayered 는 모든 named layer 를 이긴다 —
// :focus-visible 을 @layer base 로 옮기면 outline-none 유틸(24곳)에 포커스 링이 사라지고 빌드·jsdom 어디에서도 안 잡힌다.
import { describe, expect, it } from 'vitest'
import { declsOf, readGlobals, srcFiles, stripComments, topBlocks, tokenMaps, type Block } from './lib/cssTokens'

const css = stripComments(readGlobals())
const top = topBlocks(css)
/** 원색 17 — 닫힌 집합. 개정 §5.5.2 의 34개 중 다크 전용 17개(night·ink-d·cobalt 300/400/450/900/950·mint-300)는 라이트 전용 결정(2026-10-10)으로 지웠다 */
export const PRIMITIVES = [
  'gray-0', 'gray-25', 'gray-50', 'gray-75', 'gray-100', 'gray-150', 'gray-200', 'gray-400', 'gray-450', 'gray-500', 'gray-600', 'gray-900',
  'cobalt-50', 'cobalt-600', 'cobalt-700', 'cobalt-800', 'mint-700',
]
const UNLAYERED = [':focus-visible', '::selection', 'body', '*', ':root', '@media print', '@media (prefers-reduced-motion: reduce)']

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
  it('최상위 :root 에만, 닫힌 17개와 같다', () => {
    expect(m.primitives.map((d) => d.name.slice(4)).sort()).toEqual([...PRIMITIVES].sort())
    const elsewhere = walkAll(top).filter(([parents, b]) => !(parents.length === 0 && b.prelude === ':root'))
      .flatMap(([, b]) => declsOf(b.body)).filter((d) => d.name.startsWith('--p-'))
    expect(elsewhere).toEqual([])
  })
  it('컴포넌트·페이지는 원색을 직접 참조하지 않는다(src 에 var(--p- 0건)', () => {
    expect(srcFiles(/\.(tsx?)$/).filter(([, t]) => t.includes('var(--p-')).map(([f]) => f)).toEqual([])
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
    ['--shadow-card', '0 1px 2px rgb(16 24 40 / 0.05)'],
  ])('%s = %s', (n, v) => { expect(val(n)).toBe(v) })
  it('층 사다리는 오름차순이다', () => {
    const z = ['sticky', 'shell', 'rail', 'popover', 'overlay', 'fullscreen', 'modal', 'toast', 'skip'].map((k) => Number(val(`--z-${k}`)))
    expect([...z].sort((a, b) => a - b)).toEqual(z)
  })
  it('옛 --shadow-sm·md 는 "그림자 없음"이되 none 이 아니다 — shadow-[var(--shadow-sm)] 의 box-shadow 쉼표 목록에 none 이 들면 선언 전체가 무효(IACVT)라 같은 요소의 ring 까지 사라진다(U1a 리뷰 R2 P2, Tailwind 의 shadow-none 과 같은 0 0 #0000)', () => {
    for (const n of ['--shadow-sm', '--shadow-md']) expect(val(n)).not.toMatch(/\bnone\b/)
  })
  it('주 표면 카드는 옅은 그림자 한 겹(--shadow-card)을 단다 — "주 표면 그림자 없음"(10/09)을 2026-10-10 사용자 승인 시안이 바꿨다. 떠 있는 층 토큰을 카드에 쓰지 않는다', () => {
    const comps = top.filter((b) => b.prelude === '@layer components').flatMap((b) => topBlocks(b.body))
    for (const sel of ['.card', '.kpi-card', '.hero-card', '.seg-item-active']) {
      const body = comps.find((b) => b.prelude === sel)?.body ?? ''
      expect(body, sel).toMatch(/\bshadow-\(--shadow-card\)/)
      expect(body, sel).not.toMatch(/--shadow-(?:popover|modal)/)
    }
  })
  it('.freeze-edge 그림자는 토큰이다 — fg 를 섞지 않는다(U1a 리뷰 R1 P3)', () => {
    expect(val('--shadow-freeze-edge')).toBeDefined()
    const comps = top.filter((b) => b.prelude === '@layer components').flatMap((b) => topBlocks(b.body))
    const body = comps.find((b) => b.prelude === '.freeze-edge')?.body ?? ''
    expect(body).toMatch(/box-shadow\s*:\s*var\(--shadow-freeze-edge\)/)
    expect(body).not.toMatch(/--color-fg\b/)
  })
  it('--gradient-primary 는 마지막 소비처와 함께 지웠다(판정 Q15) — 다시 두지 않는다', () => {
    expect(val('--gradient-primary')).toBeUndefined()
  })
})

describe('라이트 전용(2026-10-10) — 색 체계는 :root 의 light 하나', () => {
  it(':root 가 color-scheme: light 를 선언한다 — OS 가 다크여도 브라우저가 폼 컨트롤·스크롤바를 어둡게 칠하지 않는다', () => {
    expect(top.some((b) => b.prelude === ':root' && /color-scheme\s*:\s*light/.test(b.body))).toBe(true)
    expect(css).not.toMatch(/color-scheme\s*:\s*(?!light\b)[a-z]/)
  })
  it('의미 색 토큰(--color-*)은 @theme 한 곳에서만 선언한다 — 다크·인쇄 재정의 블록이 없다', () => {
    const elsewhere = walkAll(top).filter(([parents, b]) => !(parents.length === 0 && b.prelude === '@theme'))
      .flatMap(([, b]) => declsOf(b.body).filter((d) => d.name.startsWith('--color-')).map((d) => `${b.prelude} ${d.name}`))
    expect(elsewhere).toEqual([])
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
