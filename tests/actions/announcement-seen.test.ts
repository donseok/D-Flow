import { beforeEach, describe, expect, it, vi } from 'vitest'

// 공지 읽음 워터마크 — DB 의 created_at 은 µs, JS Date 는 ms 다. 워터마크를 ms 로 잘라 저장하면 SQL 배지(created_at > last_seen_at)가
// 같은 밀리초 안의 마지막 공지를 영원히 안읽음으로 센다(레인 B UI-0 기준선 촬영에서 실측 — 방문 뒤에도 사이드바 배지가 그대로).
const h = vi.hoisted(() => ({ session: vi.fn(), gate: vi.fn(), current: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getSession: h.session }))
vi.mock('@/lib/modules/gate', () => ({ requireModule: h.gate }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: async () => ({
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => h.current(), upsert: (...a: unknown[]) => h.upsert(...a) }
      return q
    },
  }),
}))

import { markAnnouncementsSeen } from '@/app/actions/announcements'

const P = '00000000-0000-4000-8000-0000000000p1'.replace('p1', 'a1')
const LATEST = '2026-10-01T03:22:44.483017+00:00'

beforeEach(() => {
  vi.clearAllMocks()
  h.session.mockResolvedValue({ id: 'u1' })
  h.gate.mockResolvedValue({ ok: true })
  h.current.mockResolvedValue({ data: null, error: null })
  h.upsert.mockResolvedValue({ error: null })
})

describe('markAnnouncementsSeen — 워터마크를 µs 그대로 저장한다', () => {
  it('보인 마지막 공지의 µs 시각을 자르지 않고 쓴다', async () => {
    expect(await markAnnouncementsSeen(P, LATEST)).toEqual({ ok: true })
    expect(h.upsert).toHaveBeenCalledWith({ user_id: 'u1', project_id: P, last_seen_at: LATEST }, { onConflict: 'user_id,project_id' })
  })
  it('예전 코드가 ms 로 잘라 둔 워터마크(.483Z)도 같은 공지의 µs 값(.483017)으로 앞으로 민다', async () => {
    h.current.mockResolvedValue({ data: { last_seen_at: '2026-10-01T03:22:44.483+00:00' }, error: null })
    await markAnnouncementsSeen(P, LATEST)
    expect(h.upsert).toHaveBeenCalledTimes(1)
  })
  it('뒤로 가지 않는다 — 기존 워터마크가 µs 로 더 크면 쓰지 않는다', async () => {
    h.current.mockResolvedValue({ data: { last_seen_at: '2026-10-01T03:22:44.483018+00:00' }, error: null })
    expect(await markAnnouncementsSeen(P, LATEST)).toEqual({ ok: true })
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('미래 시각은 지금으로 당긴다(클라이언트 값 신뢰 금지)', async () => {
    await markAnnouncementsSeen(P, '2999-01-01T00:00:00.000001+00:00')
    const stored = h.upsert.mock.calls[0]![0].last_seen_at as string
    expect(Date.parse(stored)).toBeLessThanOrEqual(Date.now())
  })
  it('ISO 꼴이 아닌 시각은 거부하고 쓰지 않는다', async () => {
    expect(await markAnnouncementsSeen(P, 'Oct 1 2026')).toEqual({ ok: false, error: '잘못된 시각입니다.' })
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('모듈이 꺼져 있으면 쓰지 않는다', async () => {
    h.gate.mockResolvedValue({ ok: false, error: 'ERR_MODULE_DISABLED' })
    expect((await markAnnouncementsSeen(P, LATEST)).ok).toBe(false)
    expect(h.upsert).not.toHaveBeenCalled()
  })
})
