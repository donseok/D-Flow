// @vitest-environment jsdom
// 달력 다섯(근태·회의 달력 — 프로젝트 회의·내 회의가 렌더·회의록 달력)의 첫 열 = 현재 규칙의 시작 요일(W17), 쉬는 날 = 근무 요일 + holidays(개정 §5.12.5 ②),
// 비근무 요일 색은 토큰 하나(bg-weekend), 한국 특일 오버레이 0(사용자 결정 5). 회의 뷰 둘은 그리드 범위가 같은 규칙인지(봇 문맥의 range)로 본다.
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Minute } from '@/lib/domain/types'
import type { CalendarView } from '@/lib/domain/attendance'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ botCtx: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/providers/LocaleProvider', () => ({ useLocale: () => ({ locale: 'ko', t: (k: string) => k }) }))
vi.mock('@/components/chat/BotPageContextProvider', () => ({ useBotPageContext: mocks.botCtx }))
vi.mock('@/app/actions/attendance', () => ({ upsertAttendance: vi.fn(async () => ({ ok: true })), removeAttendance: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/app/actions/meetings', () => ({
  fetchMyMeetings: vi.fn(async () => ({ ok: true, meetings: [], exceptions: [] })),
  fetchMeetingDetail: vi.fn(async () => null),
  cancelOccurrence: vi.fn(async () => ({ ok: true })),
  deleteMeeting: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/app/actions/minutes', () => ({ fetchMeetingMinutesLite: vi.fn(async () => []) }))
vi.mock('@/app/actions/announcements', () => ({ createAnnouncementFromMeeting: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/components/meetings/MeetingFormModal', () => ({ MeetingFormModal: () => null }))
vi.mock('@/components/meetings/MeetingDetailModal', () => ({ MeetingDetailModal: () => null }))

import { AttendanceView } from '@/components/attendance/AttendanceView'
import { MeetingCalendar } from '@/components/meetings/MeetingCalendar'
import { MinutesCalendar } from '@/components/minutes/MinutesCalendar'
import { monthGridRange } from '@/lib/domain/attendance'
import { withTeams } from '../fixtures/teams'
import { HOLIDAY_NAMES, MONDAY_CAL, SUNDAY_CAL, WORKSPACE_CAL } from '../fixtures/calendarView'

let container: HTMLDivElement
let root: Root
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); mocks.botCtx.mockReset() })
afterEach(() => { act(() => root.unmount()); container.remove() })

const TODAY = '2026-10-07'   // 수 — 2026-10 달력
async function render(ui: ReactElement) { await act(async () => { root.render(ui) }) }
/** 머리 일곱 칸의 사전 키(t 가 키를 그대로 돌려준다) */
const headers = () => [...container.querySelectorAll('[data-cal-head]')].map(el => el.textContent)
/** 날짜 칸 — data-date 순서가 그리드 순서다 */
const cells = () => [...container.querySelectorAll<HTMLElement>('[data-date]')]
const cell = (date: string) => container.querySelector<HTMLElement>(`[data-date="${date}"]`)!

type MakeCalendar = (cal: CalendarView, names?: Readonly<Record<string, string>>) => ReactElement
const CALENDARS: Record<'attendance' | 'meeting' | 'minutes', MakeCalendar> = {
  attendance: (cal, names) => withTeams(
    <AttendanceView projectId="p1" records={[]} members={[]} initialDate={TODAY} canEdit={false} calendar={cal} holidayNames={names} />),
  meeting: (cal, names) =>
    <MeetingCalendar year={2026} month0={9} todayIso={TODAY} occurrences={[]} onSelectOccurrence={() => {}} calendar={cal} holidayNames={names} />,
  minutes: (cal) =>   // 회의록은 워크스페이스 화면 — 휴무 이름이 없다
    <MinutesCalendar year={2026} month0={9} todayIso={TODAY} minutes={[] as Minute[]} onSelectDate={() => {}} selectedDate={null} calendar={cal} />,
}

describe.each(Object.entries(CALENDARS))('%s 달력', (_name, make) => {
  it('일요일 규칙 — 머리·첫 칸이 일요일', async () => {
    await render(make(SUNDAY_CAL))
    expect(headers()).toEqual(['att.weekday.sun', 'att.weekday.mon', 'att.weekday.tue', 'att.weekday.wed', 'att.weekday.thu', 'att.weekday.fri', 'att.weekday.sat'])
    expect(cells()[0].dataset.date).toBe('2026-09-27')
  })

  it('월요일 규칙 — 머리·첫 칸이 월요일(W17)', async () => {
    await render(make(MONDAY_CAL))
    expect(headers()[0]).toBe('att.weekday.mon')
    expect(headers()[6]).toBe('att.weekday.sun')
    expect(cells()[0].dataset.date).toBe('2026-09-28')
  })

  it('비근무 요일·휴무 예외만 bg-weekend, 근무 예외 토요일·한국 특일(10-09 금)은 아니다', async () => {
    await render(make(MONDAY_CAL, HOLIDAY_NAMES))
    expect(cell('2026-10-11').className).toContain('bg-weekend')      // 일
    expect(cell('2026-10-05').className).toContain('bg-weekend')      // 휴무 예외(월)
    expect(cell('2026-10-10').className).not.toContain('bg-weekend')  // 근무 예외(토)
    expect(cell('2026-10-09').className).not.toContain('bg-weekend')  // 금 — 오버레이 0
    expect(cell('2026-10-06').className).not.toContain('bg-weekend')  // 화
  })

  it('요일 고정 색(text-delayed·text-progress)을 날짜 숫자에 쓰지 않는다', async () => {
    await render(make(SUNDAY_CAL, HOLIDAY_NAMES))
    for (const d of ['2026-10-11', '2026-10-10', '2026-10-05']) {
      expect(cell(d).innerHTML).not.toMatch(/text-delayed|text-progress/)
    }
  })

  it('쉬는 날은 색 말고도 단서가 있다 — 이름 없는 쉬는 날은 작은 표지(att.restMark)와 sr-only 문구, 이름 있는 휴무는 sr-only 문구(A-5 리뷰 O4)', async () => {
    await render(make(MONDAY_CAL, HOLIDAY_NAMES))
    const sun = cell('2026-10-11')
    expect(sun.querySelector('[data-rest-mark]')?.textContent).toContain('att.restMark')
    expect(sun.querySelector('.sr-only')?.textContent).toBe('att.restDay')
    expect(sun.querySelector('[data-rest-mark] [aria-hidden="true"]')?.textContent).toBe('att.restMark')
    for (const d of ['2026-10-06', '2026-10-10', '2026-10-09']) {   // 근무일·근무 예외 토요일·금(오버레이 0)
      expect(cell(d).textContent, d).not.toContain('att.restDay')
      expect(cell(d).textContent, d).not.toContain('att.restMark')
    }
  })

  it('머리 줄은 배경으로 비근무 요일을 가르지 않고(라이트 1.01:1 — 보이지 않는 장식) 글자 굵기·색으로 가른다(A-5 리뷰 O9)', async () => {
    await render(make(MONDAY_CAL))
    const heads = [...container.querySelectorAll<HTMLElement>('[data-cal-head]')]
    for (const h of heads) expect(h.className).not.toContain('bg-weekend')
    const sat = heads[5]
    const tue = heads[1]
    expect(sat.dataset.working).toBe('false')
    expect(tue.dataset.working).toBe('true')
    expect(sat.className).toContain('font-normal')
    expect(tue.className).toContain('font-semibold')
  })

  it('워크스페이스 달력(요일만, 일~목 근무) — 금·토가 비근무, 일요일은 근무', async () => {
    await render(make(WORKSPACE_CAL))
    expect(cell('2026-10-09').className).toContain('bg-weekend')       // 금
    expect(cell('2026-10-10').className).toContain('bg-weekend')       // 토
    expect(cell('2026-10-11').className).not.toContain('bg-weekend')   // 일
  })
})

describe('휴무 이름 — 프로젝트 holidays.name 만(특일 사전 0)', () => {
  it('근태·회의 달력은 휴무 이름을 칸에 보인다 — 이름이 있으면 작은 표지는 없고 sr-only 문구만', async () => {
    for (const make of [CALENDARS.attendance, CALENDARS.meeting]) {
      await render(make(MONDAY_CAL, HOLIDAY_NAMES))
      expect(cell('2026-10-05').textContent).toContain('창립기념일')
      expect(cell('2026-10-05').querySelector('[data-rest-mark]')).toBeNull()
      expect(cell('2026-10-05').querySelector('.sr-only')?.textContent).toBe('att.restDay')
      expect(container.textContent).not.toMatch(/hol\./)
    }
  })
})

describe('회의 뷰 둘 — 그리드 범위가 같은 규칙(사본 gridRange 삭제)', () => {
  it('MeetingsView — 월요일 규칙이면 봇 문맥 범위가 monthGridRange(…, monday)', async () => {
    const { MeetingsView } = await import('@/components/meetings/MeetingsView')
    await render(<MeetingsView projectId="p1" meetings={[]} exceptions={[]} members={[]} todayIso={TODAY}
      currentUserId="u1" canManage={false} canEdit calendar={MONDAY_CAL} />)
    const [from, to] = monthGridRange(2026, 9, 'monday')
    expect(mocks.botCtx).toHaveBeenLastCalledWith(expect.objectContaining({ range: { from, to } }))
  })

  it('MyMeetingsView — 일요일 규칙이면 범위가 monthGridRange(…, sunday)', async () => {
    const { MyMeetingsView } = await import('@/components/meetings/MyMeetingsView')
    await render(<MyMeetingsView workspaceId="ws-1" initialMeetings={[]} initialExceptions={[]} todayIso={TODAY} currentUserId="u1" calendar={SUNDAY_CAL} />)
    const [from, to] = monthGridRange(2026, 9, 'sunday')
    expect(mocks.botCtx).toHaveBeenLastCalledWith(expect.objectContaining({ range: { from, to } }))
  })
})
