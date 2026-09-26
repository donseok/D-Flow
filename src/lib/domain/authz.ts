// 권한 판정의 순수 계층 — IO·부수효과 없음. 정본: generic-platform-design §2.4.2~2.4.3.
// 서버 액션과 UI 어포던스가 같은 규칙을 쓰도록 공유한다.
export type ProjectRole = 'admin' | 'member'
export type WorkspaceRole = 'admin' | 'member'
export type EffectiveRole = 'superuser' | 'admin' | 'member' | 'viewer'

/** workspace_members.role 원시값(행 단위, Actor 없이 읽은 값)이 관리자인가 — 역할 문자열 비교는 이 파일에만 둔다. */
export function isWorkspaceAdminRole(role: string | null | undefined): boolean {
  return role === 'admin'
}
/**
 * 요청한 권한이 관리자 슬롯인가 — 부여·초대 액션이 가드(슈퍼유저 vs 프로젝트 관리자)를 고를 때 쓴다(SP2 에서 워크스페이스 관리자).
 * 서버 액션 입력이라 타입을 믿지 않는다 — 'admin' 문자열 그대로일 때만 참.
 */
export function isAdminAccessRole(v: unknown): v is 'admin' {
  return v === 'admin'
}
/** 워크스페이스 역할 표시 라벨. */
export const WORKSPACE_ROLE_LABEL: Record<WorkspaceRole, string> = { admin: '관리자', member: '멤버' }

/** 로그인 사용자의 권한 스냅샷. buildActor() 가 4축(플랫폼 관리자·워크스페이스·프로젝트·명단)으로 조립한다. */
export interface Actor {
  userId: string
  /** platform_admins 행 존재. 이름은 플랫폼 관리자 가드와 SQL is_superuser() 의 짝이라 유지. */
  isSuperuser: boolean
  /** workspaceId → role. 없는 키 = 소속 아님. */
  workspaceRoles: ReadonlyMap<string, WorkspaceRole>
  /** projectId → workspaceId. 내 워크스페이스들의 프로젝트 전부(권한 무관). 없는 키 = 타 워크스페이스·미존재. */
  projectWorkspace: ReadonlyMap<string, string>
  /** projectId → access_role. active 명단 행 중 non-null 만. */
  projectRoles: ReadonlyMap<string, ProjectRole>
  /** projectId → 내 project_members.id. */
  memberIds: ReadonlyMap<string, string>
  /** projectId → 내 팀 전부(project_member_teams). 대표 팀이 첫 원소. */
  rosterTeams: ReadonlyMap<string, { teamIds: readonly string[]; teamCodes: readonly string[] }>
}

/**
 * 이 사용자가 이 프로젝트에서 갖는 유효 역할.
 *
 * null 은 '판정 대상이 없음'이다 — 비로그인, 또는 내 워크스페이스에 없는 프로젝트(타 워크스페이스·미존재).
 * 가드는 후자를 ERR_MISSING(404)으로 돌려 존재를 숨긴다.
 * projectId 가 null 인 경우(프로젝트 미지정 회의록 등)는 슈퍼유저 외 전원을 viewer 로 본다 — fail-closed.
 * 호출부는 이 경우 '작성자 본인' 같은 별도 조건과 OR 로 결합해야 한다.
 */
