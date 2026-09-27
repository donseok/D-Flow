// tests/invariants/_minutes-reads.ts — minutes 표를 읽는 Supabase 체인을 AST 로 찾아 select 인자를 푼다(minutes-select-columns 전용).
// 글자 검사는 .from('minutes') 바로 뒤의 리터럴 select 만 봤다 — 상수에 담긴 '*', insert·update 뒤의 .select(), from<Row>('minutes'),
// 표 이름을 담은 변수는 지나쳤다(H2 최종 리뷰). 한계: 체인을 변수에 끊어 담은 뒤 그 변수에 .select() 를 잇는 꼴과, 표 이름을
// 풀 수 없는 체인(from(table))의 풀 수 없는 select 인자는 보지 못한다 — 뒤쪽은 '*' 가 확정일 때만 잡는다.
import ts from 'typescript'

export interface MinutesChain {
  line: number
  /** .from() 앞의 식 — sb, adm.admin 등 */
  receiver: string
  /** 'minutes' = 표 이름이 확정, 'maybe' = 표 이름을 풀 수 없다(매개변수 등) */
  table: 'minutes' | 'maybe'
  calls: Array<{ name: string; args: readonly ts.Expression[] }>
  /** 체인 전체 원문 */
  text: string
}

export interface Pieces { texts: string[]; unresolved: string[] }

export const parse = (name: string, text: string) =>
  ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, name.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

/** 다른 모듈의 상수를 풀 때 쓴다 — import 경로와 이름으로 그 모듈의 소스를 돌려준다(없으면 null). */
export type ImportLoader = (fromFile: string, specifier: string) => ts.SourceFile | null

function unwrap(node: ts.Expression): ts.Expression {
  let n = node
  while (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) n = n.expression
  return n
}

/** 이름이 name 인 변수 선언의 초기값들(파일 어디든). */
function initializersOf(sf: ts.SourceFile, name: string): ts.Expression[] {
  const out: ts.Expression[] = []
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) out.push(n.initializer)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

/** name 을 들여오는 import 문의 경로와 원래 이름. */
function importOf(sf: ts.SourceFile, name: string): { specifier: string; imported: string } | null {
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue
    const named = s.importClause?.namedBindings
    if (!named || !ts.isNamedImports(named)) continue
    const hit = named.elements.find(e => e.name.text === name)
    if (hit) return { specifier: s.moduleSpecifier.text, imported: (hit.propertyName ?? hit.name).text }
  }
  return null
}

/** 식이 가질 수 있는 문자열 조각 — 리터럴·템플릿·삼항·이어붙이기·[…].join()·같은 파일(또는 import 한) 상수까지 푼다.
 *  못 푼 식은 unresolved 에 원문으로 남긴다(호출부가 위반으로 친다). */
export function piecesOf(
  node: ts.Expression, sf: ts.SourceFile, load: ImportLoader = () => null, seen: Set<string> = new Set(),
): Pieces {
  const out: Pieces = { texts: [], unresolved: [] }
  const add = (p: Pieces) => { out.texts.push(...p.texts); out.unresolved.push(...p.unresolved) }
  const go = (e: ts.Expression, file: ts.SourceFile) => add(piecesOf(e, file, load, seen))
  const n = unwrap(node)

  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.texts.push(n.text)
  else if (ts.isTemplateExpression(n)) {
    out.texts.push(n.head.text)
    for (const span of n.templateSpans) { go(span.expression, sf); out.texts.push(span.literal.text) }
  } else if (ts.isConditionalExpression(n)) { go(n.whenTrue, sf); go(n.whenFalse, sf) }
  else if (ts.isBinaryExpression(n) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(n.operatorToken.kind)) {
    go(n.left, sf); go(n.right, sf)
  } else if (ts.isArrayLiteralExpression(n)) {
    for (const el of n.elements) {
      if (ts.isSpreadElement(el)) go(el.expression, sf)
      else go(el, sf)
    }
  } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'join') {
    go(n.expression.expression, sf)
  } else if (ts.isIdentifier(n)) {
    const key = `${sf.fileName}:${n.text}`
    if (seen.has(key)) return out
    seen.add(key)
    const inits = initializersOf(sf, n.text)
    if (inits.length) for (const init of inits) go(init, sf)
    else {
      const imp = importOf(sf, n.text)
      const other = imp ? load(sf.fileName, imp.specifier) : null
      const otherInits = other && imp ? initializersOf(other, imp.imported) : []
      if (other && otherInits.length) for (const init of otherInits) go(init, other)
      else out.unresolved.push(n.text)
    }
  } else out.unresolved.push(n.getText(sf))
  return out
}

