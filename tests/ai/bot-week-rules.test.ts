// 봇의 주 규칙(SP5 A 과제 17 — 스펙 D13 ③·D34·§6.1 A) — ① 일요일 규칙 프로젝트에서 주간 도구가 일요일 기준일을 거부하지 않고 아무 날짜를
// 그 프로젝트의 키로 정규화한다 ② 라우터 '지난/이번/다음 주'·플래너 앵커가 요청 범위 달력의 weekPeriodOf 와 같은 기간이다
// ③ 워크스페이스 질문에서 도구들이 같은 '이번 주'를 받는다 ④ upsertArea 의 p_from_week 가 그 프로젝트 규칙의 키다(월요일 규칙이면 월요일).
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ④ 의 목(파일 최상위로 끌어올려진다 — ①~③ 은 이 모듈들을 쓰지 않는다)
const h = vi.hoisted(() => ({ requireProjectAdmin: vi.fn(), getProjectConfig: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/authz', () => ({ requireProjectAdmin: h.requireProjectAdmin }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({ ...(await orig<object>()), getProjectConfig: h.getProjectConfig }))
vi.mock('@/lib/supabase/adminFor', () => ({ adminFor: () => ({ admin: { rpc: h.rpc } }) }))

import { routeChatRequest } from '@/lib/ai/chat/router'
import { plannerDateAnchors } from '@/lib/ai/chat/planner'
import { dateAnchors, inclusiveRange } from '@/lib/ai/chat/calendarAnchors'
import { createCompareWeeklySheetsTool, createGetWeeklySheetTool } from '@/lib/ai/tools/weekly'
import { calendarOf, weekPeriodOf, type RequestCalendar } from '@/lib/domain/calendar'
import { addDaysIso } from '@/lib/domain/dates'
import { repositoryOk } from '@/lib/repositories/types'
import type { ChatRequestV2 } from '@/lib/ai/chat/protocol'
import type { ToolExecutionContext } from '@/lib/ai/tools/types'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { MON_RULES, monProjectValues } from '../helpers/calendarFixture'

const P = '00000000-0000-0000-7e57-0000000019b0'
// 2026-10-14(수) 03:00 UTC = LA 10-13(화) 20:00 = 서울 10-14(수) 12:00
const NOW = new Date('2026-10-14T03:00:00Z')
const LA_SUN: RequestCalendar = calendarOf({ timezone: 'America/Los_Angeles', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'sunday', from: null }] })
const SEOUL_MON: RequestCalendar = calendarOf({ timezone: 'Asia/Seoul', workingDays: [1, 2, 3, 4, 5], weekStart: MON_RULES })

const req = (message: string, projectId: string | null = P): ChatRequestV2 => ({ projectId, message, history: [] }) as unknown as ChatRequestV2
const ctx = (over: Partial<ToolExecutionContext> = {}): ToolExecutionContext => ({
  userId: 'u1', capabilities: ['weekly:read'], allowedProjectIds: [P], pageContext: null,
  now: NOW.toISOString(), timezone: 'America/Los_Angeles', ...over,
})
const sheet = (weekStart: string) => repositoryOk({
  report: { id: `r-${weekStart}`, projectId: P, weekStart, title: '', updatedAt: null }, rows: [], areas: [],
})

describe('① 주간 도구 — 그 프로젝트 규칙의 키', () => {
  const repo = { getSheet: vi.fn() }
  const settings = { getProjectConfig: vi.fn() }
  beforeEach(() => { repo.getSheet.mockReset(); settings.getProjectConfig.mockReset() })

  it('일요일 규칙: 일요일 기준일을 거부하지 않는다', async () => {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig({}, { projectId: P })))
    repo.getSheet.mockResolvedValue(sheet('2026-10-11'))
    const r = await createGetWeeklySheetTool(repo as never, settings).execute({ projectId: P, weekStart: '2026-10-11', limit: 10 }, ctx())
    expect(r.ok).toBe(true)
    expect(repo.getSheet).toHaveBeenCalledWith(P, '2026-10-11')
  })
  it('일요일 규칙: 주 중의 날짜(수)는 그 주 키(일)로 정규화한다', async () => {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig({}, { projectId: P })))
    repo.getSheet.mockResolvedValue(sheet('2026-10-11'))
    await createGetWeeklySheetTool(repo as never, settings).execute({ projectId: P, weekStart: '2026-10-14', limit: 10 }, ctx())
    expect(repo.getSheet).toHaveBeenCalledWith(P, '2026-10-11')
  })
  it('월요일 규칙(회귀): 같은 수요일은 월요일 키', async () => {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig(monProjectValues, { projectId: P })))
    repo.getSheet.mockResolvedValue(sheet('2026-10-12'))
    await createGetWeeklySheetTool(repo as never, settings).execute({ projectId: P, weekStart: '2026-10-14', limit: 10 }, ctx())
    expect(repo.getSheet).toHaveBeenCalledWith(P, '2026-10-12')
  })
  it('비교 도구도 월요일을 강제하지 않는다 — 두 날짜를 키로 바꾼 뒤 과거 → 현재', async () => {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig({}, { projectId: P })))
    repo.getSheet.mockImplementation(async (_p: string, w: string) => sheet(w))
    const r = await createCompareWeeklySheetsTool(repo as never, settings).execute(
      { projectId: P, fromWeekStart: '2026-10-07', toWeekStart: '2026-10-14', limit: 10 }, ctx())
    expect(r.ok).toBe(true)
    expect(repo.getSheet.mock.calls.map(c => c[1]).sort()).toEqual(['2026-10-04', '2026-10-11'])
  })
  it('같은 주로 정규화되는 두 날짜의 비교는 거부(서로 다른 주여야 한다)', async () => {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig({}, { projectId: P })))
    const r = await createCompareWeeklySheetsTool(repo as never, settings).execute(
      { projectId: P, fromWeekStart: '2026-10-12', toWeekStart: '2026-10-14', limit: 10 }, ctx())
    expect(r.ok).toBe(false)
    expect(repo.getSheet).not.toHaveBeenCalled()
  })
  it('[RF4] 달력 키가 손상이면 도구 실패 — 기본 규칙으로 다른 주를 읽지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig({ 'calendar.week_start': 'sunday' }, { projectId: P })))
    err.mockRestore()
    const r = await createGetWeeklySheetTool(repo as never, settings).execute({ projectId: P, weekStart: '2026-10-14', limit: 10 }, ctx())
    expect(r.ok).toBe(false)
    expect(repo.getSheet).not.toHaveBeenCalled()
  })
})

