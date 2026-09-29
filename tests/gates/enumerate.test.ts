// 열거 게이트(스펙 §4.3, D18) — 코드의 액션·핸들러 = 매니페스트(양방향), 인라인 'use server'·default export 0, 라우트 모듈 = apiPrefixes
// (덮어쓰기·core 허용 목록 제외), /api/v1/** 는 core 접두에 안 걸린다, const 스텁은 두 모양만. 수는 실행 때 센다.
import { existsSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isModuleId, type ModuleId } from '@/lib/modules/defaults'
import { MODULES } from '@/lib/modules/registry'
import { walk } from '../invariants/_walk'
import {
  enumerateActions, enumerateRoutes, expectedRouteModule, isHiddenSegment, manifestDiff, METADATA_FILE, metadataModule, ROUTE_FILE, routeFileProblems,
  routePath, stubShapeOk, type Src,
} from './_enumerate'
import { ACTION_GATES, CORE_ROUTE_ALLOW, METADATA_ROUTE_ALLOW, NOTE_REQUIRED, ROUTE_GATES, ROUTE_MODULE_OVERRIDES, type GateEntry } from './manifest'

const ids = (m: GateEntry['module']): readonly ModuleId[] => (m === null ? [] : typeof m === 'string' ? [m] : m)
function entryProblems(key: string, e: GateEntry, kind: 'action' | 'route'): string[] {
  const out: string[] = []
  if (NOTE_REQUIRED.has(e.guard) && !(e.note && e.note.length > 3)) out.push(`${key}: guard ${e.guard} 은 note 필수`)
  if (e.module !== null) {
    const list = ids(e.module)
    if (list.length === 0 || new Set(list).size !== list.length || !list.every(isModuleId)) out.push(`${key}: module 목록이 비었거나 중복·모르는 id`)
    if (kind === 'action' && !Array.isArray(e.sample)) out.push(`${key}: 모듈 액션은 sample 필수`)
    if (kind === 'route' && !e.delegatedTo) out.push(`${key}: 모듈 라우트는 delegatedTo 필수(P15)`)
  } else if (e.deny !== undefined || e.delegatedTo || e.delegatedStatic !== undefined) out.push(`${key}: module null 항목에 deny·delegatedTo·delegatedStatic 이 있다`)
  // null 항목의 sample 은 허용한다 — 가드 거부 실행(deny.test)이 가드 앞 검증을 지나게
  if (e.target !== undefined && (kind !== 'action' || e.module === null || !e.note)) out.push(`${key}: target 은 note 가 있는 모듈 액션 항목에만(판정 대상 덮어쓰기)`)
  // 작성자·주최자 분기 — note 의 '관리자 또는 작성자|주최자' 와 ownerBranch 는 짝이다(한쪽만 있으면 deny 하네스가 작성자 분기를 달리지 않는다)
  const ownerNote = /관리자 또는 (작성자|주최자)/.test(e.note ?? '')
  if (ownerNote !== (e.ownerBranch !== undefined)) out.push(`${key}: note '관리자 또는 작성자·주최자' 와 ownerBranch 는 함께 둔다`)
  if (e.ownerBranch !== undefined && (kind !== 'action' || e.module === null || e.ownerBranch.length <= 3)) out.push(`${key}: ownerBranch 는 모듈 액션 항목의 사유(3자 초과)`)
  if (e.delegatedStatic !== undefined && (kind !== 'route' || e.delegatedStatic.length <= 3)) out.push(`${key}: delegatedStatic 은 라우트 모듈 항목의 사유(3자 초과)`)
  return out
}

const read = (f: string): Src => ({ rel: relative(process.cwd(), f), text: readFileSync(f, 'utf8') })
// allowJs 라 .js 액션 모듈도 번들에 들어간다 — 액션은 확장자와 무관하게 연다
const actionSrc = () => walk('src', undefined, /\.[cm]?[jt]sx?$/).map(read)
const routeSrc = () => walk('src/app/api', undefined, /^route\.tsx?$/).map(read)

describe('열거 — 액션', () => {
  const { keys, problems } = enumerateActions(actionSrc())
  it('인라인 use server·default export 0건(D18)', () => { expect(problems).toEqual([]) })
  it('코드의 액션 = 매니페스트(새 액션은 항목이 있어야 한다 — D38, 죽은 항목 금지)', () => {
    expect(keys.length).toBeGreaterThan(100)
    expect(keys).toContain('src/app/actions/issues.ts#createIssue')
    const { missing, dead } = manifestDiff(keys, ACTION_GATES)
    expect(missing, '매니페스트에 없는 액션').toEqual([])
    expect(dead, '코드에 없는 항목').toEqual([])
  })
  it('항목 모양', () => { expect(Object.entries(ACTION_GATES).flatMap(([k, e]) => entryProblems(k, e, 'action'))).toEqual([]) })
})

