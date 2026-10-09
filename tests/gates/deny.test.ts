// deny — 액션(스펙 §4.3 deny 행, 판정 P15·P17). 모듈 항목: ① 모듈 하나를 기대 범위(target)에서 끄면 거부 값(목록형 module 은 원소마다), 관문이 그
// 범위로 물어 거부했고, 관문 앞에서 쓰지 않았고, 거부 뒤 DB 에 닿지 않았다 ② 가드를 모두 거부시키면 관문을 부르지 않고 쓰지 않으며 admin 클라이언트도
// 만들지 않는다(adminBeforeGuard 예외) ③ 관문 호출은 판정 모듈의 import 이고 결과를 조건으로 본다(AST). null 항목: 본문(+같은 파일 헬퍼)에 관문
// 호출이 없고(AST), 가드 통과 실행에서도 관문을 부르지 않는다(다른 파일 헬퍼 경유), 토글되는 모듈의 데이터 표도 만들지 않는다(닫힌 목록 — RPC 로 만지는 표는 _rpc-tables.ts 대응으로 센다, SP4 D25).
// 가드 등급 null 항목은 세션 없음·등급 거부 두 모드로, session
// null 항목은 세션 없음으로 가드 거부 실행(가드에 닿았는지·거부 응답·쓰기 0 — 스펙 §4.3 deny 첫 줄은 전 항목이다).
// 모듈 항목의 실행 검사는 매니페스트의 모든 모듈 항목을 덮는다.
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
import { MODULE_TABLE_OWNER } from './_tables'
import { UNKNOWN_RPC_PREFIX } from './_rpc-tables'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { gateCallsIn, gateSitesIn, parse, siteProblems, tablesIn } from '../invariants/_ast'
import { harness, P, U, type Target } from './_harness'
import { ACTION_GATES, ROUTE_GATES, type GateEntry } from './manifest'

/** 액션의 관문 — 판정 모듈(@/lib/modules/gate)의 import 로 부르고 결과를 조건으로 본다 */
const ACTION_GATE_NAMES: ReadonlySet<string> = new Set(['requireModule', 'requireSessionModule'])

const listOf = (m: GateEntry['module']): ModuleId[] => (m === null ? [] : typeof m === 'string' ? [m] : [...m])
const has = (v: unknown, id: string): boolean =>
  v === id || (Array.isArray(v) ? v.some((x) => has(x, id)) : !!v && typeof v === 'object' && Object.values(v).some((x) => has(x, id)))
/** 토글되는 모듈(non-core)이 자기 데이터로 소유하는 표 — 매니페스트가 `module: null` 을 믿는 그 공백을 메운다(B9 T25-I1).
 *  core 모듈 소유 표(wbs_items·projects·profiles·teams·설정 표 등)는 여기 없다 — core 는 끌 수 없어 관문이 필요 없다.
 *  모듈이 표를 '직접' 소유하는지(apiPrefixes·routePrefixes 가 그 모듈의 면인 표)를 기준으로 적었고, 다른 모듈의 표를 같이 쓰는
 *  캐시 표(llm_profiles — ai.enabled 는 settings 모듈 소유)는 일부러 뺀다. 새 표를 여기 더하면 그 표를 쓰는 모듈 하나가 자동으로 막힌다 */
// 토글 모듈이 소유한 표 목록은 tests/gates/_tables.ts 한 곳에 있다 — deny.routes.test.ts 의 "무관문 갈래" 축이 같은 표를 쓴다(F-2)
/** module null 인데 모듈 데이터 표를 만지는 항목(닫힌 목록 — 항목마다 그 표와 사유. settings-writes 의 허용 파일 표와 같은 모양이다).
 *  새 null 항목이 모듈 표를 만지면 여기 표·사유를 확인한 뒤 더한다 — 관문 모듈로 적는 쪽은 다른 축(MU4)이 교차 검증한다 */
