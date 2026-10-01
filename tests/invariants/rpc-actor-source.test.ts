// p_actor 의 출처(SP4 스펙 D51·§6.1, 마무리 판정 T7, 계획 P5). DEFINER RPC 는 p_actor 를 행위자로 그대로 믿고 그 안에서 auth.uid() 는
// null 이다 — p_actor 를 받는 RPC 를 부르는 src 의 모든 자리가 그 값을 가드 결과에서 얻는지 AST 로 본다.
//  (a) 직접: 값이 `<g>.actor.userId` 이고 <g> 의 가장 가까운 선언이 `const <g> = await <가드>(…)`(@/lib/authz 의 네 가드 — 별칭·네임스페이스 import 포함)
//  (b) 한 단계: 값이 지역 const(또는 그 객체 리터럴의 필드)면 초기값이 (a). 같은 파일 함수의 매개변수(또는 그 필드)면 그 함수의 모든
//      참조가 호출이고(export·콜백·객체 필드 아님) 각 호출이 그 자리에 (a) 를 넘긴다
//  (c) 그 밖은 닫힌 허용 목록 ACTOR_SOURCE_EXCEPTIONS(`<파일>#<rpc>` → 값 식·사유, 죽은 항목 검사) — 세션 가드가 아닌 행위자(에이전트
//      토큰·내부 경로)도 받는 라이브러리 도우미와 두 단계 전달
// 구조 규칙(허용 목록으로 덮지 못한다): p_actor 는 `.rpc('<P_ACTOR_RPCS 의 이름>', { … })` 의 객체 리터럴에만, 그 호출에는 반드시, 그 뒤
// 펼침이 p_actor 를 덮을 수 없게. 대상 = 마이그레이션에서 인자 이름이 정확히 p_actor 인 함수(자동 추출) ↔ P_ACTOR_RPCS(양방향 —
// p_actor_id·p_actor_name 의 회의록 RPC 는 범위 밖). 첫날 실측(main 81deae9 — 스펙 §6.1): p_actor 자리 9곳 = 직접 3·한 단계 2·허용 목록 4.
// 한계: 타입 검사기 없이 이름의 가장 가까운 선언을 찾는다. `g.ok` 확인은 타입 검사가 강제한다(GuardResult 유니온 — 좁히지 않으면 g.actor 가 형 오류).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { hasModifier, parse } from './_ast'
import { walk } from './_walk'

/** 마이그레이션에서 인자 이름이 정확히 p_actor 인 public 함수 — 닫힌 목록. 새 마이그레이션이 p_actor 함수를 만들면 그 과제가 같이 더한다 */
const P_ACTOR_RPCS: ReadonlySet<string> = new Set([
  'apply_project_settings', 'apply_workflow_event', 'apply_workspace_settings', 'create_project_with_settings', 'set_dependency_waiver',
  'set_platform_admin', 'set_workspace_role', 'upsert_project_member', 'upsert_project_member_cmd',
])

/** (c) 닫힌 허용 목록 — `<파일>#<rpc>` → 그 자리의 p_actor 값 식(공백 하나로 정규화)과 사유. (a)·(b) 로 통과하는 자리를 적으면 죽은 항목 */
const ACTOR_SOURCE_EXCEPTIONS: Readonly<Record<string, { expr: string; why: string }>> = {
  'src/app/actions/settings.ts#apply_project_settings': {
    expr: 'x.actor',
    why: '설정 명령 어댑터(두 단계) — updateProjectSettings 의 가드 결과 g.actor 를 runCommand 가 받아 어댑터 rpc(admin, x) 의 x.actor 로 싣는다',
  },
  'src/app/actions/settings.ts#apply_workspace_settings': {
    expr: 'x.actor',
    why: '설정 명령 어댑터(두 단계) — updateWorkspaceSettings 의 가드 결과 g.actor 를 runCommand 가 받아 어댑터 rpc(admin, x) 의 x.actor 로 싣는다',
  },
  'src/lib/settings/write.ts#apply_project_settings': {
    expr: 'actorUserId',
    why: '서버 내부 쓰기 writeProjectSettingsInternal — 가져오기 라우트(가드 결과)와 에이전트 경로(lib/agent/wbsImport.ts)의 행위자를 함께 받는 라이브러리 도우미',
  },
  'src/lib/agent/workflowEvent.ts#apply_workflow_event': {
    expr: 'args.actorUserId',
    why: '워크플로 사건 도우미 applyWorkflowEvent — 세션 액션의 가드 결과와 에이전트 토큰 라우트(api/v1/agent/work/[id]/*)·위임(lib/agent/delegation.ts)의 행위자를 함께 받는다',
  },
}

