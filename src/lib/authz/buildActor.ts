import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor, ProjectRole, WorkspaceRole } from '../domain/authz'
import { fetchAllPages } from '../data/paging'

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
  // ①②④ 는 user_id 만으로 걸러지므로 한 묶음으로 보낸다. ③ projects 만 ② 의 워크스페이스 목록을 기다린다.
  const [pa, ws, pm] = await Promise.all([
    db.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    db.from('workspace_members').select('workspace_id, role').eq('user_id', userId),
    // people 임베드는 반드시 !inner — 아니면 .eq('people.user_id') 가 임베드만 거르고 명단 행은 전부 돌아온다(admin 경로에서 전원 합산).
    db.from('project_members')
      .select('id, project_id, access_role, people!inner(user_id, active), project_member_teams(team_id, is_primary, teams(code))')
      .eq('people.user_id', userId).eq('people.active', true).eq('active', true),
  ])
  if (pa.error) fail('platform_admins', pa.error.message)
  if (ws.error || !ws.data) fail('workspace_members', ws.error?.message)
  if (pm.error || !pm.data) fail('project_members', pm.error?.message)
  // 최고 권한 비트는 응답 모양이 아니라 내용으로 판정한다 — [] ·{} ·남의 행은 슈퍼유저가 아니다(fail-closed).
  const isSuperuser = (pa.data as { user_id?: unknown } | null)?.user_id === userId
  const workspaceRoles = new Map<string, WorkspaceRole>()
  for (const r of ws.data!) workspaceRoles.set(r.workspace_id as string, r.role as WorkspaceRole)

  // ③ projects — SP1 에서는 읽기 정책이 개방이라 명시 필터. 플랫폼 관리자는 전부, 소속 워크스페이스가 없으면 조회하지 않는다.
  // 이 맵은 '존재하는 프로젝트'의 근거다(isHiddenProject·워크스페이스 해석) — PostgREST max_rows 에서 잘리면 빠진 프로젝트가 404·ERR_MISSING
  // 으로 읽히므로 id 정렬 페이지로 끝까지 읽고 count 총합으로 대조한다(fetchAllPages).
  const wids = [...workspaceRoles.keys()]
  let projects: Array<{ id: string; workspace_id: string }> = []
  if (isSuperuser || wids.length) {
    try {
      projects = await fetchAllPages<{ id: string; workspace_id: string }>('projects', (from, to) => {
        const q = db.from('projects').select('id, workspace_id', { count: 'exact' })
        return (isSuperuser ? q : q.in('workspace_id', wids)).order('id').range(from, to)
      })
    } catch (e) {
      fail('projects', e instanceof Error ? e.message : String(e))
    }
  }

  const projectWorkspace = new Map<string, string>()
  for (const p of projects) projectWorkspace.set(p.id, p.workspace_id)
  const projectRoles = new Map<string, ProjectRole>()
  const memberIds = new Map<string, string>()
  const rosterTeams = new Map<string, { teamIds: string[]; teamCodes: string[] }>()
  for (const row of pm.data! as Array<Record<string, unknown>>) {
    const pid = row.project_id as string
    memberIds.set(pid, row.id as string)
    if (row.access_role) projectRoles.set(pid, row.access_role as ProjectRole)
    // 대표 팀 먼저, 나머지는 code 사전순 — 임베드 응답 순서(물리 순서)에 기대지 않아 primaryTeamCode 가 결정적이다.
    const links = ((row.project_member_teams ?? []) as Array<{ team_id: string; is_primary: boolean; teams: { code: string } | { code: string }[] | null }>)
      .map(l => ({ id: l.team_id, code: (Array.isArray(l.teams) ? l.teams[0]?.code : l.teams?.code) ?? null, primary: l.is_primary }))
      .filter((l): l is { id: string; code: string; primary: boolean } => !!l.code)
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.code.localeCompare(b.code))
    if (links.length) rosterTeams.set(pid, { teamIds: links.map(l => l.id), teamCodes: links.map(l => l.code) })
  }
  return { userId, isSuperuser, workspaceRoles, projectWorkspace, projectRoles, memberIds, rosterTeams }
}
