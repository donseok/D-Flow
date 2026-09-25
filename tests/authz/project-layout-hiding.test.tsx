import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeActor, makeMemberActor, makeSuperuser, WS } from '../fixtures/actor'

// 스펙 §3.2 — /p/[projectId] 레이아웃은 roleIn(actor, projectId) === null(타 워크스페이스·미존재)이면 404.
// 권한 조회 실패(degraded)는 404 가 아니다 — 장애를 '없는 프로젝트'로 위장하지 않고 기존 열화 표시를 유지한다.
const mocks = vi.hoisted(() => ({
  getActorViewState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: mocks.getActorViewState }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/lib/teams/master', () => ({ teamsForProjectSync: () => [] }))
vi.mock('@/components/app/TeamsProvider', () => ({ TeamsProvider: ({ children }: { children: unknown }) => children }))

import ProjectLayout from '@/app/(app)/p/[projectId]/layout'

const render = (projectId: string) => ProjectLayout({ children: 'page', params: Promise.resolve({ projectId }) })

beforeEach(() => { vi.clearAllMocks() })

describe('ProjectLayout — 존재 은닉(notFound)', () => {
  it('명단 멤버는 통과한다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    await expect(render('p1')).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('같은 워크스페이스의 명단 없는 사람(viewer)도 통과한다 — 조회 전용은 404 가 아니다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeActor({ projectWorkspace: new Map([['p1', WS]]) }), degraded: false })
    await expect(render('p1')).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('타 워크스페이스·미존재 프로젝트는 404', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeMemberActor('p1'), degraded: false })
    await expect(render('p-elsewhere')).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })
  it('플랫폼 관리자는 어느 프로젝트든 통과한다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: makeSuperuser(), degraded: false })
    await expect(render('p-any')).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('권한 조회 실패(degraded)는 404 가 아니라 열화 표시를 유지한다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    await expect(render('p1')).resolves.toBeTruthy()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })
  it('비로그인(actor null, 정상 조회)은 404 — 판정 대상이 없다', async () => {
    mocks.getActorViewState.mockResolvedValue({ actor: null, degraded: false })
    await expect(render('p1')).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
