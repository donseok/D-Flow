// 워크스페이스 화면(/w/[slug]/…)의 달력 = 그 슬러그 워크스페이스의 달력(merge 뒤 판정 — a6-fix-brief "rebase 때 반드시 할 것").
// UI-2 가 /meetings·/minutes·/portfolio·/agents·/projects 를 /w/[slug]/… 로 옮겨 화면마다 워크스페이스 하나로 거른다. 소속 워크스페이스들로
// 정하는 옛 판정(다중 소속이면 달력이 다를 때 UTC·일요일)을 그대로 두면 두 워크스페이스 소속자가 /w/A/meetings 에서 A 의 달력 대신
// UTC·일요일 첫 열을 본다 — 그 화면의 달력 출처는 슬러그 워크스페이스 하나다.
import { readFileSync } from 'node:fs'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { calendarOf } from '@/lib/domain/calendar'
import { ConfigKeyError } from '@/lib/settings/errors'
import { makeActor } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-00000000d501', WB = '00000000-0000-0000-7e57-00000000d502'
const CAL = {
  [WA]: calendarOf({ timezone: 'Asia/Seoul', workingDays: [1, 2, 3, 4, 5], weekStart: [{ day: 'monday', from: null }] }),
  [WB]: calendarOf({ timezone: 'America/Los_Angeles', workingDays: [1, 2, 3, 4, 5, 6], weekStart: [{ day: 'sunday', from: null }] }),
} as Record<string, ReturnType<typeof calendarOf>>

const m = vi.hoisted(() => ({
  getWorkspaceConfig: vi.fn(), getMyMeetings: vi.fn(), actor: { current: null as unknown },
  ProjectPageShell: vi.fn(({ children }: { hero?: ReactNode; children: ReactNode }) => <>{children}</>),
  MyMeetingsView: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: m.getWorkspaceConfig }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/data/meetings', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/data/meetings')>()), getMyMeetings: m.getMyMeetings }))
vi.mock('@/lib/authz/workspaceScope', () => ({
  loadWorkspaceScope: vi.fn(async (slug: string) => ({ ws: { id: slug === 'beta' ? WB : WA, slug, name: slug }, actor: m.actor.current, degraded: false, role: 'member' })),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1', email: 'alice@example.com' })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async (): Promise<'ko'> => 'ko') }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: m.ProjectPageShell }))
vi.mock('@/components/meetings/MyMeetingsView', () => ({ MyMeetingsView: m.MyMeetingsView }))

import { viewCalendar, viewTimezone } from '@/lib/calendar/viewZone'
import MyMeetingsPage from '@/app/(app)/w/[slug]/meetings/page'

/** 두 워크스페이스 소속자 — A·B 의 달력이 서로 다르다(옛 판정이면 UTC·일요일로 떨어지는 경우) */
const duo = () => makeActor({ workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]) })

beforeEach(() => {
  vi.clearAllMocks()
  m.actor.current = duo()
  m.getWorkspaceConfig.mockImplementation(async (id: string) => ({ calendar: CAL[id] ?? null, calendarError: CAL[id] ? null : new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone') }))
  m.getMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
  // 2026-10-04(일) 20:00Z = 서울 10-05(월) 05:00 · LA 10-04(일) 13:00 · UTC 10-04(일)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-04T20:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

describe('viewCalendar·viewTimezone — 인자는 화면의 워크스페이스 id(행위자의 소속 목록이 아니다)', () => {
  it('그 워크스페이스의 달력 한 벌만 읽는다 — 다른 소속은 묻지 않는다', async () => {
    expect(await viewCalendar(WA)).toMatchObject({ ok: true, calendar: { timezone: 'Asia/Seoul', weekStart: [{ day: 'monday', from: null }] } })
    expect(await viewTimezone(WB)).toEqual({ ok: true, timeZone: 'America/Los_Angeles' })
    expect(m.getWorkspaceConfig.mock.calls.map((c) => c[0])).toEqual([WA, WB])
  })
  it('그 워크스페이스 달력 손상은 ok:false(키 포함) — UTC·일요일로 대체하지 않는다', async () => {
    m.getWorkspaceConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.week_start') })
    expect(await viewCalendar(WA)).toMatchObject({ ok: false, key: 'calendar.week_start' })
    expect(await viewTimezone(WA)).toMatchObject({ ok: false, key: 'calendar.week_start' })
  })
})

describe('/w/<slug>/meetings — 두 워크스페이스 소속자', () => {
  async function viewProps(slug: string) {
    const shell = (await MyMeetingsPage({ params: Promise.resolve({ slug }) })) as ReactElement<{ children: unknown }>
    const view = ([] as unknown[]).concat(shell.props.children)
      .find((c): c is ReactElement<Record<string, unknown>> => !!c && typeof c === 'object' && 'type' in c && c.type === m.MyMeetingsView)
    if (!view) throw new Error('MyMeetingsView 를 찾지 못했다')
    return view.props as { todayIso: string; calendar: { weekStart: unknown; workingDays: unknown } }   // CalendarView 에는 tz 가 없다 — tz 는 todayIso 로 본다
  }
  it('/w/alpha 는 A 의 달력(서울·월요일 첫 열) — UTC·일요일이 아니다', async () => {
    const p = await viewProps('alpha')
    expect(p.calendar.weekStart).toEqual([{ day: 'monday', from: null }])
    expect(p.todayIso).toBe('2026-10-05')
    expect(m.getWorkspaceConfig.mock.calls.map((c) => c[0])).toEqual([WA])
  })
  it('/w/beta 는 B 의 달력(LA·일요일·토요일 근무)', async () => {
    const p = await viewProps('beta')
    expect(p.calendar.weekStart).toEqual([{ day: 'sunday', from: null }])
    expect([...(p.calendar.workingDays as Iterable<number>)].sort()).toEqual([1, 2, 3, 4, 5, 6])
    expect(p.todayIso).toBe('2026-10-04')
  })
})

describe('워크스페이스 화면 다섯은 슬러그 워크스페이스로 달력을 정하고 기준 시간대 줄(다중 소속 폴백)을 그리지 않는다', () => {
  it.each([
    ['src/app/(app)/w/[slug]/projects/page.tsx', 'viewTimezone(scope.ws.id)'],
    ['src/app/(app)/w/[slug]/portfolio/page.tsx', 'viewTimezone(scope.ws.id)'],
    ['src/app/(app)/w/[slug]/agents/page.tsx', 'viewTimezone(scope.ws.id)'],
    ['src/app/(app)/w/[slug]/meetings/page.tsx', 'viewCalendar(scope.ws.id)'],
    ['src/app/(app)/w/[slug]/minutes/page.tsx', 'viewCalendar(scope.ws.id)'],
  ])('%s', (file, call) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain(call)
    expect(src).not.toMatch(/view(Calendar|Timezone)\(scope\.actor/)   // 소속 목록 판정에 행위자를 넘기지 않는다
    expect(src).not.toContain('ViewBasisNotice')
  })
})