/** 첫날 분류 실측(스펙 §6.1 — 직접 3·한 단계 2·허용 목록 4). 이 9곳만 적는다(새 자리는 더하지 않는다) — 바뀌면 의도를 확인하고 고친다 */
const FIRST_DAY: Readonly<Record<string, 'direct' | 'indirect' | 'exception'>> = {
  'src/app/actions/project.ts#create_project_with_settings': 'direct',
  'src/app/actions/accounts.ts#set_platform_admin': 'direct',
  'src/app/actions/accounts.ts#set_workspace_role': 'direct',
  'src/app/actions/roster.ts#upsert_project_member_cmd': 'indirect',
  'src/app/actions/accounts.ts#upsert_project_member_cmd': 'indirect',
  'src/app/actions/settings.ts#apply_project_settings': 'exception',
  'src/app/actions/settings.ts#apply_workspace_settings': 'exception',
  'src/lib/settings/write.ts#apply_project_settings': 'exception',
  'src/lib/agent/workflowEvent.ts#apply_workflow_event': 'exception',
}

const GUARDS: ReadonlySet<string> = new Set(['requireSuperuser', 'requireWorkspaceAdmin', 'requireProjectAdmin', 'requireProjectMember'])
const GUARD_SOURCE = '@/lib/authz'

type Verdict = { ok: true; how: 'direct' | 'indirect' } | { ok: false; why: string }
interface Site { file: string; line: number; rpc: string; expr: string; verdict: Verdict }
interface Scan { sites: Site[]; problems: string[] }
type Binding =
  | { kind: 'const'; init: ts.Expression }
  | { kind: 'param'; fn: ts.SignatureDeclaration; index: number }
  | { kind: 'fn'; decl: ts.FunctionDeclaration }
  | { kind: 'import'; source: string; imported: string }
  | { kind: 'other' }

const lineOf = (sf: ts.SourceFile, n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
const unwrap = (e: ts.Expression): ts.Expression => {
  let cur = e
  while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur) || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)
    || ts.isTypeAssertionExpression(cur)) cur = cur.expression
  return cur
}
const propName = (p: ts.ObjectLiteralElementLike): string | null => {
  if (ts.isSpreadAssignment(p)) return null
  if (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) return p.name.text
  if (ts.isComputedPropertyName(p.name) && ts.isStringLiteralLike(p.name.expression)) return p.name.expression.text
  return null
}
const bindsName = (b: ts.BindingName, name: string): boolean =>
  ts.isIdentifier(b) ? b.text === name : b.elements.some((e) => !ts.isOmittedExpression(e) && bindsName(e.name, name))

/** 문장 s 가 name 을 선언하면 그 바인딩 */
function declaredIn(s: ts.Statement, name: string): Binding | null {
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      if (!bindsName(d.name, name)) continue
      const isConst = (s.declarationList.flags & ts.NodeFlags.Const) !== 0
      return ts.isIdentifier(d.name) && isConst && d.initializer ? { kind: 'const', init: d.initializer } : { kind: 'other' }
    }
  }
  if (ts.isFunctionDeclaration(s) && s.name?.text === name) return { kind: 'fn', decl: s }
  if (ts.isClassDeclaration(s) && s.name?.text === name) return { kind: 'other' }
  if (ts.isImportDeclaration(s) && s.importClause && ts.isStringLiteral(s.moduleSpecifier)) {
    const source = s.moduleSpecifier.text
    const c = s.importClause
    if (c.name?.text === name) return { kind: 'import', source, imported: 'default' }
    const nb = c.namedBindings
    if (nb && ts.isNamespaceImport(nb) && nb.name.text === name) return { kind: 'import', source, imported: '*' }
    if (nb && ts.isNamedImports(nb)) {
      const el = nb.elements.find((x) => x.name.text === name)
      if (el) return { kind: 'import', source, imported: (el.propertyName ?? el.name).text }
    }
  }
  return null
}

