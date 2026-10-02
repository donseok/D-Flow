// 사용현황 RPC 의 시간대(스펙 D14·E32) — 다섯 조회가 p_timezone 을 넘기고, 22023(잘못된 tz)을 USAGE_TIMEZONE_INVALID 로
// 매핑한다(fail-closed — 0 으로 위장하지 않는다). 접속 로그 범위는 그 tz 의 자정 경계다(+09:00 고정 폐기).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ createServerClient: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: m.createServerClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/authz', () => ({ getActor: vi.fn() }))

import {
  getDailyActives, getMenuRanking, getRecentUsageEvents, getUsageSessions, getUsageSummary, getUserRollup,
} from '@/lib/data/usage'
import { UsageQueryError, usageRpcError, usageTimezone } from '@/lib/domain/usage'

const LA = 'America/Los_Angeles'
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.createServerClient.mockResolvedValue({ rpc: m.rpc })
})

describe('usageTimezone — /usage 의 기준 tz', () => {
  it('필터 워크스페이스가 없으면 UTC(전체 합산), 있으면 그 tz', () => {
    expect(usageTimezone(null)).toBe('UTC')
    expect(usageTimezone(LA)).toBe(LA)
  })
})

describe('사용현황 RPC 다섯 — p_timezone 을 이름 인자로 넘긴다', () => {
  it('요약·일별·메뉴·사용자·세션', async () => {
    m.rpc.mockResolvedValue({ data: [], error: null })
    await getUsageSummary('2026-10-01', '2026-10-07', '2026-10-07', LA)
    await getDailyActives('2026-10-01', '2026-10-07', LA)
    await getMenuRanking('2026-10-01', '2026-10-07', LA)
    await getUserRollup('2026-10-01', '2026-10-07', LA)
    m.rpc.mockResolvedValueOnce({ data: 3, error: null })
    await getUsageSessions('2026-10-01', '2026-10-07', 30, LA)
    expect(m.rpc.mock.calls).toEqual([
      ['usage_summary', { p_from: '2026-10-01', p_to: '2026-10-07', p_today: '2026-10-07', p_timezone: LA }],
      ['usage_daily_actives', { p_from: '2026-10-01', p_to: '2026-10-07', p_timezone: LA }],
      ['usage_menu_ranking', { p_from: '2026-10-01', p_to: '2026-10-07', p_timezone: LA }],
      ['usage_user_rollup', { p_from: '2026-10-01', p_to: '2026-10-07', p_timezone: LA }],
      ['usage_sessions', { p_from: '2026-10-01', p_to: '2026-10-07', p_timezone: LA, p_gap_minutes: 30 }],
    ])
  })

  it('22023 은 USAGE_TIMEZONE_INVALID — 문구에 DB 원문이 없다', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'time zone "Mars/Base" not recognized' } })
    for (const run of [
      () => getUsageSummary('2026-10-01', '2026-10-07', '2026-10-07', 'Mars/Base'),
      () => getDailyActives('2026-10-01', '2026-10-07', 'Mars/Base'),
      () => getMenuRanking('2026-10-01', '2026-10-07', 'Mars/Base'),
      () => getUserRollup('2026-10-01', '2026-10-07', 'Mars/Base'),
      () => getUsageSessions('2026-10-01', '2026-10-07', 30, 'Mars/Base'),
    ]) {
      const e = await run().catch((x: unknown) => x)
      expect(e).toBeInstanceOf(UsageQueryError)
      expect((e as UsageQueryError).code).toBe('USAGE_TIMEZONE_INVALID')
      expect((e as Error).message).not.toContain('Mars/Base')
      expect((e as Error).message).not.toContain('not recognized')
    }
  })

  it('그 밖의 오류는 USAGE_QUERY_FAILED — 0 이나 빈 배열로 풀지 않는다', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function usage_summary' } })
    const e = await getUsageSummary('2026-10-01', '2026-10-07', '2026-10-07', 'UTC').catch((x: unknown) => x)
    expect((e as UsageQueryError).code).toBe('USAGE_QUERY_FAILED')
    expect((e as Error).message).not.toContain('permission denied')
  })

  it('usageRpcError 는 원문을 로그로만 남긴다', () => {
    const err = usageRpcError('사용 현황 요약', { code: '22023', message: 'time zone "x" not recognized' })
    expect(err.code).toBe('USAGE_TIMEZONE_INVALID')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[usage] 사용 현황 요약'), expect.objectContaining({ code: '22023' }))
  })
})

describe('접속 로그 범위 — tz 의 자정 경계', () => {
  function q(calls: { gte: unknown[]; lt: unknown[] }) {
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'order', 'limit']) b[k] = vi.fn(() => b)
    b.gte = vi.fn((...a: unknown[]) => { calls.gte.push(a); return b })
    b.lt = vi.fn((...a: unknown[]) => { calls.lt.push(a); return b })
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
    return b
  }
  it('LA 의 10-01~10-07 은 10-01T07:00Z 이상, 10-08T07:00Z 미만(PDT)', async () => {
    const calls = { gte: [] as unknown[], lt: [] as unknown[] }
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => q(calls)) })
    await getRecentUsageEvents({ from: '2026-10-01', to: '2026-10-07', limit: 20, timezone: LA })
    expect(calls.gte[0]).toEqual(['occurred_at', '2026-10-01T07:00:00.000Z'])
    expect(calls.lt[0]).toEqual(['occurred_at', '2026-10-08T07:00:00.000Z'])
  })
  it('UTC 는 자정 그대로', async () => {
    const calls = { gte: [] as unknown[], lt: [] as unknown[] }
    m.createServerClient.mockResolvedValue({ from: vi.fn(() => q(calls)) })
    await getRecentUsageEvents({ from: '2026-10-01', to: '2026-10-07', limit: 20, timezone: 'UTC' })
    expect(calls.gte[0]).toEqual(['occurred_at', '2026-10-01T00:00:00.000Z'])
    expect(calls.lt[0]).toEqual(['occurred_at', '2026-10-08T00:00:00.000Z'])
  })
})
