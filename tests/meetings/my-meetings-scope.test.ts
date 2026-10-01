// 내 회의(/w/[slug]/meetings, D26) — 액션은 인자 워크스페이스로 판정하고 그 워크스페이스의 회의만 읽는다. 비소속은 빈 달력(존재 은닉).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getSession: vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'u1' })), getActor: vi.fn(),
  getMyMeetings: vi.fn(async () => ({ ok: true, meetings: [], exceptions: [] })),
}))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/lib/authz', () => ({ getActor: h.getActor, requireProjectAdmin: vi.fn(), requireProjectMember: vi.fn(), resolveProjectId: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/data/meetings', () => ({ getMyMeetings: h.getMyMeetings, getMeetingDetail: vi.fn(), ERR_MEETINGS_LOAD: '회의 일정을 불러오지 못했습니다.' }))

import { fetchMyMeetings } from '@/app/actions/meetings'
import { requireModule, requireSessionModule } from '@/lib/modules/gate'
import { makeActor } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-000000001691', WB = '00000000-0000-0000-7e57-000000001692'
const EMPTY = { ok: true, meetings: [], exceptions: [] }
beforeEach(() => { vi.clearAllMocks(); h.getActor.mockResolvedValue(makeActor({ workspaceRoles: new Map([[WA, 'member']]) })) })

describe('fetchMyMeetings(workspaceId, …)', () => {
  it('소속 워크스페이스 — 그 워크스페이스로 관문·로더', async () => {
    await fetchMyMeetings(WA, '2026-09-01', '2026-10-11')
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: WA }, 'meetings')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(h.getMyMeetings).toHaveBeenCalledWith(WA, '2026-09-01', '2026-10-11')
  })
  it('비소속·형식 밖 인자는 빈 달력(존재 은닉) — 관문·로더 미호출', async () => {
    for (const w of [WB, '', 3 as unknown as string]) {
      await expect(fetchMyMeetings(w, '2026-09-01', '2026-10-11'), String(w)).resolves.toEqual(EMPTY)
    }
    expect(requireModule).not.toHaveBeenCalled()
    expect(h.getMyMeetings).not.toHaveBeenCalled()
  })
  it('관문이 닫히면 빈 달력 — 로더 미호출', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: '꺼짐' })
    await expect(fetchMyMeetings(WA, '2026-09-01', '2026-10-11')).resolves.toEqual(EMPTY)
    expect(h.getMyMeetings).not.toHaveBeenCalled()
  })
  it('권한 조회 실패는 실패 결과(빈 달력으로 위장하지 않는다), 비로그인은 빈 달력', async () => {
    h.getActor.mockRejectedValueOnce(new Error('down'))
    await expect(fetchMyMeetings(WA, '2026-09-01', '2026-10-11')).resolves.toEqual({ ok: false, error: '회의 일정을 불러오지 못했습니다.' })
    h.getSession.mockResolvedValueOnce(null)
    await expect(fetchMyMeetings(WA, '2026-09-01', '2026-10-11')).resolves.toEqual(EMPTY)
    expect(h.getMyMeetings).not.toHaveBeenCalled()
  })
})