/** id 의 가장 가까운 선언 — 감싸는 함수의 매개변수·블록·소스 파일을 안에서 밖으로 본다. 못 찾으면 null(전역) */
function bindingOf(id: ts.Identifier): Binding | null {
  const name = id.text
  for (let n: ts.Node | undefined = id.parent; n; n = n.parent) {
    if (ts.isFunctionLike(n)) {
      const i = n.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === name)
      if (i >= 0) return { kind: 'param', fn: n, index: i }
      if (n.parameters.some((p) => bindsName(p.name, name))) return { kind: 'other' }
    }
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseClause(n) || ts.isDefaultClause(n)) {
      for (const s of n.statements) {
        const b = declaredIn(s, name)
        if (b) return b
      }
    }
    if ((ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) && n.initializer
      && ts.isVariableDeclarationList(n.initializer) && n.initializer.declarations.some((d) => bindsName(d.name, name))) return { kind: 'other' }
    if (ts.isCatchClause(n) && n.variableDeclaration && bindsName(n.variableDeclaration.name, name)) return { kind: 'other' }
  }
  return null
}

/** 식이 가드 호출인가(await·괄호를 벗긴다) — 호출 이름의 가장 가까운 선언이 @/lib/authz 의 import 여야 한다 */
function isGuardCall(e: ts.Expression): boolean {
  let c = unwrap(e)
  if (ts.isAwaitExpression(c)) c = unwrap(c.expression)
  if (!ts.isCallExpression(c)) return false
  const callee = c.expression
  if (ts.isIdentifier(callee)) {
    const b = bindingOf(callee)
    return b?.kind === 'import' && b.source === GUARD_SOURCE && GUARDS.has(b.imported)
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const b = bindingOf(callee.expression)
    return b?.kind === 'import' && b.source === GUARD_SOURCE && b.imported === '*' && GUARDS.has(callee.name.text)
  }
  return false
}

/** (a) 값이 `<g>.actor.userId` 이고 <g> 의 가장 가까운 선언이 가드 결과의 const 인가 */
function isGuardUserId(e: ts.Expression): boolean {
  const v = unwrap(e)
  if (!ts.isPropertyAccessExpression(v) || v.name.text !== 'userId') return false
  const a = unwrap(v.expression)
  if (!ts.isPropertyAccessExpression(a) || a.name.text !== 'actor' || !ts.isIdentifier(a.expression)) return false
  const b = bindingOf(a.expression)
  return b?.kind === 'const' && isGuardCall(b.init)
}

/** 같은 파일에서 이름으로만 부르는 함수의 이름 — 함수 선언 또는 const 의 화살표·함수 식. export·이름 없음(객체 필드의 화살표 등)은 null */
function callableName(fn: ts.SignatureDeclaration): string | null {
  if (ts.isFunctionDeclaration(fn)) return fn.name && !hasModifier(fn, ts.SyntaxKind.ExportKeyword) ? fn.name.text : null
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isVariableDeclaration(fn.parent) && fn.parent.initializer === fn
    && ts.isIdentifier(fn.parent.name)) {
    const list = fn.parent.parent
    if (!ts.isVariableDeclarationList(list) || (list.flags & ts.NodeFlags.Const) === 0) return null
    if (ts.isVariableStatement(list.parent) && hasModifier(list.parent, ts.SyntaxKind.ExportKeyword)) return null
    return fn.parent.name.text
  }
  return null
}

/** 이름 자리(속성·메서드 이름, import 지정자)가 아닌 참조인가 */
const isReference = (id: ts.Identifier): boolean => {
  const p = id.parent
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false
  if ((ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)
    || ts.isMethodSignature(p)) && p.name === id) return false
  return !(ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p))
}

