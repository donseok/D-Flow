import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor } from '../fixtures/actor'

const h = vi.hoisted(() => ({
  editor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  views: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  slider: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div id="mock-slider" />),
  workspaceConfig: vi.fn(),
}))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn(async () => makeAdminActor('p1')), getActorViewState: async () => ({ actor: makeAdminActor('p1'), degraded: false }) }))
// GG1 — 프로젝트 페이지 관문(requireModulePage)이 화면 숨김을 다시 판정한다(getActorViewState + 비공개 숨김 집합). 이 파일은 비공개를 다루지 않는다 — 빈 집합
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]) }))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: vi.fn(async () => ({ ok: true, rows: [], nextBefore: null })) }))
vi.mock('@/lib/settings/projectConfig', async () => {
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  return { getProjectConfig: vi.fn(async () => makeProjectConfig({ 'core.level_labels': ['P'], 'modules.enabled': ['agents', 'kanban'] })) }
})
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: (...a: unknown[]) => h.workspaceConfig(...a) }))
vi.mock('@/lib/settings/workspaceLinks', () => ({ manageableWorkspaceLinks: vi.fn(async () => []) }))
vi.mock('@/app/actions/projectAreas', () => ({ listAreas: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/ai/health', () => ({ assistantIndexStatus: vi.fn(async () => ({ freshness: 'disabled', indexed: 0 })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }), useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/ui/SectionCard', () => ({ SectionCard: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <>{actions}{children}</> }))
vi.mock('@/components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('@/components/settings/ProjectTeamsManager', () => ({ ProjectTeamsManager: () => null }))
vi.mock('@/components/settings/ProjectAreasManager', () => ({ ProjectAreasManager: () => null }))
vi.mock('@/components/settings/LevelSettingsManager', () => ({ LevelSettingsManager: () => null }))
vi.mock('@/components/settings/MilestoneKeywordsEditor', () => ({ MilestoneKeywordsEditor: () => null }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: h.slider }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: () => null }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/CalendarSettingsPanel', () => ({ CalendarSettingsPanel: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: () => null }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: () => null }))
vi.mock('@/components/settings/ModuleToggleEditor', () => ({ ModuleToggleEditor: h.editor }))
vi.mock('@/components/settings/ViewsDefaultEditor', () => ({ ViewsDefaultEditor: h.views }))

import { requireModule } from '@/lib/modules/gate'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { ERR_MODULE_DISABLED } from '@/lib/authz/errors'
import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () => renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
const agentsModule = (on: boolean) => vi.mocked(requireModule).mockImplementation(async (_s, m) =>
  (!on && m === 'agents') ? { ok: false, error: ERR_MODULE_DISABLED } : { ok: true })

beforeEach(() => {
  vi.clearAllMocks()
  h.workspaceConfig.mockResolvedValue({ keys: { 'modules.allowed': { status: 'set', value: ['agents'] } } })
})
afterEach(() => { vi.mocked(requireModule).mockReset() })

describe('설정 페이지 — 프로젝트 모듈', () => {
  it('모듈 편집기에 저장값과 워크스페이스 허용 범위를 넘긴다', async () => {
    agentsModule(true); await render()
    expect(h.editor).toHaveBeenCalled()
    expect(h.editor.mock.calls[0][0]).toMatchObject({ projectId: 'p1', revision: 1, initialEnabled: ['agents', 'kanban'] })
    const options = h.editor.mock.calls[0][0].options as { id: string; allowed: boolean }[]
    expect(options.find(x => x.id === 'agents')?.allowed).toBe(true)
    expect(options.find(x => x.id === 'kanban')?.allowed).toBe(false)
  })
  it('워크스페이스 허용 설정이 손상되면 사유를 보이고 추가 허용을 막는다', async () => {
    h.workspaceConfig.mockResolvedValue({ keys: { 'modules.allowed': { status: 'invalid', error: 'bad' } } })
    const html = await render()
    expect(html).toContain('data-config-state="invalid"')
    expect(html).toContain('modules.allowed')
    expect(html).toContain('bad')
    expect((h.editor.mock.calls[0][0].options as { allowed: boolean }[]).every(x => !x.allowed)).toBe(true)
  })
  it('agents가 꺼져도 크레딧 편집기와 안내문이 남는다', async () => {
    agentsModule(false)
    const html = await render()
    expect(html).toContain('에이전트 모듈이 꺼져 있습니다.')
    expect(h.slider.mock.calls[0][0]).toMatchObject({ projectId: 'p1', editable: true })
    expect(html.indexOf('에이전트 모듈이 꺼져 있습니다.')).toBeLessThan(html.indexOf('mock-slider'))
  })
  it('모듈·메뉴 범주에 작업 계획 기본 보기 편집기 — 저장값(기본 표)·revision·칸반 관문 결과를 넘긴다(SP3b UI-3 과제 7)', async () => {
    agentsModule(true)
    const html = await render()
    expect(html).toContain('id="project-views-default"')
    expect(h.views.mock.calls[0][0]).toMatchObject({ projectId: 'p1', revision: 1, initial: { wbs: 'sheet' }, kanbanOn: true, invalidReason: undefined })
    expect(vi.mocked(requireModule)).toHaveBeenCalledWith({ projectId: 'p1' }, 'kanban')
    h.views.mockClear()
    vi.mocked(requireModule).mockImplementation(async (_s, m) => (m === 'kanban' ? { ok: false, error: ERR_MODULE_DISABLED } : { ok: true }))
    await render()
    expect(h.views.mock.calls[0][0]).toMatchObject({ kanbanOn: false })
  })
  it('views.default 가 손상이면 편집기에 initial null 과 사유를 넘긴다 — 복구 저장 경로(u3-3 리뷰 P2-10(b), workspace-settings-page 의 portal.widgets 손상과 대칭)', async () => {
    agentsModule(true)
    vi.mocked(getProjectConfig).mockResolvedValueOnce(makeProjectConfig({ 'core.level_labels': ['P'], 'modules.enabled': ['agents', 'kanban'], 'views.default': 'oops' }))
    await render()
    const props = h.views.mock.calls[0][0]
    expect(props).toMatchObject({ projectId: 'p1', initial: null })
    expect(typeof props.invalidReason).toBe('string'); expect((props.invalidReason as string).length).toBeGreaterThan(0)
  })
})
