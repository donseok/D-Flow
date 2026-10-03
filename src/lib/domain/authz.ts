// 권한 판정의 순수 계층 — IO·부수효과 없음. 정본: generic-platform-design §2.4.2~2.4.3.
// 서버 액션과 UI 어포던스가 같은 규칙을 쓰도록 공유한다.
export type ProjectRole = 'admin' | 'member'
export type WorkspaceRole = 'admin' | 'member'
export type EffectiveRole = 'superuser' | 'admin' | 'member' | 'viewer'
/** project_members.access_role 값 — 호출부는 역할 문자열을 직접 적지 않고 이 상수로 비교한다. */
export const ACCESS_ROLE = { admin: 'admin', member: 'member' } as const
/** workspace_members.role 값. */
export const WORKSPACE_ROLE = { admin: 'admin', member: 'member' } as const

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

/** 워크스페이스 관리자 승계와 명단 역할을 한 판정자로 계산한다(D37). */
export function inheritedProjectRole(wsRole: WorkspaceRole | null, accessRole: ProjectRole | null): 'admin' | 'member' | 'viewer' {
  return wsRole === 'admin' ? 'admin' : accessRole ?? 'viewer'
}
export type EffectiveRoleView = { kind: 'role'; role: 'admin' | 'member' | 'viewer'; inherited: boolean } | { kind: 'external' } | { kind: 'unknown' }
/** 표시용 판정. 조회 실패는 명단 역할로 대체하지 않고 확인 불가로 표시한다. */
export function effectiveRoleOfRow(row: { kind: 'account' | 'external'; userId: string | null; accessRole: ProjectRole | null }, wsRoles: ReadonlyMap<string, WorkspaceRole> | null): EffectiveRoleView {
  if (row.kind === 'external' || !row.userId) return { kind: 'external' }
  if (!wsRoles) return { kind: 'unknown' }
  const role = inheritedProjectRole(wsRoles.get(row.userId) ?? null, row.accessRole)
  return { kind: 'role', role, inherited: role === 'admin' && row.accessRole !== 'admin' }
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
  return inheritedProjectRole(actor.workspaceRoles.get(wid) ?? null, actor.projectRoles.get(projectId) ?? null) // ⑤⑥ 승계 → 명단
}
declare const HIDDEN_PROJECT_IDS: unique symbol
/**
 * 명단 밖 비공개 프로젝트 id 집합 — 만드는 곳은 getHiddenProjectIds(src/lib/authz/visibility.ts) 하나다(HH2). 브랜드라 `new Set()`·임의 집합을
 * isHiddenProject 의 셋째 인자로 넘기면 typecheck 가 실패한다 — 병합 때 두 인자 호출을 빈 집합으로 메우면 명단 밖 비공개가 조용히 열리기 때문이다.
 * 테스트는 tests/fixtures/actor.ts 의 hiddenIds() 로 만든다. tests/invariants/hidden-project-ids-brand.test.ts 가 고정한다.
 */
export type HiddenProjectIds = ReadonlySet<string> & { readonly [HIDDEN_PROJECT_IDS]: true }
/**
 * 프로젝트 화면 숨김의 한 판정자(UI-2b 최종 리뷰 GG1) — 레이아웃·페이지 재판정·`/api/shell` 프로젝트 배지·전환 대상·최근 방문·루트 시작
 * 화면이 모두 이것으로 가른다. 숨김 = ① 타 워크스페이스·미존재(roleIn null), 플랫폼 관리자는 없는 pid ② 명단 밖 비공개 — 셋째 인자
 * `hiddenPrivate` 는 getHiddenProjectIds()(비공개 ∧ canSeeProject 거짓, 회의록·위키·AI·포털 목록과 같은 정본)의 결과다. 필수 인자이고
 * 브랜드 타입(HiddenProjectIds)이라 비공개 축을 빠뜨린 호출도, 다른 출처의 집합(빈 집합 포함)을 넘긴 호출도 컴파일되지 않는다(HH2).
 * '명단 밖'의 경계는 access_role 이다 — 명단 행이 있어도 access_role 이 null 이면 projectRoles 에 없으므로 숨는다(canSeeProject 와 같은 축, HH5).
 * 그 집합을 못 읽었으면(던짐) 호출부가 404 로 위장하지 않고 자기 실패 관례로 돌린다.
 * roleIn 은 플랫폼 관리자에게 pid 가 무엇이든 'superuser' 라 그것만으로는 미존재를 가리지 못한다.
 * buildActor 는 플랫폼 관리자에게 전 프로젝트를 싣으므로 projectWorkspace 에 없으면 미존재다.
 */
