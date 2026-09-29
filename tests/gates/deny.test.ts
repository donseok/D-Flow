// deny — 액션(스펙 §4.3 deny 행, 판정 P15·P17). 모듈 항목: ① 모듈 하나를 기대 범위(target)에서 끄면 거부 값(목록형 module 은 원소마다), 관문이 그
// 범위로 물어 거부했고, 관문 앞에서 쓰지 않았고, 거부 뒤 DB 에 닿지 않았다 ② 가드를 모두 거부시키면 관문을 부르지 않고 쓰지 않으며 admin 클라이언트도
// 만들지 않는다(adminBeforeGuard 예외) ③ 관문 호출은 판정 모듈의 import 이고 결과를 조건으로 본다(AST). null 항목: 본문(+같은 파일 헬퍼)에 관문
// 호출이 없고(AST), 가드 통과 실행에서도 관문을 부르지 않는다(다른 파일 헬퍼 경유). 가드 등급 null 항목은 세션 없음·등급 거부 두 모드로, session
// null 항목은 세션 없음으로 가드 거부 실행(가드에 닿았는지·거부 응답·쓰기 0 — 스펙 §4.3 deny 첫 줄은 전 항목이다).
// 모듈 항목의 실행 검사는 COVERED_ACTION_FILES 의 파일만 — 과제 14~17 이 관문을 넣으며 자기 파일을 더하고 과제 25 가 필터를 지운다.
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
import { ERR_ANON, ERR_DENIED, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import type { ModuleId } from '@/lib/modules/defaults'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { gateCallsIn, gateSitesIn, parse, siteProblems } from '../invariants/_ast'
import { harness, P, U, type Target } from './_harness'
import { ACTION_GATES, type GateEntry } from './manifest'

/** 관문을 넣은 액션 파일 — 과제 14~17 이 자기 파일을 더한다. 과제 25 가 이 집합과 필터를 지운다(전 항목) */
const COVERED_ACTION_FILES = new Set<string>([
  'src/app/actions/issues.ts', 'src/app/actions/issueUpdates.ts', 'src/app/actions/issueAttachments.ts', 'src/app/actions/issueAnalysis.ts',   // 과제 14
  'src/app/actions/meetings.ts', 'src/app/actions/meetingNotify.ts', 'src/app/actions/announcements.ts', 'src/app/actions/attendance.ts',   // 과제 15
  'src/app/actions/weekly.ts', 'src/app/actions/wiki.ts', 'src/app/actions/chat.ts',
  'src/app/actions/minutes.ts',   // 과제 16
  'src/app/actions/agentHub.ts', 'src/app/actions/agentSeatmap.ts', 'src/app/actions/agentWork.ts', 'src/app/actions/wbsSpec.ts',   // 과제 17
])
/** 액션의 관문 — 판정 모듈(@/lib/modules/gate)의 import 로 부르고 결과를 조건으로 본다 */
const ACTION_GATE_NAMES: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule'])

const listOf = (m: GateEntry['module']): ModuleId[] => (m === null ? [] : typeof m === 'string' ? [m] : [...m])
const has = (v: unknown, id: string): boolean =>
  v === id || (Array.isArray(v) ? v.some((x) => has(x, id)) : !!v && typeof v === 'object' && Object.values(v).some((x) => has(x, id)))
/** 모듈 판정의 대상 — 매니페스트 target, 없으면 sample 에서(프로젝트 id → project, 행 id → row, 없으면 session) */
const targetOf = (e: GateEntry): Target => e.target ?? (has(e.sample ?? [], P) ? 'project' : has(e.sample ?? [], U) ? 'row' : 'session')
const entries = Object.entries(ACTION_GATES)
const moduleEntries = entries.filter(([k, e]) => e.module !== null && COVERED_ACTION_FILES.has(k.split('#')[0]))
const load = async (key: string) => {
  const [file, name] = key.split('#')
  const mod = (await import(/* @vite-ignore */ join(process.cwd(), file))) as Record<string, (...a: unknown[]) => Promise<unknown>>
  return mod[name]
}
/** 가드 거부를 throw 로 알리는 액션도 거부다 — 단 거부 문구(accept)가 든 throw 만. 가드가 새서 본문이 던진 오류(TypeError 등)는 그대로 던진다(I1 b) */
const runRefused = (fn: (...a: unknown[]) => Promise<unknown>, args: readonly unknown[], accept: readonly string[]) =>
  Promise.resolve().then(() => fn(...args)).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    if (accept.some((t) => msg.includes(t))) return { thrown: msg }
    throw err
  })
