// 범위 레이아웃(D2·D49) — 슬러그·소속 조회 실패만 던진다(오류 경계). 설정·모듈 읽기 실패는 CORE·레지스트리 순서·제품 기본으로 그리고 children 렌더(Review Focus 5)
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getActorViewState: vi.fn(), resolveWorkspaceBySlug: vi.fn(), listMyWorkspaces: vi.fn(), getDisplayName: vi.fn(async () => 'alice'),
  getWorkspaceConfig: vi.fn(), effectiveModules: vi.fn(), listWorkspaceProjects: vi.fn(async (): Promise<{ ok: boolean; rows?: unknown[]; error?: string }> => ({ ok: true, rows: [] })), getWorkspacePrefs: vi.fn(async () => ({})),
  shellProps: vi.fn(), notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/workspace/resolve', () => ({ resolveWorkspaceBySlug: h.resolveWorkspaceBySlug, workspaceRefById: vi.fn() }))
vi.mock('@/lib/workspace/list', () => ({ listMyWorkspaces: h.listMyWorkspaces }))
vi.mock('@/lib/auth', () => ({ getDisplayName: h.getDisplayName }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.getWorkspaceConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: h.effectiveModules }))
vi.mock('@/lib/data/portal', () => ({ listWorkspaceProjects: h.listWorkspaceProjects }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: h.getWorkspacePrefs }))
vi.mock('@/lib/teams/master', () => ({ activeTeamsForWorkspacesSync: () => [] }))
vi.mock('next/navigation', () => ({ notFound: h.notFound }))
vi.mock('@/components/app/AppShell', () => ({ AppShell: (p: { children: React.ReactNode }) => { h.shellProps(p); return <div data-shell>{p.children}</div> } }))

import WorkspaceLayout from '@/app/(app)/w/[slug]/layout'
import { BRAND } from '@/lib/branding'
import { ConfigKeyError, ConfigUnavailableError } from '@/lib/settings/errors'
import { WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'
import { makeActor } from '../fixtures/actor'

const WS = { id: '00000000-0000-0000-7e57-000000001731', slug: 'acme', name: 'Acme' }
const P1 = '00000000-0000-0000-7e57-000000001732', P2 = '00000000-0000-0000-7e57-000000001733', P_OTHER = '00000000-0000-0000-7e57-000000001734'
const cfg = (values: Record<string, unknown>) => ({ workspaceId: WS.id, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [], keys: resolveKeys({ scope: 'workspace', id: WS.id, values, defs: WORKSPACE_SETTINGS, env: { NODE_ENV: 'test' } }).keys })
const run = () => WorkspaceLayout({ children: <p>본문</p>, params: Promise.resolve({ slug: 'acme' }) })
const hrefs = (p: { groups: { items: { href: string }[] }[] }) => p.groups.flatMap((g) => g.items.map((i) => i.href))

beforeEach(() => {
  vi.clearAllMocks()
  h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WS.id, 'admin']]) }), degraded: false })
  h.resolveWorkspaceBySlug.mockResolvedValue({ ok: true, ws: WS })
  h.listMyWorkspaces.mockResolvedValue({ ok: true, rows: [{ ...WS, role: 'admin', joinedAt: '1' }] })
  h.getWorkspaceConfig.mockResolvedValue(cfg({}))
  h.effectiveModules.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings', 'minutes', 'meetings']))
  h.listWorkspaceProjects.mockResolvedValue({ ok: true, rows: [] })
  h.getWorkspacePrefs.mockResolvedValue({})
})

