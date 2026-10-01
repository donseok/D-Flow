// 페이지 관문 불변식(스펙 §4.2 끝 문단, D11, R14) — src/app 의 모든 page.tsx 는 자기 모듈로 관문을 부르거나 닫힌 제외 목록(사유)에 있다.
// AST 로 본다: default export 함수 본문의 await 를 소스 순서로 모아 '첫 데이터 await' 가 관문이어야 한다(관문 앞에는 권한 redirect 재료·로케일만).
// 관문의 모듈 인자는 routePrefixes(세그먼트 접두 일치)가 정하고, 첫 인자 모양은 페이지 종류가 정한다.
// loadWorkspaceScope — 슬러그 판정(E19): /w/[slug]/** 의 첫 await 이고 관문은 그 다음 줄이다(스펙 §2.4 ①).
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import type { ModuleId } from '@/lib/modules/defaults'
import { LEGACY_GLOBAL_PREFIXES, MODULES } from '@/lib/modules/registry'
import { walk } from './_walk'

const APP = 'src/app'
/** 닫힌 제외 목록(스펙 §4.2 끝 문단) — 사유 필수. Phase C 가 (app)/w/[slug]/settings/** 를 더한다 */
const EXCLUDED: Record<string, string> = {
  'src/app/login/page.tsx': '로그인 전 — 워크스페이스 미확정',
  'src/app/invite/[token]/page.tsx': '초대 토큰 — 로그인 전·워크스페이스 미확정',
  'src/app/page.tsx': '/projects 로 redirect 만',
  'src/app/(app)/account/page.tsx': '계정 단위(개인 토큰 포함) — 모듈 밖',
  'src/app/(app)/admin/accounts/page.tsx': '플랫폼·워크스페이스 관리 — 모듈 밖(정본 §3.2.2 끝 문단)',
  'src/app/(app)/admin/llm-config/page.tsx': '플랫폼 관리 — 모듈 밖',
  'src/app/(app)/admin/teams/page.tsx': '워크스페이스 관리 — 모듈 밖',
  'src/app/(app)/(global)/admin/ui-states/page.tsx': '플랫폼 진단 — 모듈 밖(SP3b D16)',
  'src/app/(app)/projects/page.tsx': '셸(프로젝트 목록)',
  'src/app/(app)/w/[slug]/settings/page.tsx': '워크스페이스 관리 화면 — 모듈을 허용하는 문이어서 자기 모듈 관문 밖(§5.2)',
}
/** 경로 접두로 모듈을 정할 수 없는 페이지 — 세션 없는 공유 링크(과제 10). requireModule(…, { client: admin }) 를 부른다 */
const SPECIAL: Record<string, { module: ModuleId; why: string }> = {
  'src/app/share/minutes/[token]/page.tsx': { module: 'minutes', why: '익명 공유 링크 — 토큰 행의 워크스페이스로 admin 판정' },
}
/** 관문 앞에서 await 해도 되는 호출 — 권한 redirect 재료·로케일. 데이터 로더·Promise.all 은 관문 뒤다(notFound 뒤 로더가 돌지 않게) */
const ALLOWED_BEFORE = new Set(['params', 'searchParams', 'getActorForView', 'getActor', 'getActorViewState', 'getServerLocale', 'loadWorkspaceScope'])
/** 관문 앞에서 await 없이 불러도 되는 동기 호출 — 권한 판정 술어와 Next 신호. await 없이 시작한 로더(프라미스)는 여기 없으므로 막힌다 */
const SYNC_BEFORE = new Set(['redirect', 'notFound', 'isProjectMember', 'isProjectAdmin', 'canViewAgents', 'canViewPortfolio', 'canViewUsage', 'wsHref'])
/** 페이지별 관문 앞 허용(사유) — 대상 행에서 워크스페이스를 알아야 하는 페이지. selects 는 관문 앞 조회 체인이 고를 수 있는 열(그 밖의 열을 읽는 체인은 문제) */
const PRE_GATE: Record<string, { calls: string[]; selects?: string[]; why: string }> = {
  'src/app/(app)/w/[slug]/minutes/[id]/page.tsx': { calls: ['getMinuteDetail'], why: '대상 행의 워크스페이스(스펙 §4.2 2행) — react cache 라 뒤 묶음이 다시 읽지 않는다' },
  'src/app/share/minutes/[token]/page.tsx': {
    calls: ['isShareToken', 'serviceRoleConfigured', 'createAdminClient'], selects: ['workspace_id'],
    why: '토큰 형식·env 가드 뒤 토큰 행의 workspace_id 한 열(본문은 관문 뒤)',
  },
}