const carries = (r: unknown, token: string) => JSON.stringify(r ?? null).includes(token)
beforeEach(() => {
  harness.reset(); vi.spyOn(console, 'error').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('AGENT_API_ENABLED', 'true')   // 가드 앞 배포 플래그(createAgentToken) — 켜야 로그인 판정까지 간다. 이 플래그를 읽는 액션은 그 하나다
})
// 하네스가 바꾼 전역 관문 mock 을 통과 구현으로 되돌린다(공통 규칙 — 전역 mock 값을 바꾸는 파일)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset(); vi.unstubAllEnvs() })

describe('deny — 모듈 항목(실행)', () => {
  it('덮는 파일이 매니페스트에 있다(오타 금지)', () => {
    const files = new Set(entries.map(([k]) => k.split('#')[0]))
    for (const f of COVERED_ACTION_FILES) expect(files.has(f), f).toBe(true)
  })
  it.each(moduleEntries.length ? moduleEntries : [['(아직 없음)', null as unknown as GateEntry]])('%s — 모듈을 기대 범위에서 끄면 거부 값이고, 관문 앞에서 쓰지 않고, 거부 뒤 DB 에 닿지 않는다', async (key, e) => {
    if (!e) { expect(COVERED_ACTION_FILES.size, '덮은 파일이 있는데 모듈 항목이 0 이다 — 경로 오타').toBe(0); return }   // 자리표시 행은 빈 범위에서만
    const fn = await load(key)
    const target = targetOf(e)
    for (const off of listOf(e.module)) {
      harness.reset(); harness.moduleOff(off, target)
      const r = await fn(...(e.sample ?? []))
      const at = `${key} off=${off} target=${target} — ${harness.gateLog()}`
      if ('deny' in e) expect(r, at).toEqual(e.deny)
      else expect(r, at).toMatchObject({ ok: false, error: ERR_MODULE_DISABLED })
      expect(harness.deniedBy(off), `관문이 기대 범위로 ${off} 를 묻지 않았다: ${at}`).toBe(true)
      expect(harness.writes(), `관문 앞에서 썼다(P17): ${at}`).toBe(0)
      expect(harness.afterDeny(), `관문이 거부한 뒤 DB 에 닿았다(결과를 버리거나 본문이 돌았다): ${at}`).toBe(0)
    }
  }, 30_000)
  it.each(moduleEntries.length ? moduleEntries : [['(아직 없음)', null as unknown as GateEntry]])('%s — 가드가 거부하면 관문·쓰기·admin 이 없다', async (key, e) => {
    if (!e) { expect(COVERED_ACTION_FILES.size, '덮은 파일이 있는데 모듈 항목이 0 이다 — 경로 오타').toBe(0); return }   // 자리표시 행은 빈 범위에서만
    const fn = await load(key)
    harness.reset(); harness.denyGuards()
    const r = await runRefused(fn, e.sample ?? [], [ERR_DENIED, ERR_ANON])
    expect(harness.guardCalls(), `${key} 가 권한 판정에 닿지 않았다 — 가드 앞 입력 검증이면 매니페스트 sample 을 고친다`).toBeGreaterThan(0)
    expect(harness.gateCalls(), `${key} 가 가드 거부 뒤 관문을 불렀다`).toBe(0)
    expect(harness.writes(), `${key} 가 가드 거부 뒤 썼다`).toBe(0)
    expect(harness.afterGuardDeny(), `${key} 가 가드 거부 뒤 DB 에 닿았다`).toBe(0)
    if (!e.adminBeforeGuard) expect(harness.adminCreated(), `${key} 가 가드 거부 뒤 admin 을 만들었다`).toBe(0)
    if (e.deny === undefined) expect((r as { ok?: unknown } | null)?.ok, key).not.toBe(true)
  }, 30_000)
})

