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

/** 최상위 함수(선언·`const f = () => …`·`const f = function …`)의 이름 → 몸 */
function localBodies(sf: ts.SourceFile): Map<string, ts.ConciseBody> {
  const bodies = new Map<string, ts.ConciseBody>()
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) bodies.set(s.name.text, s.body)
    else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) bodies.set(d.name.text, d.initializer.body)
      }
    }
  }
  return bodies
}

/** exportName 함수 본문과, 그 본문이(재귀적으로) 부르는 같은 파일의 최상위 함수(선언·`const f = () => …`·`const f = function …`)에서
 *  names 에 든 호출 이름을 모은다. 다른 파일은 보지 않는다. 호출은 `f()`·`ns.f()`·별칭 import(`import { f as g }` 의 `g()`)를 원래 이름으로 센다.
 *  이름만 본다(넓게 — null 항목의 "부르면 실패" 용). 모듈 항목의 판정 확인은 원천·결과 사용까지 보는 gateSitesIn 을 쓴다 */
export function gateCallsIn(sf: ts.SourceFile, exportName: string, names: ReadonlySet<string> = GATE_CALLS): string[] {
  const bodies = localBodies(sf)
  const alias = new Map<string, string>()
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) {
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

/** 판정 함수의 원천 — 이 모듈에서 import 한 바인딩이라야 판정 호출로 센다(같은 이름의 지역 함수·아무 객체의 메서드는 판정이 아니다) */
export const GATE_SOURCES: Readonly<Record<string, string>> = {
  requireModule: '@/lib/modules/gate', requireSessionModule: '@/lib/modules/gate', moduleState: '@/lib/modules/gate',
  projectsWithModule: '@/lib/modules/gate', workspacesWithModule: '@/lib/modules/gate', requireModulePage: '@/lib/modules/pageGate',
  requireAgentProject: '@/lib/agent/externalApi', accessibleProjectIds: '@/lib/agent/mineShared',
  loadGatedOrder: '@/lib/agent/routeShared', loadGatedOrderForUser: '@/lib/agent/routeShared',
}
/** 결과가 판정(통과/거부)이라 조건으로 봐야 하는 것 — 목록형(projectsWithModule·accessibleProjectIds)은 결과를 쓰기만 하면 된다 */
const MUST_CHECK: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule', 'moduleState', 'requireAgentProject', 'loadGatedOrder', 'loadGatedOrderForUser'])

export type GateSite = {
  name: string
  line: number
  /** 호출 식별자가 GATE_SOURCES 원천의 import 바인딩이다 */
  bound: boolean
  /** 결과를 버린다 — 식 문장·void·쓰지 않는 변수 */
  discarded: boolean
  /** 결과가 조건(if·삼항 조건)이나 return 으로 흐른다(MUST_CHECK 가 아니면 쓰기만 해도 참) */
  checked: boolean
  /** export 함수 몸의 최상위 문(조건 가지·try·반복·단락 평가의 오른쪽 밖)에서 늘 도는 호출 — 지역 헬퍼 안이면 헬퍼 호출도 최상위여야 한다 */
  topLevel: boolean
  call: ts.CallExpression
}

const unwrapUp = (n: ts.Node): ts.Node => {
  let cur = n
  for (;;) {
    const p = cur.parent
    if (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)
      || (ts.isConditionalExpression(p) && p.condition !== cur)) { cur = p; continue }
    return cur
  }
}
/** 값이 판정으로 흐르는가 — if·while·삼항의 조건, 또는 return(헬퍼가 결과를 호출부에 넘긴다) */
const inCondition = (n: ts.Node, stop: ts.Node): boolean => {
  for (let cur: ts.Node = n; cur !== stop && cur.parent; cur = cur.parent) {
    const p = cur.parent
    if ((ts.isIfStatement(p) || ts.isWhileStatement(p) || ts.isDoStatement(p)) && p.expression === cur) return true
    if (ts.isConditionalExpression(p) && p.condition === cur) return true
    if (ts.isReturnStatement(p) || (ts.isArrowFunction(p) && p.body === cur)) return true
    if (ts.isFunctionLike(p)) return false
  }
  return false
}
const namesOf = (b: ts.BindingName): string[] => (ts.isIdentifier(b) ? [b.text] : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : namesOf(e.name))))

