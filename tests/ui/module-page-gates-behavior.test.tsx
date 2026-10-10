// 페이지 관문의 동작(R14) — 거부면 notFound() 이고 데이터 로더가 돌지 않는다. 프로젝트 페이지(칸반)·워크스페이스 페이지(/w/[slug]/agents)·대상 행 페이지(/minutes/[id]) 하나씩.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  getComputedWbs: vi.fn(async () => ({ items: [], today: '2026-09-29' })),
  getSeatmap: vi.fn(async () => ({ floors: [] })),
  getActorForView: vi.fn(),                     // 값은 beforeEach 에서 — vi.hoisted 안에서는 import 한 픽스처를 쓸 수 없다
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
  getMinuteDetail: vi.fn(),
  getMinuteAnnotations: vi.fn(async () => []),
}))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: m.getComputedWbs }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: m.getSeatmap }))
vi.mock('@/lib/authz', () => ({ getActorForView: m.getActorForView, getActorViewState: async () => ({ actor: await m.getActorForView(), degraded: false }) }))
// GG1 — 프로젝트 페이지 관문(requireModulePage)이 화면 숨김을 다시 판정한다(getActorViewState + 비공개 숨김 집합). 이 파일은 비공개를 다루지 않는다 — 빈 집합
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
// 좌석표·회의록 상세는 /w/[slug] 아래 — 슬러그 판정이 워크스페이스 w1 을 준다(회의록은 행의 워크스페이스와 같아야 관문까지 간다)
vi.mock('@/lib/authz/workspaceScope', () => ({
  loadWorkspaceScope: vi.fn(async () => ({ ws: { id: 'w1', slug: 'acme', name: 'Acme' }, actor: await m.getActorForView(), degraded: false, role: 'member' })),
}))
vi.mock('@/lib/authz/agentsAccess', () => ({ canViewAgents: () => true }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => []) }))
vi.mock('@/components/kanban/KanbanBoard', () => ({ KanbanBoard: () => null }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: () => null }))
vi.mock('@/components/wbs/WbsRealtimeRefresh', () => ({ WbsRealtimeRefresh: () => null }))
vi.mock('@/components/agents/SeatmapView', () => ({ SeatmapView: () => null }))
vi.mock('next/navigation', () => ({ notFound: m.notFound, redirect: m.redirect }))
vi.mock('@/lib/data/minutes', () => ({
  getMinuteDetail: m.getMinuteDetail, getMinuteAnnotations: m.getMinuteAnnotations, getMinuteVersions: vi.fn(async () => []),
  getMinuteWikiImpact: vi.fn(), getMinuteVersionBody: vi.fn(), getMinuteFolderPath: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => null) }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: vi.fn(async () => ({})) }))
vi.mock('@/lib/data/issues', () => ({ getMinuteLinkedIssues: vi.fn(async () => []) }))
vi.mock('@/lib/data/members', () => ({ getProjectRoster: vi.fn(), getMyProjectIds: vi.fn(async () => []) }))
vi.mock('@/components/minutes/MinuteViewer', () => ({ MinuteViewer: () => null }))
import WbsPage from '@/app/(app)/p/[projectId]/wbs/page'
import AgentsPage from '@/app/(app)/w/[slug]/agents/page'
import MinuteDetailPage from '@/app/(app)/w/[slug]/minutes/[id]/page'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import { makeMemberActor } from '../fixtures/actor'

// 온전한 Actor 를 준다 — 칸반 페이지는 JSX props 에서 toProjectActorView(actor, projectId) 가 행위자의 맵(projectWorkspace·rosterTeams)을 읽는다.
// { userId, isSuperuser } 만 주면 '켜지면 로더가 돈다' 가 구현과 무관하게 TypeError 로 떨어진다(사전 점검 실측)
beforeEach(() => { vi.clearAllMocks(); m.getActorForView.mockResolvedValue(makeMemberActor('p1') as never) })
// 관문 mock 값을 바꾸는 파일 — 남은 Once 값이 뒤 케이스로 새지 않게 통과 구현으로 되돌린다(공통 규칙 '전역 mock')
afterEach(() => { for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset() })
describe('페이지 관문 — 거부면 로더가 돌지 않는다', () => {
  it('프로젝트 페이지(작업 계획) — { projectId } 와 wbs로 판정', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(WbsPage({ params: Promise.resolve({ projectId: 'p1' }), searchParams: Promise.resolve({ view: 'board' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'wbs')
    expect(m.getComputedWbs).not.toHaveBeenCalled()
  })
  it('워크스페이스 페이지(/w/[slug]/agents) — 슬러그 워크스페이스({ workspaceId })로 판정, 거부면 좌석표를 읽지 않는다', async () => {
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(AgentsPage({ params: Promise.resolve({ slug: 'acme' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: 'w1' }, 'agents')
    expect(requireSessionModule).not.toHaveBeenCalled()
    expect(m.getSeatmap).not.toHaveBeenCalled()
  })
  const openMinute = () => MinuteDetailPage({ params: Promise.resolve({ slug: 'acme', id: '00000000-0000-0000-7e57-0000000016fa' }), searchParams: Promise.resolve({}) })
  it('대상 행 페이지(/w/[slug]/minutes/[id]) — 행의 워크스페이스로 판정, 거부면 주석·버전 등 로더가 돌지 않는다', async () => {
    m.getMinuteDetail.mockResolvedValue({ minute: { workspaceId: 'w1' } })
    vi.mocked(requireModule).mockResolvedValueOnce({ ok: false, error: ERR_MODULE_DISABLED })
    await expect(openMinute()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(m.getMinuteDetail).toHaveBeenCalledWith('00000000-0000-0000-7e57-0000000016fa')
    expect(requireModule).toHaveBeenCalledWith({ workspaceId: 'w1' }, 'minutes')
    expect(m.getMinuteAnnotations).not.toHaveBeenCalled()
  })
  it('대상 행이 없으면(또는 워크스페이스를 모르면) 관문을 부르지 않고 404', async () => {
    m.getMinuteDetail.mockResolvedValue(null)
    await expect(openMinute()).rejects.toThrow('NEXT_NOT_FOUND')
    m.getMinuteDetail.mockResolvedValue({ minute: { workspaceId: null } })
    await expect(openMinute()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(requireModule).not.toHaveBeenCalled()
    expect(m.getMinuteAnnotations).not.toHaveBeenCalled()
  })
})
