'use server'
// 명단(project_members) 쓰기의 유일한 입구 — 앱은 project_members 에 직접 insert/update/upsert 하지 않는다(스펙 SP1 §4).
// 추가·수정·권한 부여·팀 동기화는 전부 RPC upsert_project_member 한 번이다. 인물 확정(id → (워크스페이스, 이메일) → 신규)·
// 권한 규칙(관리자 슬롯·본인 강등·계정 없는 권한 금지)·팀 동기화가 한 트랜잭션에서 돈다. 여기서 쪼개 쓰면 반쪽 저장이 생긴다.
// 행 삭제만 RPC 밖이다(스펙이 허용한 1곳) — 세션 클라이언트로 지워 RLS(관리자 행은 워크스페이스 관리자만)가 판정하게 한다.
import { revalidatePath } from 'next/cache'
import {
  requireProjectAdmin, requireProjectMember, requireSuperuser, resolveProjectId,
} from '@/lib/authz'
import { ERR_MISSING } from '@/lib/authz/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { isValidEmail, isUuidLike } from '@/lib/domain/validate'
import { isAdminAccessRole } from '@/lib/domain/authz'
import { isAccountRole, type AccountRole } from '@/lib/domain/accounts'
import { rosterWriteError, ROSTER_WRITE_FAILED, ROSTER_HAS_RECORDS } from '@/lib/domain/rosterErrors'
import { ROSTER_SELECT, mapRosterRows, personOf, type RosterMember } from '@/lib/data/memberSelect'
import { teamsForProjectSync } from '@/lib/teams/master'
import type { TeamCode } from '@/lib/domain/types'

type AdminClient = ReturnType<typeof createAdminClient>
type AccessRole = 'admin' | 'member'

export interface RosterInput {
  /** 기존 인물 — 주면 그 인물의 명단 행을 upsert 한다. 이때 email 은 인물 매칭에 쓰이지 않는다(인물의 이메일은 바꾸지 않는다). */
  personId?: string | null
  name: string
  /** 새 인물일 때 (워크스페이스, 이메일)로 기존 인물을 먼저 찾는다. null = 외부 인력(이메일 없음). */
  email: string | null
  /** 이 프로젝트 권한. null = 조회 전용. 계정 없는 인물에게 주면 DB 가 거부한다. */
  accessRole: AccessRole | null
  roleLabel: string | null
  title: string | null
  /** 이 명단 행의 팀 전부 — 첫 원소가 대표 팀. 결과 집합이 이 배열과 같아진다(빈 배열 = 팀 없음). */
  teamIds: string[]
  /** 비활성 토글. 생략하면 기존 값 유지(새 행은 활성). */
  active?: boolean
}

export type RosterActionResult = { ok: true; memberId: string } | { ok: false; error: string }

const ERR_NAME = '이름을 입력하세요.'
const ERR_EMAIL = '올바른 이메일 형식이 아닙니다.'
const ERR_ACCESS = '알 수 없는 권한입니다.'
/** 모양이 틀린 id — RPC 안의 uuid 캐스트(22P02)까지 가면 '다시 시도하세요' 로 보이지만 다시 해도 안 되는 입력이다. */
const ERR_BAD_REQUEST = '잘못된 요청입니다.'
const ERR_TEAM_CODE = '알 수 없는 팀 코드'
const ERR_ROSTER_LOOKUP = '명단 정보를 확인할 수 없어 중단했습니다.'
const ERR_ROSTER_LIST = '명단을 불러오지 못했습니다.'
/** 행이 있는데(resolveProjectId 가 찾았다) 삭제가 0행 = RLS 가 막았다 — 관리자 행은 워크스페이스 관리자만(admin_write_member_rows). */
const ERR_REMOVE_ADMIN_ROW = '관리자 권한이 있는 사람은 워크스페이스 관리자만 명단에서 삭제할 수 있습니다.'

const trimOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** 서버 액션 입력은 타입을 믿지 않는다 — 조작된 요청이 형상을 어겨도 TypeError 대신 거부로 끝난다. */
function normalizeName(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function normalizeEmail(v: unknown): { ok: true; email: string | null } | { ok: false } {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return { ok: true, email: null }
  if (typeof v !== 'string' || !isValidEmail(v)) return { ok: false }
  return { ok: true, email: v.trim().toLowerCase() }   // DB check(email = lower(btrim(email)))와 같은 정규화
}
function isAccessRoleOrNull(v: unknown): v is AccessRole | null {
  return v === null || v === 'admin' || v === 'member'
}
function isTeamIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string' && isUuidLike(x))
}

/**
 * project_members 를 참조하는 FK 전수(0003, pg_constraint 로 확인) — 명단 행과 함께 사라지는 게 맞는 project_member_teams 는 뺀다.
 * 전부 ON DELETE CASCADE(근태·이슈 담당·회의 참석·알림 수신) 또는 SET NULL(이슈·WBS 담당자·위키 담당)이라,
 * 그대로 지우면 기록이 조용히 사라지거나 담당자가 비워진다. 삭제 전에 센다.
 */
const MEMBER_DEPENDANTS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['attendance_records', 'member_id'],
  ['issue_assignees', 'member_id'],
  ['issues', 'assignee_member_id'],
  ['meeting_attendees', 'member_id'],
  ['notification_recipients', 'member_id'],
  ['wbs_items', 'assignee_member_id'],
  ['wiki_items', 'owner_member_id'],
]

/** 종속 행이 있는가. service_role 로 센다 — 세션 RLS 에 가려 0건으로 보이면 기록이 지워진다. 조회 실패는 중단(3원칙 ②). */
async function memberHasRecords(admin: AdminClient, memberId: string): Promise<{ ok: true; has: boolean } | { ok: false }> {
  const counts = await Promise.all(MEMBER_DEPENDANTS.map(async ([table, column]) => {
    const { count, error } = await admin.from(table).select(column, { count: 'exact', head: true }).eq(column, memberId)
    if (error || count === null) {
      console.error(`[removeRosterMember] ${table} 종속 행 조회 실패:`, error?.message ?? 'count 없음')
      return null
    }
    return count
  }))
  if (counts.some(c => c === null)) return { ok: false }
  return { ok: true, has: counts.some(c => (c as number) > 0) }
}

/** RPC 한 번. 성공하면 명단 화면을 다시 그린다. */
async function callUpsert(
  admin: AdminClient, actorId: string, projectId: string,
  person: Record<string, unknown>, member: Record<string, unknown>, teamIds: string[] | null,
): Promise<RosterActionResult> {
  const { data, error } = await admin.rpc('upsert_project_member', {
    p_actor: actorId, p_project_id: projectId, p_person: person, p_member: member, p_team_ids: teamIds,
  })
  if (error) return { ok: false, error: rosterWriteError(error) }
  if (typeof data !== 'string') {
    console.error('[roster] upsert_project_member 가 member_id 를 돌려주지 않았다:', data)
    return { ok: false, error: ROSTER_WRITE_FAILED }
  }
  revalidatePath(`/p/${projectId}/members`)
  return { ok: true, memberId: data }
}

export async function upsertRosterMember(projectId: string, input: RosterInput): Promise<RosterActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const name = normalizeName(input?.name)
  if (!name) return { ok: false, error: ERR_NAME }
  const email = normalizeEmail(input.email)
  if (!email.ok) return { ok: false, error: ERR_EMAIL }
  if (!isAccessRoleOrNull(input.accessRole)) return { ok: false, error: ERR_ACCESS }
  if (!isTeamIdList(input.teamIds)) return { ok: false, error: ERR_BAD_REQUEST }
  const personId = input.personId ?? null
  if (personId !== null && (typeof personId !== 'string' || !isUuidLike(personId))) return { ok: false, error: ERR_BAD_REQUEST }
  if (input.active !== undefined && typeof input.active !== 'boolean') return { ok: false, error: '활성 여부가 올바르지 않습니다.' }

  const person: Record<string, unknown> = { display_name: name, email: email.email }
  if (personId) person.id = personId
  const member: Record<string, unknown> = {
    access_role: input.accessRole, role_label: trimOrNull(input.roleLabel), title: trimOrNull(input.title),
  }
  if (input.active !== undefined) member.active = input.active
  return callUpsert(createAdminClient(), g.actor.userId, projectId, person, member, input.teamIds)
}

