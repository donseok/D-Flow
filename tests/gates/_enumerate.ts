// 열거기(스펙 §4.3, D18) — 정적 AST. enumerate.test.ts·deny.routes.test.ts 가 쓴다.
import ts from 'typescript'
import type { ModuleId } from '@/lib/modules/defaults'
import { MODULES } from '@/lib/modules/registry'
import { hasModifier, isUseServerModule, parse, prologue } from '../invariants/_ast'
import { CORE_ROUTE_ALLOW, ROUTE_MODULE_OVERRIDES } from './manifest'

const HTTP = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const ROUTE_CONSTS = new Set(['dynamic', 'runtime', 'maxDuration', 'revalidate'])
export type Src = { rel: string; text: string }

/** 타입만 내보내는 export 선언문(`export type { … }`·`export { type A, type B }`) */
const typeOnlyExport = (s: ts.ExportDeclaration): boolean =>
  s.isTypeOnly || (!!s.exportClause && ts.isNamedExports(s.exportClause) && s.exportClause.elements.every((e) => e.isTypeOnly))

export function enumerateActions(files: Src[]): { keys: string[]; problems: string[] } {
  const keys: string[] = []; const problems: string[] = []
  for (const { rel, text } of files) {
    if (!text.includes('use server')) continue
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
        else problems.push(`${rel}: 메서드가 아닌 export function ${s.name?.text ?? '?'}`)
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

// 라우트 핸들러 파일은 src/app/api 아래의 route.ts 뿐이다 — 앱 폴더 어디든 route.{ts,tsx,js,jsx} 는 핸들러가 되므로 다른 자리·확장자는 열거 밖이다
export function routeFileProblems(rels: readonly string[]): string[] {
  return rels.filter((f) => !/^src\/app\/api\/(.+\/)?route\.ts$/.test(f)).map((f) => `${f}: 라우트 파일은 src/app/api/**/route.ts 에만 둔다`)
}

/** 코드의 키와 매니페스트의 대조(양방향) — missing 은 매니페스트에 없는 코드, dead 는 코드에 없는 항목 */
export function manifestDiff(codeKeys: readonly string[], manifest: Readonly<Record<string, unknown>>): { missing: string[]; dead: string[] } {
  const code = new Set(codeKeys)
  return { missing: codeKeys.filter((k) => !(k in manifest)), dead: Object.keys(manifest).filter((k) => !code.has(k)) }
}

export function routePath(rel: string): string {
  return '/' + rel.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '')
}
export function expectedRouteModule(path: string): { module: ModuleId | null } | { problem: string } {
  if (path in ROUTE_MODULE_OVERRIDES) return { module: null }
  const hits = MODULES.filter((m) => m.apiPrefixes.some((p) => path === p || path.startsWith(p + '/')))
  if (hits.length > 1) return { problem: `${path}: 두 모듈의 apiPrefixes 에 걸린다(${hits.map((m) => m.id).join(',')})` }
  if (hits.length === 0) return path in CORE_ROUTE_ALLOW ? { module: null } : { problem: `${path}: 어느 모듈의 apiPrefixes 에도, core 허용 목록에도 없다` }
  return { module: hits[0].core ? null : hits[0].id }
}