describe('② 라우터·플래너 앵커 = 요청 범위 달력의 weekPeriodOf', () => {
  const expected = (cal: RequestCalendar, key: string) => ({ from: key, to: addDaysIso(weekPeriodOf(cal.weekStart, key).endExclusive, -1) })
  it('LA·일요일: 오늘은 LA 날짜(10-13 화), 이번 주 10-11~10-17, 지난 주 10-04~, 다음 주 10-18~', () => {
    const a = dateAnchors(LA_SUN, NOW)
    expect(a.today).toBe('2026-10-13')
    expect(inclusiveRange(a.thisWeek)).toEqual(expected(LA_SUN, '2026-10-11'))
    expect(inclusiveRange(a.lastWeek)).toEqual(expected(LA_SUN, '2026-10-04'))
    expect(inclusiveRange(a.nextWeek)).toEqual(expected(LA_SUN, '2026-10-18'))
    const p = plannerDateAnchors(LA_SUN, NOW.toISOString())
    expect(p.thisWeek).toEqual(inclusiveRange(a.thisWeek))
    expect(p.today).toBe('2026-10-13')
  })
  it('라우터의 "지난주 회의"·"이번 주 회의"·"차주 회의" 범위가 앵커와 같다', () => {
    const a = dateAnchors(LA_SUN, NOW)
    const argsOf = (m: string) => routeChatRequest(req(m), NOW, LA_SUN).calls[0]?.args as { from?: string; to?: string }
    expect(argsOf('지난주 회의 알려줘')).toMatchObject(inclusiveRange(a.lastWeek))
    expect(argsOf('이번 주 회의 알려줘')).toMatchObject(inclusiveRange(a.thisWeek))
    expect(argsOf('차주 회의 알려줘')).toMatchObject(inclusiveRange(a.nextWeek))
  })
  it('서울·월요일(회귀): 이번 주 = 10-12(월)~10-18', () => {
    expect(inclusiveRange(dateAnchors(SEOUL_MON, NOW).thisWeek)).toEqual({ from: '2026-10-12', to: '2026-10-18' })
  })
  it('과도기 규칙: 이번 주가 과도기 기간이면 6일([10-05, 10-11))', () => {
    const cal = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }] })
    expect(inclusiveRange(dateAnchors(cal, new Date('2026-10-07T12:00:00Z')).thisWeek)).toEqual({ from: '2026-10-05', to: '2026-10-10' })
  })
  it('주간 질문의 weekStart 는 앵커 이번 주의 기준일(시작 10-11 + 3일 — 도구가 그 날이 든 프로젝트의 주로 바꾼다, M1)', () => {
    const call = routeChatRequest(req('이번 주 주간업무 보여줘'), NOW, LA_SUN).calls.find(c => c.tool === 'get_weekly_sheet')
    expect(call?.args).toMatchObject({ weekStart: '2026-10-14' })
  })
})

