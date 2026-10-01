import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'
import { makeAdminActor } from '../fixtures/actor'
import { makeProjectConfig } from '../helpers/projectConfigFixture'
import { LEGACY_EXCEL_PROFILE_V1 } from '../fixtures/excel/legacy-3row-profile'
import { ConfigUnavailableError } from '@/lib/settings/errors'

// Task 1b — "저장된 양식 비우기"는 저장된 엑셀 양식이 있을 때만(손상 양식 포함 — 그게 풀어야 할 교착이다) 보인다.
// 설정 조회가 실패하면 있는지 모르는 양식을 비우라고 권하지 않는다.
const mocks = vi.hoisted(() => ({
  getProjectConfig: vi.fn(),
  ClearExcelProfileButton: vi.fn<(props: { projectId: string }) => null>(() => null),
  ExportExcelButton: vi.fn<(props: { projectId: string; layout: unknown }) => null>(() => null),
  latestKeyChange: vi.fn(async (): Promise<{ ok: true; changedAt: string | null; source: string | null } | { ok: false; error: string }> => ({ ok: true, changedAt: null, source: null })),
}))
vi.mock('@/lib/teams/source', async () => (await import('../helpers/teams-source-mock')).teamsSourceMock())
vi.mock('@/lib/authz', () => ({ getActorForView: vi.fn(async () => makeAdminActor('p1')) }))
vi.mock('@/lib/data/wbs', () => ({ getComputedWbs: vi.fn(async () => ({ items: [], holidays: [] })) }))
vi.mock('@/app/actions/project', () => ({
  listProjects: vi.fn(async () => [{ id: 'p1', name: 'Acme', start_date: null, end_date: null }]),
}))
vi.mock('@/app/actions/llmConfig', () => ({ getLlmConfig: vi.fn(async () => ({ error: 'x' })) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: vi.fn(async () => ({ ok: true, rows: [], nextBefore: null })) }))
vi.mock('@/lib/settings/projectConfig', () => ({ getProjectConfig: mocks.getProjectConfig }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: vi.fn(async () => ({ keys: { 'modules.allowed': { status: 'set', value: ['agents'] } } })) }))
vi.mock('@/lib/settings/workspaceLinks', () => ({ manageableWorkspaceLinks: vi.fn(async () => []) }))
vi.mock('@/components/settings/ModuleToggleEditor', () => ({ ModuleToggleEditor: () => null }))
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
vi.mock('@/components/settings/MilestoneKeywordsEditor', () => ({ MilestoneKeywordsEditor: () => null }))
vi.mock('@/components/settings/StageCreditSlider', () => ({ StageCreditSlider: () => null }))
vi.mock('@/components/settings/ProjectInfoEditButton', () => ({ ProjectInfoEditButton: () => null }))
vi.mock('@/components/settings/ProjectPrivacyToggle', () => ({ ProjectPrivacyToggle: () => null }))
vi.mock('@/components/settings/ScheduleManager', () => ({ ScheduleManager: () => null }))
vi.mock('@/components/settings/ReindexButton', () => ({ ReindexButton: () => null }))
vi.mock('@/components/settings/ExportExcelButton', () => ({ ExportExcelButton: mocks.ExportExcelButton }))
vi.mock('@/lib/settings/history', () => ({ latestKeyChange: mocks.latestKeyChange }))
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn(async () => ({ from: vi.fn() })) }))
vi.mock('@/components/settings/ClearExcelProfileButton', () => ({ ClearExcelProfileButton: mocks.ClearExcelProfileButton }))

import SettingsPage from '@/app/(app)/p/[projectId]/settings/page'

const render = async () =>
  renderToStaticMarkup((await SettingsPage({ params: Promise.resolve({ projectId: 'p1' }) })) as ReactElement)
const config = (profile?: unknown) =>
  makeProjectConfig({ 'core.level_labels': ['P'], ...(profile === undefined ? {} : { 'wbs.excel_profile': profile }) })

beforeEach(() => { vi.clearAllMocks() })

