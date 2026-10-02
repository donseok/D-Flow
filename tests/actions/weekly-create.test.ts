// createWeeklyReport(스펙 §4.1.3·D43·D45·D51) — 가드 → 관문 → 입력 → 영역(설정) → 이월 → RPC 한 길. 존재 확인은 이월할 때 판정 앞의 읽기
// 하나뿐이고(같은 주 문서가 있으면 매핑 없이 RPC 의 exists — A1-4 리뷰 P7) 문서를 만드는 읽기 경로는 없으며(D22),
// 세션으로 문서·행을 쓰지 않으며(D27), 보상 삭제가 없다. DB 원문은 응답에 싣지 않는다(D21 — failWith 가 로그로만).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(),
  getProjectConfig: vi.fn(), findCarryOverSource: vi.fn(), findWeeklyReportId: vi.fn(), getWeeklySheet: vi.fn(),
  rpc: vi.fn(), adminFor: vi.fn(), createServerClient: vi.fn(), revalidatePath: vi.fn(),
}))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin, requireProjectMember: h.requireProjectMember }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/data/weeklySheet', () => ({
  findCarryOverSource: h.findCarryOverSource, findWeeklyReportId: h.findWeeklyReportId, getWeeklySheet: h.getWeeklySheet,
}))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: h.adminFor }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: vi.fn() }))

import { createWeeklyReport } from '@/app/actions/weekly'
import { requireModule } from '@/lib/modules/gate'
import { ERR_DENIED, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { ConfigUnavailableError, ERR_CONFIG_BUSY, ERR_CONFIG_UNAVAILABLE, mapDbError } from '@/lib/settings/errors'
import { WEEKLY_CELL_MAX, type WeeklySheetRow } from '@/lib/domain/weeklySheet'
import type { ConfigArea } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { monProjectValues } from '../helpers/calendarFixture'
import { makeAdminActor } from '../fixtures/actor'

// 단위 테스트 id — RLS 구간(1800~189f·18f0~18ff)과 겹치지 않는 18b0~18bf
const P = '00000000-0000-0000-7e57-0000000018b0'
const A_EXP = '00000000-0000-0000-7e57-0000000018b1'    // 실험(활성, 순서 1)
const A_DATA = '00000000-0000-0000-7e57-0000000018b2'   // 데이터(활성, 순서 2)
const A_OPS = '00000000-0000-0000-7e57-0000000018b3'    // 운영(비활성, 순서 3)
const REPORT = '00000000-0000-0000-7e57-0000000018b4'
const ACTOR = makeAdminActor(P, { userId: 'u-guard' })

const area = (id: string, code: string, name: string, sortOrder: number, active = true): ConfigArea =>
  ({ id, kind: 'weekly_section', code, name, sortOrder, active, teams: [] })
const AREAS: ConfigArea[] = [area(A_EXP, 'EXP', '실험', 1), area(A_DATA, 'DATA', '데이터', 2), area(A_OPS, 'OPS', '운영', 3, false)]
// 월요일 규칙 프로젝트(D28 월요일 회귀 — 기존 p_week_start 기대값 그대로). 일요일 규칙은 아래 케이스가 따로 본다
const cfgWith = (areas: ConfigArea[]) => makeProjectConfig(monProjectValues, { projectId: P, areas: { weekly_section: areas, issue_area: [] } })
const prev = (areaId: string, over: Partial<WeeklySheetRow> = {}): WeeklySheetRow =>
  ({ id: `prev-${areaId}`, reportId: 'rep-prev', areaId, thisContent: '', thisIssue: '', nextContent: '', nextIssue: '', ...over })
const source = (rows: WeeklySheetRow[]) => ({ report: { id: 'rep-prev', projectId: P, weekStart: '2026-09-21', title: '' }, rows })
const seedRow = (areaId: string, thisContent = '') =>
  ({ area_id: areaId, this_content: thisContent, this_issue: '', next_content: '', next_issue: '' })

beforeEach(() => {
  vi.clearAllMocks()
  h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: ACTOR })
  h.getProjectConfig.mockResolvedValue(cfgWith(AREAS))
  h.findCarryOverSource.mockResolvedValue(null)
  h.findWeeklyReportId.mockResolvedValue(null)
  h.adminFor.mockImplementation((scope: Record<string, string>) => ({ ...scope, admin: { rpc: h.rpc } }))
  h.rpc.mockResolvedValue({ data: { status: 'created', report_id: REPORT, rows: 2 }, error: null })
  h.createServerClient.mockImplementation(async () => { throw new Error('createWeeklyReport 는 세션 클라이언트를 만들지 않는다') })
})
afterEach(() => { vi.restoreAllMocks() })   // vitest 4 — vi.spyOn 만 되돌린다(전역 관문 mock 의 구현은 그대로)