/**
 * 명단 행 삭제. active=false 가 아니라 행을 지운다 — 근태·이슈 담당·회의 참석·알림·WBS/위키 담당 기록이 하나라도 있는
 * 사람은 지우지 않고 "비활성으로 바꾸세요" 로 거부한다. 참조 FK 가 CASCADE·SET NULL 이라 DB 는 막아 주지 않는다
 * (MEMBER_DEPENDANTS). 검사와 삭제 사이의 경합은 남는다 — 그 창에서 생긴 기록은 FK 규칙대로 지워지거나 비워진다.
 */
export async function removeRosterMember(memberId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await resolveProjectId('project_members', memberId)
  if (!found.ok) return { ok: false, error: found.error }
  const projectId = found.projectId
  if (!projectId) return { ok: false, error: ERR_MISSING }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }

  const records = await memberHasRecords(createAdminClient(), memberId)
  if (!records.ok) return { ok: false, error: ERR_ROSTER_LOOKUP }
  if (records.has) return { ok: false, error: ROSTER_HAS_RECORDS }

  // service_role 로 지우면 '관리자 행은 워크스페이스 관리자만' 이 뚫린다(RPC 는 같은 규칙을 본문에서 본다).
  // 세션 경로로 지워 RLS 두 정책이 판정하게 하고, 영향 행 수로 거부를 드러낸다.
  const sb = await createServerClient()
  const { data, error } = await sb
    .from('project_members').delete().eq('id', memberId).eq('project_id', projectId).select('id')
  if (error) return { ok: false, error: rosterWriteError(error) }
  if (!data || data.length === 0) return { ok: false, error: ERR_REMOVE_ADMIN_ROW }
  revalidatePath(`/p/${projectId}/members`)
  return { ok: true }
}

export async function listRoster(
  projectId: string,
): Promise<{ ok: true; rows: RosterMember[] } | { ok: false; error: string }> {
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const { data, error } = await createAdminClient()
    .from('project_members').select(ROSTER_SELECT).eq('project_id', projectId)
    .order('sort_order').order('created_at')
  // 조회 실패를 '명단 0명' 으로 위장하지 않는다 — 관리자가 같은 사람을 다시 넣게 만든다.
  if (error || !data) {
    console.error('[listRoster] 조회 실패:', error?.message ?? 'unknown')
    return { ok: false, error: ERR_ROSTER_LIST }
  }
  return { ok: true, rows: mapRosterRows(data) }
}

// ── @deprecated 옛 화면(MembersBoard·ProjectRolesManager·AccountsManager) 어댑터 ─────────────────────────
// Phase B(Task 12)의 RosterManager 가 대체하면서 지운다. 전부 위 RPC 경로로만 쓴다 — 옛 전역 소속·프로젝트 역할 표는 0003 에서 폐지됐다.

/** @deprecated Phase B 에서 제거 — RosterInput 을 쓴다. */
export interface MemberInput {
  name: string
  email: string | null
  teamCode: TeamCode | null
  /** addMember: 주면 부여, 생략·null 이면 권한을 건드리지 않는다(추가가 기존 권한을 깎지 않게). updateMember: 생략하면 유지. */
  accessRole?: AccessRole | null
  title: string | null
  roleLabel: string | null
}

/** @deprecated Phase B 에서 제거. */
export interface MemberActionResult {
  ok: boolean
  error?: string
}

