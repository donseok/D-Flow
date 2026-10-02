// 여러 워크스페이스 소속자의 전역 화면·봇 '오늘'(A-3 리뷰 P2, M3) — 소속 워크스페이스들의 달력(tz·주 시작·근무 요일)이 모두 같으면 그 달력,
// 다르면 제품 기본값(UTC — 화면·봇 답이 기준 tz 이름을 적는다). 여럿 중 하나라도 판독 실패·손상이면 '다름'(UTC + 로그 — N2 판정 (a)),
// 하나뿐인 소속의 실패는 던진다(그 사용자의 유일한 달력).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))

import { DEFAULT_REQUEST_CALENDAR, resolveMemberWorkspacesCalendar, resolveMemberWorkspacesCalendarBasis } from '@/lib/calendar/load'
import { viewTimezone } from '@/lib/calendar/viewZone'
import { calendarOf, type WeekStartRule } from '@/lib/domain/calendar'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'

const SUN: WeekStartRule[] = [{ day: 'sunday', from: null }]
const MON: WeekStartRule[] = [{ day: 'monday', from: null }]
const ws = (timezone: string, weekStart = SUN, workingDays: number[] = [1, 2, 3, 4, 5]) =>
  ({ calendar: calendarOf({ timezone, workingDays: workingDays as never, weekStart }), calendarError: null })
