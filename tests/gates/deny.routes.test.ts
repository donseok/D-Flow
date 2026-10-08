// deny — 라우트(판정 P15·P16). 모듈 라우트의 실행 확인은 delegatedTo 파일이 한다 — 여기서는 ① 위임 파일이 그 메서드를 import 하고, 그 메서드를
// 부르는 it 블록 안에서 모듈 거부를 단언하는지(메서드 단위 — 다른 메서드의 거부 단언이 채워 주지 않는다) ② 모듈 라우트 핸들러마다 판정 호출이
// 판정 모듈의 import 이고, 결과를 조건으로 보며, 핸들러 최상위에서 늘 도는지(AST — 결과를 버린 관문·한 가지에만 둔 관문을 잡는다, R3·F1·F2)
// ③ 세션 없는 라우트의 판정 호출이 { client } 를 넘기는지(F8) ④ null 라우트는 관문을 부르지 않는지(AST) ⑤ const 스텁 74 는 인자 없이도, 요청을
// 넘겨도 404 · { error: 'Not Found' } 인지 본다. 설계상 한 갈래에만 관문을 두는 핸들러(닫힌 목록 BRANCH_GATE)는 ② 대신 갈래마다 판정이 그 갈래를
// 지배하는지 보고, 위임 파일에 갈래마다 거부 단언·core 갈래의 관문 비호출 단언이 있는지 본다(과제 20, Ruling [B4 I-1] (b)).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/admin', async () => (await import('./_harness')).adminMock)
vi.mock('@/lib/supabase/server', async () => (await import('./_harness')).serverMock)
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { gateCallsIn, gateSitesIn, parse, siteProblems, tablesInNode, type GateSite } from '../invariants/_ast'
import { UNKNOWN_RPC_PREFIX } from './_rpc-tables'
import { walk } from '../invariants/_walk'
import { enumerateRoutes } from './_enumerate'
import { harness, U } from './_harness'
import { MODULE_TABLE_OWNER } from './_tables'
import { ROUTE_GATES, type GateEntry } from './manifest'

const entries = Object.entries(ROUTE_GATES)
// 하네스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 전역 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })
/** 거부 단언의 흔적 — 오류 상수·기계 코드만(무관한 문자열 'off' 는 세지 않는다). 주석은 세지 않는다(AST 의 식별자·문자열만) */
const DENY_TOKENS = ['ERR_MODULE_DISABLED', 'module_disabled', 'MODULE_DISABLED']
/** 모듈 라우트 핸들러가 부르는 판정 — 관문 둘 + 목록형 둘 + 에이전트 두 원천 AND 헬퍼(과제 18). 원천은 _ast.GATE_SOURCES */
const MODULE_ROUTE_GATES: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule', 'requireScopedSessionModule', 'projectsWithModule', 'workspacesWithModule',
  'requireAgentProject', 'loadGatedOrderForUser', 'accessibleProjectIds'])
/** 세션 없는 라우트(쿠키 없음) — 판정 호출마다 { client: admin } 을 넘겨야 켜진 모듈이 닫히지 않는다(map-gates R-G3, F8) */
const SESSIONLESS: ReadonlySet<GateEntry['guard']> = new Set(['agentPrincipal', 'minutesSecret', 'cronSecret', 'public'])
const CLIENT_GATES: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule', 'moduleState', 'projectsWithModule', 'workspacesWithModule'])

/** 위임 파일에서 그 라우트 모듈의 메서드를 import 한 지역 이름(import { GET } / import { GET as X }) — 없으면 null */
function importedAs(sf: ts.SourceFile, sub: string, method: string): string | null {
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== sub) continue
    const nb = st.importClause?.namedBindings
    const el = nb && ts.isNamedImports(nb) ? nb.elements.find((x) => (x.propertyName ?? x.name).text === method) : undefined
    if (el) return el.name.text
  }
  return null
}
/** it·test(·.each·.only·.concurrent) 블록 — skip·todo 는 세지 않는다 */
function testBlocks(sf: ts.SourceFile): ts.CallExpression[] {
  const out: ts.CallExpression[] = []
  const base = (e: ts.Expression): string | null => {
    if (ts.isIdentifier(e)) return e.text
    if (ts.isPropertyAccessExpression(e)) return ['skip', 'todo', 'skipIf', 'fails'].includes(e.name.text) ? null : base(e.expression)
    if (ts.isCallExpression(e)) return base(e.expression)                                  // it.each(table)(title, fn)
    return null
  }
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ['it', 'test'].includes(base(n.expression) ?? '') && n.arguments.some((a) => ts.isFunctionLike(a))) out.push(n)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}
/** 블록(과 그 블록이 부르는 같은 파일 최상위 함수)에 hit 인 노드가 있는가 */
function reaches(sf: ts.SourceFile, block: ts.Node, hit: (n: ts.Node) => boolean): boolean {
  const helpers = new Map<string, ts.Node>()
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) helpers.set(s.name.text, s.body)
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && ts.isFunctionLike(d.initializer)) helpers.set(d.name.text, d.initializer)
  }
  const seen = new Set<string>()
  const look = (n: ts.Node): boolean => {
    if (hit(n)) return true
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const h = helpers.get(n.expression.text)
      if (h && !seen.has(n.expression.text)) { seen.add(n.expression.text); if (look(h)) return true }
    }
    return ts.forEachChild(n, look) ?? false
  }
  return look(block)
}
/** 블록(과 그 블록이 부르는 같은 파일 최상위 함수)이 local 을 부르는가 */
const callsIn = (sf: ts.SourceFile, block: ts.Node, local: string): boolean =>
  reaches(sf, block, (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === local)
/** 식별자·문자열 리터럴의 거부 흔적(주석 제외) */
function tokenIn(node: ts.Node): boolean {
  const look = (n: ts.Node): boolean => {
    if (ts.isIdentifier(n) && DENY_TOKENS.includes(n.text)) return true
    if (ts.isStringLiteralLike(n) && DENY_TOKENS.some((t) => n.text.includes(t))) return true
    return ts.forEachChild(n, look) ?? false
  }
  return look(node)
}
/** expect(…).matcher(…) 사슬의 뿌리 expect 호출(없으면 null) */
const expectRoot = (c: ts.CallExpression): ts.CallExpression | null => {
  let e: ts.Expression = c.expression
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) {
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'expect') return e
    e = e.expression
  }
  return null
}
const expectRooted = (c: ts.CallExpression): boolean => expectRoot(c) !== null
/** 부정 사슬이다 — expect(x).not.toMatchObject(…) 뿐 아니라 expect(x).resolves.not.toBe(…) 도 "그 코드가 **없어야** 한다"를 말한다.
 *  사슬 안에서만 걷는다(인자 경계에서 멈춘다) — 바깥 expect 의 부정이 안쪽 expect 를 부정으로 만들지 않게 하는 것이 목적이다(F-1) */
const negated = (c: ts.CallExpression): boolean => {
  const r = expectRoot(c)
  if (!r) return false
  let e: ts.Node = r.parent
  while (e && (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) || ts.isAwaitExpression(e) || ts.isElementAccessExpression(e))) {
    if (ts.isPropertyAccessExpression(e) && e.name.text === 'not') return true
    e = e.parent
  }
  return false
}
/** 블록 안의 거부 단언 — 거부 흔적이 expect 사슬(대상·매처 인자) 안에 있어야 하고 **부정이 아니어야** 한다.
 *  mock 준비(mockResolvedValue 의 ERR_MODULE_DISABLED)·주석은 단언이 아니다 */
