import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'

// 내 회의 화면(서버) — 회의 조회 실패를 '회의 0건'·KPI 0 으로 그리지 않는다(M5, 에러 처리 3원칙 ①).
// 사유·재시도는 MyMeetingsView 가 그린다(initialFailed) — 여기서는 페이지가 실패를 넘기고 KPI 를 '—' 로 두는지만 본다.
const mocks = vi.hoisted(() => ({
  getMyMeetings: vi.fn(),
  getActorForView: vi.fn(),
  // 셸은 받은 props 를 기록한다 — 히어로 KPI 는 props 로 검사한다.
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
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ id: 'u1', email: 'alice@example.com' })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async (): Promise<'ko' | 'en'> => 'ko') }))
vi.mock('@/lib/domain/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/domain/dates')>()),
  seoulToday: () => '2026-07-19',
}))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: mocks.ProjectPageShell }))
vi.mock('@/components/meetings/MyMeetingsView', () => ({ MyMeetingsView: mocks.MyMeetingsView }))

import MyMeetingsPage from '@/app/(app)/meetings/page'
import { ERR_MEETINGS_LOAD } from '@/lib/data/meetings'
import type { Meeting } from '@/lib/domain/types'

/** 페이지가 돌려준 트리에서 셸·뷰에 넘긴 props 를 꺼낸다(렌더하지 않고 요소만 본다). */
async function renderPage() {
  const shell = (await MyMeetingsPage()) as ReactElement<{
    hero: ReactElement<{ heroKpis: ReactElement<{ children: ReactElement<{ value: unknown }>[] }> }>
    children: ReactElement<Record<string, unknown>> | unknown
  }>
  const kpis = shell.props.hero.props.heroKpis.props.children.map(k => k.props.value)
  const view = ([] as unknown[]).concat(shell.props.children)
    .find((c): c is ReactElement<Record<string, unknown>> => !!c && typeof c === 'object' && 'type' in c && c.type === mocks.MyMeetingsView)
  if (!view) throw new Error('MyMeetingsView 를 찾지 못했다')
  return { kpis, viewProps: view.props }
}

const todayMeeting: Meeting = {
  id: 'm1', projectId: 'p1', title: '주간 회의', meetingDate: '2026-07-19',
  startTime: '10:00', endTime: '11:00', location: null, category: 'routine', body: '',
  recurrence: 'none', recurrenceUntil: null, createdBy: 'u1', createdByName: 'alice',
  createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z', attendeeIds: [],
  projectName: 'Acme', isMine: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActorForView.mockResolvedValue(makeMemberActor('p1'))
})

describe('내 회의 화면 — 회의 조회 실패', () => {
  it('실패를 뷰에 넘기고(initialFailed) 일정은 빈 목록, KPI 는 0 이 아니라 —', async () => {
    mocks.getMyMeetings.mockResolvedValue({ ok: false, error: ERR_MEETINGS_LOAD })
    const { kpis, viewProps } = await renderPage()
    expect(viewProps).toMatchObject({ initialMeetings: [], initialExceptions: [], initialFailed: true })
    expect(kpis).toEqual(['—', '—', '—'])
  })

  it('정상 + 회의 0건은 실패가 아니다 — KPI 는 숫자 0', async () => {
    mocks.getMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
    const { kpis, viewProps } = await renderPage()
    expect(viewProps).toMatchObject({ initialFailed: false })
    expect(kpis).toEqual([0, 0, 0])
  })

  it('정상은 읽은 회의를 그대로 넘기고 KPI 를 센다', async () => {
    mocks.getMyMeetings.mockResolvedValue({ ok: true, meetings: [todayMeeting], exceptions: [] })
    const { kpis, viewProps } = await renderPage()
    expect(viewProps).toMatchObject({ initialMeetings: [todayMeeting], initialFailed: false })
    expect(kpis[0]).toBe(1)
    expect(kpis[2]).toBe(1)
  })
})
