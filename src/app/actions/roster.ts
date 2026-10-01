'use server'
// 명단(project_members) 쓰기의 유일한 입구 — 앱은 project_members 에 직접 insert/update/upsert 하지 않는다(스펙 SP1 §4).
// 추가·수정·권한 부여·팀 동기화는 전부 RPC upsert_project_member_cmd 한 번이다(행위자·명령 id 가 권한 변경 이력에 남는다). 인물 확정(id → (워크스페이스, 이메일) → 신규)·
// 권한 규칙(관리자 슬롯·본인 강등·계정 없는 권한 금지)·팀 동기화가 한 트랜잭션에서 돈다. 여기서 쪼개 쓰면 반쪽 저장이 생긴다.
// 행 삭제만 RPC 밖이다(스펙이 허용한 1곳) — 세션 클라이언트로 지워 RLS(관리자 행은 워크스페이스 관리자만)가 판정하게 한다.
import { revalidatePath } from 'next/cache'
import { requireProjectAdmin, requireProjectMember, resolveProjectId } from '@/lib/authz'
import { ERR_MISSING } from '@/lib/authz/errors'
import { newAuthzCommandId, parseAuthzResult } from '@/lib/authz/commands'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { isUuidLike } from '@/lib/domain/validate'
import { canonicalEmail } from '@/lib/domain/email'
import { rosterWriteError, ROSTER_WRITE_FAILED, ROSTER_HAS_RECORDS } from '@/lib/domain/rosterErrors'
import { ROSTER_SELECT, mapRosterRows, type RosterMember } from '@/lib/data/memberSelect'
import { projectTeams } from '@/lib/teams/source'
import type { AccessRole, RosterInput } from '@/lib/domain/roster'

type AdminClient = ReturnType<typeof createAdminClient>
// 입력 계약은 도메인(순수 계층)이 정본이다 — 화면의 검증(validateDraft)과 이 액션이 같은 타입을 본다.
export type { RosterInput } from '@/lib/domain/roster'

export type RosterActionResult = { ok: true; memberId: string } | { ok: false; error: string }

const ERR_NAME = '이름을 입력하세요.'
const ERR_EMAIL = '올바른 이메일 형식이 아닙니다.'
const ERR_ACCESS = '알 수 없는 권한입니다.'
/** 모양이 틀린 id — RPC 안의 uuid 캐스트(22P02)까지 가면 '다시 시도하세요' 로 보이지만 다시 해도 안 되는 입력이다. */
const ERR_BAD_REQUEST = '잘못된 요청입니다.'
const ERR_ROSTER_LOOKUP = '명단 정보를 확인할 수 없어 중단했습니다.'
const ERR_ROSTER_LIST = '명단을 불러오지 못했습니다.'
const ERR_TEAM = '이 프로젝트에서 고를 수 있는 팀이 아닙니다.'
/** 행이 있는데(resolveProjectId 가 찾았다) 삭제가 0행 = RLS 가 막았다 — 관리자 행은 워크스페이스 관리자만(admin_write_member_rows). */
const ERR_REMOVE_ADMIN_ROW = '관리자 권한이 있는 사람은 워크스페이스 관리자만 명단에서 삭제할 수 있습니다.'

const trimOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** 서버 액션 입력은 타입을 믿지 않는다 — 조작된 요청이 형상을 어겨도 TypeError 대신 거부로 끝난다. */
function normalizeName(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function normalizeEmail(v: unknown): { ok: true; email: string | null } | { ok: false } {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return { ok: true, email: null }
  // 초대 행과 같은 정규형(local@ASCII 호스트, domain/email) — 다르면 수락 RPC 의 인물 매치가 빗나가 사람이 둘로 갈린다(P-1).
  // trim·소문자도 여기서 한다(DB check email = lower(btrim(email))).
  const email = typeof v === 'string' ? canonicalEmail(v) : null
  return email ? { ok: true, email } : { ok: false }
}
function isAccessRoleOrNull(v: unknown): v is AccessRole | null {
  return v === null || v === 'admin' || v === 'member'
}
function isTeamIdList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(x => typeof x === 'string' && isUuidLike(x))
}

/**
 * project_members 를 참조하는 FK(0003, pg_constraint 로 확인) 중 업무 기록인 것 — ON DELETE CASCADE(근태·이슈 담당·회의 참석)
 * 또는 SET NULL(이슈·WBS 담당자·위키 담당)이라, 그대로 지우면 기록이 조용히 사라지거나 담당자가 비워진다. 삭제 전에 센다.
 * 명단 행과 함께 사라지는 게 맞는 project_member_teams(팀 소속)·notification_recipients(알림 수신)는 뺀다(컨트롤러 판정).
 */