export function isHiddenProject(actor: Actor | null, projectId: string, hiddenPrivate: HiddenProjectIds): boolean {
  if (!actor) return true
  if (hiddenPrivate.has(projectId)) return true
  if (actor.isSuperuser) return !actor.projectWorkspace.has(projectId)
  return roleIn(actor, projectId) === null
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
/**
 * 실제 소속(workspace_members 행이 있다) — 플랫폼 관리자 승계 없음. 본인 기록(개인 설정·방문·현재 워크스페이스 쿠키)을 쓸지 정할 때(U2b-3 보안 리뷰 AA6).
 * 범위(UI-2b 최종 보안 리뷰 P3 → GG7): 이 규칙이 닫는 것은 **워크스페이스 단위 본인 기록**뿐이다 — 현재 워크스페이스 쿠키·최근 방문·워크스페이스
 * 개인 설정(user_preferences)·알림 읽음. 프로젝트 단위 화면 상태(WBS 접힘 user_wbs_state·공지 읽음 워터마크 announcement_seen)와 사용 기록
 * (usage_events)은 보기 축을 따른다 — 플랫폼 관리자가 비소속 워크스페이스의 프로젝트를 열어 접거나 공지를 보면 그 프로젝트 키의 본인 행이 생긴다
 * (본인 행이라 누설은 없다). '비소속 보기는 아무것도 쓰지 않는다'가 아니다. 맞추려면 두 쓰기에 hasWorkspaceMembership(actor, 프로젝트의 워크스페이스).
 */
export function hasWorkspaceMembership(actor: Actor | null, workspaceId: string): boolean {
  return !!actor && actor.workspaceRoles.has(workspaceId)
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
 * 회의록 범위의 멤버 이상 — 프로젝트가 있으면 그 프로젝트의 멤버 이상, 없으면 그 워크스페이스에 역할(hasProjectRoleInWorkspace).
 * 범위는 회의록 행의 것이다(클라이언트 입력 아님). 다른 워크스페이스에만 역할이 있으면 거짓 — 하이라이트·요약처럼 남에게도
 * 보이는 쓰기의 최소 자격이고, canEditMinute 의 전제다.
 */
export function isMinuteMember(actor: Actor | null, minute: { project_id: string | null; workspace_id: string }): boolean {
  return minute.project_id ? isProjectMember(actor, minute.project_id) : hasProjectRoleInWorkspace(actor, minute.workspace_id)
}
/**
 * 회의록 변경(본문·메타·연결·공유) 자격 — 그 회의록 범위의 멤버 이상(isMinuteMember)이면서 작성자 본인 또는 그 프로젝트의
 * 관리자 이상(워크스페이스 관리자 승계 포함). 작성자라도 조회 전용이 됐거나 그 워크스페이스를 떠났으면 고칠 수 없다.
 * 프로젝트 미지정(project_id null) 회의록은 isProjectAdmin(actor, null)=슈퍼유저만 — 의도된 fail-closed(SP1 스펙 §3.5).
 * 세션 액션(checkOwner)과 외부 API(link·POST replace)가 같은 판정을 쓴다.
 */
export function canEditMinute(
  actor: Actor | null, minute: { created_by: string | null; project_id: string | null; workspace_id: string },
): boolean {
  if (!actor || !isMinuteMember(actor, minute)) return false
  return minute.created_by === actor.userId || isProjectAdmin(actor, minute.project_id)
}
/**
 * 설정 키의 editor 등급(스펙 §3.3) — 스코프 등급(프로젝트·워크스페이스 관리자)은 설정 액션의 가드가 이미 판정했다.
 * 여기는 키 정의의 editor 가 그 스코프에 맞는지와 플랫폼 관리자 전용 키만 본다. 모르는 값·스코프에 안 맞는 값은 거부(fail-closed).
 */
export function canEditSetting(scope: 'workspace' | 'project', editor: 'platform_admin' | 'workspace_admin' | 'project_admin', actor: Actor): boolean {
  if (scope === 'project') return editor === 'project_admin'
  if (editor === 'workspace_admin') return true
  if (editor === 'platform_admin') return actor.isSuperuser
  return false
}
/** 비공개 프로젝트 화면 숨김(0070 의미 유지, RLS 경계 아님). 워크스페이스 관리자 승계 포함. */
export function canSeeProject(actor: Actor | null, project: { id: string; is_private?: boolean | null }): boolean {
  if (!project.is_private) return true
  if (!actor) return false
  return actor.isSuperuser || isWorkspaceAdmin(actor, actor.projectWorkspace.get(project.id)) || actor.projectRoles.has(project.id)
}
/**
 * 조회자에게 보이는 팀의 범위 — 회의록 담당 필터·검증(domain/teams 의 teamCodesVisibleTo)이 쓴다. 플랫폼 관리자(all)는
 * 전 워크스페이스, 아니면 소속 워크스페이스들의 공용 팀과 볼 수 있는 프로젝트들의 전용 팀.
 * 만드는 곳은 아래 두 함수뿐이다 — 전부를 여는 뷰({ all: true })는 플랫폼 관리자 판정과 함께 이 파일에만 둔다
 * (tests/invariants/teams-source.test.ts 가 검사한다).
 * 호출 전제: projectIds 의 워크스페이스 ⊆ workspaceIds(workspaceIds 가 비어 있지 않을 때) — visibleTeams 는 질의를 workspace_id 로만
 * 좁히므로 그 밖 프로젝트의 전용 팀은 빠진다(닫힘). 생산자 셋(teamViewOf·accessScope·gateChatTools 로 좁힌 봇 범위)이 이 전제를
 * 지킨다 — gateChatTools 는 워크스페이스 모듈 설정을 못 읽으면 좁히지 않고 던진다(A2-3 리뷰 보안 P3 — X2).
 */
export type TeamView =
  | { all: true }
  | { all: false; workspaceIds: Iterable<string>; projectIds: Iterable<string> }

/**
 * 접근 범위(accessScope — 봇 도구 컨텍스트와 같은 모양)의 팀 가시 범위. 플랫폼 관리자는 멤버십과 무관하게 전부(멤버십 없는
 * 관리자를 빈 범위로 두면 담당 필터가 조용히 무시되거나 항상 거부된다). 아니면 소속 워크스페이스들 + 볼 수 있는 프로젝트
 * (allowedProjectIds — 비공개 판정이 끝난 목록). 플래그·워크스페이스가 없으면 거짓·빈 범위로 본다(fail-closed).
 */
export function teamViewOfScope(scope: {
  isSuperuser?: boolean
  workspaceIds?: readonly string[]
  allowedProjectIds: readonly string[]
}): TeamView {
  if (scope.isSuperuser === true) return { all: true }
  return { all: false, workspaceIds: scope.workspaceIds ?? [], projectIds: scope.allowedProjectIds }
}
/**
 * Actor 의 팀 가시 범위 — teamViewOfScope 와 같은 규칙. 볼 수 있는 프로젝트 = 소속 워크스페이스의 프로젝트 중
 * hiddenProjectIds(canSeeProject 거짓인 비공개 — 호출부가 읽어 준다)를 뺀 것.
 */
export function teamViewOf(actor: Actor, hiddenProjectIds: Iterable<string>): TeamView {
  const hidden = new Set(hiddenProjectIds)
  return teamViewOfScope({
    isSuperuser: actor.isSuperuser,
    workspaceIds: [...actor.workspaceRoles.keys()],
    allowedProjectIds: [...actor.projectWorkspace.keys()].filter(pid => !hidden.has(pid)),
  })
}
function adminWorkspaceIds(actor: Actor): Set<string> {
  const s = new Set<string>()
  for (const [wid, r] of actor.workspaceRoles) if (r === 'admin') s.add(wid)
  return s
}
/** 어느 워크스페이스든 관리자인가 — 프로젝트 생성 어포던스(사이드바 '+'·포털 버튼). 서버 가드는 대상 워크스페이스의
 *  requireWorkspaceAdmin(actions/project.ts)이다. 명단 admin 은 생성 권한이 아니다. */
export function isAnyWorkspaceAdmin(actor: Actor | null): boolean {
  if (!actor) return false
  return actor.isSuperuser || adminWorkspaceIds(actor).size > 0
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