/** 팀 코드 → 이 프로젝트의 팀 id(프로젝트 팀이 있으면 그것만, 없으면 공용 — resolveTeamsForProject 규칙). */
function teamIdOf(projectId: string, code: string): string | null {
  return teamsForProjectSync(projectId).find(t => t.code === code)?.id ?? null
}

/** @deprecated Phase B 에서 제거 — upsertRosterMember 를 쓴다. */
export async function addMember(projectId: string, input: MemberInput): Promise<MemberActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const name = normalizeName(input?.name)
  if (!name) return { ok: false, error: ERR_NAME }
  const email = normalizeEmail(input.email)
  if (!email.ok) return { ok: false, error: ERR_EMAIL }
  if (input.accessRole !== undefined && !isAccessRoleOrNull(input.accessRole)) return { ok: false, error: ERR_ACCESS }
  let teamIds: string[] | null = null   // 팀 미지정 = 팀 무변경(같은 이메일의 기존 인물이면 그 팀을 지우지 않는다)
  if (input.teamCode) {
    const id = teamIdOf(projectId, input.teamCode)
    if (!id) return { ok: false, error: ERR_TEAM_CODE }
    teamIds = [id]
  }
  const member: Record<string, unknown> = { role_label: trimOrNull(input.roleLabel), title: trimOrNull(input.title) }
  if (input.accessRole) member.access_role = input.accessRole
  const res = await callUpsert(
    createAdminClient(), g.actor.userId, projectId, { display_name: name, email: email.email }, member, teamIds,
  )
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

type TeamsEmbed = { code?: string } | Array<{ code?: string }> | null
type MemberRowForUpdate = {
  person_id: string
  project_member_teams?: Array<{ team_id: string; is_primary: boolean; teams?: TeamsEmbed }> | null
}

/**
 * @deprecated Phase B 에서 제거 — upsertRosterMember(personId) 를 쓴다.
 * 옛 화면은 팀 하나만 안다. 대표 팀이 그대로면 팀을 건드리지 않고, 바뀌면 대표만 바꾸고 나머지 팀은 남긴다.
 */
export async function updateMember(memberId: string, input: MemberInput): Promise<MemberActionResult> {
  const found = await resolveProjectId('project_members', memberId)
  if (!found.ok) return { ok: false, error: found.error }
  const projectId = found.projectId
  if (!projectId) return { ok: false, error: ERR_MISSING }
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const name = normalizeName(input?.name)
  if (!name) return { ok: false, error: ERR_NAME }
  const email = normalizeEmail(input.email)
  if (!email.ok) return { ok: false, error: ERR_EMAIL }
  if (input.accessRole !== undefined && !isAccessRoleOrNull(input.accessRole)) return { ok: false, error: ERR_ACCESS }

  const admin = createAdminClient()
  // 쓰기 전 선행 조회 — 실패하면 중단(3원칙 ②).
  const { data, error } = await admin
    .from('project_members')
    .select('person_id, people!inner(email), project_member_teams(team_id, is_primary, teams(code))')
    .eq('id', memberId).eq('project_id', projectId)
    .maybeSingle()
  if (error) {
    console.error('[updateMember] 명단 행 조회 실패:', error.message)
    return { ok: false, error: ERR_ROSTER_LOOKUP }
  }
  if (!data) return { ok: false, error: ERR_MISSING }
  const row = data as unknown as MemberRowForUpdate
  // 이메일은 인물의 신원(워크스페이스 안 유일 키)이다 — RPC 는 기존 인물의 이메일을 바꾸지 않으므로 조용히 무시하지 않고 거부한다.
  if (email.email !== (personOf(row)?.email ?? null)) return { ok: false, error: '이메일은 명단에서 바꿀 수 없습니다.' }

  const current = (row.project_member_teams ?? [])
    .map(l => {
      const t = Array.isArray(l.teams) ? l.teams[0] : l.teams
      return { id: l.team_id, code: t?.code ?? '', isPrimary: Boolean(l.is_primary) }
    })
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.code.localeCompare(b.code))
  const primary = current[0] ?? null
  let teamIds: string[] | null = null
  if ((primary?.code ?? null) !== (input.teamCode ?? null)) {
    const others = current.filter(t => t.id !== primary?.id).map(t => t.id)
    if (input.teamCode) {
      const id = teamIdOf(projectId, input.teamCode)
      if (!id) return { ok: false, error: ERR_TEAM_CODE }
      teamIds = [id, ...others.filter(o => o !== id)]
    } else {
      teamIds = others
    }
  }

  const member: Record<string, unknown> = { role_label: trimOrNull(input.roleLabel), title: trimOrNull(input.title) }
  if (input.accessRole !== undefined) member.access_role = input.accessRole
  const res = await callUpsert(admin, g.actor.userId, projectId, { id: row.person_id, display_name: name }, member, teamIds)
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/** @deprecated Phase B 에서 제거 — removeRosterMember 를 쓴다. */
export async function removeMember(memberId: string): Promise<MemberActionResult> {
  return removeRosterMember(memberId)
}