describe('열거 — 라우트', () => {
  const { handlers, stubs, problems } = enumerateRoutes(routeSrc())
  it('export 는 메서드 함수·메서드 스텁·라우트 설정 상수뿐', () => { expect(problems).toEqual([]) })
  it('라우트 파일은 src/app/api 아래 route.ts 뿐이다(다른 자리·확장자·pages 라우터는 열거 밖)', () => {
    const anywhere = walk('src/app', undefined, ROUTE_FILE).map((f) => relative(process.cwd(), f))
    expect(anywhere.length).toBeGreaterThan(30)
    expect(routeFileProblems(anywhere)).toEqual([])
    expect(['pages', 'src/pages'].filter((d) => existsSync(d)), 'pages 라우터의 API 는 열거 밖이다').toEqual([])
  })
  it('코드의 핸들러 = 매니페스트', () => {
    expect(handlers.length).toBeGreaterThan(30)
    const { missing, dead } = manifestDiff(handlers, ROUTE_GATES)
    expect(missing, '매니페스트에 없는 핸들러').toEqual([])
    expect(dead, '코드에 없는 항목').toEqual([])
  })
  it('핸들러의 모듈 = apiPrefixes(덮어쓰기·core 허용 제외), 항목 모양', () => {
    const bad = handlers.flatMap((k) => {
      const exp = expectedRouteModule(routePath(k.split('#')[0]))
      if ('problem' in exp) return [exp.problem]
      if (!(k in ROUTE_GATES)) return []   // 항목이 없는 핸들러는 위 양방향 대조가 잡는다 — 여기서 던져 나머지를 가리지 않는다
      const got = ROUTE_GATES[k].module
      return JSON.stringify(got) === JSON.stringify(exp.module) ? [] : [`${k}: 매니페스트 ${JSON.stringify(got)} ≠ 접두 ${JSON.stringify(exp.module)}`]
    })
    expect([...bad, ...Object.entries(ROUTE_GATES).flatMap(([k, e]) => entryProblems(k, e, 'route'))]).toEqual([])
  })
  it('덮어쓰기·core 허용 목록은 실재하는 URL 경로이고(그룹·슬롯 조각 없음) 사유가 있다', () => {
    const paths = new Set(handlers.map((k) => routePath(k.split('#')[0])))
    for (const [p, why] of [...Object.entries(ROUTE_MODULE_OVERRIDES), ...Object.entries(CORE_ROUTE_ALLOW)]) {
      expect(p.split('/').some(isHiddenSegment), `${p} — 파일 경로가 아니라 URL 경로로 적는다`).toBe(false)
      expect(paths.has(p), p).toBe(true); expect(why.length, p).toBeGreaterThan(3)
    }
  })
  it('메타데이터 라우트(opengraph-image·icon·sitemap 등)는 닫힌 허용 목록이고 모듈 경로 아래에 없다(F12)', () => {
    const files = walk('src/app', undefined, METADATA_FILE).map((f) => relative(process.cwd(), f)).sort()
    expect(files.length).toBeGreaterThan(0)
    expect(files.filter((f) => !(f in METADATA_ROUTE_ALLOW)), '허용 목록 밖 — 모듈 데이터를 그리면 관문이 필요하다').toEqual([])
    for (const [f, why] of Object.entries(METADATA_ROUTE_ALLOW)) {
      expect(files, f).toContain(f); expect(why.length, f).toBeGreaterThan(3)
      expect(metadataModule(f), `${f} 는 모듈 경로 아래다`).toBeNull()
    }
  })
  it('/api/v1/** 는 core 모듈의 apiPrefixes 에 걸리지 않는다', () => {
    const coreP = MODULES.filter((m) => m.core).flatMap((m) => m.apiPrefixes)
    for (const k of handlers.filter((x) => x.includes('/api/v1/'))) {
      const p = routePath(k.split('#')[0])
      expect(coreP.some((c) => p === c || p.startsWith(c + '/')), p).toBe(false)
    }
  })
  it('const 스텁은 apiNotFound(또는 그 별칭)·404 인라인 클로저 두 모양뿐(P16)', () => {
    expect(stubs.length).toBeGreaterThan(50)
    const byKey = new Map(stubs.map((s) => [s.key, s.init]))
    expect(stubs.filter((s) => !stubShapeOk(s, byKey)).map((s) => s.key)).toEqual([])
  })
})

