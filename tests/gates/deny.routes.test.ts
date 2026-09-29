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
import { gateCallsIn, gateSitesIn, parse, siteProblems, type GateSite } from '../invariants/_ast'
import { walk } from '../invariants/_walk'
import { enumerateRoutes } from './_enumerate'
import { harness, U } from './_harness'
import { ROUTE_GATES, type GateEntry } from './manifest'

const entries = Object.entries(ROUTE_GATES)
// 하네스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 전역 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })
/** 거부 단언의 흔적 — 오류 상수·기계 코드만(무관한 문자열 'off' 는 세지 않는다). 주석은 세지 않는다(AST 의 식별자·문자열만) */
const DENY_TOKENS = ['ERR_MODULE_DISABLED', 'module_disabled', 'MODULE_DISABLED']
/** 모듈 라우트 핸들러가 부르는 판정 — 관문 둘 + 목록형 둘 + 에이전트 두 원천 AND 헬퍼(과제 18). 원천은 _ast.GATE_SOURCES */
const MODULE_ROUTE_GATES: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule', 'projectsWithModule', 'workspacesWithModule',
  'requireAgentProject', 'loadGatedOrder', 'loadGatedOrderForUser', 'accessibleProjectIds'])
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
/** expect(…).matcher(…) 사슬의 뿌리가 expect 호출인가 */
const expectRooted = (c: ts.CallExpression): boolean => {
  let e: ts.Expression = c.expression
  while (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e)) {
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'expect') return true
    e = e.expression
  }
  return false
}
/** 블록 안의 거부 단언 — 거부 흔적이 expect 사슬(대상·매처 인자) 안에 있어야 한다. mock 준비(mockResolvedValue 의 ERR_MODULE_DISABLED)·주석은 단언이 아니다 */
function hasDenyToken(block: ts.Node): boolean {
  const look = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && expectRooted(n) && tokenIn(n)) return true
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
    // v1 에이전트 — 판정은 파일 밖 헬퍼(requireAgentProject·loadGatedOrder*)이고 꺼지면 404 not_found(존재 은닉)라 응답에 거부 토큰이 없다.
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
    if (s.name === 'requireSessionModule') return [`${key}:${s.line} 세션 없는 라우트가 requireSessionModule 을 부른다`]
    const opts = s.call.arguments[2]
    const ok = !!opts && ts.isObjectLiteralExpression(opts) && opts.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === 'client')
    return ok ? [] : [`${key}:${s.line} ${s.name} 에 { client } 가 없다(쿠키 없는 세션 클라이언트는 설정 0행 — 켜진 모듈이 닫힌다)`]
  })
}
/** 설계상 한 갈래에만 관문을 두는 모듈 라우트 핸들러(닫힌 목록 — 항목마다 사유, Ruling [B4 I-1] (b)). 여기 없는 핸들러는 최상위 판정이 본문을
 *  지배해야 한다. gated: 핸들러의 갈래 if 조건 원문 → 위임 파일에서 그 갈래를 고르는 요청의 표지(문자열 조각 — 낱말 경계로 찾는다). 판정은
 *  갈래 if 의 then 블록에서 늘 돌아야 하고(가지·try·단락 평가 안이면 FAIL), 그 if 는 핸들러 몸의 최상위(try 블록·else if 사슬 포함)여야 한다.
 *  위임 파일은 갈래마다 그 표지만 품고 거부를 단언하는 it 을, core 가 있으면 어느 갈래 표지도 없이 관문 비호출을 단언하는 it 을 둔다 */