describe('deny — 모듈 항목(정적)', () => {
  it('모듈 항목(덮은 파일)은 관문을 부르고, 그 호출은 판정 모듈의 import 이며 결과를 조건으로 본다(결과를 버린 관문 금지)', () => {
    const bad = moduleEntries.flatMap(([key]) => {
      const [file, name] = key.split('#')
      const sites = gateSitesIn(parse(file, readFileSync(file, 'utf8')), name, ACTION_GATE_NAMES)
      return sites.length ? sites.flatMap(siteProblems).map((p) => `${key}${p}`) : [`${key}: 관문 호출이 없다`]
    })
    expect(bad).toEqual([])
  })
  it('판별기 민감도 — 결과를 버린 호출·지역 흉내·아무 객체의 메서드·조건으로 보지 않는 결과를 잡는다(합성 소스)', () => {
    const sf = parse('s.ts', [
      "import { requireModule, requireSessionModule as rsm } from '@/lib/modules/gate'",
      "import * as g from '@/lib/modules/gate'",
      "async function requireLocal() { return { ok: true } }",
      "export async function ok1(p) { const mod = await requireModule({ projectId: p }, 'wiki'); if (!mod.ok) return mod; return 1 }",
      "export async function ok2(p) { if (!(await g.requireModule({ projectId: p }, 'wiki')).ok) return null; return 1 }",
      "export async function ok3(p) { const mod = p ? await requireModule({ projectId: p }, 'wiki') : await rsm(null, 'wiki'); if (!mod.ok) return mod }",
      "export async function dropped(p) { await requireModule({ projectId: p }, 'wiki'); return 1 }",
      "export async function unused(p) { const mod = await rsm(p, 'wiki'); return 1 }",
      "export async function logged(p) { const mod = await requireModule({ projectId: p }, 'wiki'); console.log(mod); return 1 }",
      "export async function fake(p, cache) { await cache.requireModule(p); const r = await requireLocal(); if (!r.ok) return null }",
    ].join('\n'))
    const probs = (n: string) => gateSitesIn(sf, n, ACTION_GATE_NAMES).flatMap(siteProblems)
    expect([probs('ok1'), probs('ok2'), probs('ok3')]).toEqual([[], [], []])
    expect(probs('dropped')).toEqual([':7 requireModule 의 결과를 버린다'])
    expect(probs('unused')).toEqual([':8 requireSessionModule 의 결과를 버린다'])
    expect(probs('logged')).toEqual([':9 requireModule 의 결과를 조건으로 보지 않는다'])
    expect(probs('fake')).toEqual([':10 requireModule 가 @/lib/modules/gate 의 import 바인딩이 아니다', ':10 requireModule 의 결과를 버린다'])
  })
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
})

const nullEntries = entries.filter(([, e]) => e.module === null)
describe('deny — null 항목(가드 통과 실행 — 다른 파일 헬퍼를 거친 관문도 없다)', () => {
  it.each(nullEntries)('%s — 가드를 통과해도 관문(requireModule·requireSessionModule)을 부르지 않는다', async (key, e) => {
    const fn = await load(key)
    harness.reset()
    await Promise.resolve().then(() => fn(...(e.sample ?? []))).catch(() => undefined)   // 본문의 성패는 보지 않는다 — 관문 호출만
    expect(harness.requireCalls(), `${key} 가 관문을 불렀다: ${harness.gateLog()}`).toBe(0)
  }, 30_000)
})

/** 가드 거부 실행에서 뺀 null 액션(닫힌 목록) — 하네스로 가드까지 갈 수 없는 것만, 사유와 그 export 이름을 부르는 SP2 가드 테스트 파일.
 *  비어 있는 것이 정상이다. 항목이 생기면 과제 28 보고에 스펙 §4.3 deny 첫 줄 이탈(P15)로 적는다 */