describe('열거 — 민감도(합성 소스)', () => {
  it('새 export·default async function·export default 식·인라인 지시문을 잡는다', () => {
    const r = enumerateActions([
      { rel: 'x.ts', text: "'use server'\nexport async function a() {}\nexport default async function () {}\n" },
      { rel: 'y.ts', text: "'use server'\nconst f = 1\nexport default f\n" },
      { rel: 'z.ts', text: "export function g() {\n  'use server'\n}\n" },
    ])
    expect(r.keys).toEqual(['x.ts#a'])
    expect(r.problems).toEqual(['x.ts: export default function', 'y.ts: export default <식>', "z.ts: 인라인 'use server'"])
  })
  it('새 스텁 모양·알 수 없는 export 를 잡고, core 접두에 걸리는 v1 경로를 잡는다', () => {
    const r = enumerateRoutes([{ rel: 'src/app/api/v1/x/route.ts', text: 'export const GET = () => new Response()\nexport const helper = 1\n' }])
    expect(r.problems).toEqual(['src/app/api/v1/x/route.ts: 알 수 없는 export const helper'])
    expect(expectedRouteModule('/api/nowhere')).toEqual({ problem: '/api/nowhere: 어느 모듈의 apiPrefixes 에도, core 허용 목록에도 없다' })
    expect(expectedRouteModule('/api/export')).toEqual({ module: null })
    expect(expectedRouteModule('/api/issue-analysis')).toEqual({ module: 'issues' })
  })
  it('export 선언문(export { h as GET })은 열거를 우회하지 못한다', () => {
    const r = enumerateRoutes([{ rel: 'src/app/api/v1/y/route.ts', text: 'async function h() { return new Response() }\nexport { h as GET }\nexport type { X } from "./x"\n' }])
    expect(r.handlers).toEqual([])
    expect(r.problems).toEqual(['src/app/api/v1/y/route.ts: export 선언문 — 메서드는 function 으로'])
  })
  it('export * ·default export·클래스 export 도 라우트 열거를 우회하지 못한다', () => {
    const r = enumerateRoutes([{ rel: 'r.ts', text: "export * from './h'\nexport default async function GET() {}\nexport default h\nexport class POST {}\nexport { type T } from './t'\n" }])
    expect(r.handlers).toEqual([])
    expect(r.problems).toEqual(['r.ts: export 선언문 — 메서드는 function 으로', 'r.ts: export default function', 'r.ts: export default <식>', 'r.ts: 알 수 없는 export 문(ClassDeclaration)'])
  })
  it("'use server' 모듈의 값 export(const 화살표·export { f as g }·export *)와 지시문 머리 뒤쪽의 'use server' 를 잡는다", () => {
    const r = enumerateActions([
      { rel: 'a.ts', text: "'use server'\nexport const x = async () => {}\nasync function h() {}\nexport { h as y }\nexport * from './z'\nexport type { T } from './t'\nexport class C {}\n" },
      { rel: 'b.ts', text: "'use strict'\n'use server'\nexport async function b() {}\n" },
      { rel: 'c.ts', text: "export function g() {\n  'use strict'\n  'use server'\n}\n" },
    ])
    expect(r.keys).toEqual(['b.ts#b'])
    expect(r.problems).toEqual([
      'a.ts: 함수 선언이 아닌 값 export — 액션은 export async function 으로',
      'a.ts: export 선언문 — 액션은 export async function 으로',
      'a.ts: export 선언문 — 액션은 export async function 으로',
      'a.ts: 함수 선언이 아닌 값 export — 액션은 export async function 으로',
      "c.ts: 인라인 'use server'",
    ])
  })
  it('라우트 파일의 자리·확장자를 잡는다(api 아래 route.tsx 는 열거한다 — F10)', () => {
    expect(routeFileProblems(['src/app/api/x/route.ts', 'src/app/api/route.ts', 'src/app/(app)/p/[projectId]/x/route.ts', 'src/app/api/y/route.tsx', 'src/app/api/z/route.js'])).toEqual([
      'src/app/(app)/p/[projectId]/x/route.ts: 라우트 파일은 src/app/api/**/route.{ts,tsx} 에만 둔다',
      'src/app/api/z/route.js: 라우트 파일은 src/app/api/**/route.{ts,tsx} 에만 둔다',
    ])
    expect(routePath('src/app/api/og/route.tsx')).toBe('/api/og')
  })
  it('Next 세그먼트 설정·generateStaticParams 는 통과하고(F10 오탐), 원천 모듈의 별칭 import 스텁은 허용·지역 그림자 스텁은 거부한다(F9 b)', () => {
    const r = enumerateRoutes([{ rel: 'src/app/api/v1/s/route.ts', text: [
      "import { apiNotFound as nf, apiFail } from '@/lib/agent/externalApi'",
      "export const fetchCache = 'force-no-store'", "export const preferredRegion = 'icn1'", 'export const dynamicParams = false',
      'export async function generateStaticParams() { return [] }',
      'export const GET = nf', 'export const PUT = GET', "export const POST = () => apiFail(404, 'not_found', 'Not Found')",
    ].join('\n') }, { rel: 'src/app/api/v1/t/route.ts', text: [
      'const apiNotFound = async (req?: Request) => (req ? Response.json({ rows: [] }) : new Response(null, { status: 404 }))',
      "const apiFail = (s: number, c: string) => Response.json({ c }, { status: s === 404 ? 200 : s })",
      'export const GET = apiNotFound', "export const POST = () => apiFail(404, 'not_found')",
      "export const PATCH = (req: Request) => apiFailImported(404, 'not_found')",
    ].join('\n') }])
    expect(r.problems).toEqual([])
    const byKey = new Map(r.stubs.map((s) => [s.key, s.init]))
    expect(r.stubs.filter((s) => stubShapeOk(s, byKey)).map((s) => s.key)).toEqual(['src/app/api/v1/s/route.ts#GET', 'src/app/api/v1/s/route.ts#PUT', 'src/app/api/v1/s/route.ts#POST'])
  })
  it('URL 판정은 route group·슬롯 조각을 뺀다(F11) — api/(legacy)/wiki 는 wiki 다', () => {
    expect(routePath('src/app/api/(legacy)/wiki/export/route.ts')).toBe('/api/wiki/export')
    expect(expectedRouteModule(routePath('src/app/api/(legacy)/wiki/export/route.ts'))).toEqual({ module: 'wiki' })
    expect(expectedRouteModule(routePath('src/app/api/@x/(g)/chat/route.ts'))).toEqual({ module: 'chatbot' })
  })
  it('메타데이터 파일의 모듈 경로 판정(F12)', () => {
    expect(metadataModule('src/app/icon.tsx')).toBeNull()
    expect(metadataModule('src/app/(app)/p/[projectId]/wiki/topics/[topicId]/opengraph-image.tsx')).toBe('wiki')
    expect(metadataModule('src/app/(app)/minutes/[id]/twitter-image.tsx')).toBe('minutes')
    expect(METADATA_FILE.test('opengraph-image2.tsx') && METADATA_FILE.test('sitemap.ts') && !METADATA_FILE.test('icon.png')).toBe(true)
  })
  it("이스케이프로 쓴 'use server' 지시문도 열거한다(T13-m2 — Next 는 익은 값으로 읽는다)", () => {
    const r = enumerateActions([
      { rel: 'e1.ts', text: "'use\\x20server'\nexport async function e1() {}\n" },
      { rel: 'e2.ts', text: "\"use\\u0020server\"\nexport const e2 = async () => 1\n" },
      { rel: 'e3.ts', text: "// 주석 don't\n'u\\se\\u{20}server'\nexport async function e3() {}\n" },
      { rel: 'e4.ts', text: "export function g() {\n  'use\\x20server'\n}\n" },
      { rel: 'no.ts', text: "'use\\x20client'\nexport async function no() {}\nconst re = /\\u0020/\n" },
    ])
    expect(r.keys).toEqual(['e1.ts#e1', 'e3.ts#e3'])
    expect(r.problems).toEqual(['e2.ts: 함수 선언이 아닌 값 export — 액션은 export async function 으로', "e4.ts: 인라인 'use server'"])
  })
  it('자기 검사 — 매니페스트에 없는 새 액션·새 핸들러와 죽은 항목을 FAIL 로 잡는다(D38)', () => {
    const acts = enumerateActions([...actionSrc(), { rel: 'src/app/actions/issues.ts', text: "'use server'\nexport async function sneakyIssueAction() {}\n" }]).keys
    expect(manifestDiff(acts, ACTION_GATES).missing).toEqual(['src/app/actions/issues.ts#sneakyIssueAction'])
    const routes = enumerateRoutes([...routeSrc(), { rel: 'src/app/api/wiki/sneaky/route.ts', text: 'export async function GET() { return new Response() }\n' }]).handlers
    expect(manifestDiff(routes, ROUTE_GATES).missing).toEqual(['src/app/api/wiki/sneaky/route.ts#GET'])
    expect(expectedRouteModule(routePath('src/app/api/wiki/sneaky/route.ts'))).toEqual({ module: 'wiki' })
    // 액션을 지웠는데 항목이 남으면(죽은 항목) 그것도 잡는다
    const withoutOne = acts.filter((k) => k !== 'src/app/actions/issues.ts#createIssue')
    expect(manifestDiff(withoutOne, ACTION_GATES).dead).toEqual(['src/app/actions/issues.ts#createIssue'])
  })
})
