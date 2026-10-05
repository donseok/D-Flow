// 클라이언트 표시의 시각(instant)은 서버가 내려준 범위 tz 로 찍는다(SP5 계획 P8, A-4 리뷰 P3 N7) — 브라우저 tz 로 찍으면 보는 사람마다
// 다른 날짜·시각이 되고, SSR 과 hydration 이 어긋난다. no-runtime-constants 는 서울 리터럴만 보므로 이 꼴은 따로 막는다(AST).
// 금지: src/components·src/app 의 ① new Intl.DateTimeFormat(…, opts) 의 opts 에 timeZone 없음 ② Date#toLocaleDateString/TimeString(…) 의 opts 에
// timeZone 없음 ③ toLocaleString(…, opts) 에 날짜 필드(year·month·day·hour·minute·second·dateStyle·timeStyle·weekday)가 있는데 timeZone 없음
// ④ 로컬 게터 getHours·getMinutes·getSeconds·getDate·getMonth·getFullYear(브라우저 tz). 숫자 toLocaleString('ko-KR')(천 단위)은 날짜 필드가 없어 대상 밖.
// date-only 문자열을 UTC 로 고정해 찍는 곳은 timeZone: 'UTC' 를 명시한다(그것도 timeZone 이다). 한계: opts 를 변수로 넘기면 판정하지 않는다(표본이 본다).
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { walk } from './_walk'
import { parse } from './_ast'

const ROOT = process.cwd()
const DATE_FIELDS = new Set(['year', 'month', 'day', 'hour', 'minute', 'second', 'dateStyle', 'timeStyle', 'weekday'])
const LOCAL_GETTERS = new Set(['getHours', 'getMinutes', 'getSeconds', 'getDate', 'getMonth', 'getFullYear'])

function propNames(node: ts.Expression | undefined): Set<string> | null {
  if (!node || !ts.isObjectLiteralExpression(node)) return null
  const out = new Set<string>()
  for (const p of node.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) out.add(p.name.text)
    if (ts.isSpreadAssignment(p)) out.add('...')
  }
  return out
}

/** 한 파일의 위반(줄:꼴) */
function instantFormatHits(fileName: string, text: string): string[] {
  const sf = parse(fileName, text)
  const hits: string[] = []
  const at = (n: ts.Node, what: string) => hits.push(`${fileName}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${what}`)
  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'DateTimeFormat'
      && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'Intl') {
      const props = propNames(n.arguments?.[1])
      if (!props || (!props.has('timeZone') && !props.has('...'))) at(n, 'Intl.DateTimeFormat 에 timeZone 없음')
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const name = n.expression.name.text
      const props = propNames(n.arguments[1])
      if (name === 'toLocaleDateString' || name === 'toLocaleTimeString') {
        if (!props || (!props.has('timeZone') && !props.has('...'))) at(n, `${name} 에 timeZone 없음`)
      }
      if (name === 'toLocaleString' && props && [...props].some((p) => DATE_FIELDS.has(p)) && !props.has('timeZone') && !props.has('...')) {
        at(n, 'toLocaleString(날짜 필드) 에 timeZone 없음')
      }
      if (LOCAL_GETTERS.has(name) && n.arguments.length === 0) at(n, `로컬 게터 ${name}()`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return hits
}

describe('instant-format-zone — 시각 표시는 범위 tz 로', () => {
  const files = [...walk(join(ROOT, 'src/components')), ...walk(join(ROOT, 'src/app'))]
  it('걷는다(빈 목록으로 통과하지 않는다)', () => {
    expect(files.length).toBeGreaterThan(100)
  })
  it('위반이 없다', () => {
    const hits = files.flatMap((p) => instantFormatHits(relative(ROOT, p), readFileSync(p, 'utf8')))
    expect(hits, hits.join('\n')).toEqual([])
  }, 20_000)
  it('표본 — 잡는 것과 잡지 않는 것', () => {
    expect(instantFormatHits('a.tsx', "new Intl.DateTimeFormat('ko-KR', { month: 'short' }).format(d)")).toHaveLength(1)
    expect(instantFormatHits('a.tsx', "new Intl.DateTimeFormat('ko-KR', { month: 'short', timeZone }).format(d)")).toEqual([])
    expect(instantFormatHits('a.tsx', "d.toLocaleString('ko-KR', { hour: '2-digit' })")).toHaveLength(1)
    expect(instantFormatHits('a.tsx', "n.toLocaleString('ko-KR')")).toEqual([])
    expect(instantFormatHits('a.tsx', "d.toLocaleTimeString('ko-KR', { hour12: false, timeZone })")).toEqual([])
    expect(instantFormatHits('a.tsx', 'd.getHours()')).toHaveLength(1)
    expect(instantFormatHits('a.tsx', 'd.getUTCHours()')).toEqual([])
  })
})