const NULL_GUARD_EXEMPT: Readonly<Record<string, { why: string; coveredBy: string }>> = {}
/** 가드 거부 응답이 ERR_DENIED 를 싣지 않는 null 액션(닫힌 목록, I1 c) — 사유와 모드별 정확한 응답. 여기 없는 항목은 응답에 ERR_DENIED 가 있어야 한다 */
const DENY_SHAPE: Readonly<Record<string, { why: string; deny?: unknown; rank?: unknown }>> = {
  'src/app/actions/brief.ts#ensureProjectBriefAction': { why: '페이로드에 오류 채널이 없다 — unavailable 로 강등하고 사유는 로그(표시 = 로깅)', deny: { state: 'unavailable' }, rank: { state: 'unavailable' } },
  'src/app/actions/teams.ts#updateTeam': { why: '인증을 행 조회보다 먼저 본다 — 세션이 없으면 ERR_ANON(팀 id 존재를 가려내지 못하게). 등급 거부 모드에서는 ERR_DENIED', deny: { ok: false, error: ERR_ANON } },
  'src/app/actions/wbsAssign.ts#getWbsAssigneeStage': { why: '읽기 패널 — 거부·없음 모두 null(사유는 로그)', deny: null, rank: null },
  'src/app/actions/wbsSpec.ts#getWbsSpec': { why: '읽기 패널 — 거부·없음 모두 null(사유는 로그)', deny: null, rank: null },
}
/** session null 항목 가운데 세션 없음 실행에서 뺀 것(닫힌 목록) — 사유와 그 거부를 고정하는 테스트 파일 */
const SESSION_EXEMPT: Readonly<Record<string, { why: string; coveredBy: string }>> = {}
/** 코드 가드 없이 세션 클라이언트의 RLS 로만 읽는 session null 항목(닫힌 목록) — 로그인 판정 대신 "세션 클라이언트로만 읽고 admin·쓰기·관문이 없다"를 본다 */
const RLS_ONLY: Readonly<Record<string, string>> = {
  'src/app/actions/agentWork.ts#getAgentProjectState': 'read_agent_projects RLS — 설정 화면의 옛 토글 상태(P8). 세션이 없으면 RLS 가 0행',
}
/** 로그인 판정과 세션 클라이언트(RLS) 읽기를 한 왕복에 병렬로 도는 session null 항목(닫힌 목록) — "로그인 거부 뒤 DB 접근 0" 대신
 *  "그 읽기가 세션 클라이언트다(admin 0)"를 본다. 비로그인이면 RLS 가 0행이다 */
const RLS_PARALLEL: Readonly<Record<string, string>> = {
  'src/app/actions/project.ts#listProjectsWithState': '셸 프로젝트 목록 — getActorViewState 와 RLS 읽기를 병렬로(2026-08-18 성능 감사, 직렬 1단 제거)',
  'src/app/actions/project.ts#listProjects': 'listProjectsWithState 에 위임',
}
const GUARD_RANKS = new Set(['superuser', 'workspaceAdmin', 'projectAdmin', 'projectMember'])
const nullGuarded = entries.filter(([k, e]) => e.module === null && GUARD_RANKS.has(e.guard) && !(k in NULL_GUARD_EXEMPT))
const nullSession = entries.filter(([k, e]) => e.module === null && e.guard === 'session' && !(k in SESSION_EXEMPT) && !(k in RLS_ONLY))

/** 거부 응답 단언 — 닫힌 예외는 정확한 값, 나머지는 ERR_DENIED 흔적(본문 검증 오류가 '거부'로 통과하지 않게) */
function expectRefusal(key: string, r: unknown, mode: 'deny' | 'rank'): void {
  const shape = DENY_SHAPE[key]
  if (shape && mode in shape) expect(r, `${key} (${mode})`).toEqual(shape[mode])
  else expect(carries(r, ERR_DENIED), `${key} (${mode}) 의 응답에 ERR_DENIED 가 없다: ${JSON.stringify(r)}`).toBe(true)
}