describe('설정 화면 — 저장된 엑셀 양식 비우기', () => {
  it.each([
    ['유효한 저장 양식', LEGACY_EXCEL_PROFILE_V1],
    ['손상된 저장 양식', { version: 2 }],
  ])('%s 이 있으면 버튼을 그 프로젝트로 그린다', async (_name, excelProfile) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})   // 손상 키는 해석기가 로그를 남긴다
    mocks.getProjectConfig.mockResolvedValue(config(excelProfile))
    const html = await render()
    expect(mocks.ClearExcelProfileButton.mock.calls.at(-1)![0]).toEqual({ projectId: 'p1', revision: 1 })   // revision = 설정 문서의 CAS 값
    expect(html).toContain('저장된 엑셀 양식이 있습니다')
  })

  it.each([
    ['키 없음(기본값)', undefined],
    ['명시적 null(비운 뒤)', null],
  ])('저장 양식이 없으면(%s) 그리지 않는다', async (_name, profile) => {
    mocks.getProjectConfig.mockResolvedValue(config(profile))
    const html = await render()
    expect(mocks.ClearExcelProfileButton).not.toHaveBeenCalled()
    expect(html).not.toContain('저장된 엑셀 양식이 있습니다')
  })

  it('설정 조회가 실패하면 버튼 대신 페이지의 오류 상태를 그린다 — 나머지 절은 그린다', async () => {
    mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const html = await render()
    expect(mocks.ClearExcelProfileButton).not.toHaveBeenCalled()
    expect(html).toContain('설정을 불러오지 못해 이 화면을 그릴 수 없습니다')
    expect(html).toContain('data-config-load-error')
    expect(html).not.toContain('db down')   // 원문은 로그에만(I-2)
    err.mockRestore()
  })
})

describe('내보내기 표기(D48)', () => {
  const layoutProp = () => mocks.ExportExcelButton.mock.calls.at(-1)?.[0].layout
  it('저장 양식이 없으면 표준', async () => {
    mocks.getProjectConfig.mockResolvedValue(config())
    await render()
    expect(layoutProp()).toEqual({ kind: 'standard' })
    expect(mocks.latestKeyChange).not.toHaveBeenCalled()
  })
  it('저장 양식이면 그 키의 최신 변경 날짜(서울 날짜)', async () => {
    mocks.getProjectConfig.mockResolvedValue(config(LEGACY_EXCEL_PROFILE_V1))
    mocks.latestKeyChange.mockResolvedValue({ ok: true, changedAt: '2026-09-30T03:00:00Z', source: 'internal' })
    await render()
    expect(layoutProp()).toEqual({ kind: 'saved', savedAt: '2026-09-30', viaWizard: true })
    expect(mocks.latestKeyChange).toHaveBeenCalledWith(expect.anything(), { projectId: 'p1' }, 'wbs.excel_profile')
  })
  it('[U5] 마법사가 아닌 출처(복사)면 viaWizard 거짓 — "임포트 마법사"라 적지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(config(LEGACY_EXCEL_PROFILE_V1))
    mocks.latestKeyChange.mockResolvedValue({ ok: true, changedAt: '2026-09-30T03:00:00Z', source: 'copy' })
    await render()
    expect(layoutProp()).toEqual({ kind: 'saved', savedAt: '2026-09-30', viaWizard: false })
  })
  it('이력 조회 실패는 날짜 미상 + 로그 — 표준으로 위장하지 않는다', async () => {
    mocks.getProjectConfig.mockResolvedValue(config(LEGACY_EXCEL_PROFILE_V1))
    mocks.latestKeyChange.mockResolvedValue({ ok: false, error: '이력 조회 실패' })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render()
    expect(layoutProp()).toEqual({ kind: 'saved', savedAt: null, viaWizard: false })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('손상 양식·설정 조회 실패면 표기하지 않는다(모르는 것을 말하지 않는다)', async () => {
    mocks.getProjectConfig.mockResolvedValue(config({ version: 2 }))
    await render()
    expect(layoutProp()).toBeNull()
    mocks.getProjectConfig.mockRejectedValue(new ConfigUnavailableError('x'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await render()
    expect(layoutProp()).toBeNull()
    err.mockRestore()
  })
})
