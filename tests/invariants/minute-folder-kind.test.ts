// 회의록 폴더 종류는 minute_folders.kind 로만 판정한다(SP5 B2 — 개정 §4.7 "대체", 스펙 W33). created_by 는 작성자 의미만 남는다.
// 옛 판정(parent_id null ∧ created_by null = 팀 시드 루트)을 되살리는 코드가 src 에 0건인지 AST 로 본다:
//  (a) 쿼리 빌더의 `.is('created_by', null)`·`.eq('created_by', null)` — 시드 루트 조회
//  (b) `X.createdBy === null`·`== null`(created_by 도) — 작성자 없음으로 종류를 가르는 비교. `!== null` 은 작성자 판정(본인 확인)이라 허용
//  (c) 폴더 행 리터럴에 `created_by: null` 을 쓰는 minute_folders insert 는 kind 를 함께 적어야 한다(루트 생성은 kind 가 정한다)
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse } from './_ast'
import { walk } from './_walk'

const CWD = process.cwd()
const CREATED = new Set(['created_by', 'createdBy'])

const nameOf = (e: ts.Expression): string | null =>
  ts.isPropertyAccessExpression(e) ? e.name.text
    : ts.isElementAccessExpression(e) && ts.isStringLiteral(e.argumentExpression) ? e.argumentExpression.text
      : ts.isIdentifier(e) ? e.text : null
const isNull = (e: ts.Expression) => e.kind === ts.SyntaxKind.NullKeyword

export function findings(file: string, text: string): string[] {
  const sf = parse(file, text)
  const out: string[] = []
  const at = (n: ts.Node, what: string) => out.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${what}`)
  const visit = (n: ts.Node) => {
    // (a)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['is', 'eq'].includes(n.expression.name.text)
        && n.arguments.length === 2 && ts.isStringLiteralLike(n.arguments[0]) && CREATED.has(n.arguments[0].text) && isNull(n.arguments[1])) {
      at(n, `.${n.expression.name.text}('${n.arguments[0].text}', null)`)
    }
    // (b)
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(n.operatorToken.kind)) {
      const [l, r] = [n.left, n.right]
      const side = isNull(r) ? l : isNull(l) ? r : null
      const nm = side ? nameOf(side) : null
      if (nm && CREATED.has(nm)) at(n, `${nm} == null`)
    }
    // (c)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'insert'
        && chainHasFrom(n.expression.expression, 'minute_folders')) {
      for (const a of n.arguments) {
        if (!ts.isObjectLiteralExpression(a)) continue
        const props = new Map(a.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(sf), p.initializer]))
        const cb = props.get('created_by')
        if (cb && isNull(cb) && !props.has('kind')) at(a, 'minute_folders insert 의 created_by: null 에 kind 가 없다')
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

function chainHasFrom(e: ts.Expression, table: string): boolean {
  let cur: ts.Expression = e
  for (;;) {
    if (ts.isCallExpression(cur)) {
      if (ts.isPropertyAccessExpression(cur.expression) && cur.expression.name.text === 'from'
          && cur.arguments[0] && ts.isStringLiteralLike(cur.arguments[0]) && cur.arguments[0].text === table) return true
      cur = cur.expression
    } else if (ts.isPropertyAccessExpression(cur)) cur = cur.expression
    else return false
  }
}

describe('회의록 폴더 종류 = kind(SP5 B2 — W33)', () => {
  it('src 에 created_by null 로 폴더 종류를 판정하는 코드가 없다', () => {
    const hits = walk(`${CWD}/src`).flatMap((f) => findings(relative(CWD, f), readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  }, 30_000)
  it('판정기 표본', () => {
    expect(findings('a.ts', "q.is('parent_id', null).is('created_by', null)")).toHaveLength(1)
    expect(findings('a.ts', 'const seed = f.parentId === null && f.createdBy === null')).toHaveLength(1)
    expect(findings('a.ts', "const mine = f.createdBy !== null && f.createdBy === me")).toEqual([])
    expect(findings('a.ts', "sb.from('minute_folders').insert({ name, parent_id: null, created_by: null })")).toHaveLength(1)
    expect(findings('a.ts', "sb.from('minute_folders').insert({ name, parent_id: null, created_by: null, kind: 'team_root' })")).toEqual([])
    expect(findings('a.ts', "sb.from('minutes').insert({ created_by: null })")).toEqual([])
  })
})
