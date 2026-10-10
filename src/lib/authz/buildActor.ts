import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor, ProjectRole, WorkspaceRole } from '../domain/authz'
import { fetchAllPages } from '../data/paging'

type Db = Pick<SupabaseClient, 'from'>
const fail = (axis: string, msg: string | undefined): never => {
  console.error(`[buildActor] ${axis} 조회 실패:`, msg)
  throw new Error('권한 정보를 불러오지 못했습니다: ' + (msg ?? 'unknown'))
}

/** 임베드 workspaces(archived_at) 가 "보관됨"을 말하는가. 세션 클라이언트는 RLS(0056)가 보관된 워크스페이스의 행을 이미 가리고,
 *  admin 클라이언트(RLS 없음)는 이 판정이 유일한 선이다. 임베드가 null 이면(워크스페이스 행이 보이지 않는다) 보관으로 본다(fail-closed).
 *  키 자체가 없는 응답(임베드를 싣지 않는 테스트 대역)만 보관 아님으로 읽는다 — PostgREST 는 요청한 임베드의 키를 늘 싣는다. */
function embedArchived(row: Record<string, unknown>): boolean {
  if (!Object.hasOwn(row, 'workspaces')) return false
  const e = row.workspaces as { archived_at?: unknown } | Array<{ archived_at?: unknown }> | null
  const w = Array.isArray(e) ? e[0] : e
  return !w || w.archived_at !== null
}

/** 4축 조립 — 세션 클라이언트(getActor)와 admin 클라이언트(actorFromUser)가 공유한다.
 *  **보관된 워크스페이스(0056)는 싣지 않는다** — 그 소속·프로젝트·명단이 스냅샷에 없으므로 순수 판정(roleIn·workspaceRoleIn …)이 "없음"으로 읽고
 *  가드 넷이 ERR_MISSING(404)으로 닫는다. 플랫폼 관리자는 소속과 무관하게 통과하므로 "있는(보관 아닌) 워크스페이스" 집합(liveWorkspaceIds)을 따로 싣는다.
 *  두 경로 모두 user_id 를 명시 필터로 건다: admin 경로에서 빠뜨리면 전원의 권한이 합쳐진 Actor 가 나온다.
 *  조회 실패는 throw 한다 — '역할 없음'으로 폴백하면 전원이 조회 전용으로 보이고(운영 마비),
 *  관대하게 폴백하면 가드가 뚫린다(fail-closed). */
