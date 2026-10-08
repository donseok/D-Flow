import { describe, it, expect, vi } from 'vitest'
import { createSupabaseAccessScopeResolver } from '@/lib/authz/accessScope'
import type { SupabaseServerClient } from '@/lib/repositories/supabase/common'

// 챗봇 접근 스코프 = 내 워크스페이스의 프로젝트(buildActor 의 projectWorkspace) 중 볼 수 있는 것(canSeeProject).
// 비공개 프로젝트(0070)는 목록에선 숨겼는데 챗봇이 답하면 숨김이 무색해진다 — 스코프가 같은 규칙을 따르는지 검증.

type R = { data: unknown; error: { message: string } | null }
type Tables = Partial<Record<'platform_admins' | 'workspace_members' | 'project_members' | 'projects', R>>

const PROJECTS = [
  { id: 'p-pub', workspace_id: 'ws-1', is_private: false },
  { id: 'p-priv', workspace_id: 'ws-1', is_private: true },
  { id: 'p-other', workspace_id: 'ws-2', is_private: false },
]
const rosterRow = (projectId: string, access_role: 'admin' | 'member' | null) => ({
  id: `m-${projectId}`, project_id: projectId, access_role,
  people: { user_id: 'u1', active: true }, project_member_teams: [],
})

/** buildActor 4축 + 스코프의 비공개 플래그 조회. projects 는 .in('workspace_id', …) 필터를 흉내 낸다(워크스페이스 경계). */
function client(tables: Tables = {}) {
  const t: Required<Tables> = {
    platform_admins: { data: null, error: null },
    workspace_members: { data: [{ workspace_id: 'ws-1', role: 'member' }], error: null },
    project_members: { data: [], error: null },
    projects: { data: PROJECTS, error: null },
    ...tables,
  }
  const from = vi.fn((table: string) => {
    const r = (t as Record<string, R>)[table] ?? { data: null, error: { message: `unexpected table ${table}` } }
    let inFilter: [string, unknown[]] | null = null
    const answer = (): R => {
      if (!inFilter || !Array.isArray(r.data)) return r
      const [col, vals] = inFilter
      return { ...r, data: (r.data as Array<Record<string, unknown>>).filter(row => vals.includes(row[col])) }
    }
    const b: Record<string, unknown> = {}
    for (const k of ['select', 'eq', 'limit', 'order', 'range']) b[k] = () => b
    b.in = (col: string, vals: unknown[]) => { inFilter = [col, vals]; return b }
    b.maybeSingle = async () => answer()
    // buildActor 의 projects 는 페이지 + count 총합 대조(fetchAllPages) — 배열 응답에는 걸러진 행 수를 count 로 싣는다
    b.then = (res: (v: R) => unknown, rej: (e: unknown) => unknown) => {
      const a = answer()
      return Promise.resolve(Array.isArray(a.data) ? { ...a, count: a.data.length } : a).then(res, rej)
    }
    return b
  })
  return { client: { from } as unknown as SupabaseServerClient, from }
}

const resolve = (tables: Tables = {}) => createSupabaseAccessScopeResolver(client(tables).client).resolve('u1')

