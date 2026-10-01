import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement, ReactNode } from 'react'

const h = vi.hoisted(() => ({
  access: vi.fn(), config: vi.fn(), history: vi.fn(), events: vi.fn(),
  eventsList: vi.fn<(p: Record<string, unknown>) => null>(() => null),
  allowEditor: vi.fn<(p: Record<string, unknown>) => ReactNode>(() => <div id="mock-allow-editor" />),
  shell: vi.fn<(p: { items: { id: string; label: string }[]; children: ReactNode }) => ReactNode>(({ children }) => <>{children}</>),
  redirect: vi.fn((to: string): never => { throw new Error(`NEXT_REDIRECT ${to}`) }),
}))
vi.mock('@/lib/settings/workspacePageAccess', () => ({ workspacePageAccess: (...a: unknown[]) => h.access(...a) }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: (...a: unknown[]) => h.config(...a) }))
vi.mock('@/app/actions/settings', () => ({ listSettingsHistory: (...a: unknown[]) => h.history(...a) }))
vi.mock('@/app/actions/authzEvents', () => ({ listAuthzEvents: (...a: unknown[]) => h.events(...a) }))
vi.mock('@/components/settings/AuthzEventsList', () => ({ AuthzEventsList: (p: Record<string, unknown>) => h.eventsList(p) }))
vi.mock('@/lib/i18n/server', () => ({ getServerLocale: vi.fn(async () => 'ko') }))
vi.mock('next/navigation', () => ({ redirect: h.redirect }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/ui/SectionCard', () => ({ SectionCard: ({ id, children }: { id: string; children: ReactNode }) => <section id={id}>{children}</section> }))
vi.mock('@/components/settings/SettingsShell', () => ({ SettingsShell: (p: { items: { id: string; label: string }[]; children: ReactNode }) => h.shell(p) }))
vi.mock('@/components/settings/ModuleAllowEditor', () => ({ ModuleAllowEditor: h.allowEditor }))
vi.mock('@/components/settings/WorkspaceFieldsEditor', () => ({ WorkspaceFieldsEditor: () => null }))
vi.mock('@/components/settings/LogoEditor', () => ({ LogoEditor: () => null }))
vi.mock('@/components/settings/AccentEditor', () => ({ AccentEditor: () => null }))
vi.mock('@/components/settings/MenuOrderEditor', () => ({ MenuOrderEditor: () => null }))
vi.mock('@/components/settings/SettingsHistoryList', () => ({ SettingsHistoryList: () => null }))
vi.mock('@/components/settings/ConfigLoadError', () => ({ ConfigLoadError: ({ error }: { error: string }) => <p data-load-error>{error}</p> }))

import WorkspaceSettingsPage from '@/app/(app)/w/[slug]/settings/page'
import { ConfigUnavailableError } from '@/lib/settings/errors'
import { WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'

const WID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'
const config = (values: Record<string, unknown> = {}) => ({
  workspaceId: WID, revision: 7, schemaVersion: 1, schemaAhead: false, unknownKeys: [],
  keys: resolveKeys({ scope: 'workspace', id: WID, values, defs: WORKSPACE_SETTINGS, env: { NODE_ENV: 'test' } }).keys,
})
const access = (over: Record<string, unknown> = {}) => ({ id: WID, slug: 'alpha', name: 'Alpha', isSuperuser: false, isAdmin: true, ...over })
const render = async () => renderToStaticMarkup((await WorkspaceSettingsPage({ params: Promise.resolve({ slug: 'alpha' }) })) as ReactElement)

beforeEach(() => {
  vi.clearAllMocks()
  h.access.mockResolvedValue(access())
  h.config.mockResolvedValue(config())
  h.history.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
  h.events.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
})

describe('/w/[slug]/settings 페이지', () => {
  it('워크스페이스 관리자가 아니면 /projects 로 돌려보내고 설정을 읽지 않는다', async () => {
    h.access.mockResolvedValue(access({ isAdmin: false }))
    await expect(render()).rejects.toThrow('NEXT_REDIRECT /projects')
    expect(h.config).not.toHaveBeenCalled()
  })

  it('다섯 범주 목차를 스펙 순서로 낸다', async () => {
    await render()
    expect(h.shell.mock.calls[0][0].items).toEqual([
      { id: 'workspace-general', label: '일반' }, { id: 'workspace-modules', label: '모듈·AI' },
      { id: 'workspace-invites', label: '초대' }, { id: 'workspace-menu', label: '메뉴' }, { id: 'workspace-history', label: '기록' },
    ])
  })

  it('모듈 허용 구역은 플랫폼 관리자에게만 보인다', async () => {
    await render()
    expect(h.allowEditor).not.toHaveBeenCalled()
    h.access.mockResolvedValue(access({ isSuperuser: true }))
    await render()
    expect(h.allowEditor).toHaveBeenCalledTimes(1)
    expect(h.allowEditor.mock.calls[0][0]).toMatchObject({ workspaceId: WID, revision: 7 })
  })

  it('공용 팀 링크는 플랫폼 관리자에게만 — 그 밖에는 눌러서 튕기는 링크 없이 안내만', async () => {
    expect(await render()).not.toContain('href="/admin/teams"')
    h.access.mockResolvedValue(access({ isSuperuser: true }))
    expect(await render()).toContain('href="/admin/teams"')
  })

  it('설정 조회 실패는 404 나 빈 화면이 아니라 오류 화면이고 로그를 남긴다', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.config.mockRejectedValue(new ConfigUnavailableError('db down'))
    expect(await render()).toContain('data-load-error')
    expect(error).toHaveBeenCalledWith('[workspace settings] 설정 조회 실패:', expect.objectContaining({ workspaceId: WID }))
    error.mockRestore()
  })

  it('설정 조회 실패가 아닌 예외는 삼키지 않고 다시 던진다', async () => {
    h.config.mockRejectedValue(new Error('boom'))
    await expect(render()).rejects.toThrow('boom')
  })

  it('기록 범주에 설정 변경과 권한 변경 목록이 함께 있고, 권한 목록에는 이 워크스페이스의 첫 페이지를 넘긴다', async () => {
    h.events.mockResolvedValue({ ok: true, rows: [], nextBefore: null })
    const html = await render()
    expect(h.events).toHaveBeenCalledWith(WID)
    expect(h.eventsList).toHaveBeenCalledTimes(1)
    expect(h.eventsList.mock.calls[0][0]).toMatchObject({ workspaceId: WID, initial: { ok: true } })
    expect(html).toContain('권한 변경')
    expect(html).toContain('설정 변경')
  })

  it('권한 이력 조회가 실패해도 설정 화면은 열리고 오류가 목록 자리에 간다', async () => {
    h.events.mockResolvedValue({ ok: false, error: '권한 변경 이력을 불러오지 못했습니다.' })
    await render()
    expect(h.eventsList.mock.calls[0][0]).toMatchObject({ initial: { ok: false } })
  })
})