describe('/w/[slug] 레이아웃 — 셸', () => {
  it('정상 — navFor 결과(워크스페이스 범위)를 AppShell 에 넘기고 children 을 그린다', async () => {
    const html = renderToString(await run())
    expect(html).toContain('본문')
    const p = h.shellProps.mock.calls[0][0]
    expect(p.scope).toBe('workspace'); expect(p.configDegraded).toBe(false)
    expect(hrefs(p)).toContain('/w/acme/minutes')
  })
  it('모듈 집합 실패(ConfigUnavailableError·ConfigKeyError) → CORE 만·알림·children 렌더(던지지 않는다)', async () => {
    for (const err of [new ConfigUnavailableError('down'), new ConfigKeyError('CONFIG_INVALID', 'modules.allowed')]) {
      vi.clearAllMocks(); h.shellProps.mockClear()
      h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[WS.id, 'admin']]) }), degraded: false })
      h.resolveWorkspaceBySlug.mockResolvedValue({ ok: true, ws: WS }); h.listMyWorkspaces.mockResolvedValue({ ok: true, rows: [] })
      h.getWorkspaceConfig.mockResolvedValue(cfg({})); h.effectiveModules.mockRejectedValue(err)
      const e = vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(renderToString(await run())).toContain('본문')
      const p = h.shellProps.mock.calls[0][0]
      expect(p.configDegraded).toBe(true)
      expect(hrefs(p)).not.toContain('/w/acme/minutes')
      e.mockRestore()
    }
  })
  it('설정 문서 읽기 실패(ConfigUnavailableError) → 레지스트리 순서·제품 기본, 알림, children 렌더', async () => {
    h.getWorkspaceConfig.mockRejectedValue(new ConfigUnavailableError('down'))
    const e = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(renderToString(await run())).toContain('본문')
    const p = h.shellProps.mock.calls[0][0]
    expect(p.configDegraded).toBe(true); expect(p.brand.productName).toBe(BRAND.productName); expect(p.accentCss).toBe('')
    expect(hrefs(p)).toContain('/w/acme/minutes')                                  // 모듈 집합은 따로 읽혔다 — 메뉴는 그대로
    e.mockRestore()
  })
  it('navigation.menu 손상 → 레지스트리 순서, branding 손상 → 제품 기본 — 알림 있음', async () => {
    h.getWorkspaceConfig.mockResolvedValue(cfg({ 'navigation.menu': 'oops', 'branding.product_name': 42 }))
    const e = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderToString(await run())
    const p = h.shellProps.mock.calls[0][0]
    expect(p.configDegraded).toBe(true); expect(p.brand.productName).toBe(BRAND.productName)
    e.mockRestore()
  })
  it('브랜딩 값을 셸에 싣는다(V8) — 제품 이름·로고 슬롯 유무·워크스페이스 id', async () => {
    h.getWorkspaceConfig.mockResolvedValue(cfg({ 'branding.product_name': 'Acme Flow', 'branding.logo': { full: `ws/${WS.id}/branding/full-0123456789abcdef.png`, full_dark: null, mark: `ws/${WS.id}/branding/mark-0123456789abcdef.png` } }))
    renderToString(await run())
    const p = h.shellProps.mock.calls[0][0]
    expect(p.configDegraded).toBe(false)
    expect(p.brand).toEqual({ productName: 'Acme Flow', workspaceId: WS.id, hasFull: true, hasFullDark: false, hasMark: true })
  })
  it('W14 — 즐겨찾기·최근 방문은 현재 워크스페이스의 가시 프로젝트로 거른다(다른 워크스페이스·숨김 id 는 빠진다)', async () => {
    h.listWorkspaceProjects.mockResolvedValue({ ok: true, rows: [{ id: P1, name: '하나', status: 'active', isAdmin: false }, { id: P2, name: '둘', status: 'active', isAdmin: false }] })
    h.getWorkspacePrefs.mockResolvedValue({ favoriteProjectIds: [P_OTHER, P2], recentProjects: [{ id: P_OTHER, at: '2026-10-01T00:00:00Z' }, { id: P1, at: '2026-10-01T00:00:00Z' }] })
    renderToString(await run())
    const p = h.shellProps.mock.calls[0][0]
    expect(p.favoriteIds).toEqual([P2]); expect(p.recentIds).toEqual([P1]); expect(p).not.toHaveProperty('recent')   // 최근 방문 쓰기는 서버가(Y1) — 셸은 id 만
  })
  it('셸 프로젝트 목록 실패 → 목록·즐겨찾기 없이, projectsFailed 로 알린다(데이터 없음으로 위장하지 않는다)', async () => {
    h.listWorkspaceProjects.mockResolvedValue({ ok: false, error: 'x' })
    h.getWorkspacePrefs.mockResolvedValue({ favoriteProjectIds: [P1] })
    const e = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderToString(await run())
    const p = h.shellProps.mock.calls[0][0]
    expect(p.projectsFailed).toBe(true); expect(p.projects).toEqual([]); expect(p.favoriteIds).toEqual([])
    e.mockRestore()
  })
  it('슬러그 조회 오류·소속 목록 오류는 던진다(오류 경계), 미존재·비소속은 404', async () => {
    h.resolveWorkspaceBySlug.mockResolvedValue({ ok: false, kind: 'unavailable', error: 'down' })
    await expect(run()).rejects.toThrow(); expect(h.notFound).not.toHaveBeenCalled()
    h.resolveWorkspaceBySlug.mockResolvedValue({ ok: true, ws: WS }); h.listMyWorkspaces.mockResolvedValue({ ok: false, error: 'down' })
    await expect(run()).rejects.toThrow(); expect(h.notFound).not.toHaveBeenCalled()
    h.listMyWorkspaces.mockResolvedValue({ ok: true, rows: [] }); h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map() }), degraded: false })
    await expect(run()).rejects.toThrow('NEXT_NOT_FOUND')
    h.resolveWorkspaceBySlug.mockResolvedValue({ ok: false, kind: 'missing' })
    await expect(run()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(h.shellProps).not.toHaveBeenCalled(); expect(h.getWorkspaceConfig).not.toHaveBeenCalled()
  })
  it('열화(actor null) — 404 없이 caps 전부 false 로 셸을 그린다', async () => {
    h.getActorViewState.mockResolvedValue({ actor: null, degraded: true })
    renderToString(await run())
    const p = h.shellProps.mock.calls[0][0]
    expect(p.degraded).toBe(true); expect(p.canEditSettings).toBe(false)
    expect(p.groups.flatMap((g: { items: { id: string }[] }) => g.items.map((i) => i.id))).not.toContain('ws.settings')
  })
})
