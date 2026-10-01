// /w/[slug]/minutes 의 ?project= (D53, W11) — 접근 가능한 그 워크스페이스 프로젝트면 거르고 칩, 아니면 쿼리 무시(존재 은닉 — 안내도 없다). 칩 × 는 쿼리 제거
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(), requireModulePage: vi.fn(async () => {}), getMinutesPage: vi.fn(async () => []), getMinutesExplorer: vi.fn(async () => ({ folders: [], leaves: [], total: 0, truncated: false })),
  getMinuteFavorites: vi.fn(async () => []), getSession: vi.fn(async () => ({ id: 'u1' })), getAccountPrefs: vi.fn(async () => ({})), listProjects: vi.fn(async (): Promise<{ id: string; name: string; workspace_id: string }[]> => []),
  getServerLocale: vi.fn(async () => 'ko'), getMyProjectIds: vi.fn(async () => []), viewProps: vi.fn(),
}))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: h.requireModulePage }))
vi.mock('@/lib/data/minutes', () => ({ getMinutesPage: h.getMinutesPage, getMinutesExplorer: h.getMinutesExplorer, getMinuteFavorites: h.getMinuteFavorites }))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: h.getAccountPrefs }))
vi.mock('@/app/actions/project', () => ({ listProjects: h.listProjects }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: h.getServerLocale }))
vi.mock('@/lib/data/members', () => ({ getMyProjectIds: h.getMyProjectIds }))
vi.mock('@/components/minutes/MinutesView', () => ({ MinutesView: (p: unknown) => { h.viewProps(p); return null } }))

import MinutesPage from '@/app/(app)/w/[slug]/minutes/page'
import { makeMemberActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-000000001671', slug: 'acme', name: 'Acme' }
const P_IN = '00000000-0000-0000-7e57-000000001672', P_OTHER_WS = '00000000-0000-0000-7e57-000000001673', P_HIDDEN = '00000000-0000-0000-7e57-000000001674'
const render = async (q: Record<string, string | string[]>) => renderToString(await MinutesPage({ params: Promise.resolve({ slug: 'acme' }), searchParams: Promise.resolve(q) }))
const ROWS = [{ id: P_IN, name: 'Apollo', workspace_id: WS.id }, { id: P_OTHER_WS, name: 'Other', workspace_id: 'ws-other' }]

beforeEach(() => {
  vi.clearAllMocks()
  const actor = makeMemberActor(P_IN, [], { workspaceRoles: new Map([[WS.id, 'member']]), projectWorkspace: new Map([[P_IN, WS.id], [P_OTHER_WS, 'ws-other'], [P_HIDDEN, WS.id]]) })
  h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor, degraded: false, role: 'member' })
  h.listProjects.mockResolvedValue(ROWS)
})

describe('?project= 거르기(D53)', () => {
  it('접근 가능한 그 워크스페이스 프로젝트 — 로더·뷰에 projectId, 칩과 × 링크', async () => {
    const html = await render({ project: P_IN })
    expect(h.getMinutesPage).toHaveBeenCalledWith(WS.id, P_IN, expect.any(String), expect.any(String), null)
    expect(h.getMinutesExplorer).toHaveBeenCalledWith(WS.id, P_IN)
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ scope: { workspaceId: WS.id, projectId: P_IN } }))
    expect(html).toContain('프로젝트: <!-- -->Apollo')
    expect(html).toContain('href="/w/acme/minutes"')
  })
  it('다른 워크스페이스·목록에 없는(숨김) 프로젝트·형식 밖·중복 키는 무시 — 칩·안내 없음', async () => {
    for (const p of [P_OTHER_WS, P_HIDDEN, 'x', [P_IN, P_IN]]) {
      vi.clearAllMocks()
      const html = await render({ project: p })
      expect(h.getMinutesExplorer, String(p)).toHaveBeenCalledWith(WS.id, null)
      expect(h.viewProps, String(p)).toHaveBeenCalledWith(expect.objectContaining({ scope: { workspaceId: WS.id, projectId: null } }))
      expect(html, String(p)).not.toContain('프로젝트:')
    }
  })
  it('관문은 슬러그 워크스페이스로(첫 await loadWorkspaceScope 다음), 프로젝트 선택지는 그 워크스페이스 것만', async () => {
    await render({})
    expect(h.loadWorkspaceScope).toHaveBeenCalledWith('acme')
    expect(h.requireModulePage).toHaveBeenCalledWith({ workspaceId: WS.id }, 'minutes')
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ projects: [ROWS[0]] }))
  })
  it('열화(actor null)는 목록을 비우지 않고 범위로만 읽는다 — noProjectWorkspace 는 슬러그 워크스페이스', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: null, degraded: true, role: null })
    await render({ project: P_IN })
    expect(h.getMinutesPage).toHaveBeenCalledWith(WS.id, null, expect.any(String), expect.any(String), null)
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ noProjectWorkspace: { ok: true, workspaceId: WS.id } }))
  })
})