const NULL_TABLE_ALLOW: Readonly<Record<string, { tables: readonly string[]; why: string }>> = {
  'src/app/actions/projectTeams.ts#copyGlobalTeams': { tables: ['minute_folders', 'minutes'], why: '상속 공용 팀 전환(convert_inherited_teams — SP5 B2)이 회의록·폴더의 팀 참조(team_id)를 새 전용 팀으로 옮긴다 — 행을 만들거나 내용을 바꾸지 않는다' },
  'src/app/api/import/execute/route.ts#POST': { tables: ['minute_folders', 'minutes'], why: '가져오기의 공용 팀 전환(convert_inherited_teams — SP5 B2)이 회의록·폴더의 팀 참조(team_id)를 옮긴다 — 행을 만들거나 내용을 바꾸지 않는다' },
  'src/app/actions/projectAreas.ts#upsertArea': { tables: ['weekly_report_rows'], why: '영역 추가·재활성은 모듈이 꺼져도 현 주 이후 문서에 행을 만든다 — 다시 켰을 때 행이 있어야 한다(R25)' },
  'src/app/actions/teams.ts#changeTeamCode': { tables: ['minutes'], why: '팀 코드 변경(change_team_code — 팀 유연화 2단계)이 그 팀 회의록의 사본 열(team_code)을 새 code 로 맞춘다 — 행을 만들거나 본문을 바꾸지 않는다. 회의록 모듈이 꺼져 있어도 사본이 팀과 어긋나지 않아야 한다' },
  'src/app/actions/projectTeams.ts#changeProjectTeamCode': { tables: ['minutes'], why: '전용 팀 코드 변경(change_team_code)이 그 팀 회의록의 사본 열(team_code)을 새 code 로 맞춘다 — 행을 만들거나 본문을 바꾸지 않는다' },
  'src/app/actions/teams.ts#mergeTeams': { tables: ['minute_folders', 'minutes'], why: '팀 병합(merge_teams — 팀 유연화 2단계)이 회의록·폴더의 팀 참조(team_id)를 대상 팀으로 옮기고 원본 팀 루트의 하위 폴더를 대상 루트 아래로 옮긴다 — 회의록 본문은 바꾸지 않는다. 모듈이 꺼져 있어도 원본 팀을 가리키는 행이 남으면 안 된다' },
  'src/app/actions/projectTeams.ts#mergeProjectTeams': { tables: ['minute_folders', 'minutes'], why: '전용 팀 병합(merge_teams)이 회의록·폴더의 팀 참조(team_id)를 대상 팀으로 옮긴다 — 회의록 본문은 바꾸지 않는다' },
  'src/app/actions/teams.ts#addTeam': { tables: ['minute_folders'], why: '담당 팀의 회의록 팀 루트 한 줄(create_team — SP5 B2) — 폴더 트리의 루트이지 회의록 데이터가 아니다' },
  'src/app/actions/settings.ts#updateWorkspaceSettings': { tables: ['minute_folders'], why: '최상위 폴더 모드를 teams 로 되돌린 뒤의 팀 루트 보장(ensure_team_roots — SP5 B2) — 폴더 트리의 루트이지 회의록 데이터가 아니다' },
  'src/app/actions/wbs.ts#updateActual': { tables: ['agent_work_orders'], why: 'WBS(core) 진척의 갱신이 에이전트 주문 행에도 닿는다 — 같은 로컬 쓰기다' },
  'src/app/actions/wbsAssign.ts#setWbsDevWorkflow': { tables: ['agent_work_orders'], why: 'WBS 필드(core) — 주문 발행은 ensureOrder 의 두 원천 AND 가 막는다(P19)' },
  'src/app/api/wiki/reindex/route.ts#POST': { tables: ['ai_documents', 'ai_index_jobs'], why: '플랫폼 진단 — ROUTE_MODULE_OVERRIDES 가 이 경로를 플랫폼 전용으로 뺐다' },
}
/** 목록 항목의 표 접촉 — 문제 목록. entry 의 note 를 먼저 읽어 사람이 맥락을 보게 하고(계층 서술일 수 있다), 없으면 표 이름으로 판정한다.
 *  tables 는 tablesIn 의 결과라 RPC 로 만지는 표(tests/gates/_rpc-tables.ts 대응)가 이미 들어 있다. 대응 없는 RPC(rpc?:<이름>)는 그 RPC 가
 *  무엇을 만지는지 모른다는 뜻이라 실패다 — module null 항목에서만(모듈 항목이 부르는 RPC 는 모듈 관문이 먼저 닫는다, SP4 D25) */
