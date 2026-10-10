import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'

// 내 회의 화면(서버) — 회의 조회 실패를 '회의 0건'으로 넘기지 않는다(M5, 에러 처리 3원칙 ①).
// 사유·재시도는 MyMeetingsView 가 그린다(initialFailed) — 여기서는 페이지가 실패를 넘기는지와, 머리(PageHeader)에 넘기는 props 를 본다.
// 옛 히어로 KPI 자리(그려진 적 없다)는 걷었다 — 머리는 제목·설명뿐이라 실패가 '0'으로 보일 자리가 없다(넘긴 props 전체를 대조한다).
const mocks = vi.hoisted(() => ({
  getMyMeetings: vi.fn(),
  getActorForView: vi.fn(),
  // 셸은 받은 props 를 기록한다 — 머리는 props 로 검사한다.
  ProjectPageShell: vi.fn(({ children }: { hero?: ReactNode; children: ReactNode }) => <>{children}</>),
  MyMeetingsView: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))

vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
// ERR_* 문구는 실제 모듈의 것을 쓴다 — 로더만 바꿔 끼운다.
vi.mock('@/lib/data/meetings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/meetings')>()),
  getMyMeetings: mocks.getMyMeetings,
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView }))
// /w/[slug]/meetings — 첫 await 은 슬러그 판정(E19). 같은 행위자 mock 을 싣는다
vi.mock('@/lib/authz/workspaceScope', () => ({
  loadWorkspaceScope: vi.fn(async () => ({ ws: { id: 'ws-1', slug: 'acme', name: 'Acme' }, actor: await mocks.getActorForView(), degraded: false, role: 'member' })),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1', email: 'alice@example.com' })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async (): Promise<'ko'> => 'ko') }))
// 전역 화면의 '오늘'·첫 열 = viewCalendar(소속 워크스페이스 달력 — SP5 과제 22·24). UTC·일요일로 주고 시스템 시각을 07-19 정오(UTC)로 고정한다(Date 만)
vi.mock('@/lib/calendar/viewZone', async () => {
  const { calUtcSun } = await import('../helpers/calendarFixture')
  return { viewCalendar: async () => ({ ok: true, calendar: calUtcSun }) }
})
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: mocks.ProjectPageShell }))
vi.mock('@/components/meetings/MyMeetingsView', () => ({ MyMeetingsView: mocks.MyMeetingsView }))

import MyMeetingsPage from '@/app/(app)/w/[slug]/meetings/page'
import { ERR_MEETINGS_LOAD } from '@/lib/data/meetings'
import type { Meeting } from '@/lib/domain/types'
import { PageHeader } from '@/components/app/PageHeader'
import { t } from '@/lib/i18n/dict'

const HEADER = { title: t('ko', 'meet.myHeroTitle'), description: t('ko', 'meet.myHeroDesc') }

/** 페이지가 돌려준 트리에서 셸·뷰에 넘긴 props 를 꺼낸다(렌더하지 않고 요소만 본다). */
async function renderPage() {
  const shell = (await MyMeetingsPage({ params: Promise.resolve({ slug: 'acme' }) })) as ReactElement<{
    hero: ReactElement<Record<string, unknown>>
    children: ReactElement<Record<string, unknown>> | unknown
  }>
  expect(shell.props.hero.type).toBe(PageHeader)
  const header = shell.props.hero.props
  const view = ([] as unknown[]).concat(shell.props.children)
    .find((c): c is ReactElement<Record<string, unknown>> => !!c && typeof c === 'object' && 'type' in c && c.type === mocks.MyMeetingsView)
  if (!view) throw new Error('MyMeetingsView 를 찾지 못했다')
  return { header, viewProps: view.props }
}

const todayMeeting: Meeting = {
  id: 'm1', projectId: 'p1', title: '주간 회의', meetingDate: '2026-07-19',
  startTime: '10:00', endTime: '11:00', location: null, category: 'routine', body: '',
  recurrence: 'none', recurrenceUntil: null, createdBy: 'u1', createdByName: 'alice',
  createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', attendeeIds: [],
  projectName: 'Acme', isMine: true,
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-07-19T12:00:00Z')) })
afterEach(() => { vi.useRealTimers() })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActorForView.mockResolvedValue(makeMemberActor('p1'))
})

describe('내 회의 화면 — 회의 조회 실패', () => {
  it('실패를 뷰에 넘기고(initialFailed) 일정은 빈 목록 — 머리에는 수치를 싣지 않는다(제목·설명뿐)', async () => {
    mocks.getMyMeetings.mockResolvedValue({ ok: false, error: ERR_MEETINGS_LOAD })
    const { header, viewProps } = await renderPage()
    expect(viewProps).toMatchObject({ workspaceId: 'ws-1', initialMeetings: [], initialExceptions: [], initialFailed: true })
    expect(mocks.getMyMeetings).toHaveBeenCalledWith('ws-1', expect.any(String), expect.any(String))
    expect(header).toEqual(HEADER)
  })

  it('정상 + 회의 0건은 실패가 아니다 — 머리는 제목·설명 그대로', async () => {
    mocks.getMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [], categories: {} })
    const { header, viewProps } = await renderPage()
    expect(viewProps).toMatchObject({ initialFailed: false })
    expect(header).toEqual(HEADER)
  })

  it('정상은 읽은 회의를 그대로 넘기고 머리는 제목·설명 그대로', async () => {
    mocks.getMyMeetings.mockResolvedValue({ ok: true, meetings: [todayMeeting], exceptions: [] })
    const { header, viewProps } = await renderPage()
    expect(viewProps).toMatchObject({ initialMeetings: [todayMeeting], initialFailed: false })
    expect(header).toEqual(HEADER)
  })
})
