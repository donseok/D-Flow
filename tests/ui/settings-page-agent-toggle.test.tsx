import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor } from '../fixtures/actor'

// P8·스펙 §4.4 넷째 줄 — 설정 페이지 AGENT 카드: 옛 토글(enabled = 행 enabled ∧ agents 관문 통과), agents 가 꺼지면 크레딧 편집기 위에 안내문
// (편집기는 남고 편집 가능하다). 상태 조회 실패면 토글을 그리지 않는다. mock 머리는 settings-page-teams 와 같다.
const mocks = vi.hoisted(() => ({
  workspaceTeamsForProjectSync: vi.fn(),
  ProjectTeamsManager: vi.fn<(props: Record<string, unknown>) => null>(() => null),
  ReindexButton: vi.fn<(props: Record<string, unknown>) => null>(() => null),
}))
vi.mock('@/lib/teams/master', () => ({
  projectTeamRowsSync: vi.fn(() => []),
  teamsForProjectSync: vi.fn(() => []),
  workspaceTeamsForProjectSync: mocks.workspaceTeamsForProjectSync,
}))
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn(async () => makeAdminActor('p1')) }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]),
}))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/lib/settings/projectConfig', async () => {
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  return { getProjectConfig: vi.fn(async () => makeProjectConfig({ 'core.level_labels': ['P'] })) }
})
vi.mock('@/app/actions/projectAreas', () => ({ listAreas: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/ai/health', () => ({ assistantIndexStatus: vi.fn(async () => ({ freshness: 'disabled', indexed: 0 })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
// actions 도 그린다 — 에이전트 토글·허브 링크가 카드 머리(actions)에 있다.
vi.mock('@/components/ui/SectionCard', () => ({
  SectionCard: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <>{actions}{children}</>,
}))
vi.mock('@/components/ui/PageHero', () => ({ PageHero: () => null, HeroBadge: () => null }))
vi.mock('@/components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('@/components/settings/ProjectTeamsManager', () => ({ ProjectTeamsManager: mocks.ProjectTeamsManager }))
vi.mock('@/components/settings/ProjectAreasManager', () => ({ ProjectAreasManager: () => null }))
vi.mock('@/components/settings/LevelSettingsManager', () => ({ LevelSettingsManager: () => null }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: () => null }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: mocks.ReindexButton }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: () => null }))
const t = vi.hoisted(() => ({
  AgentProjectToggle: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  Slider: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div id="mock-slider" />),
  state: vi.fn(),
}))
vi.mock('@/components/settings/AgentProjectToggle', () => ({ AgentProjectToggle: t.AgentProjectToggle }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: t.Slider }))
vi.mock('@/app/actions/agentWork', () => ({ getAgentProjectState: t.state }))
import { requireModule } from '@/lib/modules/gate'                   // 전역 mock(과제 3)
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'

import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () =>
  renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)

/** agents 만 켜거나 끈다 — 페이지 관문(requireModulePage → requireModule(…, 'settings'))은 늘 통과시킨다 */
const agentsModule = (on: boolean) => vi.mocked(requireModule).mockImplementation(async (_s, m) =>
  (!on && (m === 'agents' || (Array.isArray(m) && m.includes('agents'))) ? { ok: false, error: ERR_MODULE_DISABLED } : { ok: true }))
const NOTICE = '에이전트 모듈이 꺼져 있습니다.'
// 팀 절이 workspaceTeamsForProjectSync(projectId).some(…) 을 부른다 — teams 테스트는 케이스마다 값을 주지만 여기는 기본값이 필요하다(없으면 7건 모두 TypeError).
// clearAllMocks 가 없으면 t.AgentProjectToggle.mock.calls[0] 에 앞 케이스의 호출이 남는다(2차 사전 점검 실측)
beforeEach(() => { vi.clearAllMocks(); mocks.workspaceTeamsForProjectSync.mockReturnValue([]) })
afterEach(() => { vi.mocked(requireModule).mockReset() })          // 전역 mock 의 mockReset 은 통과 구현으로 돌아간다(과제 3 이 고정)

describe('설정 페이지 — 에이전트 토글(P8)', () => {
  it.each([
    [true, true, { registered: true, enabled: true }],
    [true, false, { registered: true, enabled: false }],              // 행은 켜졌지만 모듈이 꺼짐(워크스페이스 허용 밖 포함) — '재개'를 누르면 모듈도 켠다
    [false, true, { registered: true, enabled: false }],              // 사람이 멈춤
  ])('행 enabled=%s · agents 관문=%s → %o', async (row, mod, props) => {
    agentsModule(mod)
    t.state.mockResolvedValue({ registered: true, enabled: row })
    await render()
    expect(t.AgentProjectToggle.mock.calls[0][0]).toMatchObject({ projectId: 'p1', ...props })
    expect(requireModule).toHaveBeenCalledWith({ projectId: 'p1' }, 'agents')
  })
  it('상태 조회 실패(null)면 토글을 그리지 않는다', async () => {
    agentsModule(true)
    t.state.mockResolvedValue(null)
    await render()
    expect(t.AgentProjectToggle).not.toHaveBeenCalled()
  })
  it('registered: false 이면 토글이 그 상태를 받고, getAgentProjectState 는 p1 으로 호출된다', async () => {
    agentsModule(true)
    t.state.mockResolvedValue({ registered: false, enabled: false })
    await render()
    expect(t.state).toHaveBeenCalledWith('p1')
    expect(t.AgentProjectToggle.mock.calls[0][0]).toMatchObject({ projectId: 'p1', registered: false, enabled: false })
  })
})

describe('설정 페이지 — agents 가 꺼져도 크레딧 편집기는 남고 안내문을 보인다(스펙 §4.4, 정본 §3.3.1)', () => {
  it('관문 거부 → 안내문이 있고 편집기가 편집 가능하게 그려진다. 안내문은 편집기 위에 나온다', async () => {
    agentsModule(false)
    t.state.mockResolvedValue({ registered: true, enabled: true })
    const html = await render()
    expect(html).toContain(NOTICE)
    expect(t.Slider).toHaveBeenCalled()
    expect(t.Slider.mock.calls[0][0]).toMatchObject({ projectId: 'p1', editable: true })
    expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf('mock-slider'))
  })
  it('관문 통과 → 안내문이 없다', async () => {
    agentsModule(true)
    t.state.mockResolvedValue({ registered: true, enabled: true })
    expect(await render()).not.toContain(NOTICE)
    expect(t.Slider).toHaveBeenCalled()
  })
  it('행은 enabled 인데 관문이 거부하면 토글은 꺼짐', async () => {
    agentsModule(false)
    t.state.mockResolvedValue({ registered: true, enabled: true })
    await render()
    expect(t.AgentProjectToggle.mock.calls[0][0]).toMatchObject({ enabled: false })
  })
})