/** fn(이름 name)의 참조가 전부 호출이면 그 호출들, 하나라도 값으로 쓰이면(콜백·export·객체 필드) null */
function callsOf(sf: ts.SourceFile, fn: ts.SignatureDeclaration, name: string): ts.CallExpression[] | null {
  const declName = ts.isFunctionDeclaration(fn) ? fn.name : ts.isVariableDeclaration(fn.parent) ? fn.parent.name : undefined
  const calls: ts.CallExpression[] = []
  let escaped = false
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && n.text === name && n !== declName && isReference(n)) {
      const b = bindingOf(n)
      if (b && ((b.kind === 'fn' && b.decl === fn) || (b.kind === 'const' && unwrap(b.init) === fn))) {
        if (ts.isCallExpression(n.parent) && n.parent.expression === n) calls.push(n.parent)
        else escaped = true
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return escaped ? null : calls
}

/** 객체 리터럴 식의 필드 값 — 펼침이 있거나 값 속성이 아니면 null(덮이거나 따라갈 수 없다). 같은 이름이 여럿이면 마지막(JS 의미) */
function fieldOf(e: ts.Expression, field: string): ts.Expression | null {
  const o = unwrap(e)
  if (!ts.isObjectLiteralExpression(o) || o.properties.some((p) => ts.isSpreadAssignment(p))) return null
  const p = [...o.properties].reverse().find((x) => propName(x) === field)
  return p && ts.isPropertyAssignment(p) ? p.initializer : null
}

/** (b) 한 단계 — 값 식이 가드 결과로 이어지면 null, 아니면 이유 */
function oneHop(v: ts.Expression, sf: ts.SourceFile): string | null {
  const e = unwrap(v)
  let id: ts.Identifier | null = null
  let field: string | null = null
  if (ts.isIdentifier(e)) id = e
  else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) { id = e.expression; field = e.name.text }
  if (!id) return '이름·이름.필드 꼴이 아니라 따라갈 수 없다'
  const label = field === null ? id.text : `${id.text}.${field}`
  const b = bindingOf(id)
  if (b?.kind === 'const') {
    const src = field === null ? b.init : fieldOf(b.init, field)
    return src && isGuardUserId(src) ? null : `지역 const ${label} 의 초기값이 가드 결과가 아니다`
  }
  if (b?.kind === 'param') {
    const name = callableName(b.fn)
    if (!name) return `${id.text} 는 export 되거나 이름 없는 함수의 매개변수다 — 호출을 모두 볼 수 없다`
    const calls = callsOf(sf, b.fn, name)
    if (calls === null) return `${name} 이 호출 밖(콜백·export·객체 필드)에서 쓰인다`
    if (calls.length === 0) return `${name} 을 부르는 곳이 없다`
    for (const c of calls) {
      const spreadAt = c.arguments.findIndex((a) => ts.isSpreadElement(a))
      if (spreadAt >= 0 && spreadAt <= b.index) return `${name} 의 :${lineOf(sf, c)} 호출이 펼침 인자를 쓴다`
      const arg: ts.Expression | undefined = c.arguments[b.index]
      const src = arg === undefined ? null : field === null ? arg : fieldOf(arg, field)
      if (!src || !isGuardUserId(src)) return `${name} 의 :${lineOf(sf, c)} 호출이 그 자리(${label})에 가드 결과를 넘기지 않는다`
    }
    return null
  }
  return `${label} 의 선언이 const·매개변수가 아니다`
}

function judge(v: ts.Expression, sf: ts.SourceFile): Verdict {
  if (isGuardUserId(v)) return { ok: true, how: 'direct' }
  const why = oneHop(v, sf)
  return why === null ? { ok: true, how: 'indirect' } : { ok: false, why }
}

