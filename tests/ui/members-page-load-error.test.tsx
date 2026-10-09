import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeActor, makeAdminActor, WS } from '../fixtures/actor'

// 명단 화면의 조회 실패는 오류 문구로 보인다 — '아직 명단에 사람이 없습니다'(0명)로 위장하지 않는다(에러 처리 3원칙 ①).
const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(),
  getProjectRoster: vi.fn(),
  listRoster: vi.fn(),
  inviteManager: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  loadProjectConfigForPage: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: async () => ({ actor: await mocks.getActorForView(), degraded: false }) }))
// GG1 — 프로젝트 레이아웃·페이지가 명단 밖 비공개 숨김 집합을 읽는다(이 파일은 비공개를 다루지 않는다 — 빈 집합)
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster }))
vi.mock('@/app/actions/roster', () => ({ listRoster: mocks.listRoster, upsertRosterMember: vi.fn(), removeRosterMember: vi.fn() }))
// 초대 허용 도메인 사전 안내(워크스페이스 설정 조회)는 이 파일의 관심사가 아니다 — 안내 없이 그린다
vi.mock('@/lib/data/inviteDomainNotice', () => ({ loadInviteDomainNotice: vi.fn(async () => null) }))
vi.mock('@/app/actions/projectInvites', () => ({ listProjectInvites: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme' }]) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
// 초대 칸의 tz = 프로젝트 달력(SP5 과제 21) — 해석기만 바꿔 끼운다
vi.mock('@/lib/settings/pageConfig', () => ({ loadProjectConfigForPage: mocks.loadProjectConfigForPage }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: async () => [] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/settings/ProjectInviteManager', () => ({ ProjectInviteManager: (p: Record<string, unknown>) => mocks.inviteManager(p) }))

import MembersPage from '@/app/(app)/p/[projectId]/members/page'

async function html() {
  return renderToStaticMarkup((await MembersPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
}

beforeEach(async () => {
  vi.clearAllMocks()
  const { calSeoulMon } = await import('../helpers/calendarFixture')
  mocks.loadProjectConfigForPage.mockResolvedValue({ ok: true, cfg: { calendar: calSeoulMon, calendarError: null } })
})

describe('members 페이지 — 조회 실패 표시', () => {
  it('비관리자: 명단 조회 실패는 오류 문구 — 빈 명단 안내가 아니다', async () => {
    mocks.getActorForView.mockResolvedValue(makeActor({ projectWorkspace: new Map([['p1', WS]]) }))
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    const out = await html()
    expect(out).toContain('명단을 불러오지 못했습니다.')
    expect(out).toContain('role="alert"')
    expect(out).not.toContain('아직 명단에 사람이 없습니다')
    expect(mocks.listRoster).not.toHaveBeenCalled()
  })
  it('비관리자: 정상 0명은 빈 명단 안내', async () => {
    mocks.getActorForView.mockResolvedValue(makeActor({ projectWorkspace: new Map([['p1', WS]]) }))
    mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [] })
    expect(await html()).toContain('아직 명단에 사람이 없습니다')
  })
  it('관리자: listRoster 실패도 오류 문구', async () => {
    mocks.getActorForView.mockResolvedValue(makeAdminActor('p1'))
    mocks.listRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    const out = await html()
    expect(out).toContain('명단을 불러오지 못했습니다.')
    expect(out).not.toContain('아직 명단에 사람이 없습니다')
    expect(mocks.getProjectRoster).not.toHaveBeenCalled()
  })
})

describe('members 페이지 — 초대 칸은 달력과 무관하게 동작(A-4 리뷰 N6)', () => {
  it('정상이면 프로젝트 tz 를 넘긴다', async () => {
    mocks.getActorForView.mockResolvedValue(makeAdminActor('p1'))
    mocks.listRoster.mockResolvedValue({ ok: true, rows: [] })
    await html()
    expect(mocks.inviteManager.mock.calls.at(-1)![0]).toMatchObject({ timeZone: 'Asia/Seoul', timeZoneError: null })
  })
  it('달력이 손상이어도 초대 관리자(발급·취소)를 그리고, 시각 칸만 사유 — tz null', async () => {
    const { ConfigKeyError } = await import('@/lib/settings/errors')
    mocks.getActorForView.mockResolvedValue(makeAdminActor('p1'))
    mocks.listRoster.mockResolvedValue({ ok: true, rows: [] })
    mocks.loadProjectConfigForPage.mockResolvedValue({ ok: true, cfg: { calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone') } })
    await html()
    expect(mocks.inviteManager).toHaveBeenCalled()
    expect(mocks.inviteManager.mock.calls.at(-1)![0]).toMatchObject({ timeZone: null, timeZoneError: expect.stringContaining('calendar.timezone') })
  })
  it('설정 전체를 못 읽어도 초대 관리자는 그린다 — 시각 칸만 사유', async () => {
    mocks.getActorForView.mockResolvedValue(makeAdminActor('p1'))
    mocks.listRoster.mockResolvedValue({ ok: true, rows: [] })
    mocks.loadProjectConfigForPage.mockResolvedValue({ ok: false, error: '설정을 불러오지 못했습니다.' })
    await html()
    expect(mocks.inviteManager.mock.calls.at(-1)![0]).toMatchObject({ timeZone: null, timeZoneError: '설정을 불러오지 못했습니다.' })
  })
})
