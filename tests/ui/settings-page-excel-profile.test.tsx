import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor } from '../fixtures/actor'

// Task 1b — "저장된 양식 비우기"는 저장된 엑셀 양식이 있을 때만(손상 양식 포함 — 그게 풀어야 할 교착이다) 보인다.
// 설정 조회가 실패하면 있는지 모르는 양식을 비우라고 권하지 않는다.
const mocks = vi.hoisted(() => ({
  getProjectConfig: vi.fn(),
  ClearExcelProfileButton: vi.fn<(props: { projectId: string }) => null>(() => null),
}))
vi.mock('@/lib/teams/master', () => ({
  projectTeamRowsSync: vi.fn(() => []),
  teamsForProjectSync: vi.fn(() => []),
  workspaceTeamsForProjectSync: vi.fn(() => []),
}))
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn(async () => makeAdminActor('p1')) }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]),
}))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/lib/data/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/app/actions/projectAreas', () => ({ listAreas: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/ai/health', () => ({ assistantIndexStatus: vi.fn(async () => ({ freshness: 'disabled', indexed: 0 })) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('NEXT_REDIRECT') }) }))
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/app/ProjectPageShell', () => ({ ProjectPageShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/ui/SectionCard', () => ({ SectionCard: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/ui/PageHero', () => ({ PageHero: () => null, HeroBadge: () => null }))
vi.mock('@/components/ui/KpiCard', () => ({ KpiCard: () => null }))
vi.mock('@/components/settings/ProjectTeamsManager', () => ({ ProjectTeamsManager: () => null }))
vi.mock('@/components/settings/ProjectAreasManager', () => ({ ProjectAreasManager: () => null }))
vi.mock('@/components/settings/LevelSettingsManager', () => ({ LevelSettingsManager: () => null }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: () => null }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: () => null }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: () => null }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: () => null }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: mocks.ClearExcelProfileButton }))

import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () =>
  renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
const config = (excelProfile: Record<string, unknown>) =>
  ({ levelLabels: ['단계'], maxDepth: 1, extraAxisLabel: null, milestoneKeywords: [], excelProfile, stageCredits: null })

beforeEach(() => { vi.clearAllMocks() })

describe('설정 화면 — 저장된 엑셀 양식 비우기', () => {
  it.each([
    ['유효한 저장 양식', { version: 1, sheetName: 'WBS' }],
    ['손상된 저장 양식', { version: 2 }],
  ])('%s 이 있으면 버튼을 그 프로젝트로 그린다', async (_name, excelProfile) => {
    mocks.getProjectConfig.mockResolvedValue(config(excelProfile))
    const html = await render()
    expect(mocks.ClearExcelProfileButton.mock.calls.at(-1)![0]).toEqual({ projectId: 'p1' })
    expect(html).toContain('저장된 엑셀 양식이 있습니다')
  })

  it("저장 양식이 없으면('{}') 그리지 않는다", async () => {
    mocks.getProjectConfig.mockResolvedValue(config({}))
    const html = await render()
    expect(mocks.ClearExcelProfileButton).not.toHaveBeenCalled()
    expect(html).not.toContain('저장된 엑셀 양식이 있습니다')
  })

  it('설정 조회가 실패하면 그리지 않는다', async () => {
    mocks.getProjectConfig.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render()
    expect(mocks.ClearExcelProfileButton).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