describe('deny — null 항목(가드 거부 실행, 스펙 §4.3 deny 첫 줄·정본 §6.5.3)', () => {
  it('가드 등급 null 항목이 있다(표본 수 하한)', () => { expect(nullGuarded.length).toBeGreaterThan(40) })
  it.each(nullGuarded)('%s — 세션이 없으면 가드에 닿고, 거부 응답이며, 쓰기·admin·관문이 없다', async (key, e) => {
    const fn = await load(key)
    harness.reset(); harness.denyGuards()
    const r = await runRefused(fn, e.sample ?? [], [ERR_DENIED])
    expect(harness.guardCalls(), `${key} 가 권한 판정에 닿지 않았다 — 가드 앞 입력 검증이면 매니페스트 sample 을 고친다`).toBeGreaterThan(0)
    expectRefusal(key, r, 'deny')
    expect(harness.writes(), `${key} 가 가드 거부 뒤 썼다`).toBe(0)
    expect(harness.afterGuardDeny(), `${key} 가 가드 거부 뒤 DB 에 닿았다`).toBe(0)
    expect(harness.gateCalls(), key).toBe(0)
    if (!e.adminBeforeGuard) expect(harness.adminCreated(), `${key} 가 가드 거부 뒤 admin 을 만들었다`).toBe(0)
  }, 30_000)
  it.each(nullGuarded)('%s — 세션은 있고 등급 가드가 거부하면 등급 가드에 닿고, 거부 응답이며, 쓰기·관문이 없다(F6)', async (key, e) => {
    const fn = await load(key)
    harness.reset(); harness.denyRanks()
    const r = await runRefused(fn, e.sample ?? [], [ERR_DENIED])
    expect(harness.rankCalls(), `${key} 가 네 등급 가드 어느 것에도 닿지 않았다`).toBeGreaterThan(0)
    expectRefusal(key, r, 'rank')
    expect(harness.writes(), `${key} 가 등급 거부 뒤 썼다`).toBe(0)
    expect(harness.afterGuardDeny(), `${key} 가 등급 거부 뒤 DB 에 닿았다`).toBe(0)
    expect(harness.gateCalls(), key).toBe(0)
    if (!e.adminBeforeGuard) expect(harness.adminCreated(), `${key} 가 등급 거부 뒤 admin 을 만들었다`).toBe(0)
  }, 30_000)
  it.each(nullSession)('%s — (session) 세션이 없으면 로그인 판정에 닿고, ok 가 아니며, 쓰기·admin·관문이 없다(F7)', async (key, e) => {
    const fn = await load(key)
    harness.reset(); harness.denyGuards()
    const r = await runRefused(fn, e.sample ?? [], [ERR_DENIED, ERR_ANON])
    expect(harness.guardCalls(), `${key} 가 로그인 판정에 닿지 않았다`).toBeGreaterThan(0)
    expect((r as { ok?: unknown } | null)?.ok, `${key}: ${JSON.stringify(r)}`).not.toBe(true)
    expect(harness.writes(), `${key} 가 세션 없이 썼다`).toBe(0)
    if (key in RLS_PARALLEL) expect(harness.sessionClients(), `${key} 의 병렬 읽기가 세션 클라이언트가 아니다`).toBeGreaterThan(0)
    else expect(harness.afterGuardDeny(), `${key} 가 로그인 거부 뒤 DB 에 닿았다`).toBe(0)
    expect(harness.gateCalls(), key).toBe(0)
    if (!e.adminBeforeGuard) expect(harness.adminCreated(), `${key} 가 세션 없이 admin 을 만들었다`).toBe(0)
  }, 30_000)
  it.each(Object.keys(RLS_ONLY))('%s — (RLS 전용) 세션이 없어도 세션 클라이언트로만 읽고 admin·쓰기·관문이 없다', async (key) => {
    const e = ACTION_GATES[key]
    expect(e?.module === null && e.guard === 'session', key).toBe(true)
    const fn = await load(key)
    harness.reset(); harness.denyGuards()
    await fn(...(e.sample ?? []))
    expect(harness.sessionClients(), `${key} 가 세션 클라이언트를 쓰지 않았다`).toBeGreaterThan(0)
    expect([harness.adminCreated(), harness.writes(), harness.gateCalls()], key).toEqual([0, 0, 0])
  }, 30_000)
  it('예외 목록은 실재하는 null 항목이고, 사유와 그 export 를 부르는 테스트가 있다', () => {
    for (const [k, x] of Object.entries({ ...NULL_GUARD_EXEMPT, ...SESSION_EXEMPT })) {
      expect(ACTION_GATES[k]?.module, k).toBeNull()
      expect(x.why.length, k).toBeGreaterThan(3)
      expect(x.coveredBy, k).toMatch(/^tests\/actions\/.*\.test\.ts$/)
      expect(readFileSync(x.coveredBy, 'utf8'), `${k} → ${x.coveredBy}`).toContain(k.split('#')[1])
    }
    for (const [k, why] of Object.entries({ ...RLS_ONLY, ...RLS_PARALLEL })) {
      expect(ACTION_GATES[k]?.module === null && ACTION_GATES[k].guard === 'session', k).toBe(true)
      expect(why.length, k).toBeGreaterThan(3)
    }
    for (const [k, x] of Object.entries(DENY_SHAPE)) {
      expect(ACTION_GATES[k]?.module, k).toBeNull()
      expect(GUARD_RANKS.has(ACTION_GATES[k].guard), k).toBe(true)
      expect(x.why.length, k).toBeGreaterThan(3)
    }
  })
})
