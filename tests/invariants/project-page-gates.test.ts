// 프로젝트 화면(src/app/(app)/p/[projectId]/**/page.tsx)이 service_role 원천을 쓰면, 같은 파일에서 그보다 먼저
// 가시성 게이트를 둔다(SP2 T15 리뷰 Critical).
//
// 이유: 레이아웃과 페이지는 병렬로 렌더된다. 레이아웃의 notFound(존재 은닉)는 페이지의 조회를 멈추지 않고, 페이지가 만든
// RSC 페이로드는 404 digest 옆에 그대로 실린다. RLS 가 걸린 세션 조회는 타 워크스페이스에서 빈 결과라 괜찮다. 하지만
// service_role 원천(팀 캐시·admin 클라이언트 로더)은 권한과 무관하게 채워져 있어, members 가 타 워크스페이스 팀 id·코드를
// 흘렸다.
//
// service_role 원천 = 코드에 createAdminClient·adminFor( 가 있는 모듈과, 그 모듈에 (값 import 로) 닿는 src 모듈 전부.
// 탐색은 'use client'(렌더 중 실행되지 않는다)와 'use server'(서버 액션 — 각자 require* 가드를 건다, 감사표) 경계에서 멈춘다.
// 탐색 간선은 값 import 와 re-export(`export { x } from`·`export * from`) 둘 다다 — 배럴을 거쳐도 원천에 닿는다.
// 게이트 = `if (…) notFound()|redirect(…)` 한 줄 중 조건이 거부형·은닉형인 것만: `!isProjectMember(`·`!isProjectAdmin(`·`!roleIn(`,
// `isHiddenProject(`(부정 없이), 또는 그 판정을 담은 변수를 같은 방향으로 쓴 것(허용 판정 변수는 `!v`, 은닉 판정 변수는 `v`,
// require* 결과는 `!v.ok`). 역전된 조건(`if (isProjectAdmin(…)) redirect`)은 권한 있는 사람을 돌려보내고 없는 사람을 통과시키므로
// 게이트가 아니다. 위치는 줄 번호로만 본다(흐름 분석은 하지 않는다).
import { describe, it, expect } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { codeLines, walk } from './_walk'

const CWD = process.cwd()
const PAGES_ROOT = join(CWD, 'src/app/(app)/p/[projectId]')
// 워크스페이스 설정 화면도 같은 이유로 본다(스펙 SP3a §7.1) — 레이아웃이 아니라 페이지가 자기 가드를 건다.
const WORKSPACE_PAGES_ROOT = join(CWD, 'src/app/(app)/w/[slug]')

/** service_role 에 닿지만 그 내용이 결과에 실리지 않는 로더 — 탐색을 여기서 끊는다. 한 줄 근거 필수. */
const SAFE_LOADERS: Record<string, string> = {
  'src/lib/data/wbs.ts': '팀 캐시(teamsForProjectSync)는 RLS 로 읽은 담당 행을 정렬하는 키로만 쓴다 — 캐시 내용이 결과에 실리지 않는다',
  'src/lib/data/snapshots.ts': '팀 캐시는 RLS 로 읽은 항목 롤업의 정렬 키(subActTeamOrder)로만 쓰고, 결과는 실적·계획 % 숫자다(쓰기도 세션 클라이언트)',
}
/** `<page>#<symbol>` — 로더가 자기 가드를 가져 페이지 게이트가 필요 없는 경우. 한 줄 근거 필수. 지금은 없다. */
const ALLOWLIST: Record<string, string> = {}

