import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// fetchMyMeetings — 내 회의 뷰가 달을 옮길 때 부르는 얇은 래퍼. 로더의 실패를 빈 달로 펴지 않고 그대로 넘긴다(M5).
const { getSession, getMyMeetings } = vi.hoisted(() => ({ getSession: vi.fn(), getMyMeetings: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession }))
vi.mock('@/lib/authz', () => ({
  requireProjectMember: vi.fn(), requireProjectAdmin: vi.fn(), resolveProjectId: vi.fn(),
  getActor: vi.fn(async () => (await import('../fixtures/actor')).makeActor()),   // 워크스페이스 ws-1 의 멤버
}))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings, getMeetingDetail: vi.fn(), ERR_MEETINGS_LOAD: '회의 일정을 불러오지 못했습니다.' }))

import { fetchMyMeetings } from '@/app/actions/meetings'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'

const W = 'ws-1'

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ id: 'u1', email: 'alice@example.com', user_metadata: {} })
})
// 관문 mock 값을 바꾸는 파일 — 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })

describe('fetchMyMeetings — 결과형', () => {
  it('로더의 실패를 그대로 넘긴다 — 빈 달로 바꾸지 않는다', async () => {
    getMyMeetings.mockResolvedValue({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    expect(await fetchMyMeetings(W, '2026-07-01', '2026-07-31')).toEqual({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    expect(getMyMeetings).toHaveBeenCalledWith(W, '2026-07-01', '2026-07-31')
  })

  it('로더의 성공을 그대로 넘긴다', async () => {
    getMyMeetings.mockResolvedValue({ ok: true, meetings: [], exceptions: [] })
    expect(await fetchMyMeetings(W, '2026-07-01', '2026-07-31')).toEqual({ ok: true, meetings: [], exceptions: [] })
  })

  it('비로그인은 로더를 부르지 않고 빈 성공 결과 — 세션은 호출부(레이아웃)가 따로 본다', async () => {
    getSession.mockResolvedValue(null)
    expect(await fetchMyMeetings(W, '2026-07-01', '2026-07-31')).toEqual({ ok: true, meetings: [], exceptions: [] })
    expect(getMyMeetings).not.toHaveBeenCalled()
  })

  it('meetings 관문(화면의 워크스페이스 — D26)이 거부하면 빈 성공이고 로더를 부르지 않는다(B5 F2 — 모듈 인자 고정)', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    expect(await fetchMyMeetings(W, '2026-07-01', '2026-07-31')).toEqual({ ok: true, meetings: [], exceptions: [] })
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: W }, 'meetings')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(getMyMeetings).not.toHaveBeenCalled()
  })
})
