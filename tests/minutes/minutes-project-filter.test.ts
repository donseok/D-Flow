// /w/[slug]/minutes 의 ?project= (D53, W11) — 접근 가능한 그 워크스페이스 프로젝트면 거르고 칩, 아니면 쿼리 무시(존재 은닉 — 안내도 없다). 칩 × 는 쿼리 제거
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  loadWorkspaceScope: vi.fn(), requireModulePage: vi.fn(async () => {}), getMinutesPage: vi.fn(async () => []), getMinutesExplorer: vi.fn(async () => ({ folders: [], leaves: [], total: 0, truncated: false })),
  getMinuteFavorites: vi.fn(async () => []), getSession: vi.fn(async () => ({ id: 'u1' })), getAccountPrefs: vi.fn(async () => ({})), listProjects: vi.fn(async (): Promise<{ id: string; name: string; workspace_id: string }[]> => []),
  getServerLocale: vi.fn(async () => 'ko'), getMyProjectIds: vi.fn(async () => []), viewProps: vi.fn(),
  hasMinutesWithoutTeam: vi.fn(async () => false),
  workspaceTeams: vi.fn(async (): Promise<unknown[]> => []), projectTeams: vi.fn(async (): Promise<unknown[]> => []),
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT ${url}`) }),
}))
vi.mock('@/lib/teams/source', () => ({ workspaceTeams: h.workspaceTeams, projectTeams: h.projectTeams }))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('@/lib/authz/workspaceScope', () => ({ loadWorkspaceScope: h.loadWorkspaceScope }))
vi.mock('@/lib/modules/pageGate', () => ({ requireModulePage: h.requireModulePage }))
vi.mock('@/lib/data/minutes', () => ({
  getMinutesPage: h.getMinutesPage, getMinutesExplorer: h.getMinutesExplorer, getMinuteFavorites: h.getMinuteFavorites,
  hasMinutesWithoutTeam: h.hasMinutesWithoutTeam,
}))
vi.mock('@/lib/auth', () => ({ getSession: h.getSession }))
vi.mock('@/app/actions/preferences', () => ({ getAccountPrefs: h.getAccountPrefs }))
vi.mock('@/app/actions/project', () => ({ listProjects: h.listProjects }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: h.getServerLocale }))
// 칩(MinutesProjectChip)은 useLocale 로 문구를 읽는다 — 공급자 밖 기본값은 키를 돌려주므로 진짜 ko 사전을 물린다
vi.mock('@/components/providers/LocaleProvider', async () => {
  const { t } = await import('@/lib/i18n/dict')
  const ko = (k: string) => t('ko', k as Parameters<typeof t>[1])   // 렌더마다 같은 함수(effect 의존성 안정)
  return { useLocale: () => ({ locale: 'ko', t: ko, setLocale: () => {} }) }
})
vi.mock('@/lib/data/members', () => ({ getMyProjectIds: h.getMyProjectIds }))
vi.mock('@/components/minutes/MinutesView', () => ({ MinutesView: (p: unknown) => { h.viewProps(p); return null } }))
// '오늘'·첫 열 = 그 워크스페이스 달력(SP5 — merge 뒤 슬러그 워크스페이스). 이 파일은 달력 축을 보지 않는다
vi.mock('@/lib/calendar/viewZone', async () => ({ viewCalendar: async () => ({ ok: true, calendar: (await import('../helpers/calendarFixture')).calUtcSun }) }))

import MinutesPage from '@/app/(app)/w/[slug]/minutes/page'
import { makeActor, makeMemberActor } from '../fixtures/actor'

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
    expect(h.getMinutesExplorer).toHaveBeenCalledWith(WS.id, P_IN, expect.anything())
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ scope: { workspaceId: WS.id, projectId: P_IN } }))
    expect(html).toContain('프로젝트: <!-- -->Apollo')
    expect(html).toContain('href="/w/acme/minutes"')
  })
  it('다른 워크스페이스·목록에 없는(숨김) 프로젝트·형식 밖·중복 키는 무시 — 칩·안내 없음', async () => {
    for (const p of [P_OTHER_WS, P_HIDDEN, 'x', [P_IN, P_IN]]) {
      vi.clearAllMocks()
      const html = await render({ project: p })
      expect(h.getMinutesExplorer, String(p)).toHaveBeenCalledWith(WS.id, null, expect.anything())
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

describe('업로드 어포던스·기본 팀·즐겨찾기는 화면의 워크스페이스 기준(UI-2a 최종 수정 FA3)', () => {
  const OTHER = '00000000-0000-0000-7e57-00000000167c', P_OTHER = '00000000-0000-0000-7e57-00000000167d'
  /** 다른 워크스페이스(OTHER)에서만 프로젝트 역할·대표 팀이 있고 이 화면의 워크스페이스에서는 멤버일 뿐 */
  const duoActor = (inWs = false) => makeActor({
    workspaceRoles: new Map([[WS.id, 'member'], [OTHER, 'member']]),
    projectWorkspace: new Map([[P_OTHER, OTHER], [P_IN, WS.id]]),
    projectRoles: new Map<string, 'admin' | 'member'>([[P_OTHER, 'member'], ...(inWs ? [[P_IN, 'member'] as [string, 'member']] : [])]),
    rosterTeams: new Map([[P_OTHER, { teamIds: ['t-erp'], teamCodes: ['ERP'] }], ...(inWs ? [[P_IN, { teamIds: ['t-mes'], teamCodes: ['MES'] }] as [string, { teamIds: string[]; teamCodes: string[] }]] : [])]),
  })
  it('다른 워크스페이스에서만 역할이 있으면 업로드 버튼(canEdit)이 없고 기본 팀도 그 워크스페이스의 것이 아니다', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: duoActor(), degraded: false, role: 'member' })
    await render({})
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ canEdit: false, defaultTeam: null }))
  })
  it('이 워크스페이스에 역할이 있으면 canEdit, 기본 팀은 이 워크스페이스 프로젝트의 대표 팀', async () => {
    h.loadWorkspaceScope.mockResolvedValue({ ws: WS, actor: duoActor(true), degraded: false, role: 'member' })
    await render({})
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ canEdit: true, defaultTeam: 'MES' }))
  })
  it('즐겨찾기 첫 적재도 화면의 워크스페이스로 읽는다', async () => {
    await render({})
    expect(h.getMinuteFavorites).toHaveBeenCalledWith(WS.id)
  })
})

describe('?team= — 담당 필터는 팀 id, 옛 code 링크는 id 로 리다이렉트(SP5 B2 — W36)', () => {
  const T_QA = '00000000-0000-4000-8000-0000000000a1', T_QA_P = '00000000-0000-4000-8000-0000000000a2', T_OLD = '00000000-0000-4000-8000-0000000000a3'
  const team = (id: string, code: string, projectId: string | null, active = true) =>
    ({ id, code, name: `${code} 팀`, color: '#6b7280', sortOrder: 0, active, progressVisible: true, projectId, workspaceId: WS.id })
  beforeEach(() => {
    h.workspaceTeams.mockResolvedValue([team(T_QA, 'QA', null), team(T_OLD, 'OLD', null, false)])
    h.projectTeams.mockResolvedValue([team(T_QA_P, 'QA', P_IN)])
  })
  it('선택지의 팀 id 면 그 팀으로 거르고 뷰에 선택지(활성 팀)·초기 팀을 넘긴다', async () => {
    await render({ team: T_QA })
    expect(h.getMinutesPage).toHaveBeenCalledWith(WS.id, null, expect.any(String), expect.any(String), T_QA)
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ initialTeamId: T_QA, teamOptions: [{ id: T_QA, code: 'QA', name: 'QA 팀' }] }))
  })
  it('옛 ?team=<code> 는 그 범위의 code 단위 해석으로 id 리다이렉트 — 프로젝트를 고르면 그 프로젝트의 전용 팀', async () => {
    await expect(render({ team: 'QA' })).rejects.toThrow(`REDIRECT /w/acme/minutes?team=${T_QA}`)
    await expect(render({ project: P_IN, team: 'QA' })).rejects.toThrow(`REDIRECT /w/acme/minutes?project=${P_IN}&team=${T_QA_P}`)
  })
  it('모르는 code·선택지 밖 id(비활성 팀 포함)·빈 값은 팀 파라미터를 지운다(존재 은닉 — 안내 없음)', async () => {
    for (const v of ['NOPE', T_OLD, T_QA_P, '']) {
      await expect(render({ team: v }), v).rejects.toThrow('REDIRECT /w/acme/minutes')
      await expect(render({ team: v }), v).rejects.not.toThrow('team=')
    }
  })
  it('파라미터가 없으면 거르지 않는다', async () => {
    await render({})
    expect(h.getMinutesPage).toHaveBeenCalledWith(WS.id, null, expect.any(String), expect.any(String), null)
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ initialTeamId: null }))
  })
  it('?team=none 은 팀 없는 회의록 필터(0052) — 리다이렉트 없이 그 값으로 거르고, 그 범위에 팀 없는 회의록이 있는지를 뷰에 넘긴다', async () => {
    h.hasMinutesWithoutTeam.mockResolvedValueOnce(true)
    await render({ team: 'none' })
    expect(h.redirect).not.toHaveBeenCalled()
    expect(h.getMinutesPage).toHaveBeenCalledWith(WS.id, null, expect.any(String), expect.any(String), 'none')
    expect(h.hasMinutesWithoutTeam).toHaveBeenCalledWith(WS.id, null)
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ initialTeamId: 'none', hasNoTeamMinutes: true }))
    h.viewProps.mockClear()
    await render({ project: P_IN })
    expect(h.hasMinutesWithoutTeam).toHaveBeenLastCalledWith(WS.id, P_IN)
    expect(h.viewProps).toHaveBeenCalledWith(expect.objectContaining({ hasNoTeamMinutes: false }))
  })
})