describe('①′ 요청 달력과 프로젝트의 주 시작이 다를 때 — 이번·지난·다음 주 = 그 프로젝트의 그 주(A-3 리뷰 P1, M1)', () => {
  // 라우터·플래너는 요청 범위 달력의 주를 고르고, 주간 도구는 그 주의 기준일(시작 + 3일 — 라벨 규칙 D4 와 같은 기준)을 그 프로젝트 규칙의
  // 키로 바꾼다. 첫날을 바꾸면 주 시작이 어긋날 때 겹침이 하루뿐인 앞 주를 고른다.
  const repo = { getSheet: vi.fn() }
  const settings = { getProjectConfig: vi.fn() }
  const TRANSITION = { 'calendar.week_start': [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }] } as const
  const UTC_SUN: RequestCalendar = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'sunday', from: null }] })
  beforeEach(() => {
    repo.getSheet.mockReset(); settings.getProjectConfig.mockReset()
    repo.getSheet.mockImplementation(async (_p: string, w: string) => sheet(w))
  })
  /** 라우터가 고른 인자로 도구를 실행하고, 저장소가 받은 주 키(들)를 돌려준다 */
  async function keysFor(message: string, reqCal: RequestCalendar, values: Record<string, unknown>, now = NOW): Promise<string[]> {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig(values, { projectId: P })))
    const call = routeChatRequest(req(message), now, reqCal).calls.find(c => c.tool === 'get_weekly_sheet' || c.tool === 'compare_weekly_sheets')
    if (!call) throw new Error(`주간 도구 호출 없음: ${message}`)
    const tool = call.tool === 'get_weekly_sheet' ? createGetWeeklySheetTool(repo as never, settings) : createCompareWeeklySheetsTool(repo as never, settings)
    const r = await tool.execute(call.args, ctx({ now: now.toISOString(), timezone: reqCal.timezone }))
    expect(r.ok).toBe(true)
    return repo.getSheet.mock.calls.map(c => c[1] as string).sort()
  }

  it('요청 일요일(LA, 오늘 10-13 화) × 프로젝트 월요일: 이번 주 10-12, 지난 주 10-05', async () => {
    expect(await keysFor('이번 주 주간업무 보여줘', LA_SUN, monProjectValues)).toEqual(['2026-10-12'])
    repo.getSheet.mockClear()
    expect(await keysFor('지난주 주간업무 보여줘', LA_SUN, monProjectValues)).toEqual(['2026-10-05'])
  })
  it('요청 일요일 × 프로젝트 월요일: 지난주와 이번 주 비교 = 10-05 → 10-12', async () => {
    expect(await keysFor('지난주랑 이번 주 주간업무 비교해줘', LA_SUN, monProjectValues)).toEqual(['2026-10-05', '2026-10-12'])
  })
  it('반대(요청 월요일 서울, 오늘 10-14 수) × 프로젝트 일요일: 이번 주 10-11, 지난 주 10-04', async () => {
    expect(await keysFor('이번 주 주간업무 보여줘', SEOUL_MON, { 'calendar.timezone': 'Asia/Seoul' })).toEqual(['2026-10-11'])
    repo.getSheet.mockClear()
    expect(await keysFor('지난주 주간업무 보여줘', SEOUL_MON, { 'calendar.timezone': 'Asia/Seoul' })).toEqual(['2026-10-04'])
  })
  it('과도기 프로젝트(E = 10-11) × 일요일 워크스페이스 — E 전(10-07 수): 이번 주 = 과도기 키 10-05, 지난 주 = 09-28', async () => {
    const before = new Date('2026-10-07T12:00:00Z')
    expect(await keysFor('이번 주 주간업무 보여줘', UTC_SUN, TRANSITION, before)).toEqual(['2026-10-05'])
    repo.getSheet.mockClear()
    expect(await keysFor('지난주 주간업무 보여줘', UTC_SUN, TRANSITION, before)).toEqual(['2026-09-28'])
  })
  it('과도기 프로젝트 — E 뒤(10-14 수): 이번 주 10-11, 지난 주 = 과도기 키 10-05', async () => {
    const after = new Date('2026-10-14T12:00:00Z')
    expect(await keysFor('이번 주 주간업무 보여줘', UTC_SUN, TRANSITION, after)).toEqual(['2026-10-11'])
    repo.getSheet.mockClear()
    expect(await keysFor('지난주 주간업무 보여줘', UTC_SUN, TRANSITION, after)).toEqual(['2026-10-05'])
  })
  it('명시 날짜는 그 날짜가 든 프로젝트의 주 — 요청 키로 바꾸지 않는다(10월 14일 수 → 월요일 프로젝트 10-12)', async () => {
    expect(await keysFor('10월 14일 주간업무 보여줘', LA_SUN, monProjectValues)).toEqual(['2026-10-12'])
  })
  it('플래너 앵커의 주 기준일 — 이번·지난·다음 주가 월요일 프로젝트의 10-12·10-05·10-19 로 간다', async () => {
    settings.getProjectConfig.mockResolvedValue(repositoryOk(makeProjectConfig(monProjectValues, { projectId: P })))
    const refs = plannerDateAnchors(LA_SUN, NOW.toISOString()).weekRefs
    const tool = createGetWeeklySheetTool(repo as never, settings)
    for (const ref of [refs.thisWeek, refs.lastWeek, refs.nextWeek]) await tool.execute({ projectId: P, weekStart: ref, limit: 10 }, ctx())
    expect(repo.getSheet.mock.calls.map(c => c[1])).toEqual(['2026-10-12', '2026-10-05', '2026-10-19'])
  })
})

