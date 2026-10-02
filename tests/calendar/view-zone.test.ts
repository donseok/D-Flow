// 워크스페이스 화면의 tz(viewTimezone — 그 슬러그 워크스페이스, 계획 D-21c)와 페이지용 달력 결과형(pickCalendar — D-21a)
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
import { viewCalendar, viewTimezone } from '@/lib/calendar/viewZone'
import { pickCalendar } from '@/lib/settings/pick'
import { ConfigKeyError } from '@/lib/settings/errors'

const cal = (timezone: string) => ({ timezone, workingDays: new Set([1, 2, 3, 4, 5]), offDates: new Set(), workDates: new Set(), weekStart: [{ day: 'sunday', from: null }] })
beforeEach(() => vi.clearAllMocks())

describe('viewTimezone — 워크스페이스 화면의 tz(D-21c — 그 슬러그 워크스페이스, 소속 목록 아님)', () => {
  it('그 워크스페이스의 tz', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: cal('America/Los_Angeles'), calendarError: null })
    await expect(viewTimezone('ws-1')).resolves.toEqual({ ok: true, timeZone: 'America/Los_Angeles' })
    expect(m.getWorkspaceConfig).toHaveBeenCalledWith('ws-1', undefined)
  })
  it('워크스페이스 달력 손상은 ok:false — UTC 로 대체하지 않는다', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone') })
    const r = await viewTimezone('ws-1')
    expect(r).toMatchObject({ ok: false, key: 'calendar.timezone' })
  })
})

describe('viewCalendar — 워크스페이스 달력 화면(회의 일정·회의록)의 달력 한 벌(과제 24) — viewTimezone 과 같은 판정', () => {
  it('그 워크스페이스의 근무 요일·주 규칙까지 넘긴다', async () => {
    const mon = { ...cal('Asia/Seoul'), weekStart: [{ day: 'monday', from: null }] }
    m.getWorkspaceConfig.mockResolvedValue({ calendar: mon, calendarError: null })
    const r = await viewCalendar('ws-1')
    expect(r).toMatchObject({ ok: true, calendar: { timezone: 'Asia/Seoul', weekStart: [{ day: 'monday', from: null }] } })
  })
  it('손상은 ok:false(키 포함)', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.week_start') })
    expect(await viewCalendar('ws-1')).toMatchObject({ ok: false, key: 'calendar.week_start' })
  })
})

describe('pickCalendar — 페이지용 결과형(D-21a)', () => {
  it('ok', () => {
    expect(pickCalendar({ calendar: cal('UTC') as never, calendarError: null })).toEqual({ ok: true, calendar: cal('UTC') })
  })
  it('손상 → kind invalid, key 는 calendarError 의 키', () => {
    const r = pickCalendar({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.week_start') })
    expect(r).toMatchObject({ ok: false, kind: 'invalid', key: 'calendar.week_start' })
  })
})