type Kind = 'project' | 'global' | 'row' | 'special'
function routeOf(file: string): string {
  const segs = ('/' + relative(APP, file).replace(/\\/g, '/').replace(/\/?page\.(tsx|ts|jsx|js|mdx)$/, '')).split('/').filter((s) => s && !/^\(.*\)$/.test(s))
  return '/' + segs.join('/')
}
const PREFIXES = MODULES.flatMap((m) => m.routePrefixes.map((p) => ({ p, module: m.id })))
function modulesOf(route: string): ModuleId[] {
  return [...new Set(PREFIXES.filter(({ p }) => route === p || route.startsWith(p + '/')).map((x) => x.module))]
}
function kindOf(file: string, route: string): Kind {
  if (SPECIAL[file]) return 'special'
  if (route.startsWith('/p/[projectId]')) return 'project'
  return route in LEGACY_GLOBAL_PREFIXES ? 'global' : 'row'
}

function calleeOf(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text
  if (ts.isCallExpression(e)) {
    const c = e.expression
    if (ts.isIdentifier(c)) return c.text
    if (ts.isPropertyAccessExpression(c)) return ts.isIdentifier(c.expression) && c.expression.text === 'Promise' ? `Promise.${c.name.text}` : c.name.text
  }
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return '?'
}
const isParamsAll = (e: ts.Expression) => ts.isCallExpression(e) && calleeOf(e) === 'Promise.all'
  && e.arguments.length === 1 && ts.isArrayLiteralExpression(e.arguments[0])
  && e.arguments[0].elements.every((x) => ts.isIdentifier(x) && (x.text === 'params' || x.text === 'searchParams'))
const literalIds = (a: ts.Expression | undefined): string[] | null => {
  if (!a) return null
  if (ts.isStringLiteral(a)) return [a.text]
  if (ts.isArrayLiteralExpression(a) && a.elements.every(ts.isStringLiteral)) return a.elements.map((x) => (x as ts.StringLiteral).text)
  return null
}
const hasProp = (a: ts.Expression | undefined, name: string) => !!a && ts.isObjectLiteralExpression(a)
  && a.properties.some((p) => (ts.isShorthandPropertyAssignment(p) || ts.isPropertyAssignment(p)) && ts.isIdentifier(p.name) && p.name.text === name)
/** { projectId } 축약형 — 경로 조각에서 꺼낸 그 변수라야 한다(다른 값을 넣은 { projectId: '…' } 는 다른 프로젝트로 판정한다) */
const hasShorthand = (a: ts.Expression | undefined, name: string) => !!a && ts.isObjectLiteralExpression(a)
  && a.properties.some((p) => ts.isShorthandPropertyAssignment(p) && p.name.text === name)
/** 빌더 체인(x.from(…).select(…)…)의 안쪽 호출 — 바깥 끝 호출 하나로 체인 전체를 판정한다 */
const isChainInner = (c: ts.CallExpression) => ts.isPropertyAccessExpression(c.parent) && c.parent.expression === c && ts.isCallExpression(c.parent.parent)
/** 체인의 .select(<리터럴>) 인자들 — 체인이 아니면(메서드 호출 1단 이하) null */
function chainSelects(c: ts.CallExpression): string[] | null {
  const out: string[] = []
  let links = 0
  let e: ts.Expression = c
  while (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) {
    links++
    const a = e.arguments[0]
    if (e.expression.name.text === 'select') out.push(a && ts.isStringLiteralLike(a) ? a.text : '?')
    e = e.expression.expression
  }
  return links >= 2 ? out : null
}
/** 함수 본문 최상위 문의 관문인가 — 조건·try·단락 평가 안의 관문은 건너뛸 수 있다 */
function isTopLevel(a: ts.AwaitExpression, body: ts.Block): boolean {
  const p = a.parent
  if (ts.isExpressionStatement(p)) return p.parent === body
  return ts.isVariableDeclaration(p) && p.initializer === a && ts.isVariableDeclarationList(p.parent)
    && ts.isVariableStatement(p.parent.parent) && p.parent.parent.parent === body
}