describe('③ 워크스페이스 질문 — 도구들이 같은 "이번 주"', () => {
  // 프로젝트 없는 복수 도메인 질문은 지금 라우터에서 레거시로 간다(legacy_project_scope) — 결정형 도구 경로(내 회의)와 플래너 앵커가
  // 같은 요청 범위 달력의 '이번 주'를 받는지로 본다
  it('프로젝트 없는 질문의 범위 인자 = 플래너 앵커의 이번 주(요청 범위 달력 하나)', () => {
    const r = routeChatRequest(req('이번 주 회의 알려줘', null), NOW, LA_SUN)
    const ranges = r.calls.map(c => c.args as { from?: string; to?: string }).filter(a => a.from && a.to).map(a => `${a.from}~${a.to}`)
    expect(r.calls.map(c => c.tool)).toEqual(['list_my_meetings'])
    const week = plannerDateAnchors(LA_SUN, NOW.toISOString()).thisWeek
    expect(week).toEqual(inclusiveRange(dateAnchors(LA_SUN, NOW).thisWeek))
    expect(new Set(ranges)).toEqual(new Set([`${week.from}~${week.to}`]))
  })
})

describe('④ 영역 저장의 p_from_week — 그 프로젝트 규칙의 키', () => {
  const AREA = { kind: 'weekly_section' as const, code: 'EXP', name: '실험', sortOrder: 1, active: true, teams: [] }
  beforeEach(() => {
    h.requireProjectAdmin.mockResolvedValue({ ok: true, actor: { userId: 'u-guard' } })
    h.rpc.mockResolvedValue({ data: { status: 'created', area_id: 'a1', rows_added: 0 }, error: null })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  it.each([
    ['월요일 규칙(서울)', { ...monProjectValues, 'calendar.timezone': 'Asia/Seoul' }, '2026-10-12'],
    ['일요일 규칙(LA)', { 'calendar.timezone': 'America/Los_Angeles' }, '2026-10-11'],
  ])('%s → p_from_week %s', async (_n, values, key) => {
    h.getProjectConfig.mockResolvedValue(makeProjectConfig(values, { projectId: P }))
    const { upsertArea } = await import('@/app/actions/projectAreas')
    await upsertArea(P, AREA)
    expect(h.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_from_week: key })
  })
})