type BranchGate = { reason: string; gated: Readonly<Record<string, string>>; core?: string }
const BRANCH_GATE: Readonly<Record<string, BranchGate>> = {
  'src/app/api/report/route.ts#GET': {
    reason: 'P4 — 주간업무 시트 갈래(source=sheet)만 weekly 관문. 기본 갈래는 WBS 화면 보고서 모달이 부르는 core 현황 보고서라 관문을 부르지 않는다',
    gated: { "source === 'sheet'": 'source=sheet' },
    core: '기본 갈래 — WBS 현황 보고서(xlsx·pptx)',
  },
  'src/app/api/minutes/chat/route.ts#POST': {
    reason: '두 모드의 판정 범위가 다르다 — 문서 모드는 회의록 행의 워크스페이스(resolveScope 뒤), 보관함 모드는 세션 유일 워크스페이스(P13). 모드 밖 요청은 400 뿐이라 core 갈래가 없다',
    gated: { "body.mode === 'doc'": 'doc', "body.mode === 'archive'": 'archive' },
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
/** BRANCH_GATE 핸들러의 판정 확인 — 모든 판정이 원천·결과 사용을 지키고, 목록의 갈래 블록에서 늘 돌며, 갈래마다 판정이 있다 */
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
/** 위임 파일을 만든 과제가 끝난 것 — 과제 14·18·20·21 이 자기 위임 파일을 더하고 과제 25 가 이 집합과 필터를 지운다(전부) */
const DELEGATED_READY = new Set<string>([
  'tests/api/issue-analysis-gate.test.ts',   // 과제 14
  'tests/modules/agents-gate.test.ts',       // 과제 18 — v1 에이전트 11(delegatedStatic)
  // 과제 20 — 세션 API 14 핸들러
  'tests/api/chat-command-gate.test.ts', 'tests/api/chat-legacy-scope.test.ts', 'tests/ai/chat-v2-route.test.ts', 'tests/api/chat-reindex.test.ts',
  'tests/api/minutes-chat-route.test.ts', 'tests/minutes/export-route.test.ts', 'tests/api/report-route.test.ts', 'tests/actions/usage-track-gate.test.ts',
  'tests/actions/wiki-ask-route.test.ts', 'tests/actions/wiki-search-route.test.ts', 'tests/actions/wiki-summarize-route.test.ts',
  // 과제 21 — v1 회의록 업로드 API 5 핸들러
  'tests/minutes/external-api.test.ts', 'tests/minutes/folder-batch.test.ts', 'tests/api/minutes-meta-modules.test.ts',
])
const ready = entries.filter(([, e]) => e.module !== null && DELEGATED_READY.has(e.delegatedTo!))
const sfOf = (key: string) => { const file = key.split('#')[0]; return parse(file, readFileSync(file, 'utf8')) }
const sitesOf = (key: string, names: ReadonlySet<string>) => gateSitesIn(sfOf(key), key.split('#')[1], names)

describe('deny — 라우트', () => {
  it('모듈 라우트의 위임 파일이 있고, 그 메서드를 import 하며, 그 메서드를 부르는 it 블록이 거부를 단언한다', () => {
    const bad = ready.flatMap(([key, e]) => {
      const f = e.delegatedTo!
      if (!existsSync(f)) return [`${key}: ${f} 없음`]
      const text = readFileSync(f, 'utf8')
      const bg = BRANCH_GATE[key]
      return [...delegationProblems(key, e, f, text), ...(bg ? branchDelegationProblems(key, bg, f, text) : [])]
    })
    expect(bad).toEqual([])
  })
  it('모듈 라우트 핸들러는 판정 모듈의 판정을 부르고, 결과를 조건으로 보며, 최상위에서 늘 돈다 — 메서드 단위(R3·F1·F2). BRANCH_GATE 는 갈래마다', () => {
    expect(ready.flatMap(([key]) => {
      const sf = sfOf(key)                                         // 판정 자리와 핸들러 몸은 같은 구문 트리에서 — branchOf 가 노드 동일성으로 멈춘다
      const sites = gateSitesIn(sf, key.split('#')[1], MODULE_ROUTE_GATES)
      const bg = BRANCH_GATE[key]
      return bg ? branchProblems(key, bg, sf, sites) : handlerProblems(key, sites)
    })).toEqual([])
  })
  it('BRANCH_GATE 는 검사 대상 모듈 라우트 항목이고 사유·갈래가 있다(닫힌 목록)', () => {
    const readyKeys = new Set(ready.map(([k]) => k))
    const bad = Object.entries(BRANCH_GATE).flatMap(([key, bg]) => [
      ...(readyKeys.has(key) ? [] : [`${key}: 검사 대상 모듈 라우트(ready) 항목이 아니다`]),
      ...(bg.reason.trim() ? [] : [`${key}: 사유 없음`]),
      ...(Object.keys(bg.gated).length ? [] : [`${key}: 갈래 없음`]),
      ...Object.values(bg.gated).filter((m) => !m.trim()).map(() => `${key}: 빈 표지`),
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
  })
  it('세션 없는 라우트의 { client } 누락을 잡는다(F8)', () => {
    expect(clientProblems('x#GET', gateSitesIn(sf, 'GET', CLIENT_GATES))).toEqual(["x#GET:4 requireModule 에 { client } 가 없다(쿠키 없는 세션 클라이언트는 설정 0행 — 켜진 모듈이 닫힌다)"])
    expect(clientProblems('x#HEAD', gateSitesIn(sf, 'HEAD', CLIENT_GATES))).toEqual([])
  })
  it('위임 파일: 그 메서드를 부르는 it 안의 거부 단언만 센다 — 다른 메서드의 거부 단언·mock 준비·주석의 토큰은 채워 주지 않는다(F2 — H3)', () => {
    const e: GateEntry = { guard: 'session', module: 'wiki', note: '로그인', delegatedTo: 't.test.ts' }
    const file = (body: string) => [
      "import { GET, POST as post } from '@/app/api/wiki/search/route'",
      "import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'",
      'const callGet = () => GET(req())',
      body,
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
    expect(p('GET')).toEqual([])
    expect(p('POST'), 'try 블록 안·else if 사슬의 갈래도 갈래다').toEqual([])
    expect(p('PUT'), '목록 밖 갈래의 판정').toEqual([`z#PUT:4 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#PUT: 갈래 mode === 'doc' 에 판정이 없다"])
    expect(p('PATCH'), '다른 조건 안에 숨은 갈래').toEqual([`z#PATCH:5 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#PATCH: 갈래 source === 'sheet' 에 판정이 없다"])
    expect(p('DELETE'), '갈래 안 조건 속 판정').toEqual([`z#DELETE:6 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#DELETE: 갈래 source === 'sheet' 에 판정이 없다"])
    expect(p('HEAD'), '빠진 갈래').toEqual(["z#HEAD: 갈래 mode === 'doc' 에 판정이 없다"])
    expect(p('OPTIONS'), '최상위로 옮긴 판정 — 목록 항목을 지워야 한다').toEqual([`z#OPTIONS:8 requireModule 가 목록의 갈래(source === 'sheet' | mode === 'doc') 블록에서 늘 도는 자리가 아니다`, "z#OPTIONS: 갈래 source === 'sheet' 에 판정이 없다", "z#OPTIONS: 갈래 mode === 'doc' 에 판정이 없다"])
    expect(handlerProblems('z#GET', gateSitesIn(bf, 'GET', MODULE_ROUTE_GATES)), '목록 밖 핸들러의 갈래 판정은 최상위 규칙에 걸린다').toEqual(['z#GET: 판정이 본문을 지배하지 않는다 — 핸들러 최상위 문에서 늘 도는 판정 호출이 없다(조건·try·단락 평가 안)'])
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
