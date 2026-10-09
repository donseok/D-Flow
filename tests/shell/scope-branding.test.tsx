// 브랜딩·메뉴의 끊긴 자리 잇기(2026-10-09 재점검) — 프로젝트·전역 범위의 탭 제목·아이콘(branding.product_name·branding.logo)과
// 전역 검색에 내려 주는 워크스페이스 메뉴(navigation.menu). 키마다 양성(저장값이 실린다)과 격리(다른 워크스페이스의 값이 새지 않는다)를 본다.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getActorViewState: vi.fn(), getHiddenProjectIds: vi.fn(async (): Promise<ReadonlySet<string>> => new Set()),
  readCurrentWorkspace: vi.fn(), getWorkspaceConfig: vi.fn(), effectiveModules: vi.fn(),
}))
vi.mock('@/lib/authz', () => ({ getActorViewState: h.getActorViewState }))
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: h.getHiddenProjectIds }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => 'alice') }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: h.readCurrentWorkspace }))
vi.mock('@/lib/workspace/list', () => ({ listMyWorkspaces: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/lib/workspace/resolve', () => ({ workspaceRefById: vi.fn(), resolveWorkspaceBySlug: vi.fn() }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: h.getWorkspaceConfig }))
vi.mock('@/lib/modules/effective', () => ({ effectiveModules: h.effectiveModules }))
vi.mock('@/lib/data/portal', () => ({ listWorkspaceProjects: vi.fn(async () => ({ ok: true, rows: [] })) }))
vi.mock('@/app/actions/preferences', () => ({ getWorkspacePrefs: vi.fn(async () => ({})) }))
vi.mock('@/lib/teams/source', () => ({ workspaceTeams: async () => [], projectTeams: async () => [] }))
vi.mock('@/components/app/AppShell', () => ({ AppShell: () => null }))
vi.mock('@/components/app/ShellScope', () => ({ ShellScope: () => null }))

import { generateMetadata as projectMetadata } from '@/app/(app)/p/[projectId]/layout'
import { generateMetadata as globalMetadata } from '@/app/(app)/(global)/layout'
import { BRAND } from '@/lib/branding'
import { loadShell } from '@/lib/shell/loadShell'
import { WORKSPACE_SETTINGS } from '@/lib/settings/registry'
import { resolveKeys } from '@/lib/settings/resolve'
import { makeActor } from '../fixtures/actor'

const A = '00000000-0000-4000-8000-0000000000a1', B = '00000000-0000-4000-8000-0000000000b1'
const PA = '00000000-0000-4000-8000-0000000000a2', PB = '00000000-0000-4000-8000-0000000000b2'
const mark = (ws: string) => `ws/${ws}/branding/mark-0123456789abcdef.png`
const cfg = (id: string, values: Record<string, unknown>) => ({
  workspaceId: id, revision: 1, schemaVersion: 1, schemaAhead: false, unknownKeys: [],
  keys: resolveKeys({ scope: 'workspace', id, values, defs: WORKSPACE_SETTINGS, env: { NODE_ENV: 'test' } }).keys,
})
/** 두 워크스페이스의 설정 — A 는 이름·마크·메뉴를 바꿨고 B 는 다른 이름만 */
const CONFIGS: Record<string, Record<string, unknown>> = {
  [A]: { 'branding.product_name': 'Acme Flow', 'branding.logo': { full: null, full_dark: null, mark: mark(A) }, 'navigation.menu': { order: ['ws.projects', 'ws.home'], labels: { 'ws.projects': '과제 목록', 'p.wbs': '공정표' } } },
  [B]: { 'branding.product_name': 'Beta PM' },
}
const titleOf = (product: string) => ({ template: `%s | ${product}`, default: product })
const both = makeActor({ workspaceRoles: new Map([[A, 'admin'], [B, 'member']]), projectWorkspace: new Map([[PA, A], [PB, B]]) })

beforeEach(() => {
  vi.clearAllMocks()
  h.getActorViewState.mockResolvedValue({ actor: both, degraded: false })
  h.getHiddenProjectIds.mockResolvedValue(new Set())
  h.getWorkspaceConfig.mockImplementation(async (id: string) => cfg(id, CONFIGS[id] ?? {}))
  h.effectiveModules.mockResolvedValue(new Set(['dashboard', 'wbs', 'members', 'settings', 'minutes', 'meetings']))
})

describe('/p/[projectId] 탭 제목·아이콘 — 그 프로젝트의 워크스페이스 값', () => {
  const meta = (projectId: string) => projectMetadata({ params: Promise.resolve({ projectId }) })
  it('저장한 제품 이름이 제목에, 마크가 아이콘에 실린다', async () => {
    expect(await meta(PA)).toEqual({ title: titleOf('Acme Flow'), icons: { icon: `/api/brand/${A}/mark` } })
  })
  it('격리 — 다른 워크스페이스의 프로젝트는 그 워크스페이스의 이름만 쓴다(A 의 이름·마크가 실리지 않는다)', async () => {
    expect(await meta(PB)).toEqual({ title: titleOf('Beta PM') })
    expect(h.getWorkspaceConfig.mock.calls.map((c) => c[0])).toEqual([B])
  })
  it('격리 — 볼 수 없는 프로젝트(타 워크스페이스·숨김)는 제목도 아이콘도 내지 않고 설정을 읽지 않는다', async () => {
    expect(await meta('00000000-0000-4000-8000-0000000000ff')).toEqual({})
    h.getHiddenProjectIds.mockResolvedValue(new Set([PA]))
    h.getActorViewState.mockResolvedValue({ actor: makeActor({ workspaceRoles: new Map([[A, 'member']]), projectWorkspace: new Map([[PA, A]]) }), degraded: false })
    expect(await meta(PA)).toEqual({})
    expect(h.getWorkspaceConfig).not.toHaveBeenCalled()
  })
  it('손상된 이름은 배포 기본, 설정 판독 실패는 아무것도 내지 않는다(루트 제목) + 로그', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getWorkspaceConfig.mockResolvedValue(cfg(A, { 'branding.product_name': 42 }))
    expect(await meta(PA)).toEqual({ title: titleOf(BRAND.productName) })
    h.getWorkspaceConfig.mockRejectedValue(new Error('down'))
    expect(await meta(PA)).toEqual({})
    expect(err.mock.calls.some((c) => String(c[0]).includes('[project layout]'))).toBe(true)
    err.mockRestore()
  })
})

describe('(global) 탭 제목·아이콘 — 셸이 그리는 현재 워크스페이스의 값', () => {
  it('현재 워크스페이스의 제품 이름과 마크가 실린다', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: A, slug: 'acme', name: 'Acme' } })
    expect(await globalMetadata()).toEqual({ title: titleOf('Acme Flow'), icons: { icon: `/api/brand/${A}/mark` } })
  })
  it('격리 — 현재 워크스페이스가 B 면 B 의 값만(읽는 설정도 B 하나)', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: B, slug: 'beta', name: 'Beta' } })
    expect(await globalMetadata()).toEqual({ title: titleOf('Beta PM') })
    expect(h.getWorkspaceConfig.mock.calls.map((c) => c[0])).toEqual([B])
  })
  it('소속이 없거나 조회가 실패하면 배포 기본(아무것도 내지 않는다) — 설정을 읽지 않는다', async () => {
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: null })
    expect(await globalMetadata()).toEqual({})
    h.readCurrentWorkspace.mockResolvedValue({ ok: false, error: 'down' })
    expect(await globalMetadata()).toEqual({})
    expect(h.getWorkspaceConfig).not.toHaveBeenCalled()
  })
  it('설정 판독 실패는 아무것도 내지 않고 로그를 남긴다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.readCurrentWorkspace.mockResolvedValue({ ok: true, ws: { id: A, slug: 'acme', name: 'Acme' } })
    h.getWorkspaceConfig.mockRejectedValue(new Error('down'))
    expect(await globalMetadata()).toEqual({})
    expect(err.mock.calls.some((c) => String(c[0]).includes('[global layout]'))).toBe(true)
    err.mockRestore()
  })
})