/** Supabase 표 체인 — 표 이름이 'minutes' 이거나 풀 수 없는 .from(…) 에서 시작해 이어진 메서드 호출 전부. storage.from(버킷)은 뺀다. */
export function minutesChains(sf: ts.SourceFile, load: ImportLoader = () => null): MinutesChain[] {
  const out: MinutesChain[] = []
  const visit = (n: ts.Node) => {
    ts.forEachChild(n, visit)
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== 'from') return
    const receiver = n.expression.expression
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage') return
    // Array.from·Buffer.from 등 — 인자가 표 이름일 수 없는 정적 호출
    if (ts.isIdentifier(receiver) && /^[A-Z]/.test(receiver.text)) return
    const arg = n.arguments[0]
    if (!arg) return
    const table = piecesOf(arg, sf, load)
    const isMinutes = table.texts.includes('minutes')
    if (!isMinutes && (table.texts.length > 0 || table.unresolved.length === 0)) return

    const calls: MinutesChain['calls'] = []
    let top: ts.Node = n
    for (;;) {
      const access: ts.Node = top.parent
      if (!ts.isPropertyAccessExpression(access) || access.expression !== top) break
      const call: ts.Node = access.parent
      if (!ts.isCallExpression(call) || call.expression !== access) break
      calls.push({ name: access.name.text, args: call.arguments })
      top = call
    }
    out.push({
      line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      receiver: receiver.getText(sf), table: isMinutes ? 'minutes' : 'maybe', calls, text: top.getText(sf),
    })
  }
  visit(sf)
  return out
}

/** PostgREST 임베드 minutes(*)·minutes!inner(*)·minutes!fk!inner(*)·minutes(*, projects(name)) */
export const EMBED = /\bminutes(?:!\w+)*\(\s*[^()]*\*/

/**
 * minutes 를 '*' 로 읽는 곳과, 무엇을 읽는지 풀 수 없는 곳. allowDynamic 은 풀 수 없어도 되는 식(원문) — 값은 호출부가 따로 검사한다.
 * 표 이름이 확정이면 '*' 와 풀 수 없는 인자 둘 다, 표 이름을 풀 수 없으면 확정된 '*' 만 잡는다.
 */
export function starReads(
  fileName: string, text: string, opts: { load?: ImportLoader; allowDynamic?: readonly string[] } = {},
): string[] {
  const sf = parse(fileName, text)
  const hits: string[] = []
  for (const chain of minutesChains(sf, opts.load)) {
    for (const call of chain.calls) {
      if (call.name !== 'select') continue
      const at = `${chain.line}: ${chain.table === 'maybe' ? '(표 이름 미확정) ' : ''}`
      if (call.args.length === 0) { hits.push(`${at}select() — 인자 없음은 *`); continue }
      const p = piecesOf(call.args[0], sf, opts.load)
      if (p.texts.some(t => t.includes('*'))) hits.push(`${at}select 에 * — ${call.args[0].getText(sf).split('\n')[0]}`)
      if (chain.table !== 'minutes') continue
      for (const u of p.unresolved) {
        if (!(opts.allowDynamic ?? []).includes(u)) hits.push(`${at}select 인자를 풀 수 없다 — ${u}`)
      }
    }
  }
  return hits
}

/** share_token 을 언급하는 minutes 체인 가운데 service_role 클라이언트(…admin)에서 시작하지 않은 것. */
export function sessionTokenChains(fileName: string, text: string, load?: ImportLoader): string[] {
  const sf = parse(fileName, text)
  return minutesChains(sf, load)
    .filter(c => c.text.includes('share_token') && !/(^|\.)admin$/.test(c.receiver))
    .map(c => `${c.line}: ${c.receiver}.from(…) 체인이 share_token 을 읽거나 쓴다`)
}

/** 객체 리터럴의 name 속성에 실린 값 — 호출부가 넘기는 열 이름(checkOwner 의 extra)을 검사할 때 쓴다. */
export function propertyValues(fileName: string, text: string, name: string): Array<{ line: number } & Pieces> {
  const sf = parse(fileName, text)
  const out: Array<{ line: number } & Pieces> = []
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAssignment(n) && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && n.name.text === name) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, ...piecesOf(n.initializer, sf) })
    } else if (ts.isShorthandPropertyAssignment(n) && n.name.text === name) {
      out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, ...piecesOf(n.name, sf) })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}
