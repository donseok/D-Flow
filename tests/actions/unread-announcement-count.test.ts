// 셸 공지 배지 수(A-4 리뷰 P3 N9) — 달력·조회 실패를 '읽지 않은 공지 0'으로 위장하지 않는다: null(모름) + 로그. 정상은 수.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getSession: vi.fn(), requireModule: vi.fn(), getProjectConfig: vi.fn(), seen: vi.fn(), count: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: m.getSession }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: m.requireModule }))
vi.mock('@/lib/settings/projectConfig', async (orig) => ({ ...(await orig<Record<string, unknown>>()), getProjectConfig: m.getProjectConfig }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: (table: string) => {
      if (table === 'announcement_seen') {
        const b = { select: () => b, eq: () => b, maybeSingle: () => m.seen() }
        return b
      }
      const q: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'or', 'gt']) q[k] = () => q
      ;(q as { then: (r: (v: unknown) => void) => void }).then = (r) => r(m.count())
      return q
    },
  }),
}))

import { getUnreadAnnouncementCount } from '@/app/actions/announcements'
import { ConfigKeyError } from '@/lib/settings/errors'

beforeEach(async () => {
  vi.clearAllMocks()
  const { calSeoulMon } = await import('../helpers/calendarFixture')
  m.getSession.mockResolvedValue({ id: 'u1' })
  m.requireModule.mockResolvedValue({ ok: true })
  m.getProjectConfig.mockResolvedValue({ calendar: calSeoulMon, calendarError: null })
  m.seen.mockResolvedValue({ data: null, error: null })
  m.count.mockReturnValue({ count: 3, error: null })
})

describe('getUnreadAnnouncementCount', () => {
  it('정상은 수', async () => {
    expect(await getUnreadAnnouncementCount('p1')).toBe(3)
  })
  it('세션 없음·모듈 꺼짐은 0(정상 — 볼 공지가 없다)', async () => {
    m.getSession.mockResolvedValueOnce(null)
    expect(await getUnreadAnnouncementCount('p1')).toBe(0)
    m.requireModule.mockResolvedValueOnce({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect(await getUnreadAnnouncementCount('p1')).toBe(0)
  })
  it('달력 손상은 null(모름) — 0 으로 위장하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.getProjectConfig.mockResolvedValue({ calendar: null, calendarError: new ConfigKeyError('CONFIG_INVALID', 'calendar.timezone') })
    expect(await getUnreadAnnouncementCount('p1')).toBeNull()
    err.mockRestore()
  })
  it('count 조회 오류는 null + 로그(종전에는 로그 없이 0)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.count.mockReturnValue({ count: null, error: { message: 'relation boom' } })
    expect(await getUnreadAnnouncementCount('p1')).toBeNull()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('워터마크 조회 오류도 null + 로그(쓰지 않고 넘어가면 이미 본 공지를 다시 센다)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.seen.mockResolvedValue({ data: null, error: { message: 'seen boom' } })
    expect(await getUnreadAnnouncementCount('p1')).toBeNull()
    err.mockRestore()
  })
})