/** 한 페이지의 문제 목록 — 빈 배열이면 통과 */
export function inspect(file: string, text: string, expected: readonly ModuleId[], kind: Kind): string[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const fn = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s)
    && (ts.getModifiers(s) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))
  if (!fn?.body) return ['export default function 이 없다']
  const awaits: ts.AwaitExpression[] = []
  const calls: ts.CallExpression[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isAwaitExpression(n)) awaits.push(n)
    if (ts.isCallExpression(n)) calls.push(n)
    if (ts.isFunctionLike(n) && n !== fn) return                     // 콜백 안의 await·호출은 페이지 흐름이 아니다
    ts.forEachChild(n, visit)
  }
  ts.forEachChild(fn.body, visit)
  const gateName = kind === 'special' ? 'requireModule' : 'requireModulePage'
  const gateIdx = awaits.findIndex((a) => calleeOf(a.expression) === gateName)
  if (gateIdx < 0) return [`await ${gateName}(…) 가 없다`]
  const gate = awaits[gateIdx]
  const problems: string[] = []
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1
  if (!isTopLevel(gate, fn.body)) problems.push(`관문(:${lineOf(gate)})이 조건·try·단락 평가 안에 있다 — 함수 본문 최상위 문으로`)
  const pre = PRE_GATE[file]
  const extra = new Set(pre?.calls ?? [])
  // 관문 앞의 호출은 await 여부와 무관하게 허용 목록만 — await 없이 시작한 로더도 notFound 앞에서 돈다(R14)
  for (const c of calls.filter((x) => x.getStart() < gate.getStart() && !isChainInner(x))) {
    const name = calleeOf(c)
    const receiver = ts.isPropertyAccessExpression(c.expression) && ts.isIdentifier(c.expression.expression) ? c.expression.expression.text : null
    const sel = chainSelects(c)
    if (sel !== null ? sel.length > 0 && sel.every((x) => pre?.selects?.includes(x)) : (
      ALLOWED_BEFORE.has(name) || SYNC_BEFORE.has(name) || extra.has(name) || isParamsAll(c) || receiver === 'console')) continue
    const awaited = ts.isAwaitExpression(c.parent)
    problems.push(`관문 앞의 ${awaited ? 'await ' : ''}${name}(:${lineOf(c)}) — 데이터 로더는 관문 뒤로`)
  }
  // 호출이 아닌 await 는 params·searchParams 만(앞에서 시작해 둔 프라미스를 기다리는 것은 위 호출 검사가 잡는다)
  for (const a of awaits.slice(0, gateIdx).filter((x) => !ts.isCallExpression(x.expression))) {
    const name = calleeOf(a.expression)
    if (name !== 'params' && name !== 'searchParams') problems.push(`관문 앞의 await ${name}(:${lineOf(a)}) — 데이터 로더는 관문 뒤로`)
  }
  const call = gate.expression as ts.CallExpression
  const ids = literalIds(call.arguments[1])
  if (!ids || [...ids].sort().join(',') !== [...expected].sort().join(',')) problems.push(`관문 모듈이 ${JSON.stringify(ids)} — 기대 ${JSON.stringify(expected)}`)
  const scope = call.arguments[0]
  if (kind === 'project' && !hasShorthand(scope, 'projectId')) problems.push('프로젝트 페이지의 관문 범위는 { projectId }(경로 조각의 축약형)')
  if (kind === 'global' && scope?.kind !== ts.SyntaxKind.NullKeyword) problems.push('전역 페이지의 관문 범위는 null(세션 유일 워크스페이스)')
  if ((kind === 'row' || kind === 'special') && !hasProp(scope, 'workspaceId')) problems.push('대상 행 페이지의 관문 범위는 { workspaceId: 행의 워크스페이스 }')
  if (kind === 'special' && !hasProp(call.arguments[2], 'client')) problems.push('세션 없는 페이지는 { client: admin } 을 넘긴다')
  return problems
}

/** Next 기본 pageExtensions(tsx·ts·jsx·js) + mdx — page.ts 로 만든 페이지도 관문 검사를 받는다 */
const PAGE_FILE = /^page\.(tsx|ts|jsx|js|mdx)$/
const pages = walk(APP, undefined, PAGE_FILE).map((f) => relative(process.cwd(), f)).sort()

describe('페이지 관문 — src/app 의 모든 page.tsx', () => {
  it('모든 페이지가 모듈·제외·특수 중 정확히 하나로 분류된다', () => {
    expect(pages.length).toBeGreaterThan(25)
    expect(pages).toContain('src/app/(app)/p/[projectId]/issues/page.tsx')
    const unclassified = pages.filter((f) => !EXCLUDED[f] && !SPECIAL[f] && modulesOf(routeOf(f)).length === 0)
    expect(unclassified, '어느 모듈에도 속하지 않는 조각 — routePrefixes 에 더하거나 사유와 함께 EXCLUDED 로').toEqual([])
    const ambiguous = pages.filter((f) => !SPECIAL[f] && modulesOf(routeOf(f)).length > 1)
    expect(ambiguous, '두 모듈에 걸리는 조각').toEqual([])
  })
  it('관문 페이지는 첫 데이터 await 가 자기 모듈의 관문이다', () => {
    const bad = pages.filter((f) => !EXCLUDED[f]).flatMap((f) => {
      const expected = SPECIAL[f] ? [SPECIAL[f].module] : modulesOf(routeOf(f))
      return inspect(f, readFileSync(f, 'utf8'), expected, kindOf(f, routeOf(f))).map((p) => `${f}: ${p}`)
    })
    expect(bad).toEqual([])
  })
  it('제외·특수·관문 앞 허용 목록에 낡은 항목이 없다(파일 있음, 제외는 모듈에 걸리지 않음, 사유 있음)', () => {
    for (const [f, why] of Object.entries(EXCLUDED)) {
      expect(existsSync(f), f).toBe(true); expect(why.length, f).toBeGreaterThan(3)
      expect(modulesOf(routeOf(f)), `${f} 는 이제 모듈에 걸린다 — 제외에서 빼고 관문을 넣는다`).toEqual([])
    }
    for (const f of [...Object.keys(SPECIAL), ...Object.keys(PRE_GATE)]) expect(existsSync(f), f).toBe(true)
  })
  it('LEGACY_GLOBAL_PREFIXES 는 routePrefixes 와 같은 모듈을 가리킨다(SP3b 가 경로를 옮기며 함께 지운다)', () => {
    for (const [p, mod] of Object.entries(LEGACY_GLOBAL_PREFIXES)) expect(modulesOf(p), p).toEqual([mod])
  })
})

