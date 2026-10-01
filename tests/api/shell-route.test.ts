import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// 셸 라우트 — 헤더 티커 공지 조회 실패를 '공지 0건'으로 위장하지 않고 headerAnnouncementsFailed 로 알린다.
// 셸 전체는 죽이지 않는다(티커 하나 때문에 알림함·배지까지 사라지면 안 된다). 표시는 ui 브랜치(과제 12)가 한다.
const mocks = vi.hoisted(() => ({
  getInboxFeed: vi.fn(),
  getNotifications: vi.fn(),
  getHeaderAnnouncements: vi.fn(),
  getUnreadAnnouncementCount: vi.fn(),
  getPendingApprovalCount: vi.fn(),
}))
vi.mock('@/app/actions/inbox', () => ({ getInboxFeed: mocks.getInboxFeed }))
vi.mock('@/app/actions/notifications', () => ({ getNotifications: mocks.getNotifications }))
vi.mock('@/app/actions/announcements', () => ({
  getHeaderAnnouncements: mocks.getHeaderAnnouncements,
  getUnreadAnnouncementCount: mocks.getUnreadAnnouncementCount,
}))
vi.mock('@/lib/data/agentApprovals', () => ({ getPendingApprovalCount: mocks.getPendingApprovalCount }))

import { GET } from '@/app/api/shell/route'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const ROWS = [{ id: 'a1', title: '킥오프 안내', category: 'general', isPinned: false }]
const req = (qs = '?route=p1&menu=p1') => new NextRequest(`http://localhost/api/shell${qs}`)

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getInboxFeed.mockResolvedValue([])
  mocks.getNotifications.mockResolvedValue(null)
  mocks.getUnreadAnnouncementCount.mockResolvedValue(0)
  mocks.getPendingApprovalCount.mockResolvedValue(0)
  mocks.getHeaderAnnouncements.mockResolvedValue({ ok: true, rows: ROWS })
})
afterEach(() => errSpy.mockRestore())
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('GET /api/shell — 헤더 공지', () => {
  it('성공이면 공지 행과 headerAnnouncementsFailed: false', async () => {
    const body = await (await GET(req())).json()
    expect(mocks.getHeaderAnnouncements).toHaveBeenCalledWith('p1')
    expect(body).toMatchObject({ headerAnnouncements: ROWS, headerAnnouncementsFailed: false })
  })

  it('{ ok: false } 면 headerAnnouncements: [] + headerAnnouncementsFailed: true', async () => {
    mocks.getHeaderAnnouncements.mockResolvedValue({ ok: false, error: '공지를 불러오지 못했습니다.' })
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ headerAnnouncements: [], headerAnnouncementsFailed: true })
  })

  it('던지면 로그 후 같은 결과 — 셸의 나머지는 그대로 응답한다', async () => {
    mocks.getHeaderAnnouncements.mockRejectedValue(new Error('boom'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ headerAnnouncements: [], headerAnnouncementsFailed: true, inbox: [], unreadAnnouncements: 0 })
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[shell]'), 'boom')
  })

  it('route 가 없으면 조회하지 않고 빈 목록 + 실패 아님', async () => {
    const body = await (await GET(req('?menu=p1'))).json()
    expect(mocks.getHeaderAnnouncements).not.toHaveBeenCalled()
    expect(body).toMatchObject({ headerAnnouncements: [], headerAnnouncementsFailed: false })
  })
})

describe('GET /api/shell — 모듈이 꺼진 항목만 비운다(과제 20)', () => {
  it('agents 가 꺼진 메뉴 문맥이면 결재 배지 0 이고 조회하지 않는다 — 셸의 나머지는 그대로', async () => {
    vi.mocked(projectsWithModule).mockResolvedValueOnce([])
    mocks.getPendingApprovalCount.mockResolvedValue(3)
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pendingApprovals).toBe(0)
    expect(body).toMatchObject({ inbox: [], headerAnnouncements: ROWS, headerAnnouncementsFailed: false })
    expect(mocks.getPendingApprovalCount).not.toHaveBeenCalled()
    expect(projectsWithModule).toHaveBeenCalledWith(['p1'], 'agents')
  })
  it('agents 가 켜진 메뉴 문맥이면 결재 대기 수를 싣는다(대조)', async () => {
    mocks.getPendingApprovalCount.mockResolvedValue(3)
    const body = await (await GET(req())).json()
    expect(body.pendingApprovals).toBe(3)
    expect(mocks.getPendingApprovalCount).toHaveBeenCalledWith('p1')
  })
  it('메뉴 문맥이 없으면 판정도 조회도 하지 않는다', async () => {
    const body = await (await GET(req('?route=p1'))).json()
    expect(body.pendingApprovals).toBe(0)
    expect(projectsWithModule).not.toHaveBeenCalled()
    expect(mocks.getPendingApprovalCount).not.toHaveBeenCalled()
  })
  it('모듈 판정이 던지면 로그 뒤 0 — 배지 하나 때문에 셸을 죽이지 않는다', async () => {
    vi.mocked(projectsWithModule).mockRejectedValueOnce(new Error('설정 조회 실패'))
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect((await res.json()).pendingApprovals).toBe(0)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[shell]'), '설정 조회 실패')
    expect(mocks.getPendingApprovalCount).not.toHaveBeenCalled()
  })
  it('공지 액션이 빈 값을 돌려주면(모듈 꺼짐 — 과제 15) 실패로 그리지 않는다', async () => {
    mocks.getHeaderAnnouncements.mockResolvedValue({ ok: true, rows: [] }); mocks.getUnreadAnnouncementCount.mockResolvedValue(0)
    const body = await (await GET(req())).json()
    expect(body).toMatchObject({ headerAnnouncements: [], headerAnnouncementsFailed: false, unreadAnnouncements: 0 })
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
