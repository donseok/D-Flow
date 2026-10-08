// v1 회의록 meta — 두 워크스페이스에 속한 행위자, 한쪽만 minutes_integration 허용(스펙 §4.3 deny 행, §7.1). 판정은 admin 으로(세션 없음).
// SP7 §5.1.4 — 인증 원천은 integration_credentials(minutes_api) 행 하나뿐이고, 범위는 그 자격증명의 워크스페이스 하나다:
// 허용된 워크스페이스에 묶인 자격증명은 그 워크스페이스의 프로젝트·팀만 싣고(행위자가 다른 워크스페이스에 속해 있어도 합치지 않는다),
// 다른 쪽 프로젝트의 회의 목록은 404, 자격증명 워크스페이스가 꺼져 있으면 409 module_disabled.
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ actorFromUser: vi.fn(), createAdminClient: vi.fn(), teams: vi.fn() }))
vi.mock('@/lib/authz', () => ({ actorFromUser: m.actorFromUser }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: m.createAdminClient }))
vi.mock('@/lib/teams/source', () => {
  const rows = (workspaceId: string, projectId: string | null) => (m.teams(workspaceId, projectId) as string[]).map((code, i) => ({
    id: `t-${workspaceId}-${code}`, code, name: code, color: '#6b7280', sortOrder: i, active: true, progressVisible: true, projectId: null, workspaceId }))
  return {
    workspaceTeams: async (workspaceId: string) => rows(workspaceId, null),
    // 프로젝트 범위 — 그 프로젝트가 속한 워크스페이스의 팀(이 파일의 프로젝트는 전용 팀이 없다)
    projectTeams: async (projectId: string) => rows(PROJECT_WS[projectId] ?? 'unknown', projectId),
  }
})
vi.mock('@/lib/minutes/externalApi', async (orig) => ({
  ...(await orig<typeof import('@/lib/minutes/externalApi')>()),
  resolveUserByEmail: vi.fn(async () => ({ id: 'u-dual', email: 'dual@example.com' })),
}))
import { GET as META } from '@/app/api/v1/minutes/meta/route'
import { moduleState, projectsWithModule, requireModule, requireSessionModule, workspacesWithModule } from '@/lib/modules/gate'
import type { ProjectRole } from '@/lib/domain/authz'
import { makeActor } from '../fixtures/actor'
import { CRED_WS, minutesCredential, type TestCredential } from '../fixtures/credentials'

const LEGACY_SECRET = 'meta-secret'
// W1 = 자격증명 워크스페이스(minutes_integration 허용), W2 = 행위자의 다른 소속(꺼짐). 자격증명 행의 workspace_id 는 UUID 여야 한다.
const W1 = CRED_WS, W2 = '5a000000-0000-4000-8000-0000000000ff'
const P1 = '00000000-0000-0000-7e57-000000001461', P2 = '00000000-0000-0000-7e57-000000001462'
const PROJECT_WS: Record<string, string> = { [P1]: W1, [P2]: W2 }
const PROJECTS = [
  { id: P1, name: 'Acme A', is_private: false, workspace_id: W1 }, { id: P2, name: 'Acme B', is_private: false, workspace_id: W2 },
]
const CRED = minutesCredential()
let cred: TestCredential = CRED
/** 표별 응답 — 자격증명(조회 → last_used_at 갱신)·멤버 확인·workspaces·projects(eq 로 건 workspace_id 만 돌려준다)·그 밖은 빈 배열 */
const admin = {
  from: vi.fn((table: string) => {
    const filters: Record<string, unknown> = {}
    let updating = false
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'in', 'order', 'range', 'maybeSingle', 'single']) b[k] = () => b
    b.eq = (col: string, val: unknown) => { filters[col] = val; return b }
    b.update = () => { updating = true; return b }
    const data = () => {
      if (table === 'integration_credentials') return updating ? null : (filters.token_prefix === cred.prefix ? cred.row : null)
      if (table === 'workspace_members') return [W1, W2].includes(filters.workspace_id as string) ? { role: 'member' } : null
      if (table === 'workspaces') return { id: filters.id, slug: 'ws', name: '워크스페이스' }
      if (table === 'projects') return PROJECTS.filter((p) => p.workspace_id === filters.workspace_id)
      return []
    }
    b.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(r)
    return b
  }),
}
const get = (qs: string, bearer: string = CRED.token) =>
  new NextRequest(`http://localhost/api/v1/minutes/meta?user_email=dual%40example.com${qs}`, { headers: { Authorization: `Bearer ${bearer}` } })