describe('판정기 민감도', () => {
  const P = 'src/app/(app)/p/[projectId]/x/page.tsx'
  const page = (body: string) => `export default async function X({ params }) {\n${body}\n}`
  it('관문 없음·로더 뒤 관문·틀린 모듈·await 없는 관문·틀린 범위를 잡는다', () => {
    expect(inspect(P, page('const { projectId } = await params\nconst d = await load(projectId)'), ['issues'], 'project')).toHaveLength(1)
    expect(inspect(P, page("const { projectId } = await params\nconst [a] = await Promise.all([load()])\nawait requireModulePage({ projectId }, 'issues')"), ['issues'], 'project')[0]).toMatch(/관문 앞의 await Promise.all/)
    expect(inspect(P, page("const { projectId } = await params\nawait requireModulePage({ projectId }, 'wiki')"), ['issues'], 'project')[0]).toMatch(/관문 모듈/)
    expect(inspect(P, page("const { projectId } = await params\nrequireModulePage({ projectId }, 'issues')"), ['issues'], 'project')).toHaveLength(1)
    expect(inspect(P, page("await requireModulePage(null, 'issues')"), ['issues'], 'project')[0]).toMatch(/\{ projectId \}/)
  })
  it('조건·try·단락 평가 안의 관문, await 없이 앞에서 시작한 로더, 축약형이 아닌 범위를 잡는다', () => {
    const pre = 'const { projectId } = await params\n'
    const gate = "await requireModulePage({ projectId }, 'issues')"
    expect(inspect(P, page(`${pre}try { ${gate} } catch {}`), ['issues'], 'project')[0]).toMatch(/최상위/)
    expect(inspect(P, page(`${pre}if (process.env.X) ${gate}`), ['issues'], 'project')[0]).toMatch(/최상위/)
    expect(inspect(P, page(`${pre}projectId.length > 0 && ${gate}`), ['issues'], 'project')[0]).toMatch(/최상위/)
    expect(inspect(P, page(`${pre}const early = getIssues(projectId)\n${gate}\nawait Promise.all([early])`), ['issues'], 'project')[0]).toMatch(/관문 앞의 getIssues/)
    expect(inspect(P, page(`${pre}await requireModulePage({ projectId: 'other' }, 'issues')`), ['issues'], 'project')[0]).toMatch(/축약형/)
  })
  it('관문 앞 조회 체인은 PRE_GATE 의 열만 — 공유 페이지가 본문 열을 관문 앞에서 읽으면 잡는다', () => {
    const S = 'src/app/share/minutes/[token]/page.tsx'
    const q = (cols: string) => `const admin = createAdminClient()\nconst { data } = await admin.from('minutes').select('${cols}').eq('share_token', token).maybeSingle()`
    const g = "\nconst gate = await requireModule({ workspaceId: data.workspace_id }, 'minutes', { client: admin })"
    expect(inspect(S, page(q('workspace_id') + g), ['minutes'], 'special')).toEqual([])
    expect(inspect(S, page(q('title, body_md') + g), ['minutes'], 'special')[0]).toMatch(/관문 앞의 await maybeSingle/)
  })
  it('page.tsx 밖의 페이지 확장자도 걷는다', () => {
    for (const n of ['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'page.mdx']) expect(PAGE_FILE.test(n), n).toBe(true)
    expect(PAGE_FILE.test('layout.tsx')).toBe(false)
  })
  it('권한 redirect 재료는 관문 앞이어도 된다. 콜백 안 await 는 보지 않는다', () => {
    expect(inspect(P, page("const { projectId } = await params\nconst actor = await getActorForView()\nawait requireModulePage({ projectId }, 'issues')\nafter(async () => { await x() })"), ['issues'], 'project')).toEqual([])
  })
})
