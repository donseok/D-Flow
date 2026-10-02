// /api/shell 새 계약(D34) — ?ws=<wid>&project=<pid>(둘 다 ShellScope 에서). 배지 셋, 실패는 0 이 아니라 null(로그), 티커 필드 없음, no-store.
// 적대적 탐색 고정(U2b-3): 비소속·형식 밖 ws 는 세지 않는다, 볼 수 없는 프로젝트·다른 워크스페이스의 프로젝트는 조회하지 않는다(E10 — 남의 수를 흘리지 않는다).
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getInboxFeed: vi.fn(), getNotifications: vi.fn(), getUnreadAnnouncementCount: vi.fn(), getPendingApprovalCount: vi.fn(),
  countMyReview: vi.fn(), getActorViewState: vi.fn(), getHiddenProjectIds: vi.fn(),
}))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: h.getHiddenProjectIds }))
vi.mock('@/app/actions/inbox', () => ({ getInboxFeed: h.getInboxFeed }))
vi.mock('@/app/actions/notifications', () => ({ getNotifications: h.getNotifications }))
vi.mock('@/app/actions/announcements', () => ({ getUnreadAnnouncementCount: h.getUnreadAnnouncementCount }))
vi.mock('@/lib/data/agentApprovals', () => ({ getPendingApprovalCount: h.getPendingApprovalCount }))
vi.mock('@/lib/data/portal', () => ({ countMyReview: h.countMyReview }))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))

