// 불변식·열거 게이트 공용 AST 판별기 — use-server-exports·tests/gates 가 같은 판정을 쓴다(과제 13 에서 옮김).
import ts from 'typescript'

export const parse = (fileName: string, text: string): ts.SourceFile =>
  ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, /\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** 지시문 머리(directive prologue) — 맨 앞의 문자열 식 문장들. Next 는 'use server' 를 첫 문장만이 아니라 이 머리 어디서든 읽는다
 *  ('use strict' 뒤에 둔 'use server' 도 서버 액션 모듈이다) */
export function prologue(statements: readonly ts.Statement[]): string[] {
  const out: string[] = []
  for (const s of statements) {
    if (!ts.isExpressionStatement(s) || !ts.isStringLiteral(s.expression)) break
    out.push(s.expression.text)
  }
  return out
}

/** 지시문 머리에 'use server' 가 있는 모듈 */
export function isUseServerModule(sf: ts.SourceFile): boolean {
  return prologue(sf.statements).includes('use server')
}

export const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)

export const GATE_CALLS: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule', 'requireModulePage'])

/** exportName 함수 본문과, 그 본문이(재귀적으로) 부르는 같은 파일의 최상위 함수(선언·`const f = () => …`·`const f = function …`)에서
 *  names 에 든 호출 이름을 모은다. 다른 파일은 보지 않는다. 호출은 `f()`·`ns.f()`·별칭 import(`import { f as g }` 의 `g()`)를 원래 이름으로 센다.
 *  기본 names 는 관문 셋 — 모듈 라우트의 판정 확인(deny.routes)은 목록형·에이전트 헬퍼까지 넓힌 집합을 넘긴다 */
export function gateCallsIn(sf: ts.SourceFile, exportName: string, names: ReadonlySet<string> = GATE_CALLS): string[] {
  const bodies = new Map<string, ts.Node>()
  const alias = new Map<string, string>()
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) bodies.set(s.name.text, s.body)
    else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) bodies.set(d.name.text, d.initializer.body)
      }
    } else if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) {
      for (const el of s.importClause.namedBindings.elements) if (el.propertyName && names.has(el.propertyName.text)) alias.set(el.name.text, el.propertyName.text)
    }
  }
  const found: string[] = []
  const seen = new Set<string>()
  const visitFn = (name: string): void => {
    if (seen.has(name)) return
    seen.add(name)
    const body = bodies.get(name)
    if (!body) return
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression
        const callee = ts.isIdentifier(e) ? (alias.get(e.text) ?? e.text) : ts.isPropertyAccessExpression(e) ? e.name.text : null
        if (callee && names.has(callee)) found.push(callee)
        else if (callee && ts.isIdentifier(e) && bodies.has(callee)) visitFn(callee)
      }
      ts.forEachChild(n, walk)
    }
    walk(body)
  }
  visitFn(exportName)
  return found
}
