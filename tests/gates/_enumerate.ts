// 열거기(스펙 §4.3, D18) — 정적 AST. enumerate.test.ts·deny.routes.test.ts 가 쓴다.
import ts from 'typescript'
import type { ModuleId } from '@/lib/modules/defaults'
import { MODULES } from '@/lib/modules/registry'
import { hasModifier, isUseServerModule, mayHaveUseServer, parse, prologue } from '../invariants/_ast'
import { CORE_ROUTE_ALLOW, ROUTE_MODULE_OVERRIDES } from './manifest'

const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
/** 라우트 세그먼트 설정(Next 공식 이름) — 값 export 로 허용 */
const ROUTE_CONSTS = new Set(['dynamic', 'dynamicParams', 'revalidate', 'fetchCache', 'runtime', 'preferredRegion', 'maxDuration'])
/** 메서드가 아니어도 Next 가 읽는 함수 export */
const ROUTE_FUNCS = new Set(['generateStaticParams'])
/** 스텁의 원천 — apiNotFound·apiFail 은 이 두 모듈의 import 바인딩이어야 한다(같은 이름의 지역 함수로 그림자를 만들면 404 가 아니다) */
export const STUB_SOURCES: ReadonlySet<string> = new Set(['@/lib/agent/externalApi', '@/lib/minutes/externalApi'])
export type Src = { rel: string; text: string }

/** 타입만 내보내는 export 선언문(`export type { … }`·`export { type A, type B }`) */
const typeOnlyExport = (s: ts.ExportDeclaration): boolean =>
  s.isTypeOnly || (!!s.exportClause && ts.isNamedExports(s.exportClause) && s.exportClause.elements.every((e) => e.isTypeOnly))

export function enumerateActions(files: Src[]): { keys: string[]; problems: string[] } {
  const keys: string[] = []; const problems: string[] = []
  for (const { rel, text } of files) {
    if (!mayHaveUseServer(text)) continue                                        // 이스케이프로 쓴 지시문도 후보다(T13-m2)
    const sf = parse(rel, text)
    // 인라인 'use server'(함수 몸의 지시문 머리) — 모듈이든 아니든 0건(D18)
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n) && 'body' in n && n.body && ts.isBlock(n.body) && prologue(n.body.statements).includes('use server')) problems.push(`${rel}: 인라인 'use server'`)
      ts.forEachChild(n, visit)
    }
    visit(sf)
    if (!isUseServerModule(sf)) continue
    for (const s of sf.statements) {
      if (ts.isExportAssignment(s)) { problems.push(`${rel}: export default <식>`); continue }
      // 'use server' 모듈의 export 는 전부 서버 액션 참조다 — 함수 선언이 아닌 값 export(const 화살표·export { f as g }·export *)는 열거를 우회한다
      if (ts.isExportDeclaration(s)) { if (!typeOnlyExport(s)) problems.push(`${rel}: export 선언문 — 액션은 export async function 으로`); continue }
      if (!hasModifier(s, ts.SyntaxKind.ExportKeyword) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s)) continue
      if (!ts.isFunctionDeclaration(s)) { problems.push(`${rel}: 함수 선언이 아닌 값 export — 액션은 export async function 으로`); continue }
      if (hasModifier(s, ts.SyntaxKind.DefaultKeyword)) { problems.push(`${rel}: export default function`); continue }
      if (s.name) keys.push(`${rel}#${s.name.text}`)
    }
  }
  return { keys: keys.sort(), problems }
}

