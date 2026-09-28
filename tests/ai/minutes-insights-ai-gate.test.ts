// 회의록 인사이트의 AI 판정은 세션 없이도 돈다(after()·외부 회의록 API) — 회의록 행을 admin 으로 읽게 client 를 넘긴다(Review Focus 1, 과제 9)
import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ createAdminClient: vi.fn(), generateAnswer: vi.fn() }))
vi.mock('@/lib/ai/llm', () => ({ generateAnswer: m.generateAnswer }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/supabase/env', () => ({ serviceRoleConfigured: () => true }))
import { aiAvailable } from '@/lib/modules/aiAvailable'          // 전역 mock(과제 8) — 여기서 거짓으로 바꾼다
import { ensureMinuteInsights, generateMinuteInsights } from '@/lib/ai/minutes-insights'

const MID = '00000000-0000-0000-7e57-000000001431'
const admin = { from: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  m.createAdminClient.mockReturnValue(admin)
  vi.mocked(aiAvailable).mockResolvedValue(false)
})

describe('회의록 인사이트 — aiAvailable 은 admin 으로 판정한다', () => {
  it('generateMinuteInsights: ({ minuteId }, { module: minutes, client: admin }) — 거짓이면 LLM·DB 를 부르지 않는다', async () => {
    await generateMinuteInsights(MID, '# 회의\n\n결정: A 로 간다')
    expect(vi.mocked(aiAvailable)).toHaveBeenCalledWith({ minuteId: MID }, { module: 'minutes', client: admin })
    expect(vi.mocked(aiAvailable).mock.calls[0][1]?.client).toBe(admin)
    expect(m.generateAnswer).not.toHaveBeenCalled(); expect(admin.from).not.toHaveBeenCalled()
  })
  it("ensureMinuteInsights: 같은 인자, 거짓이면 'unavailable'", async () => {
    expect(await ensureMinuteInsights(MID, '# 회의', 'h')).toBe('unavailable')
    expect(vi.mocked(aiAvailable).mock.calls[0]).toEqual([{ minuteId: MID }, { module: 'minutes', client: admin }])
    expect(vi.mocked(aiAvailable).mock.calls[0][1]?.client).toBe(admin)
  })
})