function hasDenyToken(block: ts.Node): boolean {
  const look = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && expectRooted(n) && !negated(n) && tokenIn(n)) return true
    return ts.forEachChild(n, look) ?? false
  }
  return look(block)
}
/** 위임 파일 한 곳의 메서드 단위 확인 — 문제 목록 */
function delegationProblems(key: string, e: GateEntry, f: string, text: string): string[] {
  const [file, method] = key.split('#')
  const sub = file.replace(/^src\/app\//, '@/app/').replace(/\.tsx?$/, '')
  const sf = parse(f, text)
  if (e.delegatedStatic) {
    // v1 에이전트 — 판정은 파일 밖 헬퍼(requireAgentProject·loadGatedOrderForUser)이고 꺼지면 404 not_found(존재 은닉)라 응답에 거부 토큰이 없다.
    // 실행 확인은 세 라우트 테스트가 한다(note). 여기서는 경로와 코드 안의 거부 흔적(주석 제외 — 두 원천 AND 의 거부 mock)만 보고,
    // 메서드 단위 보장은 핸들러 쪽 AST 케이스(판정 원천·결과 사용·최상위 지배)가 맡는다
    if (!text.includes(`'${sub}'`)) return [`${key}: ${f} 에 경로 '${sub}' 가 없다(delegatedStatic)`]
    return tokenIn(sf) ? [] : [`${key}: ${f} 에 모듈 거부 흔적(코드)이 없다`]
  }
  const local = importedAs(sf, sub, method)
  if (!local) return [`${key}: ${f} 가 ${sub} 에서 ${method} 를 import 하지 않는다`]
  const ok = testBlocks(sf).some((b) => callsIn(sf, b, local) && hasDenyToken(b))
  return ok ? [] : [`${key}: ${f} 에 ${method}(${local}) 를 부르며 모듈 거부를 단언하는 it 블록이 없다(메서드 단위)`]
}
/** 모듈 라우트 핸들러 한 메서드의 판정 확인 — 문제 목록 */
function handlerProblems(key: string, sites: readonly GateSite[]): string[] {
  if (!sites.length) return [`${key}: 판정 호출이 없다`]
  const out = sites.flatMap(siteProblems).map((p) => `${key}${p}`)
  if (!sites.some((s) => s.bound && s.checked && s.topLevel)) out.push(`${key}: 판정이 본문을 지배하지 않는다 — 핸들러 최상위 문에서 늘 도는 판정 호출이 없다(조건·try·단락 평가 안)`)
  return out
}
/** 세션 없는 라우트의 판정 호출 — requireSessionModule 금지, 나머지는 옵션 인자에 client */
function clientProblems(key: string, sites: readonly GateSite[]): string[] {
  return sites.flatMap((s) => {
    if (s.name === 'requireSessionModule' || s.name === 'requireScopedSessionModule') return [`${key}:${s.line} 세션 없는 라우트가 ${s.name} 을 부른다`]
    const opts = s.call.arguments[2]
    const ok = !!opts && ts.isObjectLiteralExpression(opts) && opts.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === 'client')
    return ok ? [] : [`${key}:${s.line} ${s.name} 에 { client } 가 없다(쿠키 없는 세션 클라이언트는 설정 0행 — 켜진 모듈이 닫힌다)`]
  })
}
/** 설계상 한 갈래에만 관문을 두는 모듈 라우트 핸들러(닫힌 목록 — 항목마다 사유, Ruling [B4 I-1] (b)). 여기 없는 핸들러는 최상위 판정이 본문을
 *  지배해야 한다. gated: 핸들러의 갈래 if 조건 원문 → 위임 파일에서 그 갈래를 고르는 요청의 표지(문자열 조각 — 낱말 경계로 찾는다). 판정은
 *  갈래 if 의 then 블록에서 늘 돌아야 하고(가지·try·단락 평가 안이면 FAIL), 그 if 는 핸들러 몸의 최상위(try 블록·else if 사슬 포함)여야 한다.
 *  ungated: 관문 앞에 조기 반환만 하는 최상위 if 의 조건 원문 → 사유(400·세션 가드 등). 그 then 블록은 **단일 return 문**일 때만 인정한다.
 *  core: 마지막 gated 갈래 뒤 구간 — 그 뒤의 최상위 if 는 관문 없는 것이 설계다(core 를 안 쓴 핸들러에는 그 구간이 없다).
 *  위임 파일은 갈래마다 그 표지만 품고 거부를 단언하는 it 을, core 가 있으면 어느 갈래 표지도 없이 관문 비호출을 단언하는 it 을 둔다 */
type BranchGate = { reason: string; gated: Readonly<Record<string, string>>; ungated?: Readonly<Record<string, string>>; core?: string }
const BRANCH_GATE: Readonly<Record<string, BranchGate>> = {
  'src/app/api/minutes/chat/route.ts#POST': {
    reason: '두 모드의 판정 범위가 다르다 — 문서 모드는 회의록 행의 워크스페이스(resolveScope 뒤), 보관함 모드는 요청의 워크스페이스(소속 확인 — D26, 과제 34). 모드 밖 요청은 400 뿐이라 core 갈래가 없다',
    gated: { "body.mode === 'doc'": 'doc', "body.mode === 'archive'": 'archive' },
    ungated: {
      '!(await getSession())': '로그인 가드',
      '!message': '질문 없음 400',
      'message.length > 2000': '질문 2000자 초과 400',
    },
  },
}
const LOGICAL: ReadonlySet<ts.SyntaxKind> = new Set([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken])
/** 판정 호출이 늘 도는 갈래의 if 조건 원문 — 호출에서 위로 가지·try·반복·단락 평가를 지나지 않고 닿는 첫 블록이 if 의 then 블록이고, 그 if 가
 *  fnBody 의 최상위 문(try 블록 안·else if 사슬 포함)이면 그 조건, 아니면 null(최상위 판정·다른 조건 안에 숨은 갈래·지역 헬퍼 안도 null) */
function branchOf(sf: ts.SourceFile, call: ts.Node, fnBody: ts.Node): string | null {
  let block: ts.Block | undefined
  for (let cur: ts.Node = call; cur.parent && !block; cur = cur.parent) {
    const p = cur.parent
    if (ts.isBlock(p)) block = p
    else if (ts.isFunctionLike(p) || ts.isTryStatement(p) || ts.isIterationStatement(p, false) || ts.isCaseClause(p) || ts.isDefaultClause(p) || ts.isSourceFile(p)) return null
    else if (ts.isIfStatement(p) && p.expression !== cur) return null
    else if (ts.isBinaryExpression(p) && p.right === cur && LOGICAL.has(p.operatorToken.kind)) return null
    else if (ts.isConditionalExpression(p) && p.condition !== cur) return null
  }
  if (!block || !ts.isIfStatement(block.parent) || block.parent.thenStatement !== block) return null
  const branch = block.parent
  for (let cur: ts.Node = branch; cur.parent; cur = cur.parent) {
    const p = cur.parent
    if (p === fnBody) return branch.expression.getText(sf)
    if (ts.isIfStatement(p) && p.elseStatement === cur) continue
    if (ts.isBlock(p) && ts.isTryStatement(p.parent) && p.parent.tryBlock === p) continue
    if (ts.isTryStatement(p) && p.tryBlock === cur) continue
    return null
  }
  return null
}
/** export 핸들러의 몸 — function 선언·const 화살표/함수식 */
function handlerBody(sf: ts.SourceFile, name: string): ts.Node | undefined {
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name) return s.body
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) return d.initializer.body
    }
  }
  return undefined
}
/** 핸들러 몸의 최상위 if 사슬(else if 도 한 갈래) — 소스 순서로. 최상위 try 블록은 통과한다(branchOf 도 try 를 통과시킨다 — 실패는
 *  catch 가 응답하고 끝나므로 그 안 if 는 갈래다). if 안에 숨은 갈래·반복문·중첩 함수는 최상위 문이 아니므로 없다 */