describe('loadShell.workspaceGroups — 전역 검색(⌘K)에 내려 주는 워크스페이스 메뉴(navigation.menu)', () => {
  const ws = (id: string, slug: string) => ({ id, slug, name: slug })
  const input = { actor: both, degraded: false, viewingAsPlatformAdmin: false, workspaces: [], userName: 'alice' }
  const items = (groups: { items: { id: string; href: string; label: unknown }[] }[]) => groups.flatMap((g) => g.items)

  it('프로젝트 범위 — 사이드 내비는 프로젝트 메뉴, 검색용 워크스페이스 메뉴는 저장한 순서·이름으로 따로 선다', async () => {
    const shell = await loadShell({ ...input, scope: 'project', ws: ws(A, 'acme'), projectId: PA })
    expect(items(shell.groups).every((i) => i.href.startsWith(`/p/${PA}`))).toBe(true)
    expect(items(shell.groups).find((i) => i.id === 'p.wbs')?.label).toBe('공정표')
    const wsItems = items(shell.workspaceGroups)
    expect(wsItems.slice(0, 2).map((i) => [i.id, i.label, i.href])).toEqual([['ws.projects', '과제 목록', '/w/acme/projects'], ['ws.home', { key: 'nav.home' }, '/w/acme']])
    // 워크스페이스 층의 모듈 집합은 프로젝트 토글 없이 따로 판정한다
    expect(h.effectiveModules.mock.calls.map((c) => c[0])).toEqual([{ workspaceId: A, projectId: PA }, { workspaceId: A }])
    expect(shell.configDegraded).toBe(false)
  })
  it('워크스페이스·전역 범위 — groups 와 같은 값이다(따로 계산하지 않는다)', async () => {
    for (const scope of ['workspace', 'global'] as const) {
      h.effectiveModules.mockClear()
      const shell = await loadShell({ ...input, scope, ws: ws(A, 'acme') })
      expect(shell.workspaceGroups).toBe(shell.groups)
      expect(h.effectiveModules).toHaveBeenCalledTimes(1)
    }
  })
  it('격리 — B 의 셸에는 A 가 바꾼 메뉴 이름·순서가 없다', async () => {
    const shell = await loadShell({ ...input, scope: 'project', ws: ws(B, 'beta'), projectId: PB })
    const wsItems = items(shell.workspaceGroups)
    expect(wsItems[0]).toMatchObject({ id: 'ws.home', href: '/w/beta' })
    expect(JSON.stringify([shell.groups, shell.workspaceGroups])).not.toMatch(/과제 목록|공정표|acme/)
    expect(shell.brand.productName).toBe('Beta PM')
    expect(h.getWorkspaceConfig.mock.calls.every((c) => c[0] === B)).toBe(true)
  })
  it('워크스페이스 층 모듈 판정이 실패하면 core 메뉴만 싣고 알린다(프로젝트 메뉴는 그대로)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.effectiveModules.mockImplementation(async (s: { projectId?: string }) => { if (!s.projectId) throw new Error('down'); return new Set(['dashboard', 'wbs', 'minutes']) })
    const shell = await loadShell({ ...input, scope: 'project', ws: ws(A, 'acme'), projectId: PA })
    expect(shell.configDegraded).toBe(true)
    expect(items(shell.workspaceGroups).map((i) => i.id)).not.toContain('ws.minutes')
    expect(items(shell.workspaceGroups).map((i) => i.id)).toContain('ws.home')
    expect(items(shell.groups).map((i) => i.id)).toContain('p.wbs')
    err.mockRestore()
  })
})
