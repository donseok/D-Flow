import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor, makeMemberActor, makeSuperuser, WS } from '../fixtures/actor'

const h = vi.hoisted(() => ({
  editor: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  slider: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div id="mock-slider" />),
  workspaceConfig: vi.fn(), actor: vi.fn(), links: vi.fn(),
  privacy: vi.fn<(p: Record<string, unknown>) => null>(() => null), areas: vi.fn<(p: Record<string, unknown>) => null>(() => null),
}))
// 팀 원천은 요청 범위 원천(SP4 §4.2.1) — 기본 픽스처 팀이면 팀 절·업무영역 편집기가 그려진다
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/authz', () => ({ getActorForView: () => h.actor(), getActorViewState: async () => ({ actor: await h.actor(), degraded: false }) }))
// GG1 — 프로젝트 페이지 관문(requireModulePage)이 화면 숨김을 다시 판정한다(getActorViewState + 비공개 숨김 집합). 이 파일은 비공개를 다루지 않는다 — 빈 집합
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({ listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]) }))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: vi.fn(async () => ({ ok: true, rows: [], nextBefore: null })) }))
vi.mock('@/lib/settings/projectConfig', async () => {
  const { makeProjectConfig } = await import('../helpers/projectConfigFixture')
  const area = (id: string, kind: 'weekly_section' | 'issue_area', code: string, name: string) =>
    ({ id, kind, code, name, sortOrder: 0, active: true, teams: [] })
  return {
    getProjectConfig: vi.fn(async () => makeProjectConfig({ 'core.level_labels': ['P'], 'modules.enabled': ['agents', 'kanban', 'issues', 'issue_analysis'] }, {
      projectId: 'p1',
      areas: { weekly_section: [area('a-exp', 'weekly_section', 'EXP', '실험')], issue_area: [area('a-iss', 'issue_area', 'ISS', '이슈 표본')] },
    })),
  }
})
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: (...a: unknown[]) => h.workspaceConfig(...a) }))
vi.mock('@/lib/settings/workspaceLinks', () => ({ manageableWorkspaceLinks: (...a: unknown[]) => h.links(...a) }))
vi.mock('@/lib/ai/health', () => ({ assistantIndexStatus: vi.fn(async () => ({ freshness: 'disabled', indexed: 0 })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }) }))
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
vi.mock('@/components/settings/CalendarSettingsPanel', () => ({ CalendarSettingsPanel: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: () => null }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: () => null }))
vi.mock('@/components/settings/ModuleToggleEditor', () => ({ ModuleToggleEditor: h.editor }))

import { requireModule } from '@/lib/modules/gate'
import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () => renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks()
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
    h.actor.mockResolvedValue(makeSuperuser({ projectRoles: new Map([['p1', 'admin']]), projectWorkspace: new Map([['p1', WS]]) }))
    await render()
    expect(h.privacy).toHaveBeenCalledTimes(1)
    expect(h.privacy.mock.calls[0][0]).toMatchObject({ projectId: 'p1' })
  })
  it('주간 업무영역과 이슈 영역 편집기를 각각의 종류와 함께 표시한다(SP4 D26·SP5 B1)', async () => {
    h.actor.mockResolvedValue(makeSuperuser({ projectRoles: new Map([['p1', 'admin']]), projectWorkspace: new Map([['p1', WS]]) }))
    const html = await render()
    expect(h.areas).toHaveBeenCalledTimes(2)
    const props = h.areas.mock.calls[0][0]
    expect(props).toMatchObject({ projectId: 'p1', kind: 'weekly_section' })
    expect((props.areas as Array<{ code: string; kind: string }>).map(a => [a.code, a.kind])).toEqual([['EXP', 'weekly_section']])
    expect(JSON.stringify(props)).not.toContain('issue_area')
    const issueProps = h.areas.mock.calls.map(call => call[0]).find(p => p.kind === 'issue_area')
    expect(issueProps).toMatchObject({ kind: 'issue_area', locale: 'ko' })
    expect((issueProps?.areas as Array<{ code: string; kind: string }>).map(a => [a.code, a.kind])).toEqual([['ISS', 'issue_area']])
    expect(html).toContain('id="project-issues"')
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
    const ids = ['project-general', 'project-modules', 'project-team', 'project-issues', 'project-status', 'project-calendar']
    expect(ids.map(at).every(i => i >= 0)).toBe(true)
    expect(ids.map(at)).toEqual([...ids.map(at)].sort((a, b) => a - b))
    expect(html.indexOf('mock-slider')).toBeGreaterThan(at('project-status'))
    expect(html.indexOf('mock-slider')).toBeLessThan(at('project-calendar'))
  })
})
