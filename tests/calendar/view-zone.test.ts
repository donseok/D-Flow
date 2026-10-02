// 전역 화면의 tz(viewTimezone — 세션 유일 워크스페이스, 계획 D-21c)와 페이지용 달력 결과형(pickCalendar — D-21a)
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
import { viewCalendar, viewTimezone } from '@/lib/calendar/viewZone'
import { pickCalendar } from '@/lib/settings/pick'
import { ConfigKeyError } from '@/lib/settings/errors'

const cal = (timezone: string) => ({ timezone, workingDays: new Set([1, 2, 3, 4, 5]), offDates: new Set(), workDates: new Set(), weekStart: [{ day: 'sunday', from: null }] })
const actor = (ids: string[]) => ({ userId: 'u1', workspaceRoles: new Map(ids.map((id) => [id, 'member'])) }) as never
beforeEach(() => vi.clearAllMocks())

describe('viewTimezone — 전역 화면의 tz(D-21c)', () => {
  it('세션 유일 워크스페이스의 tz', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: cal('America/Los_Angeles'), calendarError: null })
    await expect(viewTimezone(actor(['ws-1']))).resolves.toEqual({ ok: true, timeZone: 'America/Los_Angeles', basis: 'member' })
    expect(m.getWorkspaceConfig).toHaveBeenCalledWith('ws-1', undefined)
  })
  it('워크스페이스가 없으면 UTC(제품 기본값) — 조회하지 않는다(여럿인 경우는 member-workspaces-calendar 테스트 — M3)', async () => {
    await expect(viewTimezone(actor([]))).resolves.toEqual({ ok: true, timeZone: 'UTC', basis: 'none' })
    await expect(viewTimezone(null)).resolves.toEqual({ ok: true, timeZone: 'UTC', basis: 'none' })
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
  })
  it('워크스페이스 달력 손상은 ok:false — UTC 로 대체하지 않는다', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone') })
    const r = await viewTimezone(actor(['ws-1']))
    expect(r).toMatchObject({ ok: false, key: 'calendar.timezone' })
  })
})

describe('viewCalendar — 전역 달력 화면(내 회의·회의록)의 달력 한 벌(과제 24) — viewTimezone 과 같은 판정', () => {
  it('세션 유일 워크스페이스의 근무 요일·주 규칙까지 넘긴다', async () => {
    const mon = { ...cal('Asia/Seoul'), weekStart: [{ day: 'monday', from: null }] }
    m.getWorkspaceConfig.mockResolvedValue({ calendar: mon, calendarError: null })
    const r = await viewCalendar(actor(['ws-1']))
    expect(r).toMatchObject({ ok: true, calendar: { timezone: 'Asia/Seoul', weekStart: [{ day: 'monday', from: null }] } })
  })
  it('세션이 없으면 제품 기본값(UTC·일요일) — 조회하지 않는다', async () => {
    const r = await viewCalendar(null)
    expect(r).toMatchObject({ ok: true, calendar: { timezone: 'UTC', weekStart: [{ day: 'sunday', from: null }] } })
    expect(m.getWorkspaceConfig).not.toHaveBeenCalled()
  })
  it('손상은 ok:false(키 포함)', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.week_start') })
    expect(await viewCalendar(actor(['ws-1']))).toMatchObject({ ok: false, key: 'calendar.week_start' })
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