const MEMBER_DEPENDANTS: ReadonlyArray<readonly [table: string, column: string]> = [
  ['attendance_records', 'member_id'],
  ['issue_assignees', 'member_id'],
  ['issues', 'assignee_member_id'],
  ['meeting_attendees', 'member_id'],
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

/**
 * 고를 수 있는 팀만(A2-3 리뷰 보안 P3 — X1). 이 프로젝트의 활성 팀(초대 액션과 같은 원천 projectTeams — 전용 팀이 있으면 그것만)이고,
 * 편집이면 그 사람이 이 프로젝트에서 이미 가진 팀(비활성이 된 팀 등 — 편집 화면 RosterEditRow 가 기존 소속을 그대로 다시 보낸다)도 된다.
 * 그래서 전용 팀이 있는 프로젝트에 공용 팀 참조(정규화 키가 같은 'qa' 포함)를 새로 붙이지 못한다 — DB(M1)는 정확히 같은 code 만 본다.
 * 기존 소속은 활성 목록 밖의 id 가 있을 때만 읽는다. 조회 실패는 쓰기 전 선행 조회 실패라 중단한다(3원칙 ②, 원문은 로그로만).
 */
async function checkRosterTeams(
  admin: AdminClient, projectId: string, personId: string | null, teamIds: readonly string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (teamIds.length === 0) return { ok: true }
  const allowed = new Set<string>()
  try {
    for (const t of await projectTeams(projectId)) if (t.active) allowed.add(t.id)
  } catch (e) {
    console.error('[roster] 팀 조회 실패:', e instanceof Error ? e.message : e)
    return { ok: false, error: ERR_ROSTER_LOOKUP }
  }
  if (teamIds.every(id => allowed.has(id))) return { ok: true }
  if (personId) {
    const { data, error } = await admin.from('project_members')
      .select('project_member_teams(team_id)').eq('project_id', projectId).eq('person_id', personId).maybeSingle()
    if (error) {
      console.error('[roster] 기존 팀 소속 조회 실패:', error.message)
      return { ok: false, error: ERR_ROSTER_LOOKUP }
    }
    for (const r of ((data as { project_member_teams?: { team_id: string }[] } | null)?.project_member_teams ?? [])) allowed.add(r.team_id)
  }
  return teamIds.every(id => allowed.has(id)) ? { ok: true } : { ok: false, error: ERR_TEAM }
}

/** RPC 한 번. 성공하면 명단 화면을 다시 그린다. */
async function callUpsert(
  admin: AdminClient, actorId: string, projectId: string,
  person: Record<string, unknown>, member: Record<string, unknown>, teamIds: string[] | null,
): Promise<RosterActionResult> {
  const { data, error } = await admin.rpc('upsert_project_member_cmd', {
    p_command_id: newAuthzCommandId(), p_actor: actorId, p_project_id: projectId, p_person: person, p_member: member, p_team_ids: teamIds,
  })
  if (error) return { ok: false, error: rosterWriteError(error) }
  const result = parseAuthzResult(data)
  if (!result?.memberId) {
    console.error('[roster] upsert_project_member_cmd 가 member_id 를 돌려주지 않았다:', data)
    return { ok: false, error: ROSTER_WRITE_FAILED }
  }
  revalidatePath(`/p/${projectId}/members`)
  return { ok: true, memberId: result.memberId }
}

export async function upsertRosterMember(projectId: string, input: RosterInput): Promise<RosterActionResult> {
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const name = normalizeName(input?.name)
  if (!name) return { ok: false, error: ERR_NAME }
  const personId = input.personId ?? null
  if (personId !== null && (typeof personId !== 'string' || !isUuidLike(personId))) return { ok: false, error: ERR_BAD_REQUEST }
  // 편집(personId 있음)은 이메일을 검증하지도 보내지도 않는다 — id 분기의 RPC 는 email 을 쓰지 않고, 정규형이 안 되는 기존 행
  // (x@acme.123 등)의 이름·권한·팀 편집이 막히면 안 된다(R2). 새 인물만 정규형으로 검증해 보낸다(P-1).
  let person: Record<string, unknown> = { id: personId, display_name: name }
  if (!personId) {
    const email = normalizeEmail(input.email)
    if (!email.ok) return { ok: false, error: ERR_EMAIL }
    person = { display_name: name, email: email.email }
  }
  if (!isAccessRoleOrNull(input.accessRole)) return { ok: false, error: ERR_ACCESS }
  if (!isTeamIdList(input.teamIds)) return { ok: false, error: ERR_BAD_REQUEST }
  if (input.active !== undefined && typeof input.active !== 'boolean') return { ok: false, error: '활성 여부가 올바르지 않습니다.' }

  const member: Record<string, unknown> = {
    access_role: input.accessRole, role_label: trimOrNull(input.roleLabel), title: trimOrNull(input.title),
  }
  if (input.active !== undefined) member.active = input.active
  const admin = createAdminClient()
  const teams = await checkRosterTeams(admin, projectId, personId, input.teamIds)
  if (!teams.ok) return teams
  return callUpsert(admin, g.actor.userId, projectId, person, member, input.teamIds)
}

/**
 * 명단 행 삭제. active=false 가 아니라 행을 지운다 — 근태·이슈 담당·회의 참석·WBS/위키 담당 기록이 하나라도 있는
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
