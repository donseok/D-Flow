// display 캐스케이드 함정 넷(SP3b 스펙 D17 ①~④) — 반응형 안전망(globals.css 끝, unlayered)이 레이어 안 규칙을 이긴다.
// 안전망 테스트(breakpoint-safety-net)는 고치지 않는다(done_when). 그 테스트가 보지 않는 모양을 여기서 막는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { srcFiles } from './lib/cssTokens'

const DISPLAY = 'hidden|flex|grid|block|inline|inline-flex|inline-block|table|contents|flow-root'
const SAFETY = new RegExp(`(?<![\\w-])(?:sm|md|lg|xl|2xl):(?:${DISPLAY})(?![\\w-])`)
const BARE_DISPLAY = new RegExp(`(?<![\\w:\\[-])(?:${DISPLAY})(?![\\w-])`, 'g')
const ARBITRARY_BP = new RegExp(`(?:min|max)-\\[[^\\]]+\\]:(?:${DISPLAY})(?![\\w-])|\\[@media[^\\]]*\\]:(?:${DISPLAY})(?![\\w-])`)
const OFF_VARIANT = new RegExp(
  `(?<![\\w-])(?:aria-\\[[^\\]]+\\]|empty|not-[a-z-]+|in-[a-z-]+|pointer-[a-z]+|motion-[a-z]+|invalid|required|placeholder-shown|inert|starting|forced-colors|contrast-more|(?:group|peer)-[a-z-]+(?:\\/[\\w-]+)?|portrait|landscape|nth-[\\w-]+|nth-[a-z-]*\\[[^\\]]+\\]|only|has-[a-z-]+):(?:${DISPLAY})(?![\\w-])|(?:^|[\\s"'\`])\\*{1,2}:(?:${DISPLAY})(?![\\w-])`, 'g')

/** className={…}·className="…" 의 값 — 식인지(중괄호) 문자열인지와 함께 */
export function classNameValues(text: string): { value: string; line: number; expr: boolean }[] {
  const out: { value: string; line: number; expr: boolean }[] = []
  const re = /className\s*=\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length
    const line = text.slice(0, m.index).split('\n').length
    const open = text[i]
    if (open === '"' || open === "'" || open === '`') {
      const end = text.indexOf(open, i + 1)
      if (end === -1) continue
      out.push({ value: text.slice(i + 1, end), line, expr: open === '`' })
      i = end
    } else if (open === '{') {
      let depth = 0
      const start = i
      for (; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') { depth--; if (depth === 0) break }
      }
      out.push({ value: text.slice(start + 1, i), line, expr: true })
    }
    re.lastIndex = Math.max(re.lastIndex, i)
  }
  return out
}

/** 식 → 문자열 조각(정적 텍스트). 템플릿 리터럴은 ${…} 를 뺀 한 조각이고 보간 안의 리터럴은 따로 조각이다 */
export function literalSegments(expr: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < expr.length) {
    const c = expr[i]
    if (c === "'" || c === '"') {
      const end = expr.indexOf(c, i + 1)
      if (end < 0) break
      out.push(expr.slice(i + 1, end))
      i = end + 1
    } else if (c === '`') {
      let j = i + 1
      let text = ''
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '$' && expr[j + 1] === '{') {
          let depth = 1
          let k = j + 2
          while (k < expr.length && depth) { if (expr[k] === '{') depth++; else if (expr[k] === '}') depth--; k++ }
          out.push(...literalSegments(expr.slice(j + 2, k - 1)))
          text += ' '
          j = k
        } else { text += expr[j]; j++ }
      }
      out.push(text)
      i = j + 1
    } else i++
  }
  return out
}

