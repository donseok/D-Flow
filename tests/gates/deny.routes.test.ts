// deny — 라우트(판정 P15·P16). 모듈 라우트의 실행 확인은 delegatedTo 파일이 한다 — 여기서는 ① 위임 파일이 그 메서드를 import 하고, 그 메서드를
// 부르는 it 블록 안에서 모듈 거부를 단언하는지(메서드 단위 — 다른 메서드의 거부 단언이 채워 주지 않는다) ② 모듈 라우트 핸들러마다 판정 호출이
// 판정 모듈의 import 이고, 결과를 조건으로 보며, 핸들러 최상위에서 늘 도는지(AST — 결과를 버린 관문·한 가지에만 둔 관문을 잡는다, R3·F1·F2)
// ③ 세션 없는 라우트의 판정 호출이 { client } 를 넘기는지(F8) ④ null 라우트는 관문을 부르지 않는지(AST) ⑤ const 스텁 74 는 인자 없이도, 요청을
// 넘겨도 404 · { error: 'Not Found' } 인지 본다.
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
/** 블록(과 그 블록이 부르는 같은 파일 최상위 함수)이 local 을 부르는가 */
function callsIn(sf: ts.SourceFile, block: ts.Node, local: string): boolean {
  const helpers = new Map<string, ts.Node>()
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name && s.body) helpers.set(s.name.text, s.body)
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer && ts.isFunctionLike(d.initializer)) helpers.set(d.name.text, d.initializer)
  }
  const seen = new Set<string>()
  const look = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === local) return true
      const h = helpers.get(n.expression.text)
      if (h && !seen.has(n.expression.text)) { seen.add(n.expression.text); if (look(h)) return true }
    }
    return ts.forEachChild(n, look) ?? false
  }
  return look(block)
}
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
/** 위임 파일을 만든 과제가 끝난 것 — 과제 14·18·20·21 이 자기 위임 파일을 더하고 과제 25 가 이 집합과 필터를 지운다(전부) */
const DELEGATED_READY = new Set<string>([
  'tests/api/issue-analysis-gate.test.ts',   // 과제 14
])
const ready = entries.filter(([, e]) => e.module !== null && DELEGATED_READY.has(e.delegatedTo!))
const sitesOf = (key: string, names: ReadonlySet<string>) => {
  const [file, name] = key.split('#')
  return gateSitesIn(parse(file, readFileSync(file, 'utf8')), name, names)
}

describe('deny — 라우트', () => {
  it('모듈 라우트의 위임 파일이 있고, 그 메서드를 import 하며, 그 메서드를 부르는 it 블록이 거부를 단언한다', () => {
    const bad = ready.flatMap(([key, e]) => {
      const f = e.delegatedTo!
      return existsSync(f) ? delegationProblems(key, e, f, readFileSync(f, 'utf8')) : [`${key}: ${f} 없음`]
    })
    expect(bad).toEqual([])
  })
  it('모듈 라우트 핸들러는 판정 모듈의 판정을 부르고, 결과를 조건으로 보며, 최상위에서 늘 돈다 — 메서드 단위(R3·F1·F2)', () => {
    expect(ready.flatMap(([key]) => handlerProblems(key, sitesOf(key, MODULE_ROUTE_GATES)))).toEqual([])
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
})
