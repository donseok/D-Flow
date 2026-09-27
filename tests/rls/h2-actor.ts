// src/lib/authz/buildActor.ts 의 SQL 거울 — 그 함수의 4축을 같은 조건의 SQL 로 읽어 Actor 를 만든다. 한쪽의 조건(활성 명단·활성 인물·
// 소속 밖 프로젝트 행 버림·슈퍼유저의 전 프로젝트 등)을 바꾸면 다른 쪽도 같이 바꾼다 — 어긋나면 패리티 표가 앱이 아닌 이 거울을 검증한다.
// TS 판정(canEditMinute 등)과 SQL 헬퍼의 패리티 표에 쓴다. postgres 롤로 부른다(RLS 를 건너 전 행을 본다 — buildActor 가 user_id 필터로
// 하는 것과 같다).
import type { PoolClient, QueryResultRow } from 'pg'
import type { Actor, ProjectRole, WorkspaceRole } from '@/lib/domain/authz'

export async function actorFromDb(c: PoolClient, userId: string): Promise<Actor> {
  const q = async <T extends QueryResultRow>(sql: string, p: unknown[] = []) => (await c.query<T>(sql, p)).rows
  const isSuperuser = (await q<{ n: number }>('select count(*)::int as n from public.platform_admins where user_id = $1', [userId]))[0].n === 1
  const ws = await q<{ workspace_id: string; role: WorkspaceRole }>(
    'select workspace_id, role from public.workspace_members where user_id = $1', [userId])
  const workspaceRoles = new Map(ws.map((r) => [r.workspace_id, r.role] as const))
  const projects = isSuperuser
    ? await q<{ id: string; workspace_id: string }>('select id, workspace_id from public.projects')
    : await q<{ id: string; workspace_id: string }>('select id, workspace_id from public.projects where workspace_id = any($1::uuid[])',
      [[...workspaceRoles.keys()]])
  const projectWorkspace = new Map(projects.map((p) => [p.id, p.workspace_id] as const))
  const roster = await q<{ id: string; project_id: string; access_role: ProjectRole | null }>(
    `select pm.id, pm.project_id, pm.access_role from public.project_members pm join public.people pe on pe.id = pm.person_id
      where pe.user_id = $1 and pe.active and pm.active`, [userId])
  const projectRoles = new Map<string, ProjectRole>()
  const memberIds = new Map<string, string>()
  for (const r of roster) {
    if (!projectWorkspace.has(r.project_id)) continue   // buildActor 와 같은 규칙(H2 과제 3)
    memberIds.set(r.project_id, r.id)
    if (r.access_role) projectRoles.set(r.project_id, r.access_role)
  }
  return { userId, isSuperuser, workspaceRoles, projectWorkspace, projectRoles, memberIds, rosterTeams: new Map() }
}
