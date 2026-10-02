// 여러 워크스페이스 소속자의 전역 화면·봇 '오늘'(A-3 리뷰 P2, M3) — 소속 워크스페이스들의 달력(tz·주 시작·근무 요일)이 모두 같으면 그 달력,
// 다르면 제품 기본값(UTC — 화면·봇 답이 기준 tz 이름을 적는다), 판독 실패·손상은 fail-closed(던진다 — 기본값으로 풀지 않는다).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))

import { DEFAULT_REQUEST_CALENDAR, resolveMemberWorkspacesCalendar } from '@/lib/calendar/load'
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
  it('하나라도 손상이면 ConfigKeyError, 조회 실패면 ConfigUnavailableError — 기본값으로 풀지 않는다', async () => {
    byId({ a: ws('Asia/Seoul'), b: broken('calendar.timezone') })
    await expect(resolveMemberWorkspacesCalendar(['a', 'b'])).rejects.toBeInstanceOf(ConfigKeyError)
    m.getWorkspaceConfig.mockImplementation(async (id: string) => {
      if (id === 'b') throw new ConfigUnavailableError('워크스페이스 설정 조회 실패')
      return ws('Asia/Seoul')
    })
    await expect(resolveMemberWorkspacesCalendar(['a', 'b'])).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
})

describe('viewTimezone — 여러 워크스페이스 소속(전역 화면)', () => {
  it('모두 같으면 그 tz, 다르면 UTC, 손상이면 ok:false(그 키)', async () => {
    byId({ a: ws('America/Los_Angeles'), b: ws('America/Los_Angeles') })
    await expect(viewTimezone(actor(['a', 'b']))).resolves.toEqual({ ok: true, timeZone: 'America/Los_Angeles' })
    byId({ a: ws('America/Los_Angeles'), b: ws('Asia/Seoul') })
    await expect(viewTimezone(actor(['a', 'b']))).resolves.toEqual({ ok: true, timeZone: 'UTC' })
    byId({ a: ws('Asia/Seoul'), b: broken('calendar.week_start') })
    await expect(viewTimezone(actor(['a', 'b']))).resolves.toMatchObject({ ok: false, key: 'calendar.week_start' })
  })
})