/** @deprecated Phase B 에서 제거 — 권한 표(ProjectRolesManager)의 행 계약. */
export interface ProjectRoleRow {
  /** 계정 없는 명단 행(외부 인력)은 null — 권한 셀렉트 대신 '계정 없음'을 보여준다. */
  userId: string | null
  email: string | null
  name: string | null
  /** 대표 팀 코드(명단 행의 첫 팀). 명단 미등록이면 null. */
  teamCode: string | null
  /** 이 프로젝트 권한(access_role). 'viewer' = null. */
  role: AccountRole
  /** 플랫폼 관리자(platform_admins). */
  isSuperuser: boolean
  /** 명단 행 id — 명단 필드(팀·직함·역할) 편집과 삭제에 쓴다. 명단 미등록이면 null. */
  memberId: string | null
  title: string | null
  roleLabel: string | null
}

/**
 * @deprecated Phase B 에서 제거 — listRoster 를 쓴다.
 * 명단 행 전부 + 명단에 없는 이 워크스페이스 계정(권한 부여 후보, 'viewer'). 어느 조회든 실패하면 목록 전체를 실패로 돌린다 —
 * 이 화면은 그 자체가 권한 정보라 부분 목록이 곧 오정보다.
 */
export async function listProjectRoles(
  projectId: string,
): Promise<{ ok: true; rows: ProjectRoleRow[] } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const fail = (what: string, message: string | undefined) => {
    console.error(`[listProjectRoles] ${what} 조회 실패:`, message ?? 'unknown')
    return { ok: false as const, error: '권한 정보를 불러오지 못했습니다.' }
  }

  const { data: project, error: projectErr } = await admin
    .from('projects').select('workspace_id').eq('id', projectId).maybeSingle()
  if (projectErr) return fail('프로젝트', projectErr.message)
  if (!project) return { ok: false, error: ERR_MISSING }

  const [roster, wsMembers, platform] = await Promise.all([
    admin.from('project_members').select(ROSTER_SELECT).eq('project_id', projectId),
    admin.from('workspace_members').select('user_id').eq('workspace_id', project.workspace_id as string),
    admin.from('platform_admins').select('user_id'),
  ])
  if (roster.error || !roster.data) return fail('명단', roster.error?.message)
  if (wsMembers.error || !wsMembers.data) return fail('워크스페이스 소속', wsMembers.error?.message)
  if (platform.error || !platform.data) return fail('플랫폼 관리자', platform.error?.message)

  const members = mapRosterRows(roster.data)
  const onRoster = new Set(members.flatMap(m => (m.userId ? [m.userId] : [])))
  const candidateIds = (wsMembers.data as Array<{ user_id: string }>).map(r => r.user_id).filter(id => !onRoster.has(id))
  let profiles: Array<{ user_id: string; email: string; display_name: string }> = []
  if (candidateIds.length > 0) {
    const res = await admin.from('profiles').select('user_id, email, display_name').in('user_id', candidateIds)
    if (res.error || !res.data) return fail('프로필', res.error?.message)
    profiles = res.data as typeof profiles
  }
  const platformIds = new Set((platform.data as Array<{ user_id: string }>).map(r => r.user_id))

  const rows: ProjectRoleRow[] = members.map(m => ({
    userId: m.userId, email: m.email, name: m.name, teamCode: m.teamCode,
    role: m.userId ? (m.accessRole ?? 'viewer') : 'viewer',
    isSuperuser: m.userId ? platformIds.has(m.userId) : false,
    memberId: m.id, title: m.title, roleLabel: m.roleLabel,
  }))
  for (const p of profiles) {
    rows.push({
      userId: p.user_id, email: p.email, name: p.display_name, teamCode: null, role: 'viewer',
      isSuperuser: platformIds.has(p.user_id), memberId: null, title: null, roleLabel: null,
    })
  }
  return { ok: true, rows }
}

