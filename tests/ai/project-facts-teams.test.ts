import { beforeEach, describe, expect, it, vi } from 'vitest'

// SP2 Task 16b — AI 브리핑 팩트의 팀 축은 대상 프로젝트의 팀(전용 팀, 없으면 그 워크스페이스의 공용 팀)이다.
// 옛 전역 접근자는 전 워크스페이스의 공용 팀 합집합이라 남의 워크스페이스 팀 코드가 브리핑 근거에 섞였다.
const mocks = vi.hoisted(() => ({
  project: { data: { name: 'Acme', start_date: null, end_date: null } as Record<string, unknown> | null, error: null },
  activeTeamCodesForProjectSync: vi.fn((pid: string) => (pid === 'p1' ? ['A팀'] : ['B팀'])),
  getSnapshots: vi.fn(async (): Promise<{ ok: true; rows: unknown[] } | { ok: false; error: string }> => ({ ok: true, rows: [] })),
}))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [], today: '2026-09-26' })) }))
vi.mock('@/lib/data/snapshots', () => ({ getSnapshots: mocks.getSnapshots }))
vi.mock('@/lib/data/meetings', () => ({ getProjectMeetingData: vi.fn(async () => ({ meetings: [], exceptions: [] })) }))
vi.mock('@/lib/data/minutes', () => ({ getProjectMinuteSignals: vi.fn(async () => []) }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: vi.fn(async () => ({ milestoneKeywords: [] })) }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => mocks.project }) }) }),
  })),
}))
vi.mock('@/lib/teams/master', () => ({ activeTeamCodesForProjectSync: mocks.activeTeamCodesForProjectSync }))

import { loadProjectFacts } from '@/lib/ai/projectFacts'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.project = { data: { name: 'Acme', start_date: null, end_date: null }, error: null }
})

describe('loadProjectFacts — 팀 축은 대상 프로젝트의 팀', () => {
  it('그 프로젝트의 활성 팀 코드를 싣는다 — 다른 프로젝트·워크스페이스의 팀은 없다', async () => {
    const src = await loadProjectFacts('p1')
    expect(src?.teams).toEqual(['A팀'])
    expect(mocks.activeTeamCodesForProjectSync).toHaveBeenCalledWith('p1')
  })

  it('프로젝트를 볼 수 없으면(RLS 로 행 없음) service_role 팀 캐시를 읽지 않는다', async () => {
    mocks.project = { data: null, error: null }
    expect(await loadProjectFacts('p-hidden')).toBeNull()
    expect(mocks.activeTeamCodesForProjectSync).not.toHaveBeenCalled()
  })

  it('팀 캐시 미로드는 throw 로 올린다 — 빈 팀으로 브리핑을 만들지 않는다(호출측이 unavailable 로 강등)', async () => {
    mocks.activeTeamCodesForProjectSync.mockImplementationOnce(() => { throw new Error('팀 마스터를 아직 불러오지 못했습니다.') })
    await expect(loadProjectFacts('p1')).rejects.toThrow(/팀 마스터/)
  })
})

describe('loadProjectFacts — 조회 실패는 빈 데이터로 브리핑하지 않는다', () => {
  it('진척 이력 조회 실패는 throw 로 올린다(호출측이 unavailable 로 강등)', async () => {
    mocks.getSnapshots.mockResolvedValueOnce({ ok: false, error: '진척 이력을 불러오지 못했습니다.' })
    await expect(loadProjectFacts('p1')).rejects.toThrow('[projectFacts] 진척 이력을 불러오지 못했습니다.')
  })
})