export async function buildActor(db: Db, userId: string): Promise<Actor> {
  // ①②④ 는 user_id 만으로 걸러지므로 한 묶음으로 보낸다. ③ projects 만 ② 의 워크스페이스 목록을 기다린다.
  const [pa, ws, pm] = await Promise.all([
    db.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    db.from('workspace_members').select('workspace_id, role, workspaces(archived_at)').eq('user_id', userId),
    // people 임베드는 반드시 !inner — 아니면 .eq('people.user_id') 가 임베드만 거르고 명단 행은 전부 돌아온다(admin 경로에서 전원 합산).
    db.from('project_members')
      .select('id, project_id, access_role, people!inner(user_id, active), project_member_teams(team_id, is_primary, teams(code, name))')
      .eq('people.user_id', userId).eq('people.active', true).eq('active', true),
  ])
  if (pa.error) fail('platform_admins', pa.error.message)
  if (ws.error || !ws.data) fail('workspace_members', ws.error?.message)
  if (pm.error || !pm.data) fail('project_members', pm.error?.message)
  // 최고 권한 비트는 응답 모양이 아니라 내용으로 판정한다 — [] ·{} ·남의 행은 슈퍼유저가 아니다(fail-closed).
  const isSuperuser = (pa.data as { user_id?: unknown } | null)?.user_id === userId
  const workspaceRoles = new Map<string, WorkspaceRole>()
  for (const r of ws.data! as Array<Record<string, unknown>>) {
    if (embedArchived(r)) continue                               // 보관된 워크스페이스의 소속은 없는 것으로 본다
    workspaceRoles.set(r.workspace_id as string, r.role as WorkspaceRole)
  }

  // ③ projects — SP1 에서는 읽기 정책이 개방이라 명시 필터. 플랫폼 관리자는 전부, 소속 워크스페이스가 없으면 조회하지 않는다.
  // 이 맵은 '존재하는 프로젝트'의 근거다(isHiddenProject·워크스페이스 해석) — PostgREST max_rows 에서 잘리면 빠진 프로젝트가 404·ERR_MISSING
  // 으로 읽히므로 id 정렬 페이지로 끝까지 읽고 count 총합으로 대조한다(fetchAllPages).
  const wids = [...workspaceRoles.keys()]
  let projects: Array<{ id: string; workspace_id: string }> = []
  // 플랫폼 관리자의 "있는 워크스페이스" — 세션은 RLS 가 보관된 행을 가려 주고(my_workspace_ids), admin 은 archived_at 으로 거른다.
  // 플랫폼 관리자가 아니면 읽지 않는다(소속 맵이 곧 범위다).
  let liveWorkspaceIds: Set<string> | undefined
  const [projectRows] = await Promise.all([
    isSuperuser || wids.length
      ? fetchAllPages<{ id: string; workspace_id: string }>('projects', (from, to) => {
          const q = db.from('projects').select('id, workspace_id, workspaces(archived_at)', { count: 'exact' })
          return (isSuperuser ? q : q.in('workspace_id', wids)).order('id').range(from, to)
        }).catch((e: unknown) => fail('projects', e instanceof Error ? e.message : String(e)))
      : Promise.resolve([] as Array<{ id: string; workspace_id: string }>),
    isSuperuser
      ? fetchAllPages<{ id: string; archived_at: string | null }>('workspaces', (from, to) =>
          db.from('workspaces').select('id, archived_at', { count: 'exact' }).order('id').range(from, to))
          .then((rows) => { liveWorkspaceIds = new Set(rows.filter((w) => w.archived_at === null).map((w) => w.id)) })
          .catch((e: unknown) => fail('workspaces', e instanceof Error ? e.message : String(e)))
      : Promise.resolve(),
  ])
  projects = projectRows

  const projectWorkspace = new Map<string, string>()
  for (const p of projects) {
    if (embedArchived(p as unknown as Record<string, unknown>)) continue   // 보관된 워크스페이스의 프로젝트는 없는 것으로 본다
    if (liveWorkspaceIds && !liveWorkspaceIds.has(p.workspace_id)) continue
    projectWorkspace.set(p.id, p.workspace_id)
  }
  const projectRoles = new Map<string, ProjectRole>()
  const memberIds = new Map<string, string>()
  const rosterTeams = new Map<string, { teamIds: string[]; teamCodes: string[]; teamNames: string[] }>()
  for (const row of pm.data! as Array<Record<string, unknown>>) {
    const pid = row.project_id as string
    // 소속 워크스페이스 밖 프로젝트의 명단 행은 버린다 — 소속을 잃은 뒤 남은 행이 projectRoles 로 들어가면 isAnyProjectAdmin·
    // adminProjectIds·hasAnyProjectRole 이 그 역할을 센다(AUTH-01b). SQL 헬퍼는 is_ws_member 로 같은 선을 긋는다(0009 F1).
    // 플랫폼 관리자는 projectWorkspace 에 전 프로젝트가 있어 버리는 행이 없다.
    if (!projectWorkspace.has(pid)) continue
    memberIds.set(pid, row.id as string)
    if (row.access_role) projectRoles.set(pid, row.access_role as ProjectRole)
    // 대표 팀 먼저, 나머지는 code 사전순 — 임베드 응답 순서(물리 순서)에 기대지 않아 primaryTeamCode 가 결정적이다.
    // name 은 표시 전용(계정 메뉴의 소속) — 정렬·판정은 code 그대로다. 이름이 없으면 code 로 보이게 code 를 싣는다.
    type TeamEmbed = { code: string; name?: string | null }
    const links = ((row.project_member_teams ?? []) as Array<{ team_id: string; is_primary: boolean; teams: TeamEmbed | TeamEmbed[] | null }>)
      .map(l => { const t = Array.isArray(l.teams) ? l.teams[0] : l.teams; return { id: l.team_id, code: t?.code ?? null, name: t?.name ?? null, primary: l.is_primary } })
      .filter((l): l is { id: string; code: string; name: string | null; primary: boolean } => !!l.code)
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.code.localeCompare(b.code))
    if (links.length) rosterTeams.set(pid, { teamIds: links.map(l => l.id), teamCodes: links.map(l => l.code), teamNames: links.map(l => l.name?.trim() || l.code) })
  }
  return { userId, isSuperuser, workspaceRoles, projectWorkspace, projectRoles, memberIds, rosterTeams, ...(liveWorkspaceIds ? { liveWorkspaceIds } : {}) }
}
