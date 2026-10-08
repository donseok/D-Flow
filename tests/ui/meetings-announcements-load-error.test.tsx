import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'

// 회의·공지 화면 — 목록 조회 실패를 '회의 0건'·'공지 없음'으로 그리지 않는다(에러 처리 3원칙 ①).
// 사유(LoadErrorNotice)를 보인다. 페이지 머리(PageHeader)는 제목·설명뿐이다 — 옛 히어로 KPI 자리(그려진 적 없다)를 걷어
// 실패가 '0'으로 보일 자리가 머리에 없다(넘긴 props 전체를 대조한다).
const PID = 'p1'
const mocks = vi.hoisted(() => ({
  getProjectMeetingData: vi.fn(),
  getAnnouncements: vi.fn(),
  getActorForView: vi.fn(),
  getServerLocale: vi.fn(async (): Promise<'ko' | 'en'> => 'ko'),
  // 셸은 받은 props 를 기록하고 pinned·본문만 그린다 — 머리는 props 로 검사한다.
  ProjectPageShell: vi.fn(({ pinned, children }: { pinned?: ReactNode; children: ReactNode }) => <>{pinned}{children}</>),
  MeetingsView: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  AnnouncementsView: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))

// ERR_* 문구는 실제 모듈의 것을 쓴다 — 로더만 바꿔 끼운다.
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/data/meetings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/meetings')>()),
  getProjectMeetingData: mocks.getProjectMeetingData,
}))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/data/announcements', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/data/announcements')>()),
  getAnnouncements: mocks.getAnnouncements,
  getAnnouncementSeenAt: vi.fn(async () => null),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: mocks.getActorForView, getActorViewState: async () => ({ actor: await mocks.getActorForView(), degraded: false }) }))
// GG1 — 프로젝트 페이지 관문(requireModulePage)이 화면 숨김을 다시 판정한다(getActorViewState + 비공개 숨김 집합). 이 파일은 비공개를 다루지 않는다 — 빈 집합
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => null) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: PID, name: 'Acme' }]) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: mocks.getServerLocale }))
vi.mock('@/lib/settings/pageConfig', async () => {
  const { calSeoulMon } = await import('../helpers/calendarFixture')
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  // 회의 범주(B4)는 기본 어휘 — 달력은 이 파일의 고정 값
  return { loadProjectConfigForPage: vi.fn(async () => ({ ok: true, cfg: { ...makeProjectConfig(), calendar: calSeoulMon, calendarError: null, holidays: [] } })) }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: mocks.ProjectPageShell }))
vi.mock('@/components/meetings/MeetingsView', () => ({ MeetingsView: mocks.MeetingsView }))
vi.mock('@/components/announcements/AnnouncementsView', () => ({ AnnouncementsView: mocks.AnnouncementsView }))

import MeetingsPage from '@/app/(app)/p/[projectId]/meetings/page'
import AnnouncementsPage from '@/app/(app)/p/[projectId]/announcements/page'
import { ERR_MEETINGS_LOAD } from '@/lib/data/meetings'
import { ERR_ANNOUNCEMENTS_LOAD } from '@/lib/data/announcements'
import { registerEn, t } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import { PageHeader } from '@/components/app/PageHeader'

registerEn(EN)

const params = Promise.resolve({ projectId: PID })
/** 셸에 넘긴 머리(PageHeader)의 props 전체 — 제목·설명 말고는 없어야 한다(조회 결과에서 나온 수치가 실리지 않는다). */
const headerProps = () => {
  const shell = mocks.ProjectPageShell.mock.calls.at(-1)![0] as unknown as { hero: ReactElement<Record<string, unknown>> }
  expect(shell.hero.type).toBe(PageHeader)
  return shell.hero.props
}
const MEET_HEADER = { title: `Acme ${t('ko', 'meet.heroTitleSuffix')}`, description: t('ko', 'meet.heroDesc') }
const ANN_HEADER = { title: `Acme ${t('ko', 'ann.heroTitleSuffix')}`, description: t('ko', 'ann.heroDesc') }

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getActorForView.mockResolvedValue(makeMemberActor(PID))
})
afterEach(() => errSpy.mockRestore())

