// deny — 액션(스펙 §4.3 deny 행, 판정 P15·P17). 모듈 항목: ① 모듈 하나를 끄면 거부 값(목록형 module 은 원소마다), 관문이 그 모듈을 물었다
// ② 가드를 모두 거부시키면 관문을 부르지 않고 admin 클라이언트도 만들지 않는다(adminBeforeGuard 예외). null 항목: 본문(+같은 파일 헬퍼)에 관문 호출이 없다(AST),
// guard 가 네 가드 등급이면 ② 와 같은 가드 거부 실행(가드에 닿았는지까지 — 스펙 §4.3 deny 첫 줄은 전 항목이다).
// 모듈 항목의 실행 검사는 COVERED_ACTION_FILES 의 파일만 — 과제 14~17 이 관문을 넣으며 자기 파일을 더하고 과제 25 가 필터를 지운다.
// null 항목의 가드 거부 실행은 처음부터 전부다 — B 는 null 액션의 가드 경로를 바꾸지 않는다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/authz', async () => (await import('./_harness')).authzMock)
vi.mock('@/lib/auth', async () => (await import('./_harness')).authMock)
vi.mock('@/lib/supabase/server', async () => (await import('./_harness')).serverMock)
vi.mock('@/lib/supabase/admin', async () => (await import('./_harness')).adminMock)
vi.mock('@/lib/supabase/adminFor', async () => (await import('./_harness')).adminForMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (f: unknown) => f }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn(async () => null), generateAnswerStream: vi.fn(async () => null) }))
vi.mock('@/lib/notify/emit', () => ({ emitNotification: vi.fn(async () => ({ ok: true })) }))
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import type { ModuleId } from '@/lib/modules/defaults'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { gateCallsIn, parse } from '../invariants/_ast'
import { harness } from './_harness'
import { ACTION_GATES, type GateEntry } from './manifest'

/** 관문을 넣은 액션 파일 — 과제 14~17 이 자기 파일을 더한다. 과제 25 가 이 집합과 필터를 지운다(전 항목) */
const COVERED_ACTION_FILES = new Set<string>([])