export function roleIn(actor: Actor | null, projectId: string | null): EffectiveRole | null {
  if (!actor) return null                                        // ① 비로그인
  if (actor.isSuperuser) return 'superuser'                      // ② 플랫폼 관리자(pid null 포함)
  if (!projectId) return 'viewer'                                // ③ 미지정 — fail-closed
  const wid = actor.projectWorkspace.get(projectId)
  if (!wid) return null                                          // ④ 타 워크스페이스·미존재 — 존재 은닉
  if (actor.workspaceRoles.get(wid) === 'admin') return 'admin'  // ⑤ 워크스페이스 관리자 승계(Q2) — 명단 행보다 먼저
  return actor.projectRoles.get(projectId) ?? 'viewer'           // ⑥ 명단 행
}
export function workspaceRoleIn(actor: Actor | null, workspaceId: string): 'superuser' | WorkspaceRole | null {
  if (!actor) return null
  if (actor.isSuperuser) return 'superuser'
  return actor.workspaceRoles.get(workspaceId) ?? null
}
export function isWorkspaceAdmin(actor: Actor | null, workspaceId: string | null | undefined): boolean {
  if (!workspaceId) return Boolean(actor?.isSuperuser)
  const r = workspaceRoleIn(actor, workspaceId)
  return r === 'superuser' || r === 'admin'
}
export type WorkspaceGuardVerdict = 'ok' | 'missing' | 'denied'
/** 워크스페이스 관리 가드의 순수 판정. 소속이 없거나 id 가 없으면 'missing'(존재 은닉 — 404), 멤버면 'denied'(403). */
export function workspaceAdminVerdict(actor: Actor, workspaceId: string | null): WorkspaceGuardVerdict {
  if (actor.isSuperuser) return 'ok'
  if (!workspaceId) return 'missing'
  const r = actor.workspaceRoles.get(workspaceId)
  if (r === undefined) return 'missing'
  return r === 'admin' ? 'ok' : 'denied'
}
export function isWorkspaceMember(actor: Actor | null, workspaceId: string | null | undefined): boolean {
  if (!workspaceId) return Boolean(actor?.isSuperuser)
  return workspaceRoleIn(actor, workspaceId) !== null
}
/** 관리자 이상(슈퍼유저·워크스페이스 관리자 포함). 등록·수정·삭제 전권. */
export function isProjectAdmin(actor: Actor | null, projectId: string | null): boolean {
  const r = roleIn(actor, projectId); return r === 'superuser' || r === 'admin'
}
/** 멤버 이상. 회의·회의록·주간보고·이슈·근태·첨부 쓰기의 최소 자격. */
export function isProjectMember(actor: Actor | null, projectId: string | null): boolean {
  const r = roleIn(actor, projectId); return r === 'superuser' || r === 'admin' || r === 'member'
}
/**
 * 회의록 변경(본문·메타·연결·공유) 자격 — 작성자 본인 또는 그 프로젝트의 관리자 이상(워크스페이스 관리자 승계 포함).
 * 프로젝트 미지정(project_id null) 회의록은 isProjectAdmin(actor, null)=슈퍼유저만 — 의도된 fail-closed(SP1 스펙 §3.5).
 * 세션 액션(checkOwner)과 외부 API(link·POST replace)가 같은 판정을 쓴다.
 */
export function canEditMinute(actor: Actor | null, minute: { created_by: string | null; project_id: string | null }): boolean {
  if (!actor) return false
  return minute.created_by === actor.userId || isProjectAdmin(actor, minute.project_id)
}
/** 비공개 프로젝트 화면 숨김(0070 의미 유지, RLS 경계 아님). 워크스페이스 관리자 승계 포함. */
export function canSeeProject(actor: Actor | null, project: { id: string; is_private?: boolean | null }): boolean {
  if (!project.is_private) return true
  if (!actor) return false
  return actor.isSuperuser || isWorkspaceAdmin(actor, actor.projectWorkspace.get(project.id)) || actor.projectRoles.has(project.id)
}
function adminWorkspaceIds(actor: Actor): Set<string> {
  const s = new Set<string>()
  for (const [wid, r] of actor.workspaceRoles) if (r === 'admin') s.add(wid)
  return s
}
/** 어느 프로젝트든 관리자면 true — 헤더 등급 표시용. 회의록 폴더 가드는 0006 부터 워크스페이스 판정이라
 *  이걸 쓰지 않는다(adminWorkspaceIdList). */
export function isAnyProjectAdmin(actor: Actor | null): boolean {
  if (!actor) return false
  if (actor.isSuperuser) return true
  if (adminWorkspaceIds(actor).size > 0) return true
  for (const r of actor.projectRoles.values()) if (r === 'admin') return true
  return false
}
/**
 * 관리자 이상인 프로젝트 id 목록 — 전역 목록 화면이 항목별로 판정할 수 있게 RSC 경계로 내리는 직렬화 가능 형태.
 * 명단 admin 행 ∪ 내가 관리자인 워크스페이스의 프로젝트 전부.
 *
 * 슈퍼유저는 '모든 프로젝트의 관리자'라 이 목록으로는 표현되지 않는다 — 호출부는
 * isSuperuser 를 함께 받아 OR 로 결합해야 isProjectAdmin 과 같은 판정이 된다.
 */