describe('회의 화면 — 회의 조회 실패', () => {
  it('사유를 고정 머리에 보이고, 일정은 빈 목록으로 그리되 머리에 수치를 싣지 않는다', async () => {
    mocks.getProjectMeetingData.mockResolvedValue({ ok: false, error: ERR_MEETINGS_LOAD })
    const html = renderToStaticMarkup((await MeetingsPage({ params })) as ReactElement)
    expect(html).toContain('role="alert"')
    expect(html).toContain(t('ko', 'common.loadFailed.meetings'))
    expect(mocks.MeetingsView.mock.calls.at(-1)![0]).toMatchObject({ meetings: [], exceptions: [], loadFailed: true })
    expect(headerProps()).toEqual(MEET_HEADER)
  })

  it('영어 화면이면 사유는 영어 사전 문구 — 로더의 한국어 ERR_MEETINGS_LOAD 가 새지 않는다', async () => {
    mocks.getServerLocale.mockResolvedValueOnce('en')
    mocks.getProjectMeetingData.mockResolvedValue({ ok: false, error: ERR_MEETINGS_LOAD })
    const html = renderToStaticMarkup((await MeetingsPage({ params })) as ReactElement)
    expect(html).toContain(t('en', 'common.loadFailed.meetings'))
    expect(html).not.toContain(ERR_MEETINGS_LOAD)
  })

  it('정상은 사유 없이 회의를 넘기고 머리는 제목·설명 그대로', async () => {
    mocks.getProjectMeetingData.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
    const html = renderToStaticMarkup((await MeetingsPage({ params })) as ReactElement)
    expect(html).not.toContain('role="alert"')
    expect(mocks.MeetingsView.mock.calls.at(-1)![0]).toMatchObject({ loadFailed: false })
    expect(headerProps()).toEqual(MEET_HEADER)
  })
})

describe('공지 화면 — 공지 조회 실패', () => {
  it('목록 자리에 사유를 보이고(공지 없음 빈 상태를 그리지 않는다) 머리에 수치를 싣지 않는다', async () => {
    mocks.getAnnouncements.mockResolvedValue({ ok: false, error: ERR_ANNOUNCEMENTS_LOAD })
    const html = renderToStaticMarkup((await AnnouncementsPage({ params })) as ReactElement)
    expect(html).toContain('role="alert"')
    expect(html).toContain(t('ko', 'common.loadFailed.announcements'))
    expect(mocks.AnnouncementsView).not.toHaveBeenCalled()
    expect(headerProps()).toEqual(ANN_HEADER)
  })

  it('영어 화면이면 사유는 영어 사전 문구 — 로더의 한국어 ERR_ANNOUNCEMENTS_LOAD 가 새지 않는다', async () => {
    mocks.getServerLocale.mockResolvedValueOnce('en')
    mocks.getAnnouncements.mockResolvedValue({ ok: false, error: ERR_ANNOUNCEMENTS_LOAD })
    const html = renderToStaticMarkup((await AnnouncementsPage({ params })) as ReactElement)
    expect(html).toContain(t('en', 'common.loadFailed.announcements'))
    expect(html).not.toContain(ERR_ANNOUNCEMENTS_LOAD)
  })

  it('정상은 사유 없이 공지를 넘기고 머리는 제목·설명 그대로', async () => {
    mocks.getAnnouncements.mockResolvedValue({ ok: true, rows: [] })
    const html = renderToStaticMarkup((await AnnouncementsPage({ params })) as ReactElement)
    expect(html).not.toContain('role="alert"')
    expect(mocks.AnnouncementsView.mock.calls.at(-1)![0]).toMatchObject({ announcements: [] })
    expect(headerProps()).toEqual(ANN_HEADER)
  })
})