/** 최상위 분기 하나 — if 사슬의 각 갈래, 그리고 switch 한 벌. `then` 이 null 이면 조기 반환 가드로 인정될 수 없다(switch) */
type TopBranch = { label: string; node: ts.Node; then: ts.Statement | null }
function topLevelBranches(sf: ts.SourceFile, body: ts.Node | undefined): TopBranch[] {
  if (!body || !ts.isBlock(body)) return []
  const out: TopBranch[] = []
  const scan = (stmts: readonly ts.Statement[]): void => {
    for (const st of stmts) {
      if (ts.isIfStatement(st)) {
        let cur: ts.IfStatement = st
        for (;;) {
          out.push({ label: cur.expression.getText(sf), node: cur, then: cur.thenStatement })
          const els = cur.elseStatement
          if (els === undefined || !ts.isIfStatement(els)) break
          cur = els
        }
      } else if (ts.isSwitchStatement(st)) {
        // switch 도 갈래다 — 코어 구간에 숨은 "토글 모듈 표를 읽는 switch" 가 갈래 목록 밖으로 빠져나가지 않게(F-2)
        out.push({ label: `switch ${st.expression.getText(sf)}`, node: st, then: null })
      } else if (ts.isTryStatement(st)) scan(st.tryBlock.statements)
    }
  }
  scan(body.statements)
  return out
}
/** 조기 반환 가드로 인정되는 then 블록 — 단일 return 문뿐(본문이 붙으면 가드가 아니다) */
const singleReturn = (s: ts.Statement): boolean =>
  ts.isReturnStatement(s) || (ts.isBlock(s) && s.statements.length === 1 && ts.isReturnStatement(s.statements[0]))
/** if 사슬(if … else if … else …)이 끝나는 위치 — core 구간의 시작을 재는 데 쓴다 */
function ifChainEnd(b: ts.IfStatement): number {
  let cur: ts.IfStatement = b
  for (;;) {
    const els = cur.elseStatement
    if (els === undefined) return cur.end
    if (!ts.isIfStatement(els)) return els.end
    cur = els
  }
}
/** 노드가 토글 모듈 소유 표를 직접 만지는가 — 없는 파일의 임포트 로더는 못 본다(한계는 코드 주석) */
function moduleTablesInNode(sf: ts.SourceFile, node: ts.Node): string[] {
  return tablesInNode(sf, node).filter((t) => MODULE_TABLE_OWNER[t])
}
/** 노드가 부르는 대응 없는 RPC(`rpc?:<이름>` 표지)의 이름 — 소유 표를 모르니 관문 없는 갈래에서는 실패로 센다(K4·D25, 액션 축과 같다) */
function unknownRpcsInNode(sf: ts.SourceFile, node: ts.Node): string[] {
  return tablesInNode(sf, node).filter((t) => t.startsWith(UNKNOWN_RPC_PREFIX)).map((t) => t.slice(UNKNOWN_RPC_PREFIX.length))
}
const unknownRpcTail = (names: readonly string[]) => `소유 표를 모르는 RPC ${names.join(', ')} 를 부른다 — tests/gates/_rpc-tables.ts 에 대응을 적는다`
/** BRANCH_GATE 핸들러의 판정 확인 — 모든 판정이 원천·결과 사용을 지키고, 목록의 갈래 블록에서 늘 돌며, 갈래마다 판정이 있고,
 *  최상위 if 는 전부 목록(관문 갈래·조기 반환 가드)이나 core 구간에 속한다(B4 T20-I1 — 목록 밖 갈래의 무관문 본문은 목록으로 덮이지 않는다) */
