// 달력 로더(SP5 A 과제 13 — 스펙 D11·D36·§4.1) — holidays 를 끝까지(키셋) kind 와 함께 읽고, 세 키로 WorkCalendar 를 만든다.
// 손상 키는 그 기능만 멈춘다(calendar=null + calendarError) — 기본값으로 잇지 않는다([RF4]).
import { describe, expect, it, vi } from 'vitest'
import { keysetTable } from '../helpers/keysetTable'
import {
  calendarOrError, loadProjectHolidays, projectCalendarOf, projectTimezone, requireCalendar, toCalendarInput, workspaceCalendarOf,
} from '@/lib/calendar/load'
import { calendarOf, isWorkingDay } from '@/lib/domain/calendar'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import { PROJECT_SETTINGS, WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'
import type { ProjectConfig } from '@/lib/settings/projectConfig'
import type { WorkspaceConfig } from '@/lib/settings/workspaceConfig'

const PID = '00000000-0000-0000-7e57-0000000019a0'
const pKeys = (values: Record<string, unknown>) =>
  resolveKeys({ scope: 'project', id: PID, values, defs: PROJECT_SETTINGS }).keys as ProjectConfig['keys']
const wKeys = (values: Record<string, unknown>) =>
  resolveKeys({ scope: 'workspace', id: 'ws', values, defs: WORKSPACE_SETTINGS }).keys as WorkspaceConfig['keys']
const client = (t: ReturnType<typeof keysetTable>) => ({ from: (name: string) => {
  if (name !== 'holidays') throw new Error(`예상 밖 표 ${name}`)
  return t.make()
} }) as never

describe('loadProjectHolidays', () => {
  it('date 키셋으로 끝까지 읽고 kind 를 싣는다 — 한 응답이 잘려도 다음 쪽을 이어 읽는다', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      project_id: PID, date: `2026-10-0${i + 1}`, name: i === 2 ? '창립일' : null, kind: i === 3 ? 'work' : 'off',
    }))
    const t = keysetTable(rows, { maxRows: 2 })
    const got = await loadProjectHolidays(client(t), PID)
    expect(got.map(h => [h.date, h.kind])).toEqual([
      ['2026-10-01', 'off'], ['2026-10-02', 'off'], ['2026-10-03', 'off'], ['2026-10-04', 'work'], ['2026-10-05', 'off'],
    ])
    expect(got[2].name).toBe('창립일')
    expect(got[0].name).toBe('')                               // null 이름은 빈 문자열(표시용)
    expect(t.log[0]).toEqual(expect.arrayContaining([
      { method: 'select', args: ['date, name, kind', { count: 'exact' }] },
      { method: 'eq', args: ['project_id', PID] },
      { method: 'order', args: ['date'] },
    ]))
    expect(t.log[1]).toEqual(expect.arrayContaining([{ method: 'gt', args: ['date', '2026-10-02'] }]))
  })

  it('조회 오류는 ConfigUnavailableError — "휴일 없음"으로 위장하지 않는다', async () => {
    const t = keysetTable([], { error: { message: 'permission denied' } })
    await expect(loadProjectHolidays(client(t), PID)).rejects.toBeInstanceOf(ConfigUnavailableError)
  })

  it('kind 가 off·work 밖이면 ConfigUnavailableError(DB check 가 막지만 방어)', async () => {
    const t = keysetTable([{ project_id: PID, date: '2026-10-01', name: null, kind: 'maybe' }])
    await expect(loadProjectHolidays(client(t), PID)).rejects.toBeInstanceOf(ConfigUnavailableError)
  })
})