const broken = (key: string) => ({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', key) })
const byId = (map: Record<string, unknown>) => m.getWorkspaceConfig.mockImplementation(async (id: string) => map[id])
const actor = (ids: string[]) => ({ userId: 'u1', workspaceRoles: new Map(ids.map((id) => [id, 'member'])) }) as never

beforeEach(() => { m.getWorkspaceConfig.mockReset() })

describe('resolveMemberWorkspacesCalendar', () => {
  it('소속이 없으면 기본값, 하나면 그 워크스페이스', async () => {
    expect(await resolveMemberWorkspacesCalendar([])).toBe(DEFAULT_REQUEST_CALENDAR)
    byId({ a: ws('Asia/Seoul') })
    expect((await resolveMemberWorkspacesCalendar(['a'])).timezone).toBe('Asia/Seoul')
  })
  it('여럿이고 달력이 모두 같으면 그 달력(서울 둘 → 서울)', async () => {
    byId({ a: ws('Asia/Seoul'), b: ws('Asia/Seoul') })
    const cal = await resolveMemberWorkspacesCalendar(['a', 'b'])
    expect(cal.timezone).toBe('Asia/Seoul')
    expect(cal.weekStart).toEqual(SUN)
    expect([...cal.workingDays].sort()).toEqual([1, 2, 3, 4, 5])
  })
  it('tz·주 시작·근무 요일 중 하나라도 다르면 기본값(UTC)', async () => {
    byId({ a: ws('Asia/Seoul'), b: ws('America/Los_Angeles') })
    expect(await resolveMemberWorkspacesCalendar(['a', 'b'])).toBe(DEFAULT_REQUEST_CALENDAR)
    byId({ a: ws('Asia/Seoul'), b: ws('Asia/Seoul', MON) })
    expect(await resolveMemberWorkspacesCalendar(['a', 'b'])).toBe(DEFAULT_REQUEST_CALENDAR)
    byId({ a: ws('Asia/Seoul'), b: ws('Asia/Seoul', SUN, [1, 2, 3, 4, 5, 6]) })
    expect(await resolveMemberWorkspacesCalendar(['a', 'b'])).toBe(DEFAULT_REQUEST_CALENDAR)
  })
  it('여럿 중 하나라도 판독할 수 없으면(손상·조회 실패) "같다를 판정할 수 없음 = 다름" — 기본값(UTC) + 로그(A-4 리뷰 P2 N2 판정 (a))', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    byId({ a: ws('Asia/Seoul'), b: broken('calendar.timezone') })
    expect(await resolveMemberWorkspacesCalendar(['a', 'b'])).toBe(DEFAULT_REQUEST_CALENDAR)
    expect(err).toHaveBeenCalledWith(expect.stringContaining('[calendar]'), expect.objectContaining({ workspaceId: 'b' }))
    err.mockClear()
    m.getWorkspaceConfig.mockImplementation(async (id: string) => {
      if (id === 'b') throw new ConfigUnavailableError('워크스페이스 설정 조회 실패')
      return ws('Asia/Seoul')
    })
    expect(await resolveMemberWorkspacesCalendar(['a', 'b'])).toBe(DEFAULT_REQUEST_CALENDAR)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('하나뿐인 소속의 손상·조회 실패는 그대로 던진다(그 사용자의 유일한 달력 — 대체하지 않는다)', async () => {
    byId({ a: broken('calendar.timezone') })
    await expect(resolveMemberWorkspacesCalendar(['a'])).rejects.toBeInstanceOf(ConfigKeyError)
    m.getWorkspaceConfig.mockRejectedValue(new ConfigUnavailableError('조회 실패'))
    await expect(resolveMemberWorkspacesCalendar(['a'])).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
  it('설정 오류가 아닌 예외(결함)는 여럿이어도 그대로 던진다', async () => {
    m.getWorkspaceConfig.mockImplementation(async (id: string) => { if (id === 'b') throw new TypeError('boom'); return ws('Asia/Seoul') })
    await expect(resolveMemberWorkspacesCalendar(['a', 'b'])).rejects.toBeInstanceOf(TypeError)
  })
})

describe('viewTimezone — 여러 워크스페이스 소속(전역 화면)', () => {
  it('모두 같으면 그 tz, 다르면 UTC, 여럿 중 하나가 손상이면 UTC(N2 — 하나뿐일 때만 ok:false)', async () => {
    byId({ a: ws('America/Los_Angeles'), b: ws('America/Los_Angeles') })
    await expect(viewTimezone(actor(['a', 'b']))).resolves.toEqual({ ok: true, timeZone: 'America/Los_Angeles', basis: 'member' })
    byId({ a: ws('America/Los_Angeles'), b: ws('Asia/Seoul') })
    await expect(viewTimezone(actor(['a', 'b']))).resolves.toEqual({ ok: true, timeZone: 'UTC', basis: 'differs' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    byId({ a: ws('Asia/Seoul'), b: broken('calendar.week_start') })
    await expect(viewTimezone(actor(['a', 'b']))).resolves.toEqual({ ok: true, timeZone: 'UTC', basis: 'unreadable' })
    await expect(viewTimezone(actor(['b']))).resolves.toMatchObject({ ok: false, key: 'calendar.week_start' })
    err.mockRestore()
  })
})

describe('resolveMemberWorkspacesCalendarBasis — 기본값으로 계산한 근거(A-5 리뷰 O2 — 화면이 그 사실을 적는다)', () => {
  it('none·member·differs·unreadable', async () => {
    expect((await resolveMemberWorkspacesCalendarBasis([])).basis).toBe('none')
    byId({ a: ws('Asia/Seoul') })
    expect((await resolveMemberWorkspacesCalendarBasis(['a'])).basis).toBe('member')
    byId({ a: ws('Asia/Seoul'), b: ws('Asia/Seoul') })
    expect((await resolveMemberWorkspacesCalendarBasis(['a', 'b'])).basis).toBe('member')
    byId({ a: ws('Asia/Seoul'), b: ws('America/Los_Angeles') })
    expect(await resolveMemberWorkspacesCalendarBasis(['a', 'b'])).toEqual({ calendar: DEFAULT_REQUEST_CALENDAR, basis: 'differs' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    byId({ a: ws('Asia/Seoul'), b: broken('calendar.timezone') })
    expect(await resolveMemberWorkspacesCalendarBasis(['a', 'b'])).toEqual({ calendar: DEFAULT_REQUEST_CALENDAR, basis: 'unreadable' })
    err.mockRestore()
  })
})
