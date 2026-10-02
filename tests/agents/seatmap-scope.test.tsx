import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(), requireModulePage: vi.fn(async () => {}), getSeatmap: vi.fn(async () => ({ floors: [] })),
  redirect: vi.fn((u: string) => { throw new Error(`NEXT_REDIRECT:${u}`) }),
  viewTimezone: vi.fn<(wid: string) => Promise<{ ok: true; timeZone: string }>>(async () => ({ ok: true, timeZone: 'UTC' })),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: h.requireModulePage }))
vi.mock('@/lib/data/agentSeatmap', () => ({ getSeatmap: h.getSeatmap }))
vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: vi.fn() }))
vi.mock('@/components/agents/SeatmapView', () => ({ SeatmapView: () => null }))
// 화면의 tz = 그 워크스페이스 달력(SP5 — merge 뒤 슬러그 워크스페이스)
vi.mock('@/lib/calendar/viewZone', () => ({ viewTimezone: h.viewTimezone }))

import AgentsPage from '@/app/(app)/w/[slug]/agents/page'
import { makeActor, makeMemberActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-0000000016a5', slug: 'acme', name: 'Acme' }
const P1 = '00000000-0000-0000-7e57-0000000016a6'
const run = () => AgentsPage({ params: Promise.resolve({ slug: 'acme' }) })
beforeEach(() => { vi.clearAllMocks() })

describe('/w/[slug]/agents — 그 워크스페이스 좌석표', () => {
  it('그 워크스페이스에 역할이 있으면 관문 뒤 그 워크스페이스로 좌석표', async () => {
    const actor = makeMemberActor(P1, [], { workspaceRoles: new Map([[WS.id, 'member']]), projectWorkspace: new Map([[P1, WS.id]]) })
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor, degraded: false, role: 'member' })
    await run()
    expect(h.requireModulePage).toHaveBeenCalledWith({ workspaceId: WS.id }, 'agents')
    expect(h.getSeatmap).toHaveBeenCalledWith(actor, expect.any(Number), 'all', { workspaceId: WS.id })
    expect(h.viewTimezone).toHaveBeenCalledWith(WS.id)
  })
  it('소속이지만 역할 없음 → /w/<slug>(D7), service_role 로더 미호출', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: makeActor({ workspaceRoles: new Map([[WS.id, 'member']]) }), degraded: false, role: 'member' })
    await expect(run()).rejects.toThrow('NEXT_REDIRECT:/w/acme')
    expect(h.getSeatmap).not.toHaveBeenCalled()
  })
  it('열화(actor null)도 로더를 부르지 않는다(fail-closed)', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    await expect(run()).rejects.toThrow('NEXT_REDIRECT')
    expect(h.getSeatmap).not.toHaveBeenCalled()
  })
})