describe('accessScope — 워크스페이스 경계와 비공개 프로젝트 스코프 제외', () => {
  it('역할 없는 워크스페이스 멤버: 내 워크스페이스의 공개 프로젝트만 — 비공개·타 워크스페이스는 빠진다', async () => {
    const res = await resolve()
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-pub'])
  })
  it('명단 역할 보유자는 비공개도 스코프에 들어간다', async () => {
    const res = await resolve({ project_members: { data: [rosterRow('p-priv', 'member')], error: null } })
    expect(res.ok && [...res.scope.allowedProjectIds].sort()).toEqual(['p-priv', 'p-pub'])
  })
  it('권한 없는 명단 행(조회 전용)은 비공개를 열지 않는다', async () => {
    const res = await resolve({ project_members: { data: [rosterRow('p-priv', null)], error: null } })
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-pub'])
  })
  it('워크스페이스 관리자는 명단 행 없이도 그 워크스페이스의 비공개까지(승계)', async () => {
    const res = await resolve({ workspace_members: { data: [{ workspace_id: 'ws-1', role: 'admin' }], error: null } })
    expect(res.ok && [...res.scope.allowedProjectIds].sort()).toEqual(['p-priv', 'p-pub'])
  })
  it('플랫폼 관리자는 워크스페이스와 무관하게 전부 들어간다', async () => {
    const res = await resolve({ platform_admins: { data: { user_id: 'u1' }, error: null }, workspace_members: { data: [], error: null } })
    expect(res.ok && [...res.scope.allowedProjectIds].sort()).toEqual(['p-other', 'p-priv', 'p-pub'])
    // 워크스페이스 축 입력(회의록 담당 팀)을 전 워크스페이스로 보게 플래그를 싣는다 — 멤버십이 없어 workspaceIds 는 비어 있다(16b).
    expect(res.ok && res.scope.isSuperuser).toBe(true)
    expect(res.ok && res.scope.workspaceIds).toEqual([])
  })
  it('허용 프로젝트마다 워크스페이스를 싣는다 — 허용 밖 프로젝트의 것은 싣지 않는다(검색 범위의 원천)', async () => {
    const member = await resolve()
    expect(member.ok && member.scope.projectWorkspace).toEqual({ 'p-pub': 'ws-1' })
    const platform = await resolve({ platform_admins: { data: { user_id: 'u1' }, error: null }, workspace_members: { data: [], error: null } })
    expect(platform.ok && platform.scope.projectWorkspace).toEqual({ 'p-pub': 'ws-1', 'p-priv': 'ws-1', 'p-other': 'ws-2' })
  })
  it('플랫폼 관리자가 아니면 isSuperuser 는 거짓', async () => {
    const res = await resolve()
    expect(res.ok && res.scope.isSuperuser).toBe(false)
  })
  it('소속 워크스페이스를 함께 싣는다 — 프로젝트 축 없는 입력(회의록 담당 팀)을 호출자 범위로 좁히는 근거', async () => {
    const res = await resolve({ workspace_members: { data: [{ workspace_id: 'ws-1', role: 'member' }, { workspace_id: 'ws-2', role: 'admin' }], error: null } })
    expect(res.ok && [...res.scope.workspaceIds].sort()).toEqual(['ws-1', 'ws-2'])
  })
  it('소속 워크스페이스가 없으면 스코프는 비어 있다(정상 0건 — 실패와 구별)', async () => {
    const res = await resolve({ workspace_members: { data: [], error: null } })
    expect(res.ok && res.scope.allowedProjectIds).toEqual([])
  })
  it('권한 축 조회 실패는 ACCESS_SCOPE_UNAVAILABLE — 역할 없음으로 폴백하지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const broken of ['platform_admins', 'workspace_members', 'project_members'] as const) {
      const res = await resolve({ [broken]: { data: null, error: { message: 'boom' } } })
      expect(res.ok).toBe(false)
      expect(!res.ok && res.code).toBe('ACCESS_SCOPE_UNAVAILABLE')
    }
    err.mockRestore()
  })
  it('projects 조회 실패는 기존대로 ACCESS_SCOPE_UNAVAILABLE', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await resolve({ projects: { data: null, error: { message: 'down' } } })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.code).toBe('ACCESS_SCOPE_UNAVAILABLE')
    err.mockRestore()
  })
  it('is_private 컬럼이 없는 행(마이그레이션 전)은 공개로 취급', async () => {
    const res = await resolve({ projects: { data: [{ id: 'p-old', workspace_id: 'ws-1' }], error: null } })
    expect(res.ok && res.scope.allowedProjectIds).toEqual(['p-old'])
  })
  it('폐기 표(memberships·project_roles)를 읽지 않는다', async () => {
    const { client: c, from } = client()
    await createSupabaseAccessScopeResolver(c).resolve('u1')
    const tables = from.mock.calls.map(call => call[0])
    expect(tables).not.toContain('memberships')
    expect(tables).not.toContain('project_roles')
  })
})
