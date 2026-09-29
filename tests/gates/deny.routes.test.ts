// deny — 라우트(판정 P15·P16). 모듈 라우트의 실행 확인은 delegatedTo 파일이 한다 — 여기서는 그 파일이 그 핸들러(메서드)를 import 하고 거부를
// 단언하는지, 모듈 라우트 핸들러마다 본문에 모듈 판정 호출이 있는지(AST — 한 파일의 메서드 가운데 하나가 빠져도 잡는다, R3),
// null 라우트는 관문을 부르지 않는지(AST), const 스텁 74 는 호출하면 404 · { error: 'Not Found' } 인지 본다.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase/admin', async () => (await import('./_harness')).adminMock)
vi.mock('@/lib/supabase/server', async () => (await import('./_harness')).serverMock)
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { gateCallsIn, parse } from '../invariants/_ast'
import { walk } from '../invariants/_walk'
import { enumerateRoutes } from './_enumerate'
import { harness } from './_harness'
import { ROUTE_GATES } from './manifest'

const entries = Object.entries(ROUTE_GATES)
// 하네스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 전역 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })
/** 거부 단언의 흔적 — 오류 상수·기계 코드만(무관한 문자열 'off' 는 세지 않는다) */
const DENY_TOKENS = ['ERR_MODULE_DISABLED', 'module_disabled', 'MODULE_DISABLED']
/** 모듈 라우트 핸들러가 부르는 판정 — 관문 둘 + 목록형 둘 + 에이전트 두 원천 AND 헬퍼(과제 18) */
const MODULE_ROUTE_GATES: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule', 'projectsWithModule', 'workspacesWithModule',
  'requireAgentProject', 'loadGatedOrder', 'loadGatedOrderForUser', 'accessibleProjectIds'])
/** 위임 파일이 그 라우트 모듈에서 이 메서드를 정적으로 import 하는가(import { GET } / import { GET as X }) */
function importsMethod(file: string, text: string, sub: string, method: string): boolean {
  return parse(file, text).statements.some((st) => ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === sub
    && !!st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)
    && st.importClause.namedBindings.elements.some((el) => (el.propertyName ?? el.name).text === method))
}
/** 위임 파일을 만든 과제가 끝난 것 — 과제 14·18·20·21 이 자기 위임 파일을 더하고 과제 25 가 이 집합과 필터를 지운다(전부) */
const DELEGATED_READY = new Set<string>([])

describe('deny — 라우트', () => {
  it('모듈 라우트의 위임 파일이 있고, 그 핸들러(메서드)를 import 하며, 거부를 단언한다', () => {
    const bad = entries.filter(([, e]) => e.module !== null && DELEGATED_READY.has(e.delegatedTo!)).flatMap(([key, e]) => {
      const f = e.delegatedTo!
      if (!existsSync(f)) return [`${key}: ${f} 없음`]
      const text = readFileSync(f, 'utf8')
      const [file, method] = key.split('#')
      const sub = file.replace(/^src\/app\//, '@/app/').replace(/\.ts$/, '')
      if (e.delegatedStatic) {
        if (!text.includes(`'${sub}'`)) return [`${key}: ${f} 에 경로 '${sub}' 가 없다(delegatedStatic)`]
      } else if (!importsMethod(f, text, sub, method)) return [`${key}: ${f} 가 ${sub} 에서 ${method} 를 import 하지 않는다`]
      return DENY_TOKENS.some((t) => text.includes(t)) ? [] : [`${key}: ${f} 에 모듈 거부 단언이 없다`]
    })
    expect(bad).toEqual([])
  })
  it('모듈 라우트 핸들러는 본문(+같은 파일 지역 함수)에서 모듈 판정을 부른다 — 메서드 단위(R3)', () => {
    const missing = entries.filter(([, e]) => e.module !== null && DELEGATED_READY.has(e.delegatedTo!)).flatMap(([key]) => {
      const [file, name] = key.split('#')
      return gateCallsIn(parse(file, readFileSync(file, 'utf8')), name, MODULE_ROUTE_GATES).length ? [] : [key]
    })
    expect(missing).toEqual([])
  })
  it('module null 라우트는 관문을 부르지 않는다(워커는 moduleState — 관문 목록 밖)', () => {
    const bad = entries.filter(([, e]) => e.module === null).flatMap(([key]) => {
      const [file, name] = key.split('#')
      const calls = gateCallsIn(parse(file, readFileSync(file, 'utf8')), name)
      return calls.length ? [`${key}: ${calls.join(',')}`] : []
    })
    expect(bad).toEqual([])
  })
  it('const 스텁은 호출하면 404 · error Not Found 이고 admin 을 만들지 않는다(P16)', async () => {
    // 매니페스트가 아니라 트리 전체에서 찾는다 — 함수 핸들러 없이 스텁만 있는 파일·v1 밖의 스텁도 실행으로 본다
    const files = walk('src/app/api').filter((f) => f.endsWith('/route.ts'))
    const { stubs } = enumerateRoutes(files.map((rel) => ({ rel, text: readFileSync(rel, 'utf8') })))
    expect(stubs.length).toBeGreaterThan(50)
    harness.reset()
    for (const s of stubs) {
      const [file, name] = s.key.split('#')
      const mod = (await import(/* @vite-ignore */ join(process.cwd(), file))) as Record<string, () => Promise<Response> | Response>
      // import 는 모듈 그래프의 부팅 코드(llm-override·팀 마스터 최초 로드)로 admin 을 만들 수 있다(실측: 첫 스텁 파일 import 에서 2회) — 호출만 잰다
      const before = harness.adminCreated()
      const res = await mod[name]()
      expect(res.status, s.key).toBe(404)
      expect(((await res.json()) as { error?: string }).error, s.key).toBe('Not Found')
      expect(harness.adminCreated() - before, `${s.key} 가 호출에서 admin 을 만들었다`).toBe(0)
    }
  }, 60_000)
})