type Stub = { key: string; init: ts.Expression }
export function enumerateRoutes(files: Src[]): { handlers: string[]; stubs: Stub[]; problems: string[] } {
  const handlers: string[] = []; const stubs: Stub[] = []; const problems: string[] = []
  for (const { rel, text } of files) {
    const sf = parse(rel, text)
    for (const s of sf.statements) {
      if (ts.isExportAssignment(s)) { problems.push(`${rel}: export default <식>`); continue }
      if (ts.isFunctionDeclaration(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
        if (hasModifier(s, ts.SyntaxKind.DefaultKeyword)) problems.push(`${rel}: export default function`)
        else if (s.name && HTTP.has(s.name.text)) handlers.push(`${rel}#${s.name.text}`)
        else if (!(s.name && ROUTE_FUNCS.has(s.name.text))) problems.push(`${rel}: 메서드가 아닌 export function ${s.name?.text ?? '?'}`)
      } else if (ts.isVariableStatement(s) && hasModifier(s, ts.SyntaxKind.ExportKeyword)) {
        for (const d of s.declarationList.declarations) {
          const name = ts.isIdentifier(d.name) ? d.name.text : '?'
          if (HTTP.has(name) && d.initializer) stubs.push({ key: `${rel}#${name}`, init: d.initializer })
          else if (!ROUTE_CONSTS.has(name)) problems.push(`${rel}: 알 수 없는 export const ${name}`)
        }
      } else if (ts.isExportDeclaration(s)) {
        // export { h as GET }·export { GET } from '…'·export * 는 열거를 우회한다 — 메서드는 export function 으로만(지금 트리에 0건)
        if (!typeOnlyExport(s)) problems.push(`${rel}: export 선언문 — 메서드는 function 으로`)
      } else if (hasModifier(s, ts.SyntaxKind.ExportKeyword) && !ts.isTypeAliasDeclaration(s) && !ts.isInterfaceDeclaration(s)) {
        problems.push(`${rel}: 알 수 없는 export 문(${ts.SyntaxKind[s.kind]})`)
      }
    }
  }
  return { handlers: handlers.sort(), stubs, problems }
}

/** 이 파일에서 local 이름이 어느 모듈의 무엇을 import 한 바인딩인가 */
export function importOf(sf: ts.SourceFile, local: string): { source: string; imported: string } | null {
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.importClause?.isTypeOnly) continue
    const nb = s.importClause?.namedBindings
    if (!nb || !ts.isNamedImports(nb)) continue
    const el = nb.elements.find((x) => x.name.text === local && !x.isTypeOnly)
    if (el) return { source: s.moduleSpecifier.text, imported: (el.propertyName ?? el.name).text }
  }
  return null
}

/** const 스텁이 허용된 두 모양인가(P16) — ① 원천 모듈에서 import 한 apiNotFound(별칭 포함)·같은 파일의 다른 스텁 별칭 ② apiFail(404, 'not_found', …) 을
 *  돌려주는 인자 없는 화살표(apiFail 도 원천 모듈의 import). 지역 함수로 만든 같은 이름의 그림자는 아니다(F9 b) */
export function stubShapeOk(stub: Stub, byKey: ReadonlyMap<string, ts.Expression>, depth = 0): boolean {
  const init = stub.init
  const sf = init.getSourceFile()
  const fromSource = (local: string, name: string) => { const b = importOf(sf, local); return !!b && b.imported === name && STUB_SOURCES.has(b.source) }
  if (ts.isIdentifier(init)) {
    if (fromSource(init.text, 'apiNotFound')) return true
    const alias = byKey.get(`${stub.key.split('#')[0]}#${init.text}`)
    return !!alias && depth < 3 && stubShapeOk({ key: stub.key, init: alias }, byKey, depth + 1)
  }
  if (ts.isArrowFunction(init) && init.parameters.length === 0 && ts.isCallExpression(init.body) && ts.isIdentifier(init.body.expression) && fromSource(init.body.expression.text, 'apiFail')) {
    const [s, c] = init.body.arguments
    return !!s && ts.isNumericLiteral(s) && s.text === '404' && !!c && ts.isStringLiteral(c) && c.text === 'not_found'
  }
  return false
}