/** ② 안전망 클래스가 있는 className 에서, 안전망 클래스와 같은 정적 조각 밖에 있는 맨 display 토큰 */
export function conditionalDisplay(value: string, expr: boolean): string[] {
  if (!SAFETY.test(value)) return []
  const segs = expr ? literalSegments(value) : [value]
  const anchors = segs.filter((s) => SAFETY.test(s))
  return segs.filter((s) => !anchors.includes(s)).flatMap((s) => s.match(BARE_DISPLAY) ?? [])
}

/** ② 의 기존 위반 — 사유 'UI-2b'(스펙 §9: UI-2b 에서 0) */
export const ALLOW_CONDITIONAL: Record<string, [number, string]> = {}   // UI-2b 과제 33 에서 0(WikiSearchResults — 두 갈래 정적 className)

const files = srcFiles(/\.tsx?$/)

describe('display 캐스케이드(D17)', () => {
  it('① 임의 브레이크포인트 display 와 안전망 클래스를 한 className 에 섞지 않는다', () => {
    const bad = files.flatMap(([f, t]) => classNameValues(t).filter(({ value }) => ARBITRARY_BP.test(value) && SAFETY.test(value)).map(({ line }) => `${f}:${line}`))
    expect(bad).toEqual([])
  })
  it('② 안전망 클래스가 있는 className 의 display 토큰은 그 클래스와 같은 정적 조각 안에만 있다', () => {
    const hits = new Map<string, string[]>()
    for (const [f, t] of files) {
      for (const { value, line, expr } of classNameValues(t)) {
        const d = conditionalDisplay(value, expr)
        if (d.length) hits.set(f, [...(hits.get(f) ?? []), `${line}: ${d.join(',')}`])
      }
    }
    const outside = [...hits].filter(([f, v]) => !(f in ALLOW_CONDITIONAL) || v.length > ALLOW_CONDITIONAL[f][0])
    expect(outside.map(([f, v]) => `${f} ${v.join(' | ')}`)).toEqual([])
    expect(Object.keys(ALLOW_CONDITIONAL).filter((f) => !hits.has(f)), '0이 된 파일은 목록에서 뺀다').toEqual([])
  })
  it('④ 안전망 VARIANT 밖 변형의 display 를 쓰지 않는다', () => {
    const bad = files.flatMap(([f, t]) => [...t.matchAll(OFF_VARIANT)].map((m) => `${f}:${t.slice(0, m.index).split('\n').length} ${m[0].trim()}`))
    expect(bad).toEqual([])
  })
  it('판정기가 살아 있다 — 모양별 표본', () => {
    expect(conditionalDisplay("`hidden ${open ? 'flex' : ''} lg:flex`", true)).toEqual(['flex'])
    expect(conditionalDisplay("cn('hidden lg:flex', open && 'block')", true)).toEqual(['block'])
    expect(conditionalDisplay('hidden lg:flex', false)).toEqual([])
    expect(conditionalDisplay("`hidden lg:flex ${collapsed ? 'w-16' : 'w-60'}`", true)).toEqual([])
    expect(ARBITRARY_BP.test('min-[900px]:hidden lg:flex') && SAFETY.test('min-[900px]:hidden lg:flex')).toBe(true)
    expect('not-first:hidden aria-[expanded=true]:flex *:block'.match(OFF_VARIANT)?.length).toBe(3)
    // 이름 붙은 group/peer·방향 미디어·순서 변형도 레이어 안이라 안전망에 진다(U1b 리뷰 R2 P3)
    expect('group-hover/row:flex peer-checked:grid portrait:hidden landscape:block nth-3:block nth-last-[2]:flex only:hidden has-checked:flex'.match(OFF_VARIANT)?.length).toBe(8)
    expect('group-hover/row:w-4 portrait:text-sm lg:flex'.match(OFF_VARIANT)).toBeNull()
  })
  it('안전망 테스트 파일은 그대로다(D17 — 안전망 판정은 그 테스트가 한다)', () => {
    expect(readFileSync('tests/css/breakpoint-safety-net.test.ts', 'utf8')).toContain("const NET_MARKER = '반응형 display 안전망'")
  })
})
