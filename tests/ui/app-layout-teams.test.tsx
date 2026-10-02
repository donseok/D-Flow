// 팀 주입(V16, SP4 D19·Q23 겹침) — (app)/layout 은 TeamsProvider 를 그리지 않고, 범위 레이아웃이 그 범위의 활성 팀을 싣는다.
// w/[slug]·(global) = workspaceTeams(wid) 의 활성, p/[projectId] = projectTeams(pid) 의 활성(요청 범위 원천 — SP4 B).
// 열화(actor null)면 [] — 팀을 읽지 않는다. 팀 원천이 throw 하면 로그 + [] (설정·임포트 같은 복구 화면까지 오류가 되지 않게).
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Team } from '@/lib/domain/teams'
import { makeActor } from '../fixtures/actor'

const WA = '00000000-0000-0000-7e57-000000001781', WB = '00000000-0000-0000-7e57-000000001782', PA = '00000000-0000-0000-7e57-000000001783'
const TEAMS = vi.hoisted((): Team[] => {
  const t = (code: string, workspaceId: string, projectId: string | null = null, active = true): Team =>
    ({ id: `${workspaceId}-${code}`, code, name: code, color: '#6b7280', sortOrder: 0, active, progressVisible: true, projectId, workspaceId })
  const wa = '00000000-0000-0000-7e57-000000001781', wb = '00000000-0000-0000-7e57-000000001782', pa = '00000000-0000-0000-7e57-000000001783'
  return [t('PMO', wa), t('휴면', wa, null, false), t('A전용', wa, pa), t('A전용휴면', wa, pa, false), t('ERP', wb)]
})
const h = vi.hoisted(() => ({
  state: { actor: null as unknown, degraded: false },
  workspaceTeams: vi.fn(), projectTeams: vi.fn(),
  teams: vi.fn(),
}))
vi.mock('@/lib/teams/source', () => ({ workspaceTeams: h.workspaceTeams, projectTeams: h.projectTeams }))
vi.mock('@/lib/authz', () => ({ getActorViewState: vi.fn(async () => h.state) }))
// GG1 — 프로젝트 레이아웃·페이지가 명단 밖 비공개 숨김 집합을 읽는다(이 파일은 비공개를 다루지 않는다 — 빈 집합)
vi.mock('@/lib/authz/visibility', () => ({ getHiddenProjectIds: async () => new Set<string>() }))
vi.mock('@/lib/auth', () => ({ getDisplayName: vi.fn(async () => 'alice') }))
vi.mock('@/lib/workspace/resolve', () => ({
  resolveWorkspaceBySlug: vi.fn(async () => ({ ok: true, ws: { id: WA, slug: 'acme', name: 'Acme' } })),
  workspaceRefById: vi.fn(async () => ({ ok: true, ws: { id: WA, slug: 'acme', name: 'Acme' } })),
}))
vi.mock('@/lib/workspace/list', () => ({ listMyWorkspaces: vi.fn(async () => ({ ok: true, rows: [{ id: WA, slug: 'acme', name: 'Acme', role: 'member', joinedAt: '1' }] })) }))
vi.mock('@/lib/workspace/current', () => ({ readCurrentWorkspace: vi.fn(async () => ({ ok: true, ws: { id: WA, slug: 'acme', name: 'Acme' } })) }))
vi.mock('@/lib/shell/loadShell', () => ({ loadShell: vi.fn(async () => ({ projects: [] })), minimalShell: vi.fn(() => ({ projects: [] })) }))
vi.mock('@/lib/settings/workspaceConfig', () => ({ getWorkspaceConfig: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') }, unstable_rethrow: () => {} }))
vi.mock('@/components/app/TeamsProvider', () => ({ TeamsProvider: ({ teams, children }: { teams: Team[]; children: ReactNode }) => { h.teams(teams); return children } }))
vi.mock('@/components/app/AppShell', () => ({ AppShell: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/app/ShellScope', () => ({ ShellScope: () => null }))

import { renderToString } from 'react-dom/server'
import WorkspaceLayout from '@/app/(app)/w/[slug]/layout'
import ProjectLayout from '@/app/(app)/p/[projectId]/layout'
import GlobalLayout from '@/app/(app)/(global)/layout'

const member = () => makeActor({ workspaceRoles: new Map([[WA, 'member'], [WB, 'member']]), projectWorkspace: new Map([[PA, WA]]), projectRoles: new Map([[PA, 'member']]) })
const codes = () => (h.teams.mock.calls.at(-1)?.[0] as Team[]).map((t) => t.code)
const layouts = {
  workspace: async () => renderToString(await WorkspaceLayout({ children: 'page', params: Promise.resolve({ slug: 'acme' }) })),
  project: async () => renderToString(await ProjectLayout({ children: 'page', params: Promise.resolve({ projectId: PA }) })),
  global: async () => renderToString(await GlobalLayout({ children: 'page' })),
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state = { actor: member(), degraded: false }
  h.workspaceTeams.mockImplementation(async (wid: string) => TEAMS.filter((t) => t.projectId === null && t.workspaceId === wid))
  h.projectTeams.mockImplementation(async (pid: string) => TEAMS.filter((t) => t.projectId === null ? t.workspaceId === WA : t.projectId === pid))
})

describe('범위 레이아웃 팀 주입(V16)', () => {
  it('(app)/layout 은 TeamsProvider 를 그리지 않는다', () => {
    expect(readFileSync('src/app/(app)/layout.tsx', 'utf8')).not.toContain('TeamsProvider')
  })
  it('w/[slug] — 그 워크스페이스의 활성 공용 팀만(다른 워크스페이스·비활성·프로젝트 전용 없음)', async () => {
    await layouts.workspace()
    expect(h.workspaceTeams).toHaveBeenCalledWith(WA)
    expect(codes()).toEqual(['PMO'])
  })
  it('p/[projectId] — 그 프로젝트의 팀 중 활성만', async () => {
    await layouts.project()
    expect(h.projectTeams).toHaveBeenCalledWith(PA)
    expect(codes().sort()).toEqual(['A전용', 'PMO'])
  })
  it('(global) — 쿠키 워크스페이스의 활성 공용 팀', async () => {
    await layouts.global()
    expect(h.workspaceTeams).toHaveBeenCalledWith(WA); expect(codes()).toEqual(['PMO'])
  })
  it.each(['workspace', 'global'] as const)('%s — 열화(actor null)면 [] 이고 팀을 읽지 않는다', async (k) => {
    h.state = { actor: null, degraded: true }
    await layouts[k]()
    expect(h.workspaceTeams).not.toHaveBeenCalled(); expect(codes()).toEqual([])
  })
  it('project — 열화면 팀을 읽지 않는다(최소 셸 — 팀 공급 없음 또는 [])', async () => {
    h.state = { actor: null, degraded: true }
    await layouts.project()
    expect(h.projectTeams).not.toHaveBeenCalled()
    for (const c of h.teams.mock.calls) expect(c[0]).toEqual([])
  })
  it.each(['workspace', 'project', 'global'] as const)('%s — 팀 원천이 throw 하면 로그 + [] (레이아웃이 던지지 않는다)', async (k) => {
    h.workspaceTeams.mockRejectedValue(new Error('팀 목록을 불러오지 못했습니다.'))
    h.projectTeams.mockRejectedValue(new Error('팀 목록을 불러오지 못했습니다.'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await layouts[k]()
    expect(codes()).toEqual([])
    expect(err).toHaveBeenCalledWith(expect.stringContaining('팀 조회 실패'), expect.stringContaining('팀 목록'))
    err.mockRestore()
  })
  it('내리는 팀은 이름·색을 싣는다 — 화면 슬롯의 근거(Q23)', async () => {
    await layouts.workspace()
    expect((h.teams.mock.calls.at(-1)?.[0] as Team[])[0]).toMatchObject({ code: 'PMO', name: 'PMO', color: '#6b7280' })
  })
})