beforeEach(() => {
  vi.clearAllMocks()
  cred = CRED
  vi.stubEnv('MINUTES_API_ENABLED', 'true')
  m.createAdminClient.mockReturnValue(admin)
  m.actorFromUser.mockResolvedValue(makeActor({
    userId: 'u-dual', workspaceRoles: new Map([[W1, 'member'], [W2, 'member']]),
    projectWorkspace: new Map([[P1, W1], [P2, W2]]), projectRoles: new Map<string, ProjectRole>([[P1, 'member'], [P2, 'member']]),
  }))
  m.teams.mockImplementation((w: string) => (w === W1 ? ['PMO'] : ['OPS']))
  // 허용은 W1 뿐 — 받은 후보 중 허용된 것만 돌려준다(고정값이 아니라 판정)
  vi.mocked(workspacesWithModule).mockImplementation(async (ids: readonly string[]) => ids.filter((w) => w === W1))
})
// 관문 mock 값을 바꾸는 파일 — 전역 통과 구현으로 되돌린다(공통 규칙)
afterEach(() => {
  for (const f of [requireModule, requireSessionModule, moduleState, projectsWithModule, workspacesWithModule]) vi.mocked(f).mockReset()
  vi.unstubAllEnvs()
})

describe('v1 meta — minutes_integration 이 허용된 워크스페이스만', () => {
  it('두 워크스페이스 행위자: 자격증명 워크스페이스(허용된 쪽)의 프로젝트·팀만 싣는다', async () => {
    const res = await META(get(''))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.projects.map((p: { id: string }) => p.id)).toEqual([P1])
    expect(body.teams).toEqual(['PMO'])
    expect(body.workspace).toMatchObject({ id: W1 })
    // 판정 후보는 자격증명 워크스페이스 하나 — 행위자의 다른 소속(W2)은 후보에도, 팀 조회에도 없다
    expect(workspacesWithModule).toHaveBeenCalledWith([W1], 'minutes_integration', { client: admin })
    expect(workspacesWithModule).toHaveBeenCalledTimes(1)
    expect(m.teams.mock.calls.map((c) => c[0])).toEqual([W1])
  })
  it('꺼진 쪽 프로젝트의 회의 목록은 404(존재 은닉과 같은 응답) — 회의를 읽지 않는다', async () => {
    const res = await META(get(`&project_id=${P2}`))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not Found' })
    expect(admin.from).not.toHaveBeenCalledWith('meetings')
    expect(m.teams).not.toHaveBeenCalled()
  })
  it('허용된 쪽 프로젝트의 회의 목록은 싣는다(대조)', async () => {
    const res = await META(get(`&project_id=${P1}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ meetings: [], teams: ['PMO'] })
    expect(admin.from).toHaveBeenCalledWith('meetings')
  })
  it('허용된 워크스페이스가 없으면 409 module_disabled — 프로젝트·팀을 읽지 않는다', async () => {
    vi.mocked(workspacesWithModule).mockResolvedValue([])
    const res = await META(get(''))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(admin.from).not.toHaveBeenCalledWith('projects')
    expect(admin.from).not.toHaveBeenCalledWith('workspaces')
    expect(m.teams).not.toHaveBeenCalled()
  })
  // 옛 시크릿 경로는 행위자의 소속·프로젝트 워크스페이스의 합집합을 판정했다(도달 불가가 됐다). 자격증명 경로의 대응: 판정 대상은
  // 자격증명 워크스페이스 하나라, 그쪽이 꺼져 있으면 행위자의 다른 워크스페이스가 켜져 있어도 닫힌다(켜진 쪽으로 넘어가지 않는다).
  it('자격증명이 꺼진 워크스페이스(W2)에 묶여 있으면 행위자의 다른 워크스페이스(W1)가 켜져 있어도 409 — 판정 대상은 자격증명 워크스페이스 하나', async () => {
    cred = CRED.with({ workspace_id: W2 })
    const res = await META(get(''))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'module_disabled' })
    expect(workspacesWithModule).toHaveBeenCalledWith([W2], 'minutes_integration', { client: admin })
    expect(workspacesWithModule).toHaveBeenCalledTimes(1)
    expect(admin.from).not.toHaveBeenCalledWith('projects')
    expect(m.teams).not.toHaveBeenCalled()
  })
  it('옛 시크릿 값 Bearer 는 401 — env 에 MINUTES_API_SECRET 이 있어도 integration_credentials 를 조회하지 않는다', async () => {
    vi.stubEnv('MINUTES_API_SECRET', LEGACY_SECRET)
    const res = await META(get('', LEGACY_SECRET))
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ code: 'unauthorized' })
    expect(m.createAdminClient).not.toHaveBeenCalled()
    expect(admin.from).not.toHaveBeenCalled()
    expect(workspacesWithModule).not.toHaveBeenCalled()
  })
})