function branchProblems(key: string, bg: BranchGate, sf: ts.SourceFile, sites: readonly GateSite[]): string[] {
  if (!sites.length) return [`${key}: 판정 호출이 없다`]
  const body = handlerBody(sf, key.split('#')[1])
  const out = sites.flatMap(siteProblems).map((p) => `${key}${p}`)
  const seen = new Set<string>()
  for (const s of sites) {
    const b = body ? branchOf(sf, s.call, body) : null
    if (b !== null && b in bg.gated) seen.add(b)
    else out.push(`${key}:${s.line} ${s.name} 가 목록의 갈래(${Object.keys(bg.gated).join(' | ')}) 블록에서 늘 도는 자리가 아니다`)
  }
  for (const w of Object.keys(bg.gated)) if (!seen.has(w)) out.push(`${key}: 갈래 ${w} 에 판정이 없다`)
  const ungated = bg.ungated ?? {}
  const branches = topLevelBranches(sf, body)
  const gatedIfEnds = branches.flatMap((x) => (x.label in bg.gated && ts.isIfStatement(x.node) ? [ifChainEnd(x.node)] : []))
  const coreFrom = bg.core === undefined ? Number.POSITIVE_INFINITY : Math.max(-1, ...gatedIfEnds)
  for (const b of branches) {
    const c = b.label
    if (c in bg.gated || c in ungated) continue
    // ① 모양 — 목록 밖 갈래는 core 구간이 아니면 실패한다(세션 가드까지 열거해 목록의 완전성을 본다)
    if (b.node.getStart(sf) <= coreFrom) {
      out.push(`${key}: 최상위 갈래 ${c} 가 목록(관문 ${Object.keys(bg.gated).join(' | ') || '(없음)'} · 조기 반환 ${Object.keys(ungated).join(' | ') || '(없음)'})에도 core 구간에도 없다 — 본문이 있는 갈래는 관문 뒤여야 한다`)
      continue
    }
    // ② 데이터 — core 구간이라도 토글 모듈 표를 직접 만지면 실패한다(F-2). 예전 판정은 "마지막 관문 갈래 뒤면 면제"였고 그 면제는
    //    무한했다 — 최종 리뷰가 그 면제 안에 weekly_reports 를 읽는 갈래를 넣고 8543 테스트가 초록인 것을 실측했다.
    //    에러 가드(NextResponse 반환)와 core 폴스루는 표에 닿지 않으므로 통과한다(가짜 양성 대조는 민감도 it 에 있다)
    //    대응 없는 RPC 도 실패다(K4) — 그 RPC 가 모듈 표를 쓰는지 모른다. 한계: 최상위 if·switch 밖의 core 폴스루 문장은 보지 않는다
    const where = `${key}: 최상위 갈래 ${c} 가 목록(관문 ${Object.keys(bg.gated).join(' | ') || '(없음)'} · 조기 반환 ${Object.keys(ungated).join(' | ') || '(없음)'})에도 없고 core 구간(${bg.core}) 안이면서`
    const hits = moduleTablesInNode(sf, b.node)
    if (hits.length) {
      out.push(`${where} 토글 모듈의 표 ${hits.map((t) => `${t}(${MODULE_TABLE_OWNER[t]})`).join(', ')} 를 직접 만진다 — 꺼진 뒤에도 그 데이터가 읽히거나 바뀐다`)
    }
    const unknown = unknownRpcsInNode(sf, b.node)
    if (unknown.length) out.push(`${where} ${unknownRpcTail(unknown)}`)
  }
  for (const [c, why] of Object.entries(ungated)) {
    const b = branches.find((x) => x.label === c)
    if (!b) out.push(`${key}: 조기 반환 목록 ${c} 가 핸들러에 없다(죽은 항목)`)
    else if (b.then === null || !singleReturn(b.then)) out.push(`${key}: 조기 반환 목록 ${c} 의 then 블록이 단일 return 문이 아니다 — 본문이 붙으면 관문 갈래다(사유: ${why})`)
    else {
      // 단일 return 이라도 관문 없는 갈래다 — 대응 없는 RPC·토글 모듈 표를 부르면 실패(K4). then 블록만이 아니라 조건식까지(if 전체 — A1-1 재리뷰
      // P3: `if (!(await sb.rpc('x'))) return bad` 처럼 조건에 둔 호출을 놓쳤다). 조건 + 단일 return 이라 거짓 양성 위험이 거의 없다
      const unknown = unknownRpcsInNode(sf, b.node)
      if (unknown.length) out.push(`${key}: 조기 반환 목록 ${c} 의 갈래가 ${unknownRpcTail(unknown)}`)
      const hits = moduleTablesInNode(sf, b.node)
      if (hits.length) {
        out.push(`${key}: 조기 반환 목록 ${c} 의 갈래가 토글 모듈의 표 ${hits.map((t) => `${t}(${MODULE_TABLE_OWNER[t]})`).join(', ')} 를 직접 만진다`)
      }
    }
  }
  return out
}
/** it 블록의 몸(제목 제외 — 제목의 낱말은 갈래 표지가 아니다) */
const bodyOf = (b: ts.CallExpression): ts.Node => [...b.arguments].reverse().find((a) => ts.isFunctionLike(a)) ?? b
/** 블록 몸(과 부르는 같은 파일 최상위 함수)의 문자열·템플릿 조각에 표지가 낱말 경계로 있는가 */
function markerIn(sf: ts.SourceFile, block: ts.CallExpression, marker: string): boolean {
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(^|[^A-Za-z0-9_])${esc}($|[^A-Za-z0-9_])`)
  return reaches(sf, bodyOf(block), (n) => (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && re.test(n.text))
}
/** expect(<판정>).not.toHaveBeenCalled() — core 갈래가 관문을 부르지 않았다는 단언 */
function assertsNoGate(block: ts.Node): boolean {
  const look = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'toHaveBeenCalled'
      && ts.isPropertyAccessExpression(n.expression.expression) && n.expression.expression.name.text === 'not') {
      const e = n.expression.expression.expression
      if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'expect' && e.arguments.length === 1
        && ts.isIdentifier(e.arguments[0]) && MODULE_ROUTE_GATES.has(e.arguments[0].text)) return true
    }
    return ts.forEachChild(n, look) ?? false
  }
  return look(block)
}
/** BRANCH_GATE 핸들러의 위임 확인 — 갈래마다 그 표지만 품고 거부를 단언하는 it, core 는 어느 표지도 없이 관문 비호출을 단언하는 it */
function branchDelegationProblems(key: string, bg: BranchGate, f: string, text: string): string[] {
  const [file, method] = key.split('#')
  const sub = file.replace(/^src\/app\//, '@/app/').replace(/\.tsx?$/, '')
  const sf = parse(f, text)
  const local = importedAs(sf, sub, method)
  if (!local) return [`${key}: ${f} 가 ${sub} 에서 ${method} 를 import 하지 않는다`]
  const blocks = testBlocks(sf).filter((b) => callsIn(sf, b, local))
  const markers = Object.values(bg.gated)
  const only = (b: ts.CallExpression, m: string | null) => markers.every((o) => (o === m) === markerIn(sf, b, o))
  const out: string[] = []
  for (const [when, marker] of Object.entries(bg.gated)) {
    if (!blocks.some((b) => only(b, marker) && hasDenyToken(b))) out.push(`${key}: ${f} 에 갈래 ${when}(표지 '${marker}')만 부르며 모듈 거부를 단언하는 it 블록이 없다`)
  }
  if (bg.core !== undefined && !blocks.some((b) => only(b, null) && assertsNoGate(b))) {
    out.push(`${key}: ${f} 에 core 갈래(${bg.core})가 갈래 표지 없이 관문을 부르지 않았음을 단언하는 it 블록이 없다`)
  }
  return out
}
const moduleRoutes = entries.filter(([, e]) => e.module !== null)
const sfOf = (key: string) => { const file = key.split('#')[0]; return parse(file, readFileSync(file, 'utf8')) }
const sitesOf = (key: string, names: ReadonlySet<string>) => gateSitesIn(sfOf(key), key.split('#')[1], names)

describe('deny — 라우트', () => {
  it('모듈 라우트의 위임 파일이 있고, 그 메서드를 import 하며, 그 메서드를 부르는 it 블록이 거부를 단언한다', () => {
    const bad = moduleRoutes.flatMap(([key, e]) => {
      const f = e.delegatedTo!
      if (!existsSync(f)) return [`${key}: ${f} 없음`]
      const text = readFileSync(f, 'utf8')
      const bg = BRANCH_GATE[key]
      return [...delegationProblems(key, e, f, text), ...(bg ? branchDelegationProblems(key, bg, f, text) : [])]
    })
    expect(bad).toEqual([])
  })
  it('모듈 라우트 핸들러는 판정 모듈의 판정을 부르고, 결과를 조건으로 보며, 최상위에서 늘 돈다 — 메서드 단위(R3·F1·F2). BRANCH_GATE 는 갈래마다', () => {
    expect(moduleRoutes.flatMap(([key]) => {
      const sf = sfOf(key)                                         // 판정 자리와 핸들러 몸은 같은 구문 트리에서 — branchOf 가 노드 동일성으로 멈춘다
      const sites = gateSitesIn(sf, key.split('#')[1], MODULE_ROUTE_GATES)
      const bg = BRANCH_GATE[key]
      return bg ? branchProblems(key, bg, sf, sites) : handlerProblems(key, sites)
    })).toEqual([])
  })
  it('모듈 라우트 항목이 0건이 아니다 — vitest 4 의 it.each([]) 은 0개를 만들고 실패하지 않는다(빈 필터의 조용한 무효화)', () => {
    expect(moduleRoutes.length, '모듈 라우트 항목 0건 — 필터가 조용히 비었다').toBeGreaterThan(25)
  })
  it('BRANCH_GATE 는 검사 대상 모듈 라우트 항목이고 사유·갈래가 있다(닫힌 목록)', () => {
    const moduleRouteKeys = new Set(moduleRoutes.map(([key]) => key))
    const bad = Object.entries(BRANCH_GATE).flatMap(([key, bg]) => [
      ...(moduleRouteKeys.has(key) ? [] : [`${key}: 검사 대상 모듈 라우트 항목이 아니다`]),
      ...(bg.reason.trim() ? [] : [`${key}: 사유 없음`]),
      ...(Object.keys(bg.gated).length ? [] : [`${key}: 갈래 없음`]),
      ...Object.values(bg.gated).filter((m) => !m.trim()).map(() => `${key}: 빈 표지`),
      ...Object.entries(bg.ungated ?? {}).filter(([cond]) => cond in bg.gated).map(([cond]) => `${key}: ${cond} 가 관문 갈래와 조기 반환에 둘 다 있다`),
      ...Object.entries(bg.ungated ?? {}).filter(([, why]) => !why.trim()).map(([cond]) => `${key}: 조기 반환 ${cond} 사유 없음`),
    ])
    expect(bad).toEqual([])
  })
  it('세션 없는 라우트(에이전트·회의록 API·크론·공개)의 판정 호출은 { client } 를 넘긴다(F8)', () => {
    expect(entries.filter(([, e]) => SESSIONLESS.has(e.guard)).flatMap(([key]) => clientProblems(key, sitesOf(key, CLIENT_GATES)))).toEqual([])
  })
  it('module null 라우트는 관문을 부르지 않는다(워커는 moduleState — 관문 목록 밖)', () => {
    const bad = entries.filter(([, e]) => e.module === null).flatMap(([key]) => {
      const [file, name] = key.split('#')
      const calls = gateCallsIn(parse(file, readFileSync(file, 'utf8')), name)
      return calls.length ? [`${key}: ${calls.join(',')}`] : []
    })
    expect(bad).toEqual([])
  })
  it('const 스텁은 인자 없이도·요청을 넘겨도 404 · error Not Found 이고 admin 을 만들지 않는다(P16·F9 b)', async () => {
    // 매니페스트가 아니라 트리 전체에서 찾는다 — 함수 핸들러 없이 스텁만 있는 파일·v1 밖의 스텁도 실행으로 본다
    const files = walk('src/app/api', undefined, /^route\.tsx?$/)
    const { stubs } = enumerateRoutes(files.map((rel) => ({ rel, text: readFileSync(rel, 'utf8') })))
    expect(stubs.length).toBeGreaterThan(50)
    harness.reset()
    for (const s of stubs) {
      const [file, name] = s.key.split('#')
      const mod = (await import(/* @vite-ignore */ join(process.cwd(), file))) as Record<string, (...a: unknown[]) => Promise<Response> | Response>
      // import 는 모듈 그래프의 부팅 코드(llm-override·팀 마스터 최초 로드)로 admin 을 만들 수 있다(실측: 첫 스텁 파일 import 에서 2회) — 호출만 잰다
      const before = harness.adminCreated()
      const withBody = !['GET', 'HEAD', 'OPTIONS'].includes(name)
      const req = new Request(`http://localhost${file.replace(/^src\/app/, '').replace(/\/route\.tsx?$/, '')}`, {
        method: name, headers: { 'content-type': 'application/json', authorization: 'Bearer x' }, ...(withBody ? { body: '{}' } : {}),
      })
      for (const res of [await mod[name](), await mod[name](req, { params: Promise.resolve({ id: U }) })]) {
        expect(res.status, s.key).toBe(404)
        expect(((await res.json()) as { error?: string }).error, s.key).toBe('Not Found')
      }
      expect(harness.adminCreated() - before, `${s.key} 가 호출에서 admin 을 만들었다`).toBe(0)
    }
  }, 60_000)
})