/** console.error 인자 어딘가에 needle 이 있는가 — failWith 는 원문을 그대로(Error·객체) 둘째 인자로 남긴다.
 *  객체는 JSON 으로 보므로 needle 도 같은 이스케이프(따옴표 → \")로 맞춘다 */
const logged = (spy: { mock: { calls: unknown[][] } }, needle: string): boolean =>
  spy.mock.calls.flat().some((x) => x instanceof Error ? x.message.includes(needle)
    : typeof x === 'string' ? x.includes(needle)
    : (JSON.stringify(x) ?? '').includes(JSON.stringify(needle).slice(1, -1)))

describe('가드 → 관문 → 입력 순서(스펙 §4.1.3)', () => {
  it('가드가 거부하면 관문·설정·RPC 에 닿지 않는다 — code 는 가드 문구(선례 createProject)', async () => {
    h.requireProjectAdmin.mockResolvedValue({ ok: false, error: ERR_DENIED })
    expect(await createWeeklyReport(P, '2026-09-28', false)).toEqual({ ok: false, code: ERR_DENIED, error: ERR_DENIED })
    expect(vi.mocked(requireModule)).not.toHaveBeenCalled()
    expect(h.getProjectConfig).not.toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('모듈이 꺼지면 입력 검증 전에 닫는다 — 틀린 날짜여도 모듈 거부가 먼저다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    expect(await createWeeklyReport(P, 'not-a-date', false)).toEqual({ ok: false, code: ERR_MODULE_DISABLED, error: ERR_MODULE_DISABLED })
    expect(vi.mocked(requireModule)).toHaveBeenCalledWith({ projectId: P }, 'weekly')
    expect(h.requireProjectAdmin.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(requireModule).mock.invocationCallOrder[0])
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })

  it.each([['2026-13-45'], [''], ['2026-9-28']])('주 날짜 %j 는 INVALID_INPUT — 설정도 읽지 않는다', async (week) => {
    const r = await createWeeklyReport(P, week, false)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })

  it.each([
    ['키가 uuid 아님', { 'not-uuid': 'skip' }],
    ['값이 uuid·skip 아님', { [A_OPS]: 'somewhere' }],
    ['배열', [A_OPS]],
  ])('매핑 모양 위반(%s)은 INVALID_INPUT — 대상의 뜻은 보지 않는다(Q37)', async (_n, mapping) => {
    const r = await createWeeklyReport(P, '2026-09-28', true, mapping as never)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_INPUT' })
    expect(h.getProjectConfig).not.toHaveBeenCalled()
  })
})

describe('영역 — 설정에서 읽고, 활성 0개면 RPC 를 부르지 않는다', () => {
  it('설정 조회 실패는 CONFIG_UNAVAILABLE(재시도 가능) — 원문은 로그로만', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('프로젝트 설정 조회 실패: relation secret_x'))
    const r = await createWeeklyReport(P, '2026-09-28', false)
    expect(r).toEqual({ ok: false, code: 'CONFIG_UNAVAILABLE', error: ERR_CONFIG_UNAVAILABLE, retryable: true })
    expect(JSON.stringify(r)).not.toContain('secret_x')
    expect(logged(err, 'secret_x')).toBe(true)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['영역이 없다', [] as ConfigArea[]],
    ['비활성 영역뿐이다', [area(A_OPS, 'OPS', '운영', 1, false)]],
  ])('%s → CONFIG_REQUIRED, RPC 미호출(W1) — 문구는 RPC 토큰 WEEKLY_AREAS_REQUIRED 의 표 문구와 같다', async (_n, areas) => {
    h.getProjectConfig.mockResolvedValue(cfgWith(areas))
    const r = await createWeeklyReport(P, '2026-09-28', false)
    expect(r).toEqual({ ok: false, code: 'CONFIG_REQUIRED', error: mapDbError({ code: '23514', message: 'WEEKLY_AREAS_REQUIRED' })!.message })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.findCarryOverSource).not.toHaveBeenCalled()
  })
})