/** 펼침 식이 p_actor 를 실을 수 있는가 — 객체 리터럴과 삼항의 두 갈래만 들여다본다. 그 밖(이름·호출)은 실을 수 있다고 본다 */
function mayCarry(e: ts.Expression): boolean {
  const x = unwrap(e)
  if (ts.isObjectLiteralExpression(x)) return x.properties.some((p) => propName(p) === 'p_actor' || (ts.isSpreadAssignment(p) && mayCarry(p.expression)))
  if (ts.isConditionalExpression(x)) return mayCarry(x.whenTrue) || mayCarry(x.whenFalse)
  return true
}

/** 한 파일의 p_actor 자리(판정 포함)와 구조 문제 */
function scanFile(file: string, sf: ts.SourceFile, rpcs: ReadonlySet<string>): Scan {
  const sites: Site[] = []
  const problems: string[] = []
  const handled = new Set<ts.Node>()
  const at = (n: ts.Node) => `${file}:${lineOf(sf, n)}`
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'rpc') {
      const first = n.arguments[0]
      if (first && ts.isStringLiteralLike(first) && rpcs.has(first.text)) {
        const rpc = first.text
        const args = n.arguments.length > 1 ? unwrap(n.arguments[1]) : null
        if (!args || !ts.isObjectLiteralExpression(args)) problems.push(`${at(n)} ${rpc} 의 인자가 객체 리터럴이 아니다 — p_actor 출처를 볼 수 없다`)
        else {
          const props = [...args.properties]
          const idx = props.map(propName).lastIndexOf('p_actor')
          if (props.slice(idx + 1).some((p) => ts.isSpreadAssignment(p) && mayCarry(p.expression))) {
            problems.push(`${at(n)} ${rpc} 의 p_actor 뒤 펼침이 p_actor 를 덮을 수 있다`)
          }
          if (idx < 0) problems.push(`${at(n)} ${rpc} 에 p_actor 가 없다`)
          else {
            const p = props[idx]
            handled.add(p)
            const value = ts.isShorthandPropertyAssignment(p) ? p.name : ts.isPropertyAssignment(p) ? p.initializer : null
            if (!value) problems.push(`${at(p)} ${rpc} 의 p_actor 가 값 속성이 아니다`)
            else sites.push({ file, line: lineOf(sf, p), rpc, expr: value.getText(sf).replace(/\s+/g, ' '), verdict: judge(value, sf) })
          }
        }
      }
    }
    if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (propName(p) !== 'p_actor' || handled.has(p)) continue
        const call = ts.isCallExpression(n.parent) && n.parent.arguments[1] === n ? n.parent : null
        const name0 = call?.arguments[0]
        const rpc = call && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'rpc'
          && name0 && ts.isStringLiteralLike(name0) ? name0.text : null
        problems.push(rpc !== null
          ? `${at(p)} p_actor 를 받지 않는 RPC ${rpc} 에 넘긴다(P_ACTOR_RPCS·마이그레이션과 어긋남)`
          : `${at(p)} p_actor 를 .rpc('<p_actor 함수>', { … }) 밖에 적는다 — 출처를 볼 수 없다`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { sites, problems }
}

/** 판정 — 구조 문제 + (a)·(b) 로 통과하지 못하고 허용 목록에도 없는 자리 + 허용 목록의 죽은 항목·사유 없음 */
function evaluate(scan: Scan, exceptions: Readonly<Record<string, { expr: string; why: string }>>): string[] {
  const out = [...scan.problems]
  const used = new Set<string>()
  for (const s of scan.sites) {
    if (s.verdict.ok) continue
    const key = `${s.file}#${s.rpc}`
    if (Object.hasOwn(exceptions, key) && exceptions[key].expr === s.expr) { used.add(key); continue }
    out.push(`${s.file}:${s.line} ${s.rpc} 의 p_actor(${s.expr}) — ${s.verdict.why}. 가드 결과의 actor.userId 를 넘기거나, 다른 행위자도 받는 라이브러리 도우미면 ACTOR_SOURCE_EXCEPTIONS 에 사유와 함께 적는다(SP4 D51)`)
  }
  for (const [key, ex] of Object.entries(exceptions)) {
    if (ex.why.length < 12) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 사유가 없다`)
    if (used.has(key)) continue
    const live = scan.sites.filter((s) => `${s.file}#${s.rpc}` === key)
    if (live.length === 0) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 죽은 항목 — 그 자리가 없다`)
    else if (live.every((s) => s.verdict.ok)) out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 죽은 항목 — 예외 없이 통과한다(${live.map((s) => s.expr).join(', ')})`)
    else out.push(`ACTOR_SOURCE_EXCEPTIONS ${key}: 값 식 ${ex.expr} 이 실제(${live.map((s) => s.expr).join(', ')})와 다르다`)
  }
  return out
}