import { GET } from '@/app/api/shell/route'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { makeActor, makeSuperuser } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-000000001741', WB = '00000000-0000-0000-7e57-000000001742'
const P = '00000000-0000-0000-7e57-000000001743', PB = '00000000-0000-0000-7e57-000000001744'
const get = (q: string) => GET(new NextRequest(new URL(`/api/shell?${q}`, 'http://127.0.0.1:3201')))
const member = () => makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[P, WA]]), projectRoles: new Map([[P, 'member']]) })

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  h.getActorViewState.mockResolvedValue({ actor: member(), degraded: false })
  h.getInboxFeed.mockResolvedValue({ items: [], unseen: 0 })
  h.getNotifications.mockResolvedValue({ items: [], count: 0 })
  h.getUnreadAnnouncementCount.mockResolvedValue(2)
  h.getPendingApprovalCount.mockResolvedValue(1)
  h.countMyReview.mockResolvedValue(4)
  h.getHiddenProjectIds.mockResolvedValue(new Set())
})
afterEach(() => errSpy.mockRestore())
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('/api/shell 새 계약(D34)', () => {
  it('?ws=&project= — 배지 셋, 티커·옛 필드 없음, no-store', async () => {
    const res = await get(`ws=${WA}&project=${P}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.badges).toEqual({ myWorkReview: 4, projectApprovals: 1, projectUnreadAnnouncements: 2 })
    for (const k of ['headerAnnouncements', 'headerAnnouncementsFailed', 'unreadAnnouncements', 'pendingApprovals']) expect(body).not.toHaveProperty(k)
    expect(h.countMyReview).toHaveBeenCalledWith(WA, expect.anything())
    expect(h.getNotifications).toHaveBeenCalledWith(P)
  })
  it('배지 실패는 0 이 아니라 null(로그)', async () => {
    h.getUnreadAnnouncementCount.mockRejectedValue(new Error('x')); h.getPendingApprovalCount.mockRejectedValue(new Error('y')); h.countMyReview.mockResolvedValue(null)
    const body = await (await get(`ws=${WA}&project=${P}`)).json()
    expect(body.badges).toEqual({ myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null })
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[shell]'), 'x')
  })
  it('countMyReview 가 던져도 null(셸 전체를 죽이지 않는다)', async () => {
    h.countMyReview.mockRejectedValue(new Error('boom'))
    const res = await get(`ws=${WA}`)
    expect(res.status).toBe(200); expect((await res.json()).badges.myWorkReview).toBeNull()
  })
  it('agents 가 꺼진 프로젝트면 결재 배지 0(꺼짐은 실패가 아니다)이고 조회하지 않는다', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([])
    const body = await (await get(`ws=${WA}&project=${P}`)).json()
    expect(body.badges.projectApprovals).toBe(0); expect(h.getPendingApprovalCount).not.toHaveBeenCalled()
  })
  it('파생 알림 실패는 null(벨은 직전 값을 유지 — 옛 시맨틱)', async () => {
    h.getNotifications.mockRejectedValue(new Error('n'))
    const body = await (await get(`ws=${WA}&project=${P}`)).json()
    expect(body.notifications).toBeNull(); expect(body.badges.projectApprovals).toBe(1)
  })
  it('범위가 없으면(첫 게시 전) 인박스만 — 배지 셋 null, 범위 조회 없음', async () => {
    const body = await (await get('')).json()
    expect(body.badges).toEqual({ myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null })
    expect(h.getInboxFeed).toHaveBeenCalledTimes(1)
    expect(h.countMyReview).not.toHaveBeenCalled(); expect(h.getNotifications).not.toHaveBeenCalled()
  })
})

describe('/api/shell — 적대적(E10, fail-closed)', () => {
  it('비소속 ws 는 세지 않는다(null) — 남의 워크스페이스 수를 흘리지 않는다', async () => {
    const body = await (await get(`ws=${WB}`)).json()
    expect(body.badges.myWorkReview).toBeNull(); expect(h.countMyReview).not.toHaveBeenCalled()
  })
  it.each(['acme', '../x', `${WA},${WB}`, `${WA.toUpperCase()}x`, ' '])('형식 밖 ws %j → null, 조회 없음', async (bad) => {
    const body = await (await get(`ws=${encodeURIComponent(bad)}`)).json()
    expect(body.badges.myWorkReview).toBeNull(); expect(h.countMyReview).not.toHaveBeenCalled()
  })
  it('중복 키 ws — 첫 값만 본다(뒤에 남의 ws 를 붙여도 그 수를 세지 않는다)', async () => {
    await get(`ws=${WA}&ws=${WB}`)
    expect(h.countMyReview).toHaveBeenCalledTimes(1); expect(h.countMyReview).toHaveBeenCalledWith(WA, expect.anything())
  })
  it('볼 수 없는 프로젝트(타 워크스페이스·미존재) → 프로젝트 배지·파생 알림 null, 어떤 조회도 하지 않는다', async () => {
    const body = await (await get(`ws=${WA}&project=${PB}`)).json()
    expect(body.badges.projectApprovals).toBeNull(); expect(body.badges.projectUnreadAnnouncements).toBeNull(); expect(body.notifications).toBeNull()
    expect(h.getNotifications).not.toHaveBeenCalled(); expect(h.getUnreadAnnouncementCount).not.toHaveBeenCalled(); expect(h.getPendingApprovalCount).not.toHaveBeenCalled()
  })
  it('프로젝트가 ws 와 다른 워크스페이스면(섞인 범위) 프로젝트 배지를 세지 않는다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]), projectWorkspace: new Map([[P, WA], [PB, WB]]), projectRoles: new Map([[P, 'member'], [PB, 'member']]) }), degraded: false })
    const body = await (await get(`ws=${WA}&project=${PB}`)).json()
    expect(body.badges.projectApprovals).toBeNull(); expect(h.getPendingApprovalCount).not.toHaveBeenCalled()
    expect(body.badges.myWorkReview).toBe(4)
  })
  it('형식 밖 project 는 조회하지 않는다', async () => {
    const body = await (await get(`ws=${WA}&project=${encodeURIComponent("p1' or 1=1")}`)).json()
    expect(body.badges.projectApprovals).toBeNull(); expect(h.getNotifications).not.toHaveBeenCalled()
  })
  it('열화(actor null) → 배지 셋 null, 범위 조회 없음(인박스만)', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    const body = await (await get(`ws=${WA}&project=${P}`)).json()
    expect(body.badges).toEqual({ myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null })
    expect(h.countMyReview).not.toHaveBeenCalled(); expect(h.getPendingApprovalCount).not.toHaveBeenCalled(); expect(h.getNotifications).not.toHaveBeenCalled()
  })
  it('권한 조회가 던져도 인박스는 응답하고 배지는 null', async () => {
    h.getActorViewState.mockRejectedValue(new Error('auth down'))
    const res = await get(`ws=${WA}&project=${P}`)
    expect(res.status).toBe(200)
    expect((await res.json()).badges).toEqual({ myWorkReview: null, projectApprovals: null, projectUnreadAnnouncements: null })
  })
  it('플랫폼 관리자는 비소속 워크스페이스도 센다(그 워크스페이스를 보는 화면과 같은 축 — 칩으로 표시)', async () => {
    h.getActorViewState.mockResolvedValue({ actor: makeSuperuser({ workspaceRoles: new Map(), projectWorkspace: new Map([[PB, WB]]) }), degraded: false })
    const body = await (await get(`ws=${WB}&project=${PB}`)).json()
    expect(body.badges).toEqual({ myWorkReview: 4, projectApprovals: 1, projectUnreadAnnouncements: 2 })
  })
  it('[RF5] 결재 대기 조회가 throw 하면 배지 0 + 로그 — 셸의 나머지(받은편지함·공지)는 그대로', async () => {
    mocks.getPendingApprovalCount.mockRejectedValueOnce(new Error('[approvals] 결재 대기 목록을 끝까지 읽지 못했습니다(2/3건)'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pendingApprovals).toBe(0)
    expect(body).toMatchObject({ inbox: [], unreadAnnouncements: 0, headerAnnouncements: ROWS, headerAnnouncementsFailed: false })
    expect(errSpy).toHaveBeenCalledWith('[shell] 결재 대기 수 조회 실패:', expect.stringContaining('끝까지 읽지 못했습니다'))
  })
})

// GG1 — 프로젝트 배지는 프로젝트 화면과 같은 판정자로 거른다: 명단 밖 비공개면 조회하지 않고, 판정이 실패해도 조회하지 않는다(null + 로그)
describe('/api/shell — 명단 밖 비공개 프로젝트(GG1)', () => {
  const offRoster = () => makeActor({ workspaceRoles: new Map([[WA, 'member']]), projectWorkspace: new Map([[P, WA]]) })
  it('명단 밖 비공개 프로젝트의 배지·파생 알림을 계산하지 않는다(워크스페이스 배지는 그대로)', async () => {
    h.getActorViewState.mockResolvedValue({ actor: offRoster(), degraded: false })
    h.getHiddenProjectIds.mockResolvedValue(new Set([P]))
    const body = await (await get(`ws=${WA}&project=${P}`)).json()
    expect(body.badges).toEqual({ myWorkReview: 4, projectApprovals: null, projectUnreadAnnouncements: null })
    expect(body.notifications).toBeNull()
    expect(h.getNotifications).not.toHaveBeenCalled(); expect(h.getUnreadAnnouncementCount).not.toHaveBeenCalled(); expect(h.getPendingApprovalCount).not.toHaveBeenCalled()
  })
  it('비공개 판정이 실패하면 프로젝트 배지를 계산하지 않는다(fail-closed, 로그)', async () => {
    h.getHiddenProjectIds.mockRejectedValue(new Error('hidden-boom'))
    const res = await get(`ws=${WA}&project=${P}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.badges.projectApprovals).toBeNull(); expect(body.badges.projectUnreadAnnouncements).toBeNull()
    expect(h.getNotifications).not.toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[shell]'), 'hidden-boom')
  })
  it('대조 — 명단 멤버는 비공개 프로젝트여도 센다(숨김 집합에 없다)', async () => {
    h.getHiddenProjectIds.mockResolvedValue(new Set())
    const body = await (await get(`ws=${WA}&project=${P}`)).json()
    expect(body.badges.projectUnreadAnnouncements).toBe(2)
  })
})