function nullTableProblems(key: string, e: GateEntry, tables: readonly string[]): string[] {
  const unknown = tables.filter((t) => t.startsWith(UNKNOWN_RPC_PREFIX))
    .map((t) => `${key}: module null 항목이 부르는 RPC ${t.slice(UNKNOWN_RPC_PREFIX.length)} 의 소유 표를 모른다 — tests/gates/_rpc-tables.ts 에 그 RPC 가 만지는 표를 적는다(SP4 D25)`)
  const hits = tables.filter((t) => MODULE_TABLE_OWNER[t])
  if (!hits.length) return unknown
  const why = NULL_TABLE_ALLOW[key]
  if (!why) return [...unknown, `${key}: module null 인데 모듈 데이터 표 ${hits.map((t) => `${t}(${MODULE_TABLE_OWNER[t]})`).join(', ')} 를 만진다 — 관문이 없으면 꺼진 뒤에도 그 표가 바뀐다(사유: ${e.note ?? 'note 없음'})`]
  const stale = why.tables.filter((t) => !hits.includes(t))
  return [...unknown, ...(stale.length ? [`${key}: 허용 목록의 표 ${stale.join(', ')} 를 더 이상 만나지 않는다(죽은 항목)`] : [])]
}
/** 모듈 판정의 대상 — 매니페스트 target, 없으면 sample 에서(프로젝트 id → project, 행 id → row, 없으면 session) */
const targetOf = (e: GateEntry): Target => e.target ?? (has(e.sample ?? [], P) ? 'project' : has(e.sample ?? [], U) ? 'row' : 'session')
const entries = Object.entries(ACTION_GATES)
const moduleEntries = entries.filter(([, e]) => e.module !== null)
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
  it('모듈 항목이 0건이 아니다 — vitest 4 의 it.each([]) 은 0개를 만들고 실패하지 않는다(빈 필터의 조용한 무효화)', () => {
    expect(moduleEntries.length, '모듈 항목 0건 — 필터가 조용히 비었다').toBeGreaterThan(80)
  })
  it.each(moduleEntries)('%s — 모듈을 기대 범위에서 끄면 거부 값이고, 관문 앞에서 쓰지 않고, 거부 뒤 DB 에 닿지 않는다', async (key, e) => {
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
  it.each(moduleEntries)('%s — 가드가 거부하면 관문·쓰기·admin 이 없다', async (key, e) => {
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

const ownerEntries = moduleEntries.filter(([, e]) => e.ownerBranch !== undefined)
describe('deny — 작성자·주최자 분기(관리자 거부 + 모듈 끔, B5 F1-14·F1-15)', () => {
  // 회의는 넷 — 호출자가 없던 setMeetingAttendees 를 지웠다(참석자는 createMeeting·updateMeeting 이 replaceAttendees 로 쓴다)
  it('ownerBranch 항목이 있다(이슈 넷·회의 넷)', () => { expect(ownerEntries.length).toBeGreaterThanOrEqual(8) })
  it.each(ownerEntries)('%s — 관리자가 아닌 작성자·주최자도 관문을 지나고, 모듈을 끄면 거부 값이며 쓰지 않는다', async (key, e) => {
    const fn = await load(key)
    const target = targetOf(e)
    for (const off of listOf(e.module)) {
      harness.reset(); harness.denyAdmin(); harness.moduleOff(off, target)
      const r = await fn(...(e.sample ?? []))
      const at = `${key} off=${off} (관리자 거부·작성자) — ${harness.gateLog()}`
      expect(harness.adminGuardCalls(), `관리자 가드를 부르지 않았다 — 작성자 분기를 달리지 못했다: ${at}`).toBeGreaterThan(0)
      if ('deny' in e) expect(r, at).toEqual(e.deny)
      else expect(r, at).toMatchObject({ ok: false, error: ERR_MODULE_DISABLED })
      expect(harness.asked(off), `작성자 분기가 ${off} 를 묻지 않았다: ${at}`).toBe(true)
      expect(harness.deniedBy(off), `관문이 기대 범위로 ${off} 를 묻지 않았다: ${at}`).toBe(true)
      expect(harness.writes(), `관문 앞에서 썼다(P17): ${at}`).toBe(0)
      expect(harness.afterDeny(), `관문이 거부한 뒤 DB 에 닿았다: ${at}`).toBe(0)
    }
  }, 30_000)
})

describe('deny — 모듈 항목(정적)', () => {
  it('모듈 항목은 관문을 부르고, 그 호출은 판정 모듈의 import 이며 결과를 조건으로 본다(결과를 버린 관문 금지)', () => {
    const bad = moduleEntries.flatMap(([key]) => {
      const [file, name] = key.split('#')
      const sites = gateSitesIn(parse(file, readFileSync(file, 'utf8')), name, ACTION_GATE_NAMES)
      return sites.length ? sites.flatMap(siteProblems).map((p) => `${key}${p}`) : [`${key}: 관문 호출이 없다`]
    })
    expect(bad).toEqual([])
  }, 30_000)
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
  it('판별기 민감도 — 세션 라우트의 범위 관문(requireScopedSessionModule, 과제 34)도 원천·결과 사용을 본다(합성 소스)', () => {
    const sf = parse('r.ts', [
      "import { requireScopedSessionModule } from '@/lib/modules/scopedSession'",
      "import { requireScopedSessionModule as wrong } from '@/lib/modules/gate'",
      "export async function ok(p, w) { const g = await requireScopedSessionModule({ projectId: p, workspaceId: w }, 'chatbot'); if (!g.ok) return g; return 1 }",
      "export async function dropped(p, w) { await requireScopedSessionModule({ projectId: p, workspaceId: w }, 'chatbot'); return 1 }",
      "export async function source(p, w) { const g = await wrong({ projectId: p, workspaceId: w }, 'chatbot'); if (!g.ok) return g }",
    ].join('\n'))
    const names = new Set(['requireScopedSessionModule'])
    const probs = (n: string) => gateSitesIn(sf, n, names).flatMap(siteProblems)
    expect(probs('ok')).toEqual([])
    expect(probs('dropped')).toEqual([':4 requireScopedSessionModule 의 결과를 버린다'])
    expect(probs('source')).toEqual([':5 requireScopedSessionModule 가 @/lib/modules/scopedSession 의 import 바인딩이 아니다'])
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
  }, 30_000)
  it('module null 항목은 토글되는 모듈의 데이터 표를 만들지 않는다 — 닫힌 목록 밖 접촉은 실패다(B9 T25-I1: 매니페스트 값을 그대로 믿지 않는다)', () => {
    const allNull = [...entries, ...Object.entries(ROUTE_GATES)].filter(([, e]) => e.module === null)
    const reached = new Map(allNull.map(([key]) => {
      const [file, name] = key.split('#')
      return [key, tablesIn(parse(file, readFileSync(file, 'utf8')), name)] as const
    }))
    const bad = allNull.flatMap(([key, e]) => nullTableProblems(key, e, reached.get(key) ?? []))
    expect(bad).toEqual([])
    expect(Object.entries(NULL_TABLE_ALLOW).flatMap(([key, x]) => {
      const e = allNull.find(([k]) => k === key)?.[1]
      if (!e) return [`${key}: 죽은 항목 — module null 항목이 아니다`]
      if (x.why.length < 12) return [`${key}: 사유가 없다`]
      const hit = (reached.get(key) ?? []).filter((t) => MODULE_TABLE_OWNER[t])
      const diff = [...hit.filter((t) => !x.tables.includes(t)), ...x.tables.filter((t) => !hit.includes(t))]
      return diff.length ? [`${key}: 허용 목록과 실측 표가 다르다(추가 ${hit.filter((t) => !x.tables.includes(t)).join(', ') || '(없음)'} / 죽은 ${x.tables.filter((t) => !hit.includes(t)).join(', ') || '(없음)'})`] : []
    })).toEqual([])
    // 사유 부재는 경고다 — 실측 61건(action 57 · route 4, B9 T25-I1-3). 사유 강제는 98개 null 항목의 대량 편집이 따르므로 failing 으로
    // 만들지 않는다(B9 도 같은 결정을 냈다). 새 null 항목이 사유 없이 들어와도 이 줄이 깨지지 않게 **하한만** 건다 — 0 이 되면
    // 계측과 사유 강제 결정을 함께 되돌린다. 수치는 task-b789-fix-report.md 에 남긴다
    const reasonless = allNull.filter(([, e]) => !(e.note && e.note.length > 3))
    expect(reasonless.length, 'module null 항목 중 사유가 없는 것(실측 61 — 보고 참조). 0 이 되면 이 계측을 되돌린다').toBeGreaterThan(0)
  }, 30_000)
  it('판별기 민감도 — module null 항목이 모듈 표를 만지면 사유 없이도 실패한다(합성 소스)', () => {
    const sf = parse('s.ts', [
      "import { requireProjectMember } from '@/lib/authz'",
      "const seed = async (sb) => { await sb.from('issues').insert({ title: 'x' }) }",
      "export async function a(projectId) { const g = await requireProjectMember(projectId); if (!g.ok) return g; await seed(null); return { ok: true } }",
      "export async function b(projectId) { const g = await requireProjectMember(projectId); if (!g.ok) return g; await sb.from('wbs_items').insert({}); return { ok: true } }",
    ].join('\n'))
    const nullE: GateEntry = { guard: 'projectMember', module: null }
    expect(nullTableProblems('s.ts#a', nullE, tablesIn(sf, 'a'))).toEqual([
      's.ts#a: module null 인데 모듈 데이터 표 issues(issues) 를 만진다 — 관문이 없으면 꺼진 뒤에도 그 표가 바뀐다(사유: note 없음)',
    ])
    expect(nullTableProblems('s.ts#b', nullE, tablesIn(sf, 'b')), '대조 — core(wbs) 표는 여기 없다').toEqual([])
    expect(nullTableProblems('s.ts#c', nullE, []), '대조 — 모듈 표 접촉이 없으면 조용하다').toEqual([])
  })
  it('판별기 민감도 — RPC 로 만지는 모듈 표와 대응 없는 RPC 도 실패다(합성 소스·합성 대응, SP4 D25)', () => {
    const sf = parse('s.ts', [
      "import { requireProjectAdmin } from '@/lib/authz'",
      "const sync = async (sb) => { await sb.rpc('fake_area_rpc', { p_x: 1 }) }",
      'export async function a(projectId) { const g = await requireProjectAdmin(projectId); if (!g.ok) return g; await sync(null); return { ok: true } }',
      "export async function b(projectId) { const g = await requireProjectAdmin(projectId); if (!g.ok) return g; await sb.rpc('fake_core_rpc'); return { ok: true } }",
      "export async function c(projectId) { const g = await requireProjectAdmin(projectId); if (!g.ok) return g; await sb.rpc('mystery_rpc'); return { ok: true } }",
      'export async function d(projectId, name) { const g = await requireProjectAdmin(projectId); if (!g.ok) return g; await sb.rpc(name); return { ok: true } }',
    ].join('\n'))
    const map = { fake_area_rpc: ['project_areas', 'weekly_report_rows'], fake_core_rpc: ['wbs_items'] }
    const nullE: GateEntry = { guard: 'projectAdmin', module: null }
    expect(tablesIn(sf, 'a', map)).toEqual(['project_areas', 'weekly_report_rows'])
    expect(nullTableProblems('s.ts#a', nullE, tablesIn(sf, 'a', map))).toEqual([
      's.ts#a: module null 인데 모듈 데이터 표 weekly_report_rows(weekly) 를 만진다 — 관문이 없으면 꺼진 뒤에도 그 표가 바뀐다(사유: note 없음)',
    ])
    expect(nullTableProblems('s.ts#b', nullE, tablesIn(sf, 'b', map)), '대조 — core 표만 만지는 RPC 는 조용하다').toEqual([])
    expect(nullTableProblems('s.ts#c', nullE, tablesIn(sf, 'c', map))).toEqual([
      's.ts#c: module null 항목이 부르는 RPC mystery_rpc 의 소유 표를 모른다 — tests/gates/_rpc-tables.ts 에 그 RPC 가 만지는 표를 적는다(SP4 D25)',
    ])
    expect(nullTableProblems('s.ts#d', nullE, tablesIn(sf, 'd', map)), '[K8] 리터럴이 아닌 이름도 실패 — 무엇을 부르는지 모른다').toEqual([
      's.ts#d: module null 항목이 부르는 RPC <dynamic> 의 소유 표를 모른다 — tests/gates/_rpc-tables.ts 에 그 RPC 가 만지는 표를 적는다(SP4 D25)',
    ])
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
const RLS_ONLY: Readonly<Record<string, string>> = {}
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
  it('session null 항목도 0건이 아니다 — it.each([]) 은 0개를 만들고 실패하지 않는다(빈 필터의 조용한 무효화)', () => {
    expect(nullSession.length, 'session null 항목 0건 — 필터가 조용히 비었다').toBeGreaterThan(10)
  })
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