/** Next 가 라우트 핸들러로 쓰는 파일 이름(pageExtensions 기본 넷) — src/app/api 아래의 route.ts·route.tsx 만 열거한다 */
export const ROUTE_FILE = /^route\.[cm]?[jt]sx?$/
// 라우트 핸들러 파일은 src/app/api 아래의 route.ts·route.tsx 뿐이다 — 앱 폴더 어디든 route.{ts,tsx,js,jsx} 는 핸들러가 되므로 다른 자리·확장자는 열거 밖이다.
// 예외 하나: 옛 경로 스텁 src/app/(legacy)/**/route.ts(SP3b D5) — 데이터를 내지 않는 GET 307 뿐이고, 모양은 tests/routes/legacy-redirects.test.ts 가
// 파일 **전문 대조**로 닫는다(import 둘·dynamic·legacyRedirect 를 부르는 GET 한 줄만 — 다른 export·top-level 문장 금지, 표에 있는 파일만). 모듈 관문은 이동 대상 페이지가 한다
const LEGACY_STUB_FILE = /^src\/app\/\(legacy\)\/(.+\/)?route\.ts$/
export function routeFileProblems(rels: readonly string[]): string[] {
  return rels.filter((f) => !/^src\/app\/api\/(.+\/)?route\.tsx?$/.test(f) && !LEGACY_STUB_FILE.test(f)).map((f) => `${f}: 라우트 파일은 src/app/api/**/route.{ts,tsx} 에만 둔다(옛 경로 스텁은 src/app/(legacy)/**/route.ts)`)
}

/** 코드의 키와 매니페스트의 대조(양방향) — missing 은 매니페스트에 없는 코드, dead 는 코드에 없는 항목 */
export function manifestDiff(codeKeys: readonly string[], manifest: Readonly<Record<string, unknown>>): { missing: string[]; dead: string[] } {
  const code = new Set(codeKeys)
  return { missing: codeKeys.filter((k) => !(k in manifest)), dead: Object.keys(manifest).filter((k) => !code.has(k)) }
}

/** URL 에 나타나지 않는 조각 — route group `(x)`·병렬 슬롯 `@x` */
export const isHiddenSegment = (seg: string): boolean => /^\(.*\)$/.test(seg) || seg.startsWith('@')
/** 라우트 파일의 URL 경로 — 그룹·슬롯 조각을 뺀다(F11: api/(legacy)/wiki/export 는 /api/wiki/export 다) */
export function routePath(rel: string): string {
  const segs = rel.replace(/^src\/app\//, '').replace(/\/route\.tsx?$/, '').split('/').filter((s) => !isHiddenSegment(s))
  return '/' + segs.join('/')
}
export function expectedRouteModule(path: string): { module: ModuleId | null } | { problem: string } {
  if (path in ROUTE_MODULE_OVERRIDES) return { module: null }
  const hits = MODULES.filter((m) => m.apiPrefixes.some((p) => path === p || path.startsWith(p + '/')))
  if (hits.length > 1) return { problem: `${path}: 두 모듈의 apiPrefixes 에 걸린다(${hits.map((m) => m.id).join(',')})` }
  if (hits.length === 0) return path in CORE_ROUTE_ALLOW ? { module: null } : { problem: `${path}: 어느 모듈의 apiPrefixes 에도, core 허용 목록에도 없다` }
  return { module: hits[0].core ? null : hits[0].id }
}

/** 메타데이터 라우트(요청마다 서버 코드로 응답을 만든다) — 라우트 열거(route.*)·페이지 불변식(page.*) 어디에도 걸리지 않는다(F12) */
export const METADATA_FILE = /^(opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\d*\.[cm]?[jt]sx?$/
/** 메타데이터 파일의 URL 경로가 비core 모듈의 routePrefixes 아래인가 — 아래면 모듈을 꺼도 그 모듈의 데이터를 그릴 수 있다 */
export function metadataModule(rel: string): ModuleId | null {
  const segs = rel.replace(/^src\/app\//, '').split('/').slice(0, -1).filter((s) => !isHiddenSegment(s))
  const path = '/' + segs.join('/')
  const hit = MODULES.find((m) => !m.core && m.routePrefixes.some((p) => path === p || path.startsWith(p + '/')))
  return hit ? hit.id : null
}