/** 조건에 직접 쓴 거부형·은닉형 판정 — 허용 판정은 부정으로, 은닉 판정은 부정 없이. */
const GATE_DENY = /!\s*(?:isProjectMember|isProjectAdmin|roleIn)\(|(?<![!\w])isHiddenProject\(/
const GATE_VAR = /\b(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?.*\b(isHiddenProject|roleIn|isProjectMember|isProjectAdmin|require(?:Superuser|ProjectAdmin|ProjectMember|WorkspaceAdmin))\(/
const GATE_IF = /\bif\s*\((.*)\)\s*(?:return\s+)?(?:notFound|redirect)\(/
const IMPORT_RE = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm
/** re-export — `export { a, type B } from '…'`·`export * from '…'`·`export * as ns from '…'`. `export type { … } from` 은 값이 아니다. */
const REEXPORT_RE = /^\s*export\s+(type\s+)?(\{[\s\S]*?\}|\*(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]/gm

type GateVarKind = 'hidden' | 'allow' | 'guard'
const gateVarKind = (fn: string): GateVarKind => (fn === 'isHiddenProject' ? 'hidden' : fn.startsWith('require') ? 'guard' : 'allow')
/** 판정 변수를 게이트 방향으로 썼는가 — 은닉은 그대로(`hidden`), 허용은 부정(`!isAdmin`), 가드 결과는 `!g.ok`. */
function usesGateVar(cond: string, name: string, kind: GateVarKind): boolean {
  if (kind === 'guard') return new RegExp(`!\\s*${name}\\.ok\\b`).test(cond)
  if (kind === 'allow') return new RegExp(`!\\s*${name}\\b(?!\\s*\\.)`).test(cond)
  return new RegExp(`(?<![!\\w.])${name}\\b(?!\\s*\\.)`).test(cond)
}

const rel = (abs: string) => relative(CWD, abs)
const code = (abs: string) => codeLines(readFileSync(abs, 'utf8'), abs)

function resolveModule(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(CWD, 'src', spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null
  if (!base) return null
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c
  }
  return null
}

/** 값 import 들 — [로컬 이름들, 모듈 경로]. `import type`·`type X` 지정자는 뺀다. */
function valueImports(lines: string[], from: string): Array<{ names: string[]; module: string | null; endLine: number }> {
  const text = lines.join('\n')
  const out: Array<{ names: string[]; module: string | null; endLine: number }> = []
  for (const m of text.matchAll(IMPORT_RE)) {
    if (m[1]) continue
    const clause = m[2].trim()
    const names: string[] = []
    const braces = clause.match(/\{([\s\S]*)\}/)
    const head = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim()
    const ns = head.match(/\*\s+as\s+(\w+)/)
    if (ns) names.push(ns[1])
    else if (head) names.push(head.split(/\s+/)[0])
    if (braces) {
      for (const part of braces[1].split(',').map((p) => p.trim()).filter(Boolean)) {
        if (part.startsWith('type ')) continue
        names.push(part.split(/\s+as\s+/).pop()!.trim())
      }
    }
    out.push({ names, module: resolveModule(from, m[3]), endLine: text.slice(0, m.index! + m[0].length).split('\n').length - 1 })
  }
  return out
}

/** re-export 가 가리키는 모듈들 — 값을 내보내는 것만(`export type { … } from` 과 전부 `type` 인 중괄호는 뺀다). */
function reExportModules(lines: string[], from: string): Array<string | null> {
  const out: Array<string | null> = []
  for (const m of lines.join('\n').matchAll(REEXPORT_RE)) {
    if (m[1]) continue
    const braces = m[2].match(/^\{([\s\S]*)\}$/)
    if (braces && braces[1].split(',').map((p) => p.trim()).filter(Boolean).every((p) => p.startsWith('type '))) continue
    out.push(resolveModule(from, m[3]))
  }
  return out
}

function directive(lines: string[]): 'client' | 'server' | null {
  const first = lines.find((l) => l.trim() !== '')?.trim() ?? ''
  const m = first.match(/^['"]use (client|server)['"]/)
  return m ? (m[1] as 'client' | 'server') : null
}
const isRoot = (lines: string[]) => /\bcreateAdminClient\b|\badminFor\s*\(/.test(lines.join('\n'))

const memo = new Map<string, boolean>()
/** 이 모듈을 렌더 중에 부르면 service_role 로 읽은 값이 나올 수 있는가(값 import 추이). */
function reachesServiceRole(abs: string, useSafe = true): boolean {
  const key = `${useSafe}:${abs}`
  if (memo.has(key)) return memo.get(key)!
  memo.set(key, false)   // 순환 import 방지 — 방문 중엔 거짓
  const lines = code(abs)
  let hit = false
  if (useSafe && rel(abs) in SAFE_LOADERS) hit = false
  else if (directive(lines)) hit = false
  else if (isRoot(lines)) hit = true
  else hit = [...valueImports(lines, abs).map((i) => i.module), ...reExportModules(lines, abs)]
    .some((m) => m !== null && reachesServiceRole(m, useSafe))
  memo.set(key, hit)
  return hit
}

/** 게이트 줄 번호(없으면 -1) — bodyStart 이후만 본다. 조건이 거부형·은닉형일 때만 게이트로 센다. */
function firstGateLine(lines: string[], bodyStart = 0): number {
  const vars: Array<{ name: string; kind: GateVarKind }> = []
  for (let i = bodyStart; i < lines.length; i++) {
    const v = lines[i].match(GATE_VAR)
    if (v) vars.push({ name: v[1], kind: gateVarKind(v[2]) })
    const g = lines[i].match(GATE_IF)
    if (g && (GATE_DENY.test(g[1]) || vars.some((x) => usesGateVar(g[1], x.name, x.kind)))) return i
  }
  return -1
}
function firstUseLine(lines: string[], symbols: string[], bodyStart = 0): number {
  for (let i = bodyStart; i < lines.length; i++) {
    if (symbols.some((s) => new RegExp(`\\b${s}\\b`).test(lines[i]))) return i
  }
  return -1
}

function pageReport(abs: string) {
  const lines = code(abs)
  const imports = valueImports(lines, abs)
  const bodyStart = imports.length ? Math.max(...imports.map((i) => i.endLine)) + 1 : 0
  const symbols = imports.filter((i) => i.module !== null && reachesServiceRole(i.module)).flatMap((i) => i.names)
  const gate = firstGateLine(lines, bodyStart)
  const uses = symbols.map((s) => ({ symbol: s, line: firstUseLine(lines, [s], bodyStart) })).filter((u) => u.line >= 0)
  return { symbols, gate, uses }
}

const pages = () => [...walk(PAGES_ROOT), ...walk(WORKSPACE_PAGES_ROOT)].filter((f) => f.endsWith('page.tsx')).sort()

describe('프로젝트 화면 — service_role 원천 앞의 가시성 게이트', () => {
  it('service_role 원천을 쓰는 페이지는 그보다 앞 줄에 게이트가 있다', () => {
    const violations: string[] = []
    for (const abs of pages()) {
      const { gate, uses } = pageReport(abs)
      for (const u of uses) {
        const key = `${rel(abs)}#${u.symbol}`
        if (key in ALLOWLIST) continue
        if (gate < 0 || gate >= u.line) violations.push(`${key} (사용 ${u.line + 1}행, 게이트 ${gate < 0 ? '없음' : `${gate + 1}행`})`)
      }
    }
    expect(violations).toEqual([])
  })

  it('검사 대상에 워크스페이스 설정 페이지가 들어 있다(루트를 잘못 좁히면 조용히 빠진다)', () => {
    expect(pages().map(rel)).toContain('src/app/(app)/w/[slug]/settings/page.tsx')
    expect(pages().map(rel)).toContain('src/app/(app)/p/[projectId]/settings/page.tsx')
  })

  it('분석이 알려진 원천을 잡는다 — 팀 캐시·admin 로더·서버 컴포넌트 경유', () => {
    const at = (p: string) => pageReport(join(PAGES_ROOT, p)).symbols
    expect(at('members/page.tsx')).toContain('teamsForProjectSync')
    expect(at('settings/page.tsx')).toEqual(expect.arrayContaining(['assistantIndexStatus', 'workspaceTeamsForProjectSync', 'projectTeamRowsSync']))
    expect(at('agents/office/page.tsx')).toContain('getProjectOffice')
    expect(at('agents/page.tsx')).toContain('getAgentHub')
    // DashboardView 는 서버 컴포넌트라 렌더 중에 팀 캐시를 읽는다 — 페이지 파일에 캐시 호출이 없어도 원천이다.
    expect(at('dashboard/page.tsx')).toContain('DashboardView')
    // 'use server' 경계 — 서버 액션은 자기 가드를 건다.
    expect(at('members/page.tsx')).not.toContain('listRoster')
  })

  it('SAFE_LOADERS·ALLOWLIST 는 낡지 않았고 근거가 있다', () => {
    for (const [file, reason] of Object.entries(SAFE_LOADERS)) {
      expect(reason.length, file).toBeGreaterThan(10)
      expect(reachesServiceRole(join(CWD, file), false), `${file} 는 더 이상 service_role 에 닿지 않는다 — 항목을 지운다`).toBe(true)
    }
    for (const [key, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, key).toBeGreaterThan(10)
      const [file, symbol] = key.split('#')
      expect(pageReport(join(CWD, file)).symbols, `${key} 는 더 이상 원천이 아니다 — 항목을 지운다`).toContain(symbol)
    }
  })

  it('판정기 — 주석 속 게이트는 세지 않고, 판정 변수를 쓴 게이트는 센다', () => {
    const src = (body: string) => codeLines(body)
    expect(firstGateLine(src([
      '// if (!isProjectMember(actor, pid)) redirect(x)',
      'const x = teamsForProjectSync(pid)',
    ].join('\n')))).toBe(-1)
    expect(firstGateLine(src([
      'const hidden = isHiddenProject(actor, pid)',
      'if (hidden && !degraded) notFound()',
    ].join('\n')))).toBe(1)
    expect(firstGateLine(src('if (!actor || !isProjectMember(actor, pid)) redirect(`/p/${pid}`)'))).toBe(0)
    // 게이트가 아닌 판정 — 결과를 어포던스에만 쓰면 흐름을 끊지 않는다.
    expect(firstGateLine(src('const canManage = isProjectAdmin(actor, pid)\nreturn <V canManage={canManage} />'))).toBe(-1)
    expect(firstUseLine(src('const a = 1\n<DashboardView x />'), ['DashboardView'])).toBe(1)
  })

  it('판정기 — 역전된 조건(권한 있는 사람을 돌려보낸다)은 게이트가 아니고, 거부형·은닉형만 센다', () => {
    const src = (body: string) => codeLines(body)
    for (const inverted of [
      'if (isProjectAdmin(actor, pid)) redirect(`/p/${pid}/settings`)',
      'if (isProjectMember(actor, pid)) notFound()',
      'if (!isHiddenProject(actor, pid)) notFound()',
      'const ok = isProjectMember(actor, pid)\nif (ok) notFound()',
      'const hidden = isHiddenProject(actor, pid)\nif (!hidden) notFound()',
      'const g = await requireProjectMember(pid)\nif (g.ok) redirect(`/p/${pid}`)',
    ]) expect(firstGateLine(src(inverted)), inverted).toBe(-1)
    expect(firstGateLine(src('const g = await requireProjectMember(pid)\nif (!g.ok) redirect(`/p/${pid}`)'))).toBe(1)
    expect(firstGateLine(src('const isAdmin = isProjectAdmin(actor, pid)\nif (!isAdmin) redirect(`/p/${pid}`)'))).toBe(1)
    expect(firstGateLine(src('if (!degraded && isHiddenProject(m, pid)) notFound()'))).toBe(0)
  })

  it('분석 — re-export 배럴(`export { x } from`·`export * from`)도 간선으로 따라가고, type 만 내보내는 배럴은 따라가지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'page-gates-'))
    try {
      const master = relative(dir, join(CWD, 'src/lib/teams/master'))
      const write = (name: string, body: string) => { writeFileSync(join(dir, name), body); return join(dir, name) }
      expect(reachesServiceRole(write('named.ts', `export { teamsForProjectSync } from '${master}'\n`))).toBe(true)
      expect(reachesServiceRole(write('star.ts', `export * from '${master}'\n`))).toBe(true)
      expect(reachesServiceRole(write('nested.ts', `export * from './named'\n`))).toBe(true)
      expect(reachesServiceRole(write('types.ts', `export type { TeamCode } from '${master}'\nexport { type Team } from '${master}'\n`))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