describe('RPC 한 길(D22·D43·D51)', () => {
  it('이월 없음 — 시드 null, 주는 월요일로, p_actor 는 가드 결과의 userId, 읽기 경로로 존재를 확인하지 않는다', async () => {
    const r = await createWeeklyReport(P, '2026-10-01', false)
    expect(r).toEqual({ ok: true, reportId: REPORT, status: 'created' })
    expect(h.adminFor).toHaveBeenCalledWith({ projectId: P })
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('create_weekly_report', {
      p_actor: 'u-guard', p_project_id: P, p_week_start: '2026-09-28', p_seed: null,
    })
    expect(h.getWeeklySheet).not.toHaveBeenCalled()
    expect(h.findCarryOverSource).not.toHaveBeenCalled()
    expect(h.createServerClient).not.toHaveBeenCalled()
    expect(h.revalidatePath).toHaveBeenCalledWith('/(app)/p/[projectId]/weekly', 'page')
  })

  it('일요일 규칙 프로젝트 — 요청 날짜를 그 프로젝트의 키(일요일)로 정규화해 RPC 에 넘긴다', async () => {
    h.getProjectConfig.mockResolvedValue(makeProjectConfig({}, { projectId: P, areas: { weekly_section: AREAS, issue_area: [] } }))
    await createWeeklyReport(P, '2026-10-01', false)
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_week_start: '2026-09-27' })
  })
  it('달력 키가 손상이면 RPC 를 부르지 않고 CONFIG_INVALID — 기본 규칙으로 키를 만들지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getProjectConfig.mockResolvedValue(makeProjectConfig({ 'calendar.week_start': 'sunday' }, { projectId: P, areas: { weekly_section: AREAS, issue_area: [] } }))
    err.mockRestore()
    const r = await createWeeklyReport(P, '2026-10-01', false)
    expect(r).toMatchObject({ ok: false, code: 'CONFIG_INVALID' })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('같은 주 문서가 이미 있으면 exists — 실패가 아니다(D33)', async () => {
    h.rpc.mockResolvedValue({ data: { status: 'exists', report_id: REPORT }, error: null })
    expect(await createWeeklyReport(P, '2026-09-28', false)).toEqual({ ok: true, reportId: REPORT, status: 'exists' })
  })

  it('이월 원본이 없거나 행이 0개면 시드 null', async () => {
    h.findCarryOverSource.mockResolvedValueOnce(null).mockResolvedValueOnce(source([]))
    await createWeeklyReport(P, '2026-09-28', true)
    await createWeeklyReport(P, '2026-09-28', true)
    expect(h.findCarryOverSource).toHaveBeenNthCalledWith(1, P, '2026-09-28')
    expect(h.rpc.mock.calls.map((c) => (c[1] as { p_seed: unknown }).p_seed)).toEqual([null, null])
  })

  it('이월 — 원본의 차주계획이 같은 영역의 금주실적으로, 활성 영역마다 한 행(영역 순)', async () => {
    h.findCarryOverSource.mockResolvedValue(source([
      prev(A_DATA, { nextContent: '데이터 다음 일' }),
      prev(A_EXP, { nextContent: '실험 다음 일', nextIssue: '실험 이슈' }),
      prev(A_OPS),                                                   // 비활성·내용 없음 — 무시
    ]))
    expect(await createWeeklyReport(P, '2026-09-28', true)).toEqual({ ok: true, reportId: REPORT, status: 'created' })
    expect(h.rpc.mock.calls[0][1]).toMatchObject({
      p_seed: [
        { ...seedRow(A_EXP, '실험 다음 일'), this_issue: '실험 이슈' },
        seedRow(A_DATA, '데이터 다음 일'),
      ],
    })
  })

  it('비활성 영역에 대기 내용이 있으면 CARRY_PENDING — 문서를 만들지 않는다(W13)', async () => {
    h.findCarryOverSource.mockResolvedValue(source([prev(A_OPS, { nextContent: '운영 할 일' })]))
    const r = await createWeeklyReport(P, '2026-09-28', true)
    expect(r).toEqual({ ok: false, code: 'CARRY_PENDING', pending: [{ areaId: A_OPS, areaName: '운영', cells: ['nextContent'] }], overflow: [] })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('매핑 재요청 — 대기 영역을 고른 활성 영역에 덧붙여 만든다', async () => {
    h.findCarryOverSource.mockResolvedValue(source([prev(A_OPS, { nextContent: '운영 할 일' })]))
    const r = await createWeeklyReport(P, '2026-09-28', true, { [A_OPS]: A_DATA })
    expect(r).toEqual({ ok: true, reportId: REPORT, status: 'created' })
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_seed: [seedRow(A_EXP), seedRow(A_DATA, '운영 할 일')] })
  })

  it('매핑 값이 활성 영역이 아니면(그새 비활성) 다시 CARRY_PENDING — 오류가 아니다(Q37)', async () => {
    h.findCarryOverSource.mockResolvedValue(source([prev(A_OPS, { nextContent: '운영 할 일' })]))
    const r = await createWeeklyReport(P, '2026-09-28', true, { [A_OPS]: A_OPS })
    expect(r).toMatchObject({ ok: false, code: 'CARRY_PENDING', pending: [{ areaId: A_OPS }] })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('덧붙인 칸이 20,000자를 넘으면 CARRY_PENDING 의 overflow — 자르지 않고 만들지 않는다(D31)', async () => {
    h.findCarryOverSource.mockResolvedValue(source([
      prev(A_EXP, { nextContent: 'x'.repeat(WEEKLY_CELL_MAX) }),
      prev(A_OPS, { nextContent: 'y' }),
    ]))
    const r = await createWeeklyReport(P, '2026-09-28', true, { [A_OPS]: A_EXP })
    expect(r).toMatchObject({ ok: false, code: 'CARRY_PENDING', pending: [], overflow: [expect.objectContaining({ areaId: A_EXP, cell: 'this_content' })] })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('같은 주 문서가 이미 있으면 이월 판정 없이(매핑 창 없이) RPC 의 exists — 다른 관리자가 먼저 만든 주차(A1-4 리뷰 P7)', async () => {
    h.findWeeklyReportId.mockResolvedValue(REPORT)
    h.findCarryOverSource.mockResolvedValue(source([prev(A_OPS, { nextContent: '운영 할 일' })]))   // 판정했다면 CARRY_PENDING
    h.rpc.mockResolvedValue({ data: { status: 'exists', report_id: REPORT }, error: null })
    expect(await createWeeklyReport(P, '2026-09-28', true)).toEqual({ ok: true, reportId: REPORT, status: 'exists' })
    expect(h.findWeeklyReportId).toHaveBeenCalledWith(P, '2026-09-28')
    expect(h.findCarryOverSource).not.toHaveBeenCalled()
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_seed: null })
  })

  it('이월 없이 만들 때는 존재를 미리 읽지 않는다 — RPC 가 판정한다', async () => {
    await createWeeklyReport(P, '2026-09-28', false)
    expect(h.findWeeklyReportId).not.toHaveBeenCalled()
  })

  it('같은 주 문서 확인 실패는 중단 — CARRY_SOURCE_UNAVAILABLE, RPC 미호출, 원문은 로그로만', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.findWeeklyReportId.mockRejectedValue(new Error('relation "secret_docs" does not exist'))
    const r = await createWeeklyReport(P, '2026-09-28', true)
    expect(r).toMatchObject({ ok: false, code: 'CARRY_SOURCE_UNAVAILABLE', retryable: true })
    expect(JSON.stringify(r)).not.toContain('secret_docs')
    expect(logged(err, 'secret_docs')).toBe(true)
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('이월 원본 조회 실패는 중단(원본 없음과 구분) — CARRY_SOURCE_UNAVAILABLE, 원문은 로그로만(errMsg 경로 삭제 — Q20)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.findCarryOverSource.mockRejectedValue(new Error('relation "secret_rows" does not exist'))
    const r = await createWeeklyReport(P, '2026-09-28', true)
    expect(r).toEqual({ ok: false, code: 'CARRY_SOURCE_UNAVAILABLE', error: '이월 원본을 불러오지 못했습니다. 잠시 후 다시 시도하세요.', retryable: true })
    expect(JSON.stringify(r)).not.toContain('secret_rows')
    expect(logged(err, 'secret_rows')).toBe(true)
    expect(h.rpc).not.toHaveBeenCalled()
  })
})

describe('RPC 토큰 → 코드(D45·T6·P4) — 원문 비노출', () => {
  it.each([
    ['WEEKLY_FORBIDDEN', '42501', { code: 'ERR_DENIED', error: ERR_DENIED }],
    ['PROJECT_NOT_FOUND', 'P0002', { code: 'ERR_MISSING', error: ERR_MISSING }],
    ['WEEKLY_AREAS_REQUIRED', '23514', { code: 'CONFIG_REQUIRED', error: '주간보고 영역을 먼저 설정하세요.' }],
    ['deadlock detected', '40P01', { code: 'CONFIG_BUSY', error: ERR_CONFIG_BUSY, retryable: true }],
    ['canceling statement due to lock timeout', '55P03', { code: 'CONFIG_BUSY', error: ERR_CONFIG_BUSY, retryable: true }],
  ] as const)('%s(%s)', async (message, code, want) => {
    h.rpc.mockResolvedValue({ data: null, error: { code, message } })
    expect(await createWeeklyReport(P, '2026-09-28', false)).toEqual({ ok: false, ...want })
  })

  // 정상 경로 밖 토큰(격리 25001)과 입력 토큰(22023 — 액션이 RPC 앞에서 같은 것을 먼저 거른다)은 표에 넣지 않는다(D45·T6)
  it.each([
    ['WEEKLY_ISOLATION', '25001'],
    ['WEEKLY_INVALID_INPUT', '22023'],
    ['WEEKLY_SEED_INVALID', '22023'],
    ['relation "public.secret_table" does not exist', '42P01'],
  ])('표에 없는 %s 는 UNAVAILABLE 고정 문구 + 로그', async (message, code) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.rpc.mockResolvedValue({ data: null, error: { code, message } })
    const r = await createWeeklyReport(P, '2026-09-28', false)
    expect(r).toEqual({ ok: false, code: 'UNAVAILABLE', error: '주차 시트를 만들지 못했습니다. 잠시 후 다시 시도하세요.' })
    expect(JSON.stringify(r)).not.toContain(message)
    expect(logged(err, message)).toBe(true)
  })
})
