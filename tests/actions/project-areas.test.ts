import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 담당 영역 저장(스펙 §4.1.3·§4.1.8·D45·D51) — 가드 → 입력 모양 → validateArea → 팀 범위(설정에서 읽은 프로젝트 팀 ∪ 그 영역의 기존 배정)
// → RPC upsert_project_area 한 길. 표를 직접 쓰지 않고(D27 — 세션 쓰기 정책이 없다) DB 원문을 응답에 싣지 않는다(D21).
const h = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), getProjectConfig: vi.fn(), rpc: vi.fn(), adminFor: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))

import * as areaActions from '@/app/actions/projectAreas'
import { ERR_AREA_CODE_IMMUTABLE, type AreaInput } from '@/lib/domain/areas'
import { ERR_DENIED, ERR_MISSING } from '@/lib/authz/errors'
import { ConfigUnavailableError, ERR_CONFIG_BUSY, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
import type { ConfigArea, ConfigTeam } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { makeAdminActor } from '../fixtures/actor'

const { upsertArea } = areaActions

// 단위 테스트 id 구간 18c0~18cf(RLS 구간과 겹치지 않는다)
const P = '00000000-0000-0000-7e57-0000000018c0'
const A_EXP = '00000000-0000-0000-7e57-0000000018c1'   // 기존 주간 영역 '실험'(code EXP) — 공용 팀 MEP 가 보조로 걸려 있다(전환 전 배정)
const T_RES = '00000000-0000-0000-7e57-0000000018c2'   // 이 프로젝트 전용 팀(활성)
const T_OPS = '00000000-0000-0000-7e57-0000000018c3'   // 이 프로젝트 전용 팀(비활성 — 규칙상 프로젝트 팀이다)
const T_CIV = '00000000-0000-0000-7e57-0000000018c4'   // 워크스페이스 공용 팀 — 전용 팀이 있으면 선택지 밖
const T_MEP = '00000000-0000-0000-7e57-0000000018c5'   // 워크스페이스 공용 팀 — 실험 영역에 이미 배정
const T_FOREIGN = '00000000-0000-0000-7e57-0000000018cf' // 해석기가 모르는 팀(다른 워크스페이스 등)
const NEW_ID = '00000000-0000-0000-7e57-0000000018c9'
const ERR_TEAM_SCOPE = '이 프로젝트에서 쓸 수 없는 팀입니다.'
const ERR_SAVE = '영역을 저장하지 못했습니다. 잠시 후 다시 시도하세요.'
const ACTOR = makeAdminActor(P, { userId: 'u-guard' })

const team = (id: string, code: string, projectId: string | null, active = true): ConfigTeam =>
  ({ id, code, name: code, sortOrder: 1, active, color: '#4f46e5', progressVisible: true, projectId })
const OWN = [team(T_RES, 'RES', P), team(T_OPS, 'OPS', P, false)]
const COMMON = [team(T_CIV, 'CIV', null), team(T_MEP, 'MEP', null)]
const EXP_AREA: ConfigArea = {
  id: A_EXP, kind: 'weekly_section', code: 'EXP', name: '실험', sortOrder: 1, active: true,
  teams: [{ teamId: T_MEP, kind: 'support' }],
}
const cfgWith = (teams: ConfigTeam[]) => makeProjectConfig({}, {
  projectId: P, workspaceId: 'ws-synthetic', teams, areas: { weekly_section: [EXP_AREA], issue_area: [] },
})
const NEW_AREA: AreaInput = {
  kind: 'weekly_section', code: ' DATA ', name: ' 데이터 ', sortOrder: 2, active: true,
  teams: [{ teamId: T_RES, kind: 'primary' }],
}
const EXP_EDIT: AreaInput = {
  id: A_EXP, kind: 'weekly_section', code: 'EXP', name: '실험', sortOrder: 1, active: false,
  teams: [{ teamId: T_MEP, kind: 'support' }, { teamId: T_OPS, kind: 'primary' }],
}
/** console.error 인자 어딘가에 needle 이 있는가 — failWith 는 원문을 그대로(Error·객체) 남긴다.
 *  객체는 JSON 으로 보므로 needle 도 같은 이스케이프(따옴표 → \")로 맞춘다 */
const logged = (spy: { mock: { calls: unknown[][] } }, needle: string): boolean =>
  spy.mock.calls.flat().some((x) => x instanceof Error ? x.message.includes(needle)
    : typeof x === 'string' ? x.includes(needle)
    : (JSON.stringify(x) ?? '').includes(JSON.stringify(needle).slice(1, -1)))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-01T03:00:00Z'))        // 서울 2026-10-01(목) 12:00 → 이번 주 월요일 2026-09-28
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  h.getProjectConfig.mockResolvedValue(cfgWith([...OWN, ...COMMON]))
  h.adminFor.mockImplementation((scope: Record<string, string>) => ({ ...scope, admin: { rpc: h.rpc } }))
  h.rpc.mockResolvedValue({ data: { status: 'created', area_id: NEW_ID, rows_added: 3 }, error: null })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('액션 면 — 목록 액션 없음, 쓰기는 RPC 하나', () => {
  it('listAreas 는 없다 — 설정 페이지가 cfg.areas 를 넘긴다(스펙 §4.1.3)', () => {
    expect('listAreas' in areaActions).toBe(false)
  })

  it('표를 직접 쓰지 않는다 — .from( 이 없고 .rpc( 는 하나, service_role 클라이언트를 직접 만들지 않는다(D27)', () => {
    const src = readFileSync('src/app/actions/projectAreas.ts', 'utf8')
    expect(src).not.toMatch(/\.from\(/)
    expect(src.match(/\.rpc\(/g)).toHaveLength(1)
    expect(src).not.toMatch(/\bcreateAdminClient\b/)
  })
})

describe('가드 → 입력 → 팀 범위 — RPC 앞에서 거른다', () => {
  it('가드가 거부하면 설정도 RPC 도 없다 — code 는 가드 문구(선례 createProject)', async () => {
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await upsertArea(P, NEW_AREA)).toEqual({ ok: false, code: ERR_DENIED, error: ERR_DENIED })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['id 가 uuid 아님', { ...NEW_AREA, id: 'area-1' }],
    ['팀 id 가 uuid 아님', { ...NEW_AREA, teams: [{ teamId: 'RES', kind: 'primary' }] }],
    ['active 가 불리언 아님', { ...NEW_AREA, active: 'yes' }],
    ['teams 가 배열 아님', { ...NEW_AREA, teams: null }],
  ])('모양 위반(%s)은 잘못된 요청', async (_n, input) => {
    expect(await upsertArea(P, input as never)).toEqual({ ok: false, code: 'INVALID_INPUT', error: '잘못된 요청입니다.' })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['종류', { ...NEW_AREA, kind: 'misc' }, '알 수 없는 영역 종류입니다.'],
    ['code 공백', { ...NEW_AREA, code: '  ' }, '영역 코드를 입력하세요.'],
    ['이름 공백', { ...NEW_AREA, name: '' }, '영역 이름을 입력하세요.'],
    ['순서 소수', { ...NEW_AREA, sortOrder: 1.5 }, '순서는 정수여야 합니다.'],
    ['팀 구분', { ...NEW_AREA, teams: [{ teamId: T_RES, kind: 'lead' }] }, '담당 팀 구분은 주·보조만 됩니다.'],
    ['같은 팀 두 번', { ...NEW_AREA, teams: [{ teamId: T_RES, kind: 'primary' }, { teamId: T_RES, kind: 'support' }] }, '같은 팀을 두 번 지정할 수 없습니다.'],
  ])('validateArea 위반(%s)은 그 문구 — RPC 의 입력 토큰까지 가지 않는다(D45)', async (_n, input, msg) => {
    expect(await upsertArea(P, input as never)).toEqual({ ok: false, code: 'INVALID_INPUT', error: msg })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('설정을 읽지 못하면 쓰지 않는다 — 선행 조회 실패는 중단(3원칙 ②), 원문은 로그로만', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('팀 조회 실패: relation secret_teams'))
    const r = await upsertArea(P, NEW_AREA)
    expect(r).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: ERR_CONFIG_UNAVAILABLE, retryable: true })
    expect(JSON.stringify(r)).not.toContain('secret_teams')
    expect(logged(err, 'secret_teams')).toBe(true)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('전용 팀이 있는 프로젝트에 공용 팀 id 를 보내면 400 — 전환 전에 연 낡은 화면(§4.1.8)', async () => {
    expect(await upsertArea(P, { ...NEW_AREA, teams: [{ teamId: T_CIV, kind: 'primary' }] }))
      .toEqual({ ok: false, code: 'INVALID_INPUT', error: ERR_TEAM_SCOPE })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('다른 영역에 걸린 공용 팀도 새 영역에는 못 건다 — 기존 배정은 그 영역의 것', async () => {
    expect(await upsertArea(P, { ...NEW_AREA, teams: [{ teamId: T_MEP, kind: 'support' }] }))
      .toEqual({ ok: false, code: 'INVALID_INPUT', error: ERR_TEAM_SCOPE })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('해석기가 모르는 팀 id 는 400', async () => {
    expect(await upsertArea(P, { ...NEW_AREA, teams: [{ teamId: T_FOREIGN, kind: 'primary' }] }))
      .toEqual({ ok: false, code: 'INVALID_INPUT', error: ERR_TEAM_SCOPE })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('그 영역에 이미 배정된 공용 팀과 비활성 전용 팀은 통과 — 편집기 선택지와 같은 집합', async () => {
    h.rpc.mockResolvedValue({ data: { status: 'updated', area_id: A_EXP, rows_added: 0 }, error: null })
    expect(await upsertArea(P, EXP_EDIT)).toEqual({ ok: true, id: A_EXP, status: 'updated', rowsAdded: 0 })
    expect(h.rpc).toHaveBeenCalledTimes(1)
  })

  it('전용 팀이 없는 프로젝트는 그 워크스페이스 공용 팀을 쓴다', async () => {
    h.getProjectConfig.mockResolvedValue(cfgWith(COMMON))
    expect(await upsertArea(P, { ...NEW_AREA, teams: [{ teamId: T_CIV, kind: 'primary' }] })).toMatchObject({ ok: true })
  })

  it('담당 팀 0개도 저장한다 — 주간 영역은 팀 없이 쓰고 봇 팀 필터에서 빠질 뿐(스펙 §4.1.3)', async () => {
    expect(await upsertArea(P, { ...NEW_AREA, teams: [] })).toMatchObject({ ok: true })
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_teams: [] })
  })
})

describe('RPC 한 길(D22·D51)', () => {
  it('새 영역 — p_actor 는 가드 결과, p_area 는 다듬은 값(id 없음), p_from_week 는 서울 기준 이번 주 월요일', async () => {
    expect(await upsertArea(P, NEW_AREA)).toEqual({ ok: true, id: NEW_ID, status: 'created', rowsAdded: 3 })
    expect(h.adminFor).toHaveBeenCalledWith({ projectId: P })
    expect(h.rpc).toHaveBeenCalledWith('upsert_project_area', {
      p_actor: 'u-guard',
      p_project_id: P,
      p_area: { kind: 'weekly_section', code: 'DATA', name: '데이터', sort_order: 2, active: true },
      p_teams: [{ team_id: T_RES, kind: 'primary' }],
      p_from_week: '2026-09-28',
    })
    expect(h.revalidatePath).toHaveBeenCalledWith('/(app)/p/[projectId]/settings', 'page')
    expect(h.revalidatePath).toHaveBeenCalledWith('/(app)/p/[projectId]/weekly', 'page')
  })

  it('기존 영역 — p_area 에 id 를 싣는다', async () => {
    h.rpc.mockResolvedValue({ data: { status: 'updated', area_id: A_EXP, rows_added: 0 }, error: null })
    await upsertArea(P, EXP_EDIT)
    expect(h.rpc.mock.calls[0][1]).toMatchObject({
      p_area: { id: A_EXP, kind: 'weekly_section', code: 'EXP', name: '실험', sort_order: 1, active: false },
      p_teams: [{ team_id: T_MEP, kind: 'support' }, { team_id: T_OPS, kind: 'primary' }],
    })
  })

  it.each([
    ['2026-09-27T16:00:00Z', '2026-09-28'],   // UTC 일요일 16시 = 서울 월요일 01시
    ['2026-09-27T14:59:00Z', '2026-09-21'],   // 서울 일요일 23:59 — 아직 지난주
  ])('p_from_week 는 서울 날짜로 정한다(%s → %s)', async (now, monday) => {
    vi.setSystemTime(new Date(now))
    await upsertArea(P, NEW_AREA)
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_from_week: monday })
  })
})

describe('RPC 토큰 → 코드(D45·T6) — 원문 비노출', () => {
  it.each([
    ['AREA_FORBIDDEN', '42501', { code: 'ERR_DENIED', error: ERR_DENIED }],
    ['PROJECT_NOT_FOUND', 'P0002', { code: 'ERR_MISSING', error: ERR_MISSING }],
    ['AREA_NOT_FOUND', 'P0002', { code: 'ERR_MISSING', error: '이 프로젝트의 영역이 아니거나 존재하지 않습니다.' }],
    ['PROJECT_AREA_KIND_IMMUTABLE', '23514', { code: 'INVALID_INPUT', error: '영역 종류는 바꿀 수 없습니다.' }],
    ['PROJECT_AREA_CODE_IMMUTABLE', '23514', { code: 'INVALID_INPUT', error: ERR_AREA_CODE_IMMUTABLE }],
    ['PROJECT_AREA_PROJECT_IMMUTABLE', '23514', { code: 'INVALID_INPUT', error: '다른 프로젝트의 영역으로 옮길 수 없습니다.' }],
    ['AREA_TEAM_SCOPE', '23514', { code: 'INVALID_INPUT', error: ERR_TEAM_SCOPE }],
    // 같은 code 의 전용 팀이 있는 공용 팀(전환 뒤 오래된 폼·D4 분열 — *_command_receipts ⑤′, A1-3 리뷰 M1)
    ['TEAM_SCOPE_PROJECT_OWNED', '23514', { code: 'INVALID_INPUT', error: ERR_TEAM_SCOPE }],
    ['duplicate key value violates unique constraint "project_areas_project_id_kind_code_key"', '23505', { code: 'INVALID_INPUT', error: "'DATA' 코드가 이미 있습니다." }],
    ['deadlock detected', '40P01', { code: 'CONFIG_BUSY', error: ERR_CONFIG_BUSY, retryable: true }],
    ['canceling statement due to lock timeout', '55P03', { code: 'CONFIG_BUSY', error: ERR_CONFIG_BUSY, retryable: true }],
  ] as const)('%s(%s)', async (message, code, want) => {
    h.rpc.mockResolvedValue({ data: null, error: { code, message } })
    expect(await upsertArea(P, NEW_AREA)).toEqual({ ok: false, ...want })
    expect(h.revalidatePath).not.toHaveBeenCalled()
  })

  // 입력 토큰(22023)은 모양 검사·validateArea 가 RPC 앞에서 같은 것을 거르므로, 격리(25001 — 같은 잠금의 격리 가드)는 정상 경로에서
  // 나지 않으므로 자기 표에 넣지 않는다 — 나면 결함(로그 + 일반 문구, D45·T6)
  it.each([
    ['AREA_INVALID_INPUT', '22023'],
    ['WEEKLY_ISOLATION', '25001'],
    ['relation "public.secret_table" does not exist', '42P01'],
  ])('표에 없는 %s 는 UNAVAILABLE 고정 문구 + 로그', async (message, code) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.rpc.mockResolvedValue({ data: null, error: { code, message } })
    const r = await upsertArea(P, NEW_AREA)
    expect(r).toEqual({ ok: false, code: 'UNAVAILABLE', error: ERR_SAVE })
    expect(JSON.stringify(r)).not.toContain(message)
    expect(logged(err, message)).toBe(true)
  })
})
