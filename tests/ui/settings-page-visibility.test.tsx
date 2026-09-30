import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor, makeMemberActor, makeSuperuser } from '../fixtures/actor'

const h = vi.hoisted(() => ({
  workspaceTeams: vi.fn(), editor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  slider: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div id="mock-slider" />),
  workspaceConfig: vi.fn(), actor: vi.fn(), links: vi.fn(),
  privacy: vi.fn<(p: Record<string, unknown>) => null>(() => null), areas: vi.fn<(p: Record<string, unknown>) => null>(() => null),
}))
vi.mock('@/lib/teams/master', () => ({ projectTeamRowsSync: vi.fn(() => []), teamsForProjectSync: vi.fn(() => []), workspaceTeamsForProjectSync: h.workspaceTeams }))
vi.mock('@/lib/authz', () => ({ getActorForView: () => h.actor() }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]) }))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: vi.fn(async () => ({ ok: true, rows: [], nextBefore: null })) }))
vi.mock('@/lib/settings/projectConfig', async () => {
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  return { getProjectConfig: vi.fn(async () => makeProjectConfig({ 'core.level_labels': ['P'], 'modules.enabled': ['agents', 'kanban'] })) }
})
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: (...a: unknown[]) => h.workspaceConfig(...a) }))
vi.mock('@/lib/settings/workspaceLinks', () => ({ manageableWorkspaceLinks: (...a: unknown[]) => h.links(...a) }))
vi.mock('@/app/actions/projectAreas', () => ({ listAreas: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/ai/health', () => ({ assistantIndexStatus: vi.fn(async () => ({ freshness: 'disabled', indexed: 0 })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/ui/SectionCard', () => ({ SectionCard: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <>{actions}{children}</> }))
vi.mock('@/components/ui/PageHero', () => ({ PageHero: () => null, HeroBadge: () => null }))
vi.mock('@/components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('@/components/settings/ProjectTeamsManager', () => ({ ProjectTeamsManager: () => null }))
vi.mock('@/components/settings/ProjectAreasManager', () => ({ ProjectAreasManager: h.areas }))
vi.mock('@/components/settings/LevelSettingsManager', () => ({ LevelSettingsManager: () => null }))
vi.mock('@/components/settings/MilestoneKeywordsEditor', () => ({ MilestoneKeywordsEditor: () => null }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: h.slider }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: h.privacy }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: () => null }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: () => null }))
vi.mock('@/components/settings/ModuleToggleEditor', () => ({ ModuleToggleEditor: h.editor }))

import { requireModule } from '@/lib/modules/gate'
import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () => renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks(); h.workspaceTeams.mockReturnValue([])
  h.actor.mockResolvedValue(makeAdminActor('p1'))
  h.links.mockResolvedValue([])
  h.workspaceConfig.mockResolvedValue({ keys: { 'modules.allowed': { status: 'set', value: ['agents'] } } })
})
afterEach(() => { vi.mocked(requireModule).mockReset() })

describe('설정 페이지 — 표시 조건(스펙 §5.1·§9 #7·#8·#9)', () => {
  it('프로젝트 관리자가 아니면 대시보드로 돌려보낸다', async () => {
    h.actor.mockResolvedValue(makeMemberActor('p1'))
    await expect(render()).rejects.toThrow('NEXT_REDIRECT')
  })
  it('공개 범위 스위치는 플랫폼 관리자에게만 보인다(#9 — 서버 권한은 SP2 대로)', async () => {
    await render()
    expect(h.privacy).not.toHaveBeenCalled()
    h.actor.mockResolvedValue(makeSuperuser({ projectRoles: new Map([['p1', 'admin']]) }))
    await render()
    expect(h.privacy).toHaveBeenCalledTimes(1)
    expect(h.privacy.mock.calls[0][0]).toMatchObject({ projectId: 'p1' })
  })
  it('담당 영역 편집기와 추가 축 이름(core.extra_axis_label)은 화면에 없다(#7·#8)', async () => {
    h.actor.mockResolvedValue(makeSuperuser({ projectRoles: new Map([['p1', 'admin']]) }))
    const html = await render()
    expect(h.areas).not.toHaveBeenCalled()
    expect(html).not.toContain('core.extra_axis_label')
  })
  it('워크스페이스 설정 링크는 그 워크스페이스를 관리할 수 있을 때만 보인다', async () => {
    expect(await render()).not.toContain('워크스페이스 설정 →')
    h.links.mockResolvedValue([{ id: 'w1', slug: 'alpha', name: 'Alpha' }])
    const html = await render()
    expect(html).toContain('href="/w/alpha/settings"')
    expect(html).toContain('Alpha 워크스페이스 설정 →')
  })
  it('목차의 앵커가 범주 컨테이너 다섯을 스펙 순서로 가리키고 크레딧은 상태·승인 안에 든다', async () => {
    const html = await render()
    const at = (id: string) => html.indexOf(`id="${id}"`)
    const ids = ['project-general', 'project-modules', 'project-team', 'project-status', 'project-calendar']
    expect(ids.map(at).every(i => i >= 0)).toBe(true)
    expect(ids.map(at)).toEqual([...ids.map(at)].sort((a, b) => a - b))
    expect(html.indexOf('mock-slider')).toBeGreaterThan(at('project-status'))
    expect(html.indexOf('mock-slider')).toBeLessThan(at('project-calendar'))
  })
})