describe('projectCalendarOf / workspaceCalendarOf', () => {
  it('timezone-only 소비처는 다른 달력 키가 손상돼도 timezone 을 읽는다', () => {
    const keys = pKeys({ 'calendar.timezone': 'Asia/Seoul', 'calendar.week_start': 'broken', 'calendar.working_days': [] })
    expect(projectTimezone({ keys })).toBe('Asia/Seoul')
    expect(() => projectCalendarOf(keys, [])).toThrow(ConfigKeyError)
  })

  it('timezone-only 소비처도 손상 timezone 은 정확한 ConfigKeyError 로 거부하고, 누락은 UTC 기본값을 쓴다', () => {
    const invalid = pKeys({ 'calendar.timezone': 'Asia/Seol' })
    expect(() => projectTimezone({ keys: invalid })).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID', key: 'calendar.timezone' }))
    expect(projectTimezone({ keys: pKeys({}) })).toBe('UTC')
  })

  it('키 없음 = 제품 기본값(UTC·월~금·일요일), off 는 휴무·work 는 근무', () => {
    const cal = projectCalendarOf(pKeys({}), [
      { date: '2026-10-05', name: '휴무', kind: 'off' },        // 월
      { date: '2026-10-10', name: '', kind: 'work' },           // 토
    ])
    expect(cal.timezone).toBe('UTC')
    expect([...cal.workingDays].sort()).toEqual([1, 2, 3, 4, 5])
    expect(cal.weekStart).toEqual([{ day: 'sunday', from: null }])
    expect(isWorkingDay('2026-10-05', cal)).toBe(false)
    expect(isWorkingDay('2026-10-10', cal)).toBe(true)
    expect(isWorkingDay('2026-10-11', cal)).toBe(false)          // 일
  })

  it('저장값을 그대로 쓴다 — tz·근무 요일·전환 규칙', () => {
    const rules = [{ day: 'monday', from: null }, { day: 'sunday', from: '2026-10-11' }]
    const cal = projectCalendarOf(pKeys({ 'calendar.timezone': 'Asia/Seoul', 'calendar.working_days': [7, 1, 2, 3, 4], 'calendar.week_start': rules }), [])
    expect(cal.timezone).toBe('Asia/Seoul')
    expect([...cal.workingDays].sort()).toEqual([1, 2, 3, 4, 7])
    expect(cal.weekStart).toEqual(rules)
  })

  it('[RF4] 손상 tz 는 ConfigKeyError(CONFIG_INVALID, calendar.timezone) — UTC 로 잇지 않는다', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const keys = pKeys({ 'calendar.timezone': 'Asia/Seol' })
    err.mockRestore()
    expect(keys['calendar.timezone'].status).toBe('invalid')
    let caught: unknown
    try { projectCalendarOf(keys, []) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(ConfigKeyError)
    expect(caught).toMatchObject({ code: 'CONFIG_INVALID', key: 'calendar.timezone' })
  })

  it('워크스페이스 요일은 규칙 하나로 승격되고 날짜 예외는 비어 있다', () => {
    const cal = workspaceCalendarOf(wKeys({ 'calendar.week_start': 'monday', 'calendar.timezone': 'Europe/Berlin' }))
    expect(cal.weekStart).toEqual([{ day: 'monday', from: null }])
    expect(cal.timezone).toBe('Europe/Berlin')
    expect(cal.offDates.size).toBe(0)
    expect(cal.workDates.size).toBe(0)
  })
})

describe('calendarOrError / requireCalendar', () => {
  it('[RF4] 손상이면 calendar=null·calendarError 를 싣고, requireCalendar 가 그 오류를 던진다', () => {
    const boom = new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone')
    const r = calendarOrError(() => { throw boom })
    expect(r).toEqual({ calendar: null, calendarError: boom })
    expect(() => requireCalendar(r)).toThrow(boom)
  })
  it('ConfigKeyError 가 아닌 예외는 잡지 않는다(결함을 설정 오류로 가리지 않는다)', () => {
    expect(() => calendarOrError(() => { throw new TypeError('bug') })).toThrow(TypeError)
  })
  it('정상이면 그 달력', () => {
    const cal = calendarOf({ timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'sunday', from: null }] })
    expect(requireCalendar(calendarOrError(() => cal))).toBe(cal)
  })
})

describe('toCalendarInput', () => {
  it('Set 을 배열로 — calendarOf 로 되살리면 같은 판정', () => {
    const cal = calendarOf({
      timezone: 'Asia/Seoul', workingDays: [1, 2, 3, 4, 5, 6], weekStart: [{ day: 'monday', from: null }],
      holidays: [{ date: '2026-10-05', kind: 'off' }, { date: '2026-10-11', kind: 'work' }],
    })
    const input = toCalendarInput(cal)
    expect(JSON.parse(JSON.stringify(input))).toEqual(input)          // 직렬화 가능(Set·Map 없음)
    const back = calendarOf(input)
    for (const d of ['2026-10-05', '2026-10-10', '2026-10-11', '2026-10-12']) expect(isWorkingDay(d, back), d).toBe(isWorkingDay(d, cal))
    expect(back.weekStart).toEqual(cal.weekStart)
  })
})
