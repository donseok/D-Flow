import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeActor, makeAdminActor, WS } from '../fixtures/actor'

// 명단 화면의 조회 실패는 오류 문구로 보인다 — '아직 명단에 사람이 없습니다'(0명)로 위장하지 않는다(에러 처리 3원칙 ①).
const mocks = vi.hoisted(() => ({
  getActorForView: vi.fn(),
  getProjectRoster: vi.fn(),
  listRoster: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: async () => ({ actor: await mocks.getActorForView(), degraded: false }) }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster }))
vi.mock('@/app/actions/roster', () => ({ listRoster: mocks.listRoster, upsertRosterMember: vi.fn(), removeRosterMember: vi.fn() }))
vi.mock('@/app/actions/projectInvites', () => ({ listProjectInvites: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme' }]) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('@/lib/teams/master', () => ({ teamsForProjectSync: () => [] }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/settings/ProjectInviteManager', () => ({ ProjectInviteManager: () => null }))

import MembersPage from '@/app/(app)/p/[projectId]/members/page'

async function html() {
  return renderToStaticMarkup((await MembersPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
}

beforeEach(() => vi.clearAllMocks())

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