export function adminProjectIds(actor: Actor | null): string[] {
  if (!actor) return []
  const out = new Set<string>()
  for (const [id, role] of actor.projectRoles) if (role === 'admin') out.add(id)
  const ws = adminWorkspaceIds(actor)
  for (const [pid, wid] of actor.projectWorkspace) if (ws.has(wid)) out.add(pid)
  return [...out]
}
/**
 * 관리자인 워크스페이스 id 목록 — RSC 경계로 내리는 직렬화 가능 형태. 회의록 폴더 관리(개명·이동·삭제)의
 * 서버 판정(작성자 ∨ isWorkspaceAdmin(actor, 폴더의 워크스페이스), 0006)을 클라이언트가 폴더별로 미러한다.
 * 슈퍼유저는 목록으로 표현되지 않는다 — 호출부가 isSuperuser 와 OR 로 결합한다(adminProjectIds 와 같은 관례).
 */
export function adminWorkspaceIdList(actor: Actor | null): string[] {
  return actor ? [...adminWorkspaceIds(actor)] : []
}
/** 어느 프로젝트든 역할이 있으면 true — 조회 전용 계정 차단용. */
export function hasAnyProjectRole(actor: Actor | null): boolean {
  if (!actor) return false
  return actor.isSuperuser || actor.projectRoles.size > 0 || adminWorkspaceIds(actor).size > 0
}
/** 그 워크스페이스에 역할이 있는가 — 워크스페이스 관리자이거나, 그 워크스페이스 프로젝트 중 하나에 명단 권한. (0006 에서 폐기된 옛 전역 역할 판정의 워크스페이스판) */
export function hasProjectRoleInWorkspace(actor: Actor | null, workspaceId: string | null | undefined): boolean {
  if (!actor) return false
  if (actor.isSuperuser) return true
  if (!workspaceId) return false
  if (actor.workspaceRoles.get(workspaceId) === 'admin') return true
  for (const pid of actor.projectRoles.keys()) if (actor.projectWorkspace.get(pid) === workspaceId) return true
  return false
}

/**
 * RSC 경계로 내릴 수 있는 직렬화 가능한 스냅샷 — Actor 의 Map 은 클라이언트 props 로
 * 직렬화되지 않는다. 프로젝트 화면은 자기 프로젝트 하나만 알면 되므로 평탄화해 내리고,
 * 클라이언트에서 actorFromView 로 복원한다.
 */
export interface ProjectActorView {
  userId: string; isSuperuser: boolean
  workspaceId: string | null; workspaceRole: WorkspaceRole | null
  projectRole: ProjectRole | null; memberId: string | null
  rosterTeamIds: string[]; rosterTeamCodes: string[]
  /** 대표 팀(is_primary), 없으면 첫 팀, 없으면 null. */
  primaryTeamCode: string | null
}
export function toProjectActorView(actor: Actor | null, projectId: string): ProjectActorView | null {
  if (!actor) return null
  const wid = actor.projectWorkspace.get(projectId) ?? null
  const teams = actor.rosterTeams.get(projectId)
  return {
    userId: actor.userId, isSuperuser: actor.isSuperuser,
    workspaceId: wid, workspaceRole: wid ? actor.workspaceRoles.get(wid) ?? null : null,
    projectRole: actor.projectRoles.get(projectId) ?? null,
    memberId: actor.memberIds.get(projectId) ?? null,
    rosterTeamIds: [...(teams?.teamIds ?? [])], rosterTeamCodes: [...(teams?.teamCodes ?? [])],
    primaryTeamCode: teams?.teamCodes[0] ?? null,
  }
}
export function actorFromView(view: ProjectActorView | null, projectId: string): Actor | null {
  if (!view) return null
  return {
    userId: view.userId, isSuperuser: view.isSuperuser,
    workspaceRoles: new Map(view.workspaceId && view.workspaceRole ? [[view.workspaceId, view.workspaceRole]] : []),
    projectWorkspace: new Map(view.workspaceId ? [[projectId, view.workspaceId]] : []),
    projectRoles: new Map(view.projectRole ? [[projectId, view.projectRole]] : []),
    memberIds: new Map(view.memberId ? [[projectId, view.memberId]] : []),
    rosterTeams: new Map(view.rosterTeamCodes.length ? [[projectId, { teamIds: view.rosterTeamIds, teamCodes: view.rosterTeamCodes }]] : []),
  }
}
