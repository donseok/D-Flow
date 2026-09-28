// 페이지 관문의 동작(R14) — 거부면 notFound() 이고 데이터 로더가 돌지 않는다. 프로젝트 페이지(칸반)·전역 페이지(/agents) 하나씩.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  getComputedWbs: vi.fn(async () => ({ items: [], today: '2026-09-29' })),
  getSeatmap: vi.fn(async () => ({ floors: [] })),
  getActorForView: vi.fn(),                     // 값은 beforeEach 에서 — vi.hoisted 안에서는 import 한 픽스처를 쓸 수 없다
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: m.getSeatmap }))
vi.mock('@/lib/authz', () => ({ getActorForView: m.getActorForView }))
vi.mock('@/lib/authz/agentsAccess', () => ({ canViewAgents: () => true }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => []) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('@/components/kanban/KanbanBoard', () => ({ KanbanBoard: () => null }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: () => null }))
vi.mock('@/components/wbs/WbsRealtimeRefresh', () => ({ WbsRealtimeRefresh: () => null }))
vi.mock('@/components/agents/SeatmapView', () => ({ SeatmapView: () => null }))
vi.mock('next/navigation', () => ({ notFound: m.notFound, redirect: m.redirect }))
import KanbanPage from '@/app/(app)/p/[projectId]/kanban/page'
import AgentsPage from '@/app/(app)/agents/page'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { makeMemberActor } from '../fixtures/actor'

// 온전한 Actor 를 준다 — 칸반 페이지는 JSX props 에서 toProjectActorView(actor, projectId) 가 행위자의 맵(projectWorkspace·rosterTeams)을 읽는다.
// { userId, isSuperuser } 만 주면 '켜지면 로더가 돈다' 가 구현과 무관하게 TypeError 로 떨어진다(사전 점검 실측)
beforeEach(() => { vi.clearAllMocks(); m.getActorForView.mockResolvedValue(makeMemberActor('p1') as never) })
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })
describe('페이지 관문 — 거부면 로더가 돌지 않는다', () => {
  it('프로젝트 페이지(칸반) — { projectId } 와 kanban 으로 판정', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(KanbanPage({ params: Promise.resolve({ projectId: 'p1' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'kanban')
    expect(m.getComputedWbs).not.toHaveBeenCalled()
  })
  it('켜지면 로더가 돈다', async () => {
    await KanbanPage({ params: Promise.resolve({ projectId: 'p1' }) })
    expect(m.getComputedWbs).toHaveBeenCalledWith('p1')
  })
  it('전역 페이지(/agents) — 세션 유일 워크스페이스로 판정(null), 거부면 좌석표를 읽지 않는다', async () => {
    vi.mocked(requireSessionModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(AgentsPage()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireSessionModule).toHaveBeenCalledWith(null, 'agents')
    expect(m.getSeatmap).not.toHaveBeenCalled()
  })
})