describe('deny — 라우트 판별기 민감도(합성 소스)', () => {
  const route = [
    "import { requireModule, projectsWithModule } from '@/lib/modules/gate'",
    "import { requireAgentProject } from '@/lib/agent/externalApi'",
    "async function requireLocal() { return true }",
    "export async function GET(req) { const g = await requireProjectMember(p); if (!g.ok) return x; const mod = await requireModule({ projectId: p }, 'wiki'); if (!mod.ok) return deny; return ok }",
    "export async function POST(req) { await requireModule({ projectId: p }, 'wiki'); return ok }",
    "export async function PUT(req) { if (p) { const mod = await requireModule({ projectId: p }, 'wiki'); if (!mod.ok) return deny } return ok }",
    "export async function PATCH(req) { if (!(await requireLocal())) return deny; return ok }",
    "export async function DELETE(req) { if (!(await requireAgentProject(admin, p))) return deny; const ids = await projectsWithModule(list, 'agents'); return ids }",
    "export async function HEAD(req) { const mod = await requireModule({ projectId: p }, 'agents', { client: admin }); if (!mod.ok) return deny; return ok }",
  ].join('\n')
  const sf = parse('src/app/api/x/route.ts', route)
  const probs = (m: string) => handlerProblems(`x#${m}`, gateSitesIn(sf, m, MODULE_ROUTE_GATES))
  it('결과를 버린 관문·가지 안의 관문·판정 모듈이 아닌 흉내를 잡는다(F2 — H3)', () => {
    expect(probs('GET')).toEqual([])
    expect(probs('POST')).toEqual(['x#POST:5 requireModule 의 결과를 버린다', 'x#POST: 판정이 본문을 지배하지 않는다 — 핸들러 최상위 문에서 늘 도는 판정 호출이 없다(조건·try·단락 평가 안)'])
    expect(probs('PUT')).toEqual(['x#PUT: 판정이 본문을 지배하지 않는다 — 핸들러 최상위 문에서 늘 도는 판정 호출이 없다(조건·try·단락 평가 안)'])
    expect(probs('PATCH')).toEqual(['x#PATCH: 판정 호출이 없다'])
    expect(probs('DELETE')).toEqual([])
  })
  it('try 안의 판정은 catch 가 로그 뒤 고정 응답만 할 때만 최상위다 — 삼키는 catch·일하는 catch·finally·가지 안의 try 는 잡는다(과제 18)', () => {
    const G = "if (!(await requireAgentProject(admin, p))) return deny"
    const tsrc = [
      "import { requireAgentProject } from '@/lib/agent/externalApi'",
      "import { apiInternalError } from '@/lib/agent/externalApi'",
      `export async function GET(req) { try { const a = mk(); ${G}; return body(a) } catch (e) { console.error('x', e); return apiInternalError() } }`,
      `export async function POST(req) { try { ${G} } catch (e) { console.error('x', e) } return body() }`,
      `export async function PUT(req) { try { ${G}; return body() } catch (e) { await admin.from('t').insert({}); return apiInternalError() } }`,
      `export async function PATCH(req) { try { ${G}; return body() } catch (e) { return apiInternalError() } finally { body() } }`,
      `export async function DELETE(req) { try { ${G}; return body() } catch (e) { console.error(e); return body(admin) } }`,
      `export async function HEAD(req) { if (q) { try { ${G} } catch (e) { return apiInternalError() } } return body() }`,
      `export async function OPTIONS(req) { try { try { ${G} } catch (e) { throw e } ; return body() } catch (e) { console.warn(e); return apiInternalError('실패') } }`,
      `async function gate(a,p) { try { if (!(await requireAgentProject(a, p))) return false } catch (e) { console.error(e); return apiInternalError() } return true }\nexport async function PROPFIND(req) { if (!await gate(admin, p)) return deny; return body() }`,
      `export async function TRACE(req) { try { ${G}; return body() } catch (e) { return apiInternalError(body()) } }`,
      `export async function CONNECT(req) { try { ${G}; return body() } catch (e) { audit.write(e); return apiInternalError() } }`,
      `export async function MKCOL(req) { try { ${G}; return body() } catch (e) { console.error(await write()); return apiInternalError() } }`,
      `export async function COPY(req) { try { ${G}; return body() } catch (e) { throw await body(admin) } }`,
      `export async function MOVE(req) { L: try { ${G}; break L; } catch (e) { console.error(e); return apiInternalError() } return body() }`
    ].join('\n')
    const tf = parse('src/app/api/y/route.ts', tsrc)
    const p = (m: string) => handlerProblems(`y#${m}`, gateSitesIn(tf, m, MODULE_ROUTE_GATES))
    const notTop = (m: string) => [`y#${m}: 판정이 본문을 지배하지 않는다 — 핸들러 최상위 문에서 늘 도는 판정 호출이 없다(조건·try·단락 평가 안)`]
    expect(p('GET')).toEqual([])
    expect(p('OPTIONS'), '중첩 try 도 둘 다 로그 뒤 응답·재던짐이면 최상위').toEqual([])
    expect(p('POST'), '삼키는 catch — try 뒤 본문이 판정 없이 돈다').toEqual(notTop('POST'))
    expect(p('PUT'), 'catch 가 일을 한다').toEqual(notTop('PUT'))
    expect(p('PATCH'), 'finally').toEqual(notTop('PATCH'))
    expect(p('DELETE'), '닫힌 목록 밖의 응답(본문 호출)').toEqual(notTop('DELETE'))
    expect(p('HEAD'), '가지 안의 try').toEqual(notTop('HEAD'))
    expect(p('PROPFIND'), '지역 헬퍼 안의 exitOnlyCatch 는 최상위가 아님').toEqual(notTop('PROPFIND'))
    expect(p('TRACE'), 'apiInternalError 에 함수 호출이 포함됨').toEqual(notTop('TRACE'))
    expect(p('CONNECT'), 'catch 문에 audit.write 가 포함됨').toEqual(notTop('CONNECT'))
    expect(p('MKCOL'), 'console.error 에 await 가 포함됨').toEqual(notTop('MKCOL'))
    expect(p('COPY'), 'throw 식에 함수 호출이 포함됨').toEqual(notTop('COPY'))
    expect(p('MOVE'), '라벨 break').toEqual(notTop('MOVE'))
  })
  it('세션 없는 라우트의 { client } 누락을 잡는다(F8)', () => {
    expect(clientProblems('x#GET', gateSitesIn(sf, 'GET', CLIENT_GATES))).toEqual(["x#GET:4 requireModule 에 { client } 가 없다(쿠키 없는 세션 클라이언트는 설정 0행 — 켜진 모듈이 닫힌다)"])
    expect(clientProblems('x#HEAD', gateSitesIn(sf, 'HEAD', CLIENT_GATES))).toEqual([])
  })
  it('위임 파일: 그 메서드를 부르는 it 안의 거부 단언만 센다 — 다른 메서드의 거부 단언·mock 준비·주석의 토큰은 채워 주지 않는다(F2 — H3)', () => {
    const e: GateEntry = { guard: 'session', module: 'wiki', note: '로그인', delegatedTo: 't.test.ts' }
    const file = (...its: string[]) => [
      "import { GET, POST as post } from '@/app/api/wiki/search/route'",
      "import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'",
      'const callGet = () => GET(req())',
      ...its,
    ].join('\n')
    const onlyPost = file("it('POST 꺼짐', async () => { expect(await (await post(req())).json()).toMatchObject({ error: ERR_MODULE_DISABLED }) })\nit('GET 켜짐', async () => { expect((await GET(req())).status).toBe(200) }) // ERR_MODULE_DISABLED")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', onlyPost)).toEqual(['src/app/api/wiki/search/route.ts#GET: t.test.ts 에 GET(GET) 를 부르며 모듈 거부를 단언하는 it 블록이 없다(메서드 단위)'])
    expect(delegationProblems('src/app/api/wiki/search/route.ts#POST', e, 't.test.ts', onlyPost)).toEqual([])
    const viaHelper = file("it.each([1])('GET 꺼짐 %s', async () => { expect((await callGet()).status).toBe(404); expect(code).toBe('module_disabled') })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', viaHelper)).toEqual([])
    const mockOnly = file("it('GET 꺼짐', async () => { vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED }); expect((await GET(req())).status).toBe(404) })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', mockOnly), 'mock 준비의 토큰은 단언이 아니다').toHaveLength(1)
    const stat: GateEntry = { ...e, guard: 'agentPrincipal', module: 'agents', delegatedStatic: '두 원천 AND — 실행은 라우트 테스트' }
    const staticFile = "const V1 = ['@/app/api/v1/agent/me/route'] // ERR_MODULE_DISABLED\nit('자리', () => { expect(src).toMatch(/requireAgentProject/) })"
    expect(delegationProblems('src/app/api/v1/agent/me/route.ts#GET', stat, 'a.test.ts', staticFile), 'delegatedStatic — 주석의 토큰은 흔적이 아니다').toHaveLength(1)
    expect(delegationProblems('src/app/api/v1/agent/me/route.ts#GET', stat, 'a.test.ts', `import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'\n${staticFile}`)).toEqual([])
    const skipped = file("it.skip('GET 꺼짐', async () => { await GET(req()); expect(x).toBe(ERR_MODULE_DISABLED) })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', skipped)).toHaveLength(1)
    // 부정 단언은 "거부가 났는가"의 반대다 — 파일에 토큰이 있어도 비부정 단언 없으면 통과로 치지 않는다(B4 m-3)
    const deniedIt = "it('GET 꺼짐', async () => { expect(await (await GET(req())).json()).toMatchObject({ error: ERR_MODULE_DISABLED }) })"
    const negatedOnly = file("it('GET 꺼짐', async () => { expect(await (await GET(req())).json()).not.toMatchObject({ code: 'module_disabled' }) })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', negatedOnly), '부정 단언은 거부를 말하지 않는다').toHaveLength(1)
    const negatedHelper = file("it('GET 꺼짐', async () => { expect(await (await callGet()).json()).not.toBe(ERR_MODULE_DISABLED) })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', negatedHelper), 'not.toBe(ERR_MODULE_DISABLED) 도 부정이다').toHaveLength(1)
    // F-1 — 최종 리뷰가 실제 exploits 한 축. .resolves.not / .rejects.not 은 한 겹 더 깊어서 사슬의 첫 단계만 보면 놓친다
    const resolvedNot = file("it('GET 꺼짐', async () => { expect(resolve(await (await callGet()).json())).not.toMatchObject({ error: ERR_MODULE_DISABLED }) })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', resolvedNot), '.resolves.not 도 부정이다').toHaveLength(1)
    const rejectsNot = file("it('GET 꺼짐', async () => { expect(reject()).rejects.not.toThrow() })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', rejectsNot), '.rejects.not 도 부정이다').toHaveLength(1)
    // 대조 — 바깥 expect 의 부정이 안쪽 expect 를 부정으로 만들면 안 된다(사슬 안에서만 걷는다)
    const nested = file("it('GET 꺼짐', async () => { expect(ok(await (await callGet()).json())).not.toEqual(expect(body).toMatchObject({ error: ERR_MODULE_DISABLED })) })")
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', nested), '바깥 부정 안에 있는 비부정 단언은 통과시킨다').toEqual([])
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', file(deniedIt)), '대조 — 비부정 단언이 있으면 통과').toEqual([])
    expect(delegationProblems('src/app/api/wiki/search/route.ts#GET', e, 't.test.ts', file(deniedIt, negatedOnly.slice(negatedOnly.indexOf("it('GET")))), '대조 — 부정 it 이 옆에 있어도 비부정 it 이 통과시킨다').toEqual([])
  })
  it('BRANCH_GATE 핸들러: 목록의 갈래 블록에서 늘 도는 판정만 인정한다 — 목록 밖 갈래·숨은 갈래·빠진 갈래·최상위로 옮긴 판정은 잡는다(과제 20)', () => {
    const bg: BranchGate = { reason: '합성', gated: { "source === 'sheet'": 'source=sheet', "mode === 'doc'": 'doc' } }
    const G = "const mod = await requireModule({ projectId: p }, 'weekly'); if (!mod.ok) return deny"
    const bsrc = [
      "import { requireModule } from '@/lib/modules/gate'",
      `export async function GET(req) { if (!p) return bad; if (source === 'sheet') { if (!ok) return bad; ${G}; return sheet() } if (mode === 'doc') { ${G}; return doc() } return core() }`,
      `export async function POST(req) { try { if (source === 'sheet') { ${G}; return sheet() } else if (mode === 'doc') { ${G}; return doc() } return bad } catch (e) { console.error(e); return oops() } }`,
      `export async function PUT(req) { if (source === 'sheet') { ${G}; return sheet() } if (mode === 'pdf') { ${G}; return doc() } return core() }`,
      `export async function PATCH(req) { if (q) { if (source === 'sheet') { ${G}; return sheet() } } if (mode === 'doc') { ${G}; return doc() } return core() }`,
      `export async function DELETE(req) { if (source === 'sheet') { if (x) { ${G} } return sheet() } if (mode === 'doc') { ${G}; return doc() } return core() }`,
      `export async function HEAD(req) { if (source === 'sheet') { ${G}; return sheet() } return core() }`,
      `export async function OPTIONS(req) { ${G}; if (source === 'sheet') { return sheet() } if (mode === 'doc') { return doc() } return core() }`,
    ].join('\n')
    const bf = parse('src/app/api/z/route.ts', bsrc)
    const p = (m: string) => branchProblems(`z#${m}`, bg, bf, gateSitesIn(bf, m, MODULE_ROUTE_GATES))
    // 목록 밖 최상위 갈래의 문제(T20-I1) — 이 목록에 없는 최상위 if 는 조기 반환 목록에도 없으므로 전부 잡힌다
    const unlisted = (key: string, cond: string) => `${key}: 최상위 갈래 ${cond} 가 목록(관문 source === 'sheet' | mode === 'doc' · 조기 반환 (없음))에도 core 구간에도 없다 — 본문이 있는 갈래는 관문 뒤여야 한다`
    expect(p('GET'), '조기 반환 목록에 없는 세션 가드').toEqual([unlisted('z#GET', '!p')])
    expect(p('POST'), 'try 블록 안·else if 사슬의 갈래도 갈래다').toEqual([])
    expect(p('PUT'), '목록 밖 갈래의 판정').toEqual([`z#PUT:4 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#PUT: 갈래 mode === 'doc' 에 판정이 없다", unlisted('z#PUT', "mode === 'pdf'")])
    expect(p('PATCH'), '다른 조건 안에 숨은 갈래').toEqual([`z#PATCH:5 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#PATCH: 갈래 source === 'sheet' 에 판정이 없다", unlisted('z#PATCH', 'q')])
    expect(p('DELETE'), '갈래 안 조건 속 판정').toEqual([`z#DELETE:6 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#DELETE: 갈래 source === 'sheet' 에 판정이 없다"])
    expect(p('HEAD'), '빠진 갈래').toEqual(["z#HEAD: 갈래 mode === 'doc' 에 판정이 없다"])
    expect(p('OPTIONS'), '최상위로 옮긴 판정 — 목록 항목을 지워야 한다').toEqual([`z#OPTIONS:8 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#OPTIONS: 갈래 source === 'sheet' 에 판정이 없다", "z#OPTIONS: 갈래 mode === 'doc' 에 판정이 없다", unlisted('z#OPTIONS', '!mod.ok')])
    expect(handlerProblems('z#GET', gateSitesIn(bf, 'GET', MODULE_ROUTE_GATES)), '목록 밖 핸들러의 갈래 판정은 최상위 규칙에 걸린다').toEqual(['z#GET: 판정이 본문을 지배하지 않는다 — 핸들러 최상위 문에서 늘 도는 판정 호출이 없다(조건·try·단락 평가 안)'])
  })
  it('BRANCH_GATE 핸들러: 목록 밖의 무관문 본문 갈래와, 조기 반환 목록에 넣었는데 본문을 붙인 갈래를 잡는다(T20-I1 — 목록은 우회구가 아니다)', () => {
    const bg: BranchGate = {
      reason: '합성', gated: { "source === 'sheet'": 'source=sheet' }, core: '기본',
      ungated: { '!p': '세션 가드 400' },
    }
    const G = "const mod = await requireModule({ projectId: p }, 'weekly'); if (!mod.ok) return deny"
    const READ = "const rows = await admin.from('weekly_reports').select(); return pdfSheet(rows)"
    const bsrc = [
      "import { requireModule } from '@/lib/modules/gate'",
      `export async function GET(req) { if (!p) return bad; if (source === 'sheet') { ${G}; return sheet() } return core() }`,
      // (가) 관문 갈래 **앞**에 있는 목록 밖 본문 갈래 — 살아남던 변이(mode==='quick')의 모양. 토글 모듈 표를 직접 읽는다
      `export async function POST(req) { if (!p) return bad; if (source === 'pdf') { ${READ} } if (source === 'sheet') { ${G}; return sheet() } return core() }`,
      // (나) 조기 반환 목록에 넣은 조건에 본문을 붙인 것
      `export async function PUT(req) { if (!p) { const a = await read(); return a } if (source === 'sheet') { ${G}; return sheet() } return core() }`,
      // (다) 대조 — core 구간의 **모듈 표를 닿지 않는** 갈래는 관문 없는 것이 설계다
      `export async function PATCH(req) { if (!p) return bad; if (source === 'sheet') { ${G}; return sheet() } if (source === 'pdf') { return pdfSheet() } return core() }`,
      `export async function DELETE(req) { if (source === 'sheet') { ${G}; return sheet() } return core() }`,
      // (라) 최종 리뷰가 실측한 구멍 — core 구간이 무한 면제였다. 모듈 표를 읽는 갈래를 붙이면 잡혀야 한다
      `export async function PUT2(req) { if (!p) return bad; if (source === 'sheet') { ${G}; return sheet() } if (source === 'xlsx') { ${READ} } return core() }`,
      // (마) 갈래 목록 밖 switch — 갈래 문법만 훑으면 빠져나간다(F-2)
      `export async function POST2(req) { if (!p) return bad; if (source === 'sheet') { ${G}; return sheet() } switch (source) { case 'csv': { ${READ} } } return core() }`,
    ].join('\n')
    const bf = parse('src/app/api/z/route.ts', bsrc)
    const p = (m: string) => branchProblems(`z#${m}`, bg, bf, gateSitesIn(bf, m, MODULE_ROUTE_GATES))
    const tail = "토글 모듈의 표 weekly_reports(weekly) 를 직접 만진다 — 꺼진 뒤에도 그 데이터가 읽히거나 바뀐다"
    expect(p('GET')).toEqual([])
    expect(p('POST'), '목록 밖 무관문 본문 갈래 — core 구간 전이라 모양 판정이 먼저 말한다')
      .toEqual([`z#POST: 최상위 갈래 source === 'pdf' 가 목록(관문 source === 'sheet' · 조기 반환 !p)에도 core 구간에도 없다 — 본문이 있는 갈래는 관문 뒤여야 한다`])
    expect(p('PUT'), '조기 반환 목록의 조건에 본문을 붙이면 가드가 아니다').toEqual(['z#PUT: 조기 반환 목록 !p 의 then 블록이 단일 return 문이 아니다 — 본문이 붙으면 관문 갈래다(사유: 세션 가드 400)'])
    expect(p('PATCH'), '대조 — core 구간의 갈래가 모듈 표를 닿지 않으면 자유다').toEqual([])
    expect(p('DELETE'), '죽은 조기 반환 항목').toEqual(['z#DELETE: 조기 반환 목록 !p 가 핸들러에 없다(죽은 항목)'])
    expect(p('PUT2'), 'core 구간이 무한 면제여서는 안 된다 — 모듈 표를 읽는 갈래는 잡힌다')
      .toEqual([`z#PUT2: 최상위 갈래 source === 'xlsx' 가 목록(관문 source === 'sheet' · 조기 반환 !p)에도 없고 core 구간(기본) 안이면서 ${tail}`])
    expect(p('POST2'), '목록 밖 switch 도 갈래다')
      .toEqual([`z#POST2: 최상위 갈래 switch source 가 목록(관문 source === 'sheet' · 조기 반환 !p)에도 없고 core 구간(기본) 안이면서 ${tail}`])
    // core 를 선언하지 않은 핸들러에는 core 구간이 없다 — 모듈 표를 읽는 갈래는 목록에 있어야 한다(minutes/chat)
    const noCore: BranchGate = { reason: '합성', gated: { "mode === 'doc'": 'doc' }, ungated: { '!p': '세션 가드 400' } }
    const nsrc = [
      "import { requireModule } from '@/lib/modules/gate'",
      `export async function GET(req) { if (!p) return bad; if (mode === 'doc') { ${G}; return doc() } if (mode === 'quick') { ${READ} } return bad }`,
    ].join('\n')
    const nf = parse('src/app/api/y/route.ts', nsrc)
    expect(branchProblems('y#GET', noCore, nf, gateSitesIn(nf, 'GET', MODULE_ROUTE_GATES))).toEqual([
      "y#GET: 최상위 갈래 mode === 'quick' 가 목록(관문 mode === 'doc' · 조기 반환 !p)에도 core 구간에도 없다 — 본문이 있는 갈래는 관문 뒤여야 한다",
    ])
  })
  it('[K4] BRANCH_GATE 핸들러: 관문 없는 갈래(core 구간·조기 반환)가 대응 없는 RPC 를 부르면 실패 — 소유 표를 모르면 모른다고 센다(D25)', () => {
    const bg: BranchGate = { reason: '합성', gated: { "source === 'sheet'": 'source=sheet' }, core: '기본', ungated: { '!p': '세션 가드 400' } }
    const G = "const mod = await requireModule({ projectId: p }, 'weekly'); if (!mod.ok) return deny"
    const bsrc = [
      "import { requireModule } from '@/lib/modules/gate'",
      // (가) core 구간 갈래가 _rpc-tables.ts 에 없는 RPC 를 부른다 — 그 RPC 가 모듈 표를 쓰는지 게이트는 모른다
      `export async function GET(req) { if (!p) return bad; if (source === 'sheet') { ${G}; return sheet() } if (source === 'xlsx') { await sb.rpc('touch_weekly_snapshot'); return x() } return core() }`,
      // (나) 조기 반환 갈래의 단일 return 이 대응 없는 RPC 를 부른다
      `export async function POST(req) { if (!p) return await sb.rpc('touch_weekly_snapshot'); if (source === 'sheet') { ${G}; return sheet() } return core() }`,
      // (다) 대조 — 대응에 있고 토글 모듈 표를 쓰지 않는 RPC 는 자유다
      `export async function PUT(req) { if (!p) return bad; if (source === 'sheet') { ${G}; return sheet() } if (source === 'xlsx') { await sb.rpc('can_attach'); return x() } return core() }`,
      // (라) 조기 반환 갈래의 **조건식**이 대응 없는 RPC 를 부른다(A1-1 재리뷰 P3 — then 블록만 보면 놓친다)
      `export async function PATCH(req) { if (!(await sb.rpc('touch_weekly_snapshot'))) return bad; if (source === 'sheet') { ${G}; return sheet() } return core() }`,
    ].join('\n')
    const bf = parse('src/app/api/z/route.ts', bsrc)
    const p = (m: string) => branchProblems(`z#${m}`, bg, bf, gateSitesIn(bf, m, MODULE_ROUTE_GATES))
    expect(p('GET')).toEqual([
      "z#GET: 최상위 갈래 source === 'xlsx' 가 목록(관문 source === 'sheet' · 조기 반환 !p)에도 없고 core 구간(기본) 안이면서 소유 표를 모르는 RPC touch_weekly_snapshot 를 부른다 — tests/gates/_rpc-tables.ts 에 대응을 적는다",
    ])
    expect(p('POST')).toEqual([
      'z#POST: 조기 반환 목록 !p 의 갈래가 소유 표를 모르는 RPC touch_weekly_snapshot 를 부른다 — tests/gates/_rpc-tables.ts 에 대응을 적는다',
    ])
    expect(p('PUT')).toEqual([])
    const cond = "!(await sb.rpc('touch_weekly_snapshot'))"
    expect(branchProblems('z#PATCH', { ...bg, ungated: { [cond]: '합성 조건 — 조기 반환' } }, bf, gateSitesIn(bf, 'PATCH', MODULE_ROUTE_GATES))).toEqual([
      `z#PATCH: 조기 반환 목록 ${cond} 의 갈래가 소유 표를 모르는 RPC touch_weekly_snapshot 를 부른다 — tests/gates/_rpc-tables.ts 에 대응을 적는다`,
    ])
  })
  it('BRANCH_GATE 위임: 갈래마다 그 표지만 품은 거부 단언, core 는 표지 없이 관문 비호출 단언 — 없거나 한 it 이 두 갈래를 섞으면 잡는다(과제 20)', () => {
    const bg: BranchGate = { reason: '합성', gated: { "source === 'sheet'": 'source=sheet', "mode === 'doc'": 'doc' }, core: '기본' }
    const key = 'src/app/api/report/route.ts#GET'
    const file = (...its: string[]) => [
      "import { GET } from '@/app/api/report/route'",
      "import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'",
      "import { requireModule } from '@/lib/modules/gate'",
      'const sheetReq = () => new NextRequest(`http://l/api/report?projectId=${P}&format=pptx&source=sheet`)',
      "const docReq = () => post({ mode: 'doc' })",
      'const req = () => new NextRequest(`http://l/api/report?projectId=${P}&format=xlsx`)',
      ...its,
    ].join('\n')
    const sheetDeny = "it('시트 꺼짐', async () => { expect(await (await GET(sheetReq())).json()).toMatchObject({ error: ERR_MODULE_DISABLED }) })"
    const docDeny = "it('문서 꺼짐', async () => { expect(await (await GET(docReq())).json()).toMatchObject({ error: ERR_MODULE_DISABLED }) })"
    const coreNot = "it('기본', async () => { await GET(req()); expect(requireModule).not.toHaveBeenCalled() })"
    const probs = (text: string) => branchDelegationProblems(key, bg, 't.test.ts', text)
    expect(probs(file(sheetDeny, docDeny, coreNot))).toEqual([])
    expect(probs(file(docDeny, coreNot)), '갈래 거부 단언이 없다').toEqual([`${key}: t.test.ts 에 갈래 source === 'sheet'(표지 'source=sheet')만 부르며 모듈 거부를 단언하는 it 블록이 없다`])
    const mixed = "it('둘 다', async () => { await GET(docReq()); expect(await (await GET(sheetReq())).json()).toMatchObject({ error: ERR_MODULE_DISABLED }) })"
    expect(probs(file(mixed, coreNot)), '한 it 이 두 갈래를 섞으면 어느 갈래의 거부인지 모른다').toHaveLength(2)
    expect(probs(file(sheetDeny, docDeny)), 'core 비호출 단언이 없다').toEqual([`${key}: t.test.ts 에 core 갈래(기본)가 갈래 표지 없이 관문을 부르지 않았음을 단언하는 it 블록이 없다`])
    const coreViaSheet = "it('기본?', async () => { await GET(sheetReq()); expect(requireModule).not.toHaveBeenCalled() })"
    expect(probs(file(sheetDeny, docDeny, coreViaSheet)), '갈래 표지가 든 it 은 core 단언이 아니다').toHaveLength(1)
    const coreCalled = "it('기본', async () => { await GET(req()); expect(requireModule).toHaveBeenCalled() })"
    expect(probs(file(sheetDeny, docDeny, coreCalled)), '비호출이 아닌 단언').toHaveLength(1)
    const titleOnly = "it('source=sheet 꺼짐', async () => { expect(await (await GET(req())).json()).toMatchObject({ error: ERR_MODULE_DISABLED }) })"
    expect(probs(file(titleOnly, docDeny, coreNot)), '제목의 낱말은 표지가 아니다').toHaveLength(1)
  })
})