/** 마이그레이션 원문에서 인자 이름이 정확히 p_actor 인 public 함수(주석 제외, 대소문자·따옴표 무시, 인자 모드 IN·OUT·INOUT·VARIADIC 건너뜀) */
function pActorFunctions(texts: readonly string[]): string[] {
  const out = new Set<string>()
  const head = /create\s+(?:or\s+replace\s+)?function\s+(?:"?([a-z_0-9]+)"?\.)?"?([a-z_0-9]+)"?\s*\(/gi
  for (const raw of texts) {
    const t = raw.replace(/--[^\n]*/g, '')
    for (const m of t.matchAll(head)) {
      if (m[1] && m[1].toLowerCase() !== 'public') continue
      const params: string[] = []
      let cur = ''
      let depth = 1
      for (let i = m.index! + m[0].length; i < t.length; i++) {
        const ch = t[i]
        if (ch === '(') depth++
        else if (ch === ')' && --depth === 0) break
        if (ch === ',' && depth === 1) { params.push(cur); cur = '' } else cur += ch
      }
      params.push(cur)
      const names = params.map((p) => {
        const words = p.trim().split(/\s+/)
        const first = /^(in|out|inout|variadic)$/i.test(words[0] ?? '') ? words[1] : words[0]
        return (first ?? '').replace(/"/g, '').toLowerCase()
      })
      if (names.includes('p_actor')) out.add(m[2].toLowerCase())
    }
  }
  return [...out].sort()
}

const MIG = 'supabase/migrations'
const MIGRATIONS = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(MIG, f), 'utf8'))

function scanSrc(): Scan {
  const out: Scan = { sites: [], problems: [] }
  for (const f of walk('src')) {
    const text = readFileSync(f, 'utf8')
    if (!text.includes('p_actor') && ![...P_ACTOR_RPCS].some((r) => text.includes(r))) continue
    const r = scanFile(f, parse(f, text), P_ACTOR_RPCS)
    out.sites.push(...r.sites)
    out.problems.push(...r.problems)
  }
  return out
}
const SCAN = scanSrc()

describe('p_actor 대상 — 마이그레이션 ↔ P_ACTOR_RPCS(양방향)', () => {
  it('마이그레이션에서 인자 이름이 정확히 p_actor 인 함수 = P_ACTOR_RPCS', () => {
    const found = pActorFunctions(MIGRATIONS)
    expect(found.filter((n) => !P_ACTOR_RPCS.has(n)), 'P_ACTOR_RPCS 에 더할 것(새 p_actor 함수)').toEqual([])
    expect([...P_ACTOR_RPCS].filter((n) => !found.includes(n)), 'P_ACTOR_RPCS 에서 뺄 것(마이그레이션에 없다)').toEqual([])
  })
})

describe('p_actor 출처 — src 의 모든 자리(D51·T7)', () => {
  it('가드 결과(직접·한 단계) 또는 닫힌 허용 목록 — 구조 문제·죽은 항목·사유 없음 0', () => {
    expect(evaluate(SCAN, ACTOR_SOURCE_EXCEPTIONS)).toEqual([])
  })

  it('첫날 9곳의 분류가 실측과 같다(스펙 §6.1 — 직접 3·한 단계 2·허용 목록 4)', () => {
    const classOf = (s: Site) => (s.verdict.ok ? s.verdict.how : 'exception')
    const bad = Object.entries(FIRST_DAY).flatMap(([key, want]) => {
      const live = SCAN.sites.filter((s) => `${s.file}#${s.rpc}` === key)
      if (live.length === 0) return [`${key}: 자리가 없다`]
      return live.filter((s) => classOf(s) !== want).map((s) => `${key}:${s.line} ${classOf(s)} ≠ ${want}`)
    })
    expect(bad).toEqual([])
  })
})

