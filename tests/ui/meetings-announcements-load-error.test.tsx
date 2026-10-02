import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeMemberActor } from '../fixtures/actor'

// 회의·공지 화면 — 목록 조회 실패를 '회의 0건'·'공지 없음'으로 그리지 않는다(에러 처리 3원칙 ①).
// 사유(LoadErrorNotice)를 보이고 KPI 는 숫자 대신 '—'.
const PID = 'p1'
const mocks = vi.hoisted(() => ({
  getProjectMeetingData: vi.fn(),
  getAnnouncements: vi.fn(),
  getActorForView: vi.fn(),
  getServerLocale: vi.fn(async (): Promise<'ko' | 'en'> => 'ko'),
  // 셸은 받은 props 를 기록하고 pinned·본문만 그린다 — 히어로 KPI 는 props 로 검사한다.
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

registerEn(EN)

const params = Promise.resolve({ projectId: PID })
/** 셸에 넘긴 히어로의 KPI 카드 값들. */
const kpiValues = () => {
  const hero = mocks.ProjectPageShell.mock.calls.at(-1)![0] as unknown as { hero: ReactElement<{ heroKpis: ReactElement<{ children: ReactElement<{ value: unknown }>[] }> }> }
  return hero.hero.props.heroKpis.props.children.map(k => k.props.value)
}

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getActorForView.mockResolvedValue(makeMemberActor(PID))
})
afterEach(() => errSpy.mockRestore())

describe('회의 화면 — 회의 조회 실패', () => {
  it('사유를 고정 머리에 보이고, 일정은 빈 목록으로 그리되 KPI 는 —', async () => {
    mocks.getProjectMeetingData.mockResolvedValue({ ok: false, error: ERR_MEETINGS_LOAD })
    const html = renderToStaticMarkup((await MeetingsPage({ params })) as ReactElement)
    expect(html).toContain('role="alert"')
    expect(html).toContain(t('ko', 'common.loadFailed.meetings'))
    expect(mocks.MeetingsView.mock.calls.at(-1)![0]).toMatchObject({ meetings: [], exceptions: [], loadFailed: true })
    expect(kpiValues()).toEqual(['—', '—', '—'])
  })

  it('영어 화면이면 사유는 영어 사전 문구 — 로더의 한국어 ERR_MEETINGS_LOAD 가 새지 않는다', async () => {
    mocks.getServerLocale.mockResolvedValueOnce('en')
    mocks.getProjectMeetingData.mockResolvedValue({ ok: false, error: ERR_MEETINGS_LOAD })
    const html = renderToStaticMarkup((await MeetingsPage({ params })) as ReactElement)
    expect(html).toContain(t('en', 'common.loadFailed.meetings'))
    expect(html).not.toContain(ERR_MEETINGS_LOAD)
  })

  it('정상은 사유 없이 회의를 넘기고 KPI 는 숫자', async () => {
    mocks.getProjectMeetingData.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
    const html = renderToStaticMarkup((await MeetingsPage({ params })) as ReactElement)
    expect(html).not.toContain('role="alert"')
    expect(mocks.MeetingsView.mock.calls.at(-1)![0]).toMatchObject({ loadFailed: false })
    expect(kpiValues()).toEqual([0, 0, 0])
  })
})

describe('공지 화면 — 공지 조회 실패', () => {
  it('목록 자리에 사유를 보이고(공지 없음 빈 상태를 그리지 않는다) KPI 는 —', async () => {
    mocks.getAnnouncements.mockResolvedValue({ ok: false, error: ERR_ANNOUNCEMENTS_LOAD })
    const html = renderToStaticMarkup((await AnnouncementsPage({ params })) as ReactElement)
    expect(html).toContain('role="alert"')
    expect(html).toContain(t('ko', 'common.loadFailed.announcements'))
    expect(mocks.AnnouncementsView).not.toHaveBeenCalled()
    expect(kpiValues()).toEqual(['—', '—', '—'])
  })

  it('영어 화면이면 사유는 영어 사전 문구 — 로더의 한국어 ERR_ANNOUNCEMENTS_LOAD 가 새지 않는다', async () => {
    mocks.getServerLocale.mockResolvedValueOnce('en')
    mocks.getAnnouncements.mockResolvedValue({ ok: false, error: ERR_ANNOUNCEMENTS_LOAD })
    const html = renderToStaticMarkup((await AnnouncementsPage({ params })) as ReactElement)
    expect(html).toContain(t('en', 'common.loadFailed.announcements'))
    expect(html).not.toContain(ERR_ANNOUNCEMENTS_LOAD)
  })

  it('정상은 사유 없이 공지를 넘기고 KPI 는 숫자', async () => {
    mocks.getAnnouncements.mockResolvedValue({ ok: true, rows: [] })
    const html = renderToStaticMarkup((await AnnouncementsPage({ params })) as ReactElement)
    expect(html).not.toContain('role="alert"')
    expect(mocks.AnnouncementsView.mock.calls.at(-1)![0]).toMatchObject({ announcements: [] })
    expect(kpiValues()).toEqual([0, 0, 0])
  })
})
