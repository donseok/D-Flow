import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 챗봇 근거의 명단 조회 실패 — 빈 명단(0명)으로 답하지 않고 '명단 조회 실패' 를 근거·폴백 답변에 밝힌다(에러 처리 3원칙 ①).
const mocks = vi.hoisted(() => ({
  getProjectRoster: vi.fn(),
  getComputedWbs: vi.fn(),
}))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: mocks.getProjectRoster }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: mocks.getComputedWbs }))
vi.mock('@/app/actions/project', () => ({ listProjectsWithState: vi.fn(async () => ({ projects: [], degraded: false })) }))
vi.mock('@/lib/teams/source', () => ({ projectTeams: async () => [] }))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: 'Acme' } }) }) }) }),
  })),
}))

import { gatherKnowledge, loadProjectAnalysis } from '@/lib/ai/knowledge'

const ALICE = { id: 'm1', name: 'alice', teams: [{ id: 't1', code: 'PMO' }] }

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getComputedWbs.mockResolvedValue({ items: [], today: '2026-09-26' })
})
afterEach(() => errSpy.mockRestore())

describe('knowledge — 명단 조회 실패', () => {
  it('실패 사유를 싣고 로그를 남긴다 — members 는 비지만 rosterError 로 0명과 구분된다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    const loaded = await loadProjectAnalysis('p1')
    expect(loaded.rosterError).toBe('명단을 불러오지 못했습니다.')
    expect(loaded.members).toEqual([])
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('명단 조회 실패'))
  })
  it('팀별 의도 — 답변과 LLM 근거 모두 "명단 조회 실패" 를 명시한다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    const k = await gatherKnowledge('by_team', 'p1')
    expect(k.text).toContain('명단 조회 실패')
    expect(k.facts).toContain('명단 조회 실패')
    expect(k.scopeProjectId).toBe('p1')
  })
  it('탐색형 의도 — 팩트시트 근거에도 명시한다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: false, error: '명단을 불러오지 못했습니다.' })
    const k = await gatherKnowledge('freeform', 'p1', '진행 상황 알려줘')
    expect(k.facts).toContain('명단 조회 실패')
    expect(k.text).toContain('명단 조회 실패')
  })
  it('정상 조회는 실패 문구가 없고 명단을 그대로 쓴다', async () => {
    mocks.getProjectRoster.mockResolvedValue({ ok: true, rows: [ALICE] })
    const loaded = await loadProjectAnalysis('p1')
    expect(loaded.rosterError).toBeNull()
    expect(loaded.members).toEqual([ALICE])
    const k = await gatherKnowledge('by_team', 'p1')
    expect(k.facts).not.toContain('명단 조회 실패')
    expect(errSpy).not.toHaveBeenCalled()
  })
  it('프로젝트 없는 전사 요약은 명단을 읽지 않는다', async () => {
    const k = await gatherKnowledge('overview', null, '', 'ws-1')
    expect(mocks.getProjectRoster).not.toHaveBeenCalled()
    expect(k.facts).not.toContain('명단 조회 실패')
  })
})