describe('판별기 민감도 — 합성 소스', () => {
  const RPCS: ReadonlySet<string> = new Set(['rpc_a'])
  const HEAD = "import { requireProjectAdmin, requireWorkspaceAdmin } from '@/lib/authz'\nimport * as authz from '@/lib/authz'\n"
  const scan = (body: string) => scanFile('s.ts', parse('s.ts', HEAD + body), RPCS)
  const kinds = (body: string) => scan(body).sites.map((s) => (s.verdict.ok ? s.verdict.how : 'fail'))
  const run = (body: string, ex: Readonly<Record<string, { expr: string; why: string }>> = {}) => evaluate(scan(body), ex)

  it('(a) 직접 — 가드 결과의 actor.userId(네임스페이스 import·중첩 블록·콜백·as 안 포함)', () => {
    expect(kinds([
      "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      'export async function b(p) { const w = await authz.requireWorkspaceAdmin(p); if (!w.ok) return; for (const x of [1]) {',
      "  await Promise.all([x].map(() => sb.rpc('rpc_a', { p_x: x, p_actor: (w.actor.userId as string) }))) } }",
    ].join('\n'))).toEqual(['direct', 'direct'])
  })

  it('(a) 아님 — 인자 값, 가드가 아닌 호출, 같은 이름의 지역 함수, let', () => {
    expect(kinds([
      "export async function a(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: input.actorId }) }",
      "export async function b(p) { const g = await getActor(); await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      "export async function c(p) { const requireProjectAdmin = async () => ({ ok: true, actor: { userId: 'x' } }); const g = await requireProjectAdmin(p); await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
      "export async function d(p) { let g = await requireProjectAdmin(p); g = { ok: true, actor: { userId: 'x' } }; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }",
    ].join('\n'))).toEqual(['fail', 'fail', 'fail', 'fail'])
  })

  it('(b) 한 단계 — 같은 파일 도우미의 매개변수·그 필드, 지역 const·지역 객체 필드', () => {
    expect(kinds([
      "async function call(sb, actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await call(sb, g.actor.userId) }',
      'export async function b(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; return call(null, g.actor.userId) }',
      "const viaField = async (opts) => sb.rpc('rpc_a', { p_actor: opts.actor })",
      'export async function c(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await viaField({ actor: g.actor.userId }) }',
      'export async function d(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; const actorId = g.actor.userId; const ctx = { actor: g.actor.userId }',
      "  await sb.rpc('rpc_a', { p_actor: actorId }); await sb.rpc('rpc_a', { p_actor: ctx.actor }) }",
    ].join('\n'))).toEqual(['indirect', 'indirect', 'indirect', 'indirect'])
  })

  it('(b) 아님 — 호출 하나라도 다른 값, 두 단계, export, 콜백으로 샘, 펼침 인자, 호출 없음', () => {
    expect(kinds([
      "async function one(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function a(p, input) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await one(g.actor.userId); await one(input.actor) }',
      "async function inner(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'async function outer(actorId) { await inner(actorId) }',
      'export async function b(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await outer(g.actor.userId) }',
      "export async function exported(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      "async function cb(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function c(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await cb(g.actor.userId); [g.actor.userId].forEach(cb) }',
      "async function spread(a, actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
      'export async function d(p, rest) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await spread(...rest) }',
      "async function orphan(actorId) { await sb.rpc('rpc_a', { p_actor: actorId }) }",
    ].join('\n'))).toEqual(['fail', 'fail', 'fail', 'fail', 'fail', 'fail'])
  })

  it('구조 — .rpc 밖의 p_actor·객체 리터럴 아닌 인자·p_actor 없음·덮는 펼침·목록 밖 RPC·이름 아닌 RPC(허용 목록으로 덮지 못한다)', () => {
    const problems = run([
      "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; const args = { p_actor: g.actor.userId }; await sb.rpc('rpc_a', args) }",
      "export async function b(p) { await sb.rpc('rpc_a', { p_x: 1 }) }",
      "export async function c(p, extra) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: g.actor.userId, ...extra }) }",
      "export async function d(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('other_rpc', { p_actor: g.actor.userId }) }",
      'export async function e(p, name) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc(name, { p_actor: g.actor.userId }) }',
      "export async function f(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { ...(p ? { p_x: 1 } : {}), p_actor: g.actor.userId, ...(p ? { p_y: 2 } : {}) }) }",
    ].join('\n'))
    expect(problems.map((m) => m.replace(/^s\.ts:\d+ /, ''))).toEqual([
      "p_actor 를 .rpc('<p_actor 함수>', { … }) 밖에 적는다 — 출처를 볼 수 없다",
      'rpc_a 의 인자가 객체 리터럴이 아니다 — p_actor 출처를 볼 수 없다',
      'rpc_a 에 p_actor 가 없다',
      'rpc_a 의 p_actor 뒤 펼침이 p_actor 를 덮을 수 있다',
      'p_actor 를 받지 않는 RPC other_rpc 에 넘긴다(P_ACTOR_RPCS·마이그레이션과 어긋남)',
      "p_actor 를 .rpc('<p_actor 함수>', { … }) 밖에 적는다 — 출처를 볼 수 없다",
    ])
  })

  it('허용 목록 — 값 식이 같아야 덮는다, 죽은 항목(자리 없음·예외 없이 통과·값 식 다름)과 사유 없음은 실패', () => {
    const lib = "export async function lib(admin, args) { await admin.rpc('rpc_a', { p_actor: args.actorUserId }) }"
    const why = '라이브러리 도우미 — 합성 사유(열두 글자 넘게)'
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', why } })).toEqual([])
    expect(run(lib)).toEqual([expect.stringContaining('s.ts:3 rpc_a 의 p_actor(args.actorUserId) — args 는 export 되거나 이름 없는 함수의 매개변수다')])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actor', why } })).toEqual([
      expect.stringContaining('s.ts:3 rpc_a 의 p_actor(args.actorUserId) — '),
      'ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 값 식 args.actor 이 실제(args.actorUserId)와 다르다',
    ])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', why: '짧음' } })).toEqual(['ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 사유가 없다'])
    expect(run(lib, { 's.ts#rpc_a': { expr: 'args.actorUserId', why }, 's.ts#other': { expr: 'x', why } })).toEqual([
      'ACTOR_SOURCE_EXCEPTIONS s.ts#other: 죽은 항목 — 그 자리가 없다',
    ])
    const direct = "export async function a(p) { const g = await requireProjectAdmin(p); if (!g.ok) return g; await sb.rpc('rpc_a', { p_actor: g.actor.userId }) }"
    expect(run(direct, { 's.ts#rpc_a': { expr: 'g.actor.userId', why } })).toEqual([
      'ACTOR_SOURCE_EXCEPTIONS s.ts#rpc_a: 죽은 항목 — 예외 없이 통과한다(g.actor.userId)',
    ])
  })

  it('마이그레이션 판독 — 여러 줄 인자·모드·괄호 든 기본값·따옴표·주석·다른 스키마, p_actor_id·p_actor_name 은 아니다', () => {
    expect(pActorFunctions([[
      'create or replace function public.one(',
      '  p_event text,',
      '  IN p_actor uuid,',
      '  p_amount numeric(10, 2) default round(1.5, 0)',
      ') returns void language sql as $$ select 1 $$;',
      'CREATE FUNCTION public."two"("p_actor" uuid) RETURNS void LANGUAGE sql AS $$ select 1 $$;',
      'create function public.three(p_actor_id uuid, p_actor_name text) returns void language sql as $$ select 1 $$;',
      '-- create function public.four(p_actor uuid)',
      'create function storage.five(p_actor uuid) returns void language sql as $$ select 1 $$;',
    ].join('\n')])).toEqual(['one', 'two'])
  })
})
