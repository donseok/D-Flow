import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor, ProjectRole, WorkspaceRole } from '../domain/authz'

type Db = Pick<SupabaseClient, 'from'>
const fail = (axis: string, msg: string | undefined): never => {
  console.error(`[buildActor] ${axis} 조회 실패:`, msg)
  throw new Error('권한 정보를 불러오지 못했습니다: ' + (msg ?? 'unknown'))
}

/** 4축 조립 — 세션 클라이언트(getActor)와 admin 클라이언트(actorFromUser)가 공유한다.
 *  두 경로 모두 user_id 를 명시 필터로 건다: admin 경로에서 빠뜨리면 전원의 권한이 합쳐진 Actor 가 나온다.
 *  조회 실패는 throw 한다 — '역할 없음'으로 폴백하면 전원이 조회 전용으로 보이고(운영 마비),
 *  관대하게 폴백하면 가드가 뚫린다(fail-closed). */
export async function buildActor(db: Db, userId: string): Promise<Actor> {
  const [pa, ws] = await Promise.all([
    db.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    db.from('workspace_members').select('workspace_id, role').eq('user_id', userId),
  ])
  if (pa.error) fail('platform_admins', pa.error.message)
  if (ws.error || !ws.data) fail('workspace_members', ws.error?.message)
  const isSuperuser = Boolean(pa.data)
  const workspaceRoles = new Map<string, WorkspaceRole>()
  for (const r of ws.data!) workspaceRoles.set(r.workspace_id as string, r.role as WorkspaceRole)

  // ③ projects — SP1 에서는 읽기 정책이 개방이라 명시 필터. 플랫폼 관리자는 전부.
  const wids = [...workspaceRoles.keys()]
  const projQ = db.from('projects').select('id, workspace_id')
  const [pr, pm] = await Promise.all([
    isSuperuser ? projQ : wids.length ? projQ.in('workspace_id', wids) : Promise.resolve({ data: [], error: null }),
    db.from('project_members')
      .select('id, project_id, access_role, people!inner(user_id, active), project_member_teams(team_id, is_primary, teams(code))')
      .eq('people.user_id', userId).eq('people.active', true).eq('active', true),
  ])
  if (pr.error || !pr.data) fail('projects', pr.error?.message)
  if (pm.error || !pm.data) fail('project_members', pm.error?.message)

  const projectWorkspace = new Map<string, string>()
  for (const p of pr.data!) projectWorkspace.set(p.id as string, p.workspace_id as string)
  const projectRoles = new Map<string, ProjectRole>()
  const memberIds = new Map<string, string>()
  const rosterTeams = new Map<string, { teamIds: string[]; teamCodes: string[] }>()
  for (const row of pm.data! as Array<Record<string, unknown>>) {
    const pid = row.project_id as string
    memberIds.set(pid, row.id as string)
    if (row.access_role) projectRoles.set(pid, row.access_role as ProjectRole)
    const links = ((row.project_member_teams ?? []) as Array<{ team_id: string; is_primary: boolean; teams: { code: string } | { code: string }[] | null }>)
      .map(l => ({ id: l.team_id, code: (Array.isArray(l.teams) ? l.teams[0]?.code : l.teams?.code) ?? null, primary: l.is_primary }))
      .filter((l): l is { id: string; code: string; primary: boolean } => !!l.code)
      .sort((a, b) => Number(b.primary) - Number(a.primary))
    if (links.length) rosterTeams.set(pid, { teamIds: links.map(l => l.id), teamCodes: links.map(l => l.code) })
  }
  return { userId, isSuperuser, workspaceRoles, projectWorkspace, projectRoles, memberIds, rosterTeams }
}