/** 계정 → 이 프로젝트 워크스페이스의 인물 id. 인물 행이 없으면 지어내지 않는다(연결은 계정 관리·초대 수락이 한다). */
async function accountPersonId(
  admin: AdminClient, projectId: string, userId: string,
): Promise<{ ok: true; personId: string } | { ok: false; error: string }> {
  const { data: project, error: projectErr } = await admin
    .from('projects').select('workspace_id').eq('id', projectId).maybeSingle()
  if (projectErr) {
    console.error('[roster] 프로젝트 조회 실패:', projectErr.message)
    return { ok: false, error: ERR_ROSTER_LOOKUP }
  }
  if (!project) return { ok: false, error: ERR_MISSING }
  const { data: person, error } = await admin
    .from('people').select('id')
    .eq('workspace_id', project.workspace_id as string).eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.error('[roster] 인물 조회 실패:', error.message)
    return { ok: false, error: ERR_ROSTER_LOOKUP }
  }
  if (!person) return { ok: false, error: '이 계정은 이 워크스페이스의 인물로 등록돼 있지 않습니다.' }
  return { ok: true, personId: person.id as string }
}

/**
 * @deprecated Phase B 에서 제거 — upsertRosterMember 를 쓴다.
 * 권한 = 명단 행의 access_role 이다. 부여하면 명단 행이 함께 생기고(같은 트랜잭션), 'viewer' 는 권한만 null 로 — 행은 남는다.
 * 관리자 슬롯은 슈퍼유저 가드(SP2 에서 워크스페이스 관리자). 기존 관리자의 강등은 RPC 가 워크스페이스 관리자만 허용한다.
 * rosterError 는 더 이상 생기지 않는다(권한과 명단이 한 행·한 트랜잭션) — 옛 화면 호환을 위해 타입만 남긴다.
 */
export async function setProjectRole(
  projectId: string, userId: string, role: AccountRole,
): Promise<{ ok: boolean; error?: string; rosterError?: string }> {
  const g = isAdminAccessRole(role) ? await requireSuperuser() : await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  if (!isAccountRole(role)) return { ok: false, error: ERR_ACCESS }
  const admin = createAdminClient()
  const person = await accountPersonId(admin, projectId, userId)
  if (!person.ok) return person
  const res = await callUpsert(
    admin, g.actor.userId, projectId, { id: person.personId }, { access_role: role === 'viewer' ? null : role }, null,
  )
  if (!res.ok) return { ok: false, error: res.error }
  revalidatePath('/admin/accounts')
  return { ok: true }
}

/**
 * @deprecated Phase B 에서 제거.
 * 계정의 명단 행을 보장하고 id 를 돌려준다 — 권한·명단 필드는 건드리지 않는다(p_member 빈 객체, 팀 null).
 */
export async function ensureRosterRow(
  projectId: string, userId: string,
): Promise<{ ok: true; memberId: string } | { ok: false; error: string }> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const admin = createAdminClient()
  const person = await accountPersonId(admin, projectId, userId)
  if (!person.ok) return person
  return callUpsert(admin, g.actor.userId, projectId, { id: person.personId }, {}, null)
}
