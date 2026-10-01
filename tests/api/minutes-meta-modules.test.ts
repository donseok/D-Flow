// v1 회의록 meta — 두 워크스페이스에 속한 행위자, 한쪽만 minutes_integration 허용(스펙 §4.3 deny 행, §7.1). 허용된 쪽의 프로젝트·팀만 싣고,
// 꺼진 쪽 프로젝트의 회의 목록은 404, 허용된 워크스페이스가 없으면 409 module_disabled. 판정은 admin 으로(세션 없음).
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ actorFromUser: vi.fn(), createAdminClient: vi.fn(), teams: vi.fn(), fetchAllPages: vi.fn() }))
vi.mock('@/lib/authz', () => ({ actorFromUser: m.actorFromUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/teams/source', () => ({
  workspaceTeams: async (workspaceId: string) => (m.teams(workspaceId) as string[]).map((code, i) => ({
    id: `t-${workspaceId}-${code}`, code, name: code, color: '#6b7280', sortOrder: i, active: true, progressVisible: true, projectId: null, workspaceId })),
}))
vi.mock('@/lib/data/paging', () => ({ fetchAllPages: m.fetchAllPages }))
vi.mock('@/lib/minutes/externalApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/minutes/externalApi')>()),
  resolveUserByEmail: vi.fn(async () => ({ id: 'u-dual', email: 'dual@example.com' })),
}))
import { GET as META } from '@/app/api/v1/minutes/meta/route'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import type { ProjectRole } from '@/lib/domain/authz'
import { makeActor } from '../fixtures/actor'

const SECRET = 'meta-secret'
const W1 = 'ws-on', W2 = 'ws-off'
const P1 = '00000000-0000-0000-7e57-000000001461', P2 = '00000000-0000-0000-7e57-000000001462'
const admin = { from: vi.fn(() => { const b: Record<string, unknown> = {}; for (const k of ['select', 'eq', 'in', 'order', 'range']) b[k] = () => b; b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r); return b }) }
const get = (qs: string) => new NextRequest(`http://localhost/api/v1/minutes/meta?user_email=dual%40example.com${qs}`, { headers: { Authorization: `Bearer ${SECRET}` } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('MINUTES_API_ENABLED', 'true'); vi.stubEnv('MINUTES_API_SECRET', SECRET)
  m.createAdminClient.mockReturnValue(admin)
  m.actorFromUser.mockResolvedValue(makeActor({
    userId: 'u-dual', workspaceRoles: new Map([[W1, 'member'], [W2, 'member']]),
    projectWorkspace: new Map([[P1, W1], [P2, W2]]), projectRoles: new Map<string, ProjectRole>([[P1, 'member'], [P2, 'member']]),
  }))
  m.fetchAllPages.mockResolvedValue([{ id: P1, name: 'Acme A', is_private: false }, { id: P2, name: 'Acme B', is_private: false }])
  m.teams.mockImplementation((w: string) => (w === W1 ? ['PMO'] : ['OPS']))
  vi.mocked(workspacesWithModule).mockResolvedValue([W1])
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => {
  for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset()
  vi.unstubAllEnvs()
})

describe('v1 meta — minutes_integration 이 허용된 워크스페이스만', () => {
  it('두 워크스페이스 행위자: 허용된 쪽의 프로젝트·팀만 싣는다', async () => {
    const res = await META(get(''))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([P1])
    expect(body.teams).toEqual(['PMO'])
    expect(workspacesWithModule).toHaveBeenCalledWith([W1, W2], 'minutes_integration', { client: admin })
    expect(m.teams).not.toHaveBeenCalledWith(W2)
  })
  it('꺼진 쪽 프로젝트의 회의 목록은 404(존재 은닉과 같은 응답) — 회의를 읽지 않는다', async () => {
    const res = await META(get(`&project_id=${P2}`))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not Found' })
    expect(admin.from).not.toHaveBeenCalledWith('meetings')
  })
  it('허용된 쪽 프로젝트의 회의 목록은 싣는다(대조)', async () => {
    const res = await META(get(`&project_id=${P1}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ meetings: [] })
    expect(admin.from).toHaveBeenCalledWith('meetings')
  })
  it('허용된 워크스페이스가 없으면 409 module_disabled — 프로젝트·팀을 읽지 않는다', async () => {
    vi.mocked(workspacesWithModule).mockResolvedValue([])
    const res = await META(get(''))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(m.fetchAllPages).not.toHaveBeenCalled()
    expect(m.teams).not.toHaveBeenCalled()
  })
  it('명단 행 없이 프로젝트만 보이는 워크스페이스도 판정 대상이다 — 소속과 프로젝트 워크스페이스의 합집합', async () => {
    m.actorFromUser.mockResolvedValue(makeActor({
      userId: 'u-dual', workspaceRoles: new Map([[W1, 'member']]), projectWorkspace: new Map([[P1, W1], [P2, W2]]),
    }))
    await META(get(''))
    expect(workspacesWithModule).toHaveBeenCalledWith([W1, W2], 'minutes_integration', { client: admin })
  })
})