const listOf = (m: GateEntry['module']): ModuleId[] => (m === null ? [] : typeof m === 'string' ? [m] : [...m])
const entries = Object.entries(ACTION_GATES)
const moduleEntries = entries.filter(([k, e]) => e.module !== null && COVERED_ACTION_FILES.has(k.split('#')[0]))
const load = async (key: string) => {
  const [file, name] = key.split('#')
  const mod = (await import(/* @vite-ignore */ join(process.cwd(), file))) as Record<string, (...a: unknown[]) => Promise<unknown>>
  return mod[name]
}
beforeEach(() => { harness.reset(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
// 하네스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 전역 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('deny — 모듈 항목(실행)', () => {
  it('덮는 파일이 매니페스트에 있다(오타 금지)', () => {
    const files = new Set(entries.map(([k]) => k.split('#')[0]))
    for (const f of COVERED_ACTION_FILES) expect(files.has(f), f).toBe(true)
  })
  it.each(moduleEntries.length ? moduleEntries : [['(아직 없음)', null as unknown as GateEntry]])('%s — 모듈을 하나씩 끄면 거부 값', async (key, e) => {
    if (!e) { expect(COVERED_ACTION_FILES.size, '덮은 파일이 있는데 모듈 항목이 0 이다 — 경로 오타').toBe(0); return }   // 자리표시 행은 빈 범위에서만
    const fn = await load(key)
    for (const off of listOf(e.module)) {
      harness.reset(); harness.moduleOff(off)
      const r = await fn(...(e.sample ?? []))
      if ('deny' in e) expect(r, `${key} off=${off}`).toEqual(e.deny)
      else expect(r, `${key} off=${off}`).toMatchObject({ ok: false, error: ERR_MODULE_DISABLED })
      expect(harness.asked(off), `${key} 가 ${off} 를 묻지 않았다`).toBe(true)
    }
  }, 30_000)
  it.each(moduleEntries.length ? moduleEntries : [['(아직 없음)', null as unknown as GateEntry]])('%s — 가드가 거부하면 관문·admin 을 부르지 않는다', async (key, e) => {
    if (!e) { expect(COVERED_ACTION_FILES.size, '덮은 파일이 있는데 모듈 항목이 0 이다 — 경로 오타').toBe(0); return }   // 자리표시 행은 빈 범위에서만
    const fn = await load(key)
    harness.reset(); harness.denyGuards()
    const r = await fn(...(e.sample ?? []))
    expect(harness.guardCalls(), `${key} 가 권한 판정에 닿지 않았다 — 가드 앞 입력 검증이면 매니페스트 sample 을 고친다`).toBeGreaterThan(0)
    expect(harness.gateCalls(), `${key} 가 가드 거부 뒤 관문을 불렀다`).toBe(0)
    if (!e.adminBeforeGuard) expect(harness.adminCreated(), `${key} 가 가드 거부 뒤 admin 을 만들었다`).toBe(0)
    if (e.deny === undefined) expect((r as { ok?: unknown } | null)?.ok, key).not.toBe(true)
  }, 30_000)
})

describe('deny — null 항목(정적)', () => {
  it('module null 액션은 본문과 같은 파일 헬퍼에서 관문을 부르지 않는다(스펙 §4.3 — 부르면 실패)', () => {
    const bad = entries.filter(([, e]) => e.module === null).flatMap(([key]) => {
      const [file, name] = key.split('#')
      const calls = gateCallsIn(parse(file, readFileSync(file, 'utf8')), name)
      return calls.length ? [`${key}: ${calls.join(',')}`] : []
    })
    expect(bad).toEqual([])
  })
  it('판별기 민감도 — 같은 파일의 함수 선언·const 화살표 헬퍼·별칭 import·네임스페이스 호출을 따라간다(합성 소스)', () => {
    const sf = parse('s.ts', [
      "import { requireModule as gate } from '@/lib/modules/gate'",
      "import * as g from '@/lib/modules/gate'",
      'async function viaDecl() { await inner() }',
      "async function inner() { await requireSessionModule(null, 'minutes') }",
      "const viaArrow = async () => gate({ projectId: 'p' }, 'issues')",
      "export async function a() { await viaDecl(); await viaArrow() }",
      "export async function b() { await g.requireModule({ projectId: 'p' }, 'wiki') }",
      'export async function c() { await unrelated() }',
    ].join('\n'))
    expect(gateCallsIn(sf, 'a')).toEqual(['requireSessionModule', 'requireModule'])
    expect(gateCallsIn(sf, 'b')).toEqual(['requireModule'])
    expect(gateCallsIn(sf, 'c')).toEqual([])
  })
  it('모듈 항목(덮은 파일)은 본문이나 같은 파일 헬퍼에 관문 호출이 있다', () => {
    const missing = moduleEntries.flatMap(([key]) => {
      const [file, name] = key.split('#')
      return gateCallsIn(parse(file, readFileSync(file, 'utf8')), name).length ? [] : [key]
    })
    expect(missing).toEqual([])
  })
})
/** 가드 거부 실행에서 뺀 null 액션(닫힌 목록) — 하네스로 가드까지 갈 수 없는 것만, 사유와 그 export 이름을 부르는 SP2 가드 테스트 파일.
 *  비어 있는 것이 정상이다. 항목이 생기면 과제 28 보고에 스펙 §4.3 deny 첫 줄 이탈(P15)로 적는다 */
const NULL_GUARD_EXEMPT: Readonly<Record<string, { why: string; coveredBy: string }>> = {}
const GUARD_RANKS = new Set(['superuser', 'workspaceAdmin', 'projectAdmin', 'projectMember'])
const nullGuarded = entries.filter(([k, e]) => e.module === null && GUARD_RANKS.has(e.guard) && !(k in NULL_GUARD_EXEMPT))

describe('deny — null 항목(가드 거부 실행, 스펙 §4.3 deny 첫 줄·정본 §6.5.3)', () => {
  it('가드 등급 null 항목이 있다(표본 수 하한)', () => { expect(nullGuarded.length).toBeGreaterThan(40) })
  it.each(nullGuarded)('%s — 가드가 거부하면 가드에 닿고, 거부 응답이며, admin·관문을 부르지 않는다', async (key, e) => {
    const fn = await load(key)
    harness.reset(); harness.denyGuards()
    const r = await Promise.resolve()
      .then(() => fn(...(e.sample ?? [])))
      .catch((err: unknown) => ({ thrown: err instanceof Error ? err.message : String(err) }))   // 가드 거부를 throw 로 알리는 액션도 거부다
    expect(harness.guardCalls(), `${key} 가 권한 판정에 닿지 않았다 — 가드 앞 입력 검증이면 매니페스트 sample 을 고친다`).toBeGreaterThan(0)
    expect((r as { ok?: unknown } | null)?.ok, key).not.toBe(true)
    expect(harness.gateCalls(), key).toBe(0)
    if (!e.adminBeforeGuard) expect(harness.adminCreated(), `${key} 가 가드 거부 뒤 admin 을 만들었다`).toBe(0)
  }, 30_000)
  it('예외 목록은 실재하는 null 항목이고, 그 export 를 SP2 가드 테스트가 부른다', () => {
    for (const [k, x] of Object.entries(NULL_GUARD_EXEMPT)) {
      expect(ACTION_GATES[k]?.module, k).toBeNull()
      expect(x.why.length, k).toBeGreaterThan(3)
      expect(x.coveredBy, k).toMatch(/^tests\/actions\/.*gate.*\.test\.ts$/)
      expect(readFileSync(x.coveredBy, 'utf8'), `${k} → ${x.coveredBy}`).toContain(k.split('#')[1])
    }
  })
})
