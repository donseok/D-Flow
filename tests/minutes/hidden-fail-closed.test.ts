// 회의록 목록 표면 — 비공개 프로젝트 판정이 실패하면 목록을 열지 않고 막는다(UI-2a 최종 수정 FA1, 포털과 같은 fail-closed).
// 각 로더는 자기 실패 관례로 돌려준다: 목록·검색은 로그 + 빈 배열(조회 실패와 같은 폴백), 탐색기는 null.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ createServerClient: vi.fn(), getHiddenProjectIds: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: h.createServerClient }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: h.getHiddenProjectIds }))

import { getMinutesExplorer, getMinutesPage, searchMinutes } from '@/lib/data/minutes'

const ROW = { id: 'm1', minute_date: '2026-07-01', team_code: 'ERP', title: '공개 회의록', body_md: '', project_id: null, workspace_id: 'ws-1', created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z' }
function query(data: unknown[]) {
  const q: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'is', 'gte', 'lte', 'or', 'order', 'limit']) q[k] = () => q
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data, error: null }).then(res, rej)
  return q
}
const stubClient = () => ({ from: (t: string) => query(t === 'minutes' ? [ROW] : []) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  h.createServerClient.mockResolvedValue(stubClient())
})
const logged = () => vi.mocked(console.error).mock.calls.map((c) => String(c[0]))

describe('비공개 판정 실패 → 막는다', () => {
  it('정상일 때는 행이 나온다(대조)', async () => {
    h.getHiddenProjectIds.mockResolvedValue(new Set())
    expect((await getMinutesPage('ws-1', null, '2026-07-01', '2026-07-31', null)).map((m) => m.id)).toEqual(['m1'])
    expect((await searchMinutes('ws-1', null, '회의', null)).map((m) => m.id)).toEqual(['m1'])
    expect((await getMinutesExplorer('ws-1', null))?.leaves.map((l) => l.id)).toEqual(['m1'])
  })
  it('월 목록 — 빈 배열 + 로그, 행을 돌려주지 않는다', async () => {
    h.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    expect(await getMinutesPage('ws-1', null, '2026-07-01', '2026-07-31', null)).toEqual([])
    expect(logged().some((m) => m.includes('getMinutesPage'))).toBe(true)
  })
  it('검색 — 빈 배열 + 로그', async () => {
    h.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    expect(await searchMinutes('ws-1', null, '회의', null)).toEqual([])
    expect(logged().some((m) => m.includes('searchMinutes'))).toBe(true)
  })
  it('탐색기 — null(조회 실패와 같은 신호) + 로그', async () => {
    h.getHiddenProjectIds.mockRejectedValue(new Error('hidden down'))
    expect(await getMinutesExplorer('ws-1', null)).toBeNull()
    expect(logged().some((m) => m.includes('getMinutesExplorer'))).toBe(true)
  })
})