/** exportName 에서 닿는(같은 파일 지역 헬퍼 포함) names 호출 자리마다 원천·결과 사용·지배를 판정한다 */
export function gateSitesIn(sf: ts.SourceFile, exportName: string, names: ReadonlySet<string>): GateSite[] {
  const bodies = localBodies(sf)
  const named = new Map<string, { source: string; imported: string }>()
  const spaces = new Map<string, string>()
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause?.namedBindings) continue
    const source = s.moduleSpecifier.text
    const nb = s.importClause.namedBindings
    if (ts.isNamespaceImport(nb)) spaces.set(nb.name.text, source)
    else for (const el of nb.elements) named.set(el.name.text, { source, imported: (el.propertyName ?? el.name).text })
  }
  const resolve = (e: ts.Expression): { name: string; bound: boolean } | null => {
    if (ts.isIdentifier(e)) {
      const b = named.get(e.text)
      if (b) return names.has(b.imported) ? { name: b.imported, bound: GATE_SOURCES[b.imported] === b.source } : null
      return names.has(e.text) ? { name: e.text, bound: false } : null
    }
    if (ts.isPropertyAccessExpression(e) && names.has(e.name.text)) {
      const ns = ts.isIdentifier(e.expression) ? spaces.get(e.expression.text) : undefined
      return { name: e.name.text, bound: ns !== undefined && GATE_SOURCES[e.name.text] === ns }
    }
    return null
  }
  /** call 이 fnBody 의 최상위 문에서 늘 도는가 — 가지·try·반복·중첩 함수·단락 평가 오른쪽·가지 한쪽에만 관문이 있는 삼항이면 거짓 */
  const alwaysRuns = (call: ts.Node, fnBody: ts.ConciseBody): boolean => {
    if (!ts.isBlock(fnBody)) return true
    for (let cur: ts.Node = call; cur.parent; cur = cur.parent) {
      const p = cur.parent
      if (p === fnBody) return true
      if (ts.isBlock(p) || ts.isFunctionLike(p) || ts.isTryStatement(p) || ts.isIterationStatement(p, false) || ts.isCaseClause(p) || ts.isDefaultClause(p)) return false
      if (ts.isIfStatement(p) && p.expression !== cur) return false
      if (ts.isBinaryExpression(p) && p.right === cur && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(p.operatorToken.kind)) return false
      if (ts.isConditionalExpression(p) && p.condition !== cur) {
        const other = p.whenTrue === cur ? p.whenFalse : p.whenTrue
        let gated = false
        const look = (n: ts.Node): void => { if (ts.isCallExpression(n) && resolve(n.expression)) gated = true; else ts.forEachChild(n, look) }
        look(other)
        if (!gated) return false
      }
    }
    return false
  }
  const sites: GateSite[] = []
  const visited = new Map<string, boolean>()
  const visitFn = (fnName: string, top: boolean): void => {
    if (visited.get(fnName) === true || (visited.has(fnName) && !top)) return
    visited.set(fnName, top)
    const body = bodies.get(fnName)
    if (!body) return
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const r = resolve(n.expression)
        if (r) {
          const sink = unwrapUp(n)
          const parent = sink.parent
          let discarded = ts.isExpressionStatement(parent) || ts.isVoidExpression(parent)
          let checked = inCondition(sink, body)
          if (ts.isVariableDeclaration(parent) && parent.initializer === sink) {
            const vars = new Set(namesOf(parent.name))
            let used = false
            const refs = (m: ts.Node): void => {
              if (ts.isIdentifier(m) && vars.has(m.text) && m.parent !== parent && !(ts.isBindingElement(m.parent) && m.parent.parent.parent === parent)) {
                used = true
                if (inCondition(m, body)) checked = true
              }
              ts.forEachChild(m, refs)
            }
            refs(body)
            discarded = !used
          }
          sites.push({
            name: r.name, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, bound: r.bound, discarded,
            checked: !discarded && (checked || !MUST_CHECK.has(r.name)), topLevel: top && alwaysRuns(n, body), call: n,
          })
        } else if (ts.isIdentifier(n.expression) && bodies.has(n.expression.text) && !named.has(n.expression.text)) {
          visitFn(n.expression.text, top && alwaysRuns(n, body))
        }
      }
      ts.forEachChild(n, walk)
    }
    walk(body)
  }
  visitFn(exportName, true)
  return sites
}

/** 한 판정 자리의 문제 — 원천이 아니거나 결과를 버리거나 조건으로 보지 않는다 */
export function siteProblems(s: GateSite): string[] {
  const out: string[] = []
  if (!s.bound) out.push(`:${s.line} ${s.name} 가 ${GATE_SOURCES[s.name] ?? '판정 모듈'} 의 import 바인딩이 아니다`)
  if (s.discarded) out.push(`:${s.line} ${s.name} 의 결과를 버린다`)
  else if (!s.checked) out.push(`:${s.line} ${s.name} 의 결과를 조건으로 보지 않는다`)
  return out
}
