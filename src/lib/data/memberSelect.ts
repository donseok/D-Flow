/* ── 명단(project_members) 조회의 정본 — select 문자열 하나 + 매퍼 하나 ──
 *
 * 이름·이메일·계정 연결은 `people` 이 정본이고, 팀은 `project_member_teams` 배열이다(0003).
 * `project_members` 를 읽어 사람을 보여 주는 모든 경로는 이 select 로 읽어 이 매퍼에 넣는다 —
 * select 와 매퍼는 한 몸이라 둘을 따로 고치면 조용히 필드가 빈다. 모양이 바뀌면 여기 한 곳만 고친다.
 *
 * 이 모듈은 순수하다(클라이언트 생성·조회 없음). 에러 처리 계약은 호출부 몫이다.
 */
import { sortByKoreanName } from '@/lib/domain/nameSort'

const ROSTER_COLUMNS = 'id, project_id, person_id, access_role, role_label, title, active, sort_order, created_at'
const ROSTER_TEAMS = 'project_member_teams(team_id, is_primary, teams(id, code, name))'

export const ROSTER_SELECT =
  `${ROSTER_COLUMNS}, people!inner(display_name, email, user_id, kind, active), ${ROSTER_TEAMS}`

/**
 * 챗봇 경계(`repositories/supabase/*`)용 — ROSTER_SELECT 와 같은 모양에서 `people.email` 만 뺀다.
 * 챗봇 민감정보 정책은 "이메일은 계약에 없을 뿐 아니라 조회하지도 않는다"이다(members-read 테스트가 select 절을 단언).
 * toRosterMember 는 이 결과를 email=null 로 편다.
 */
export const ROSTER_SELECT_NO_EMAIL =
  `${ROSTER_COLUMNS}, people!inner(display_name, user_id, kind, active), ${ROSTER_TEAMS}`

export interface RosterTeam { id: string; code: string; name: string; isPrimary: boolean }

export interface RosterMember {
  id: string; projectId: string; personId: string
  name: string; email: string | null; userId: string | null; kind: 'account' | 'external'
  /** 이 프로젝트 권한 — null 은 조회 전용(권한 없음). 표시 라벨은 roleLabel/title. */
  accessRole: 'admin' | 'member' | null; roleLabel: string | null; title: string | null
  active: boolean; sortOrder: number; createdAt: string
  teams: RosterTeam[]              // 대표 팀이 첫 원소
  hasAccount: boolean
}

type One<T> = T | T[] | null
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v)

/** `people` 임베드 한 행 — 부분 select(`people!inner(user_id)` 등)는 고른 열만 채워진다. */
export interface PersonEmbed {
  display_name?: string; email?: string | null; user_id?: string | null
  kind?: 'account' | 'external'; active?: boolean
}

/**
 * 명단 행의 `people` 임베드를 편다(PostgREST 는 객체나 배열로 줄 수 있다). ROSTER_SELECT 전체가 필요 없는
 * 부분 select 소비처(신원 필터·이름 표시)가 임베드 이름·모양을 각자 해석하지 않도록 여기 한 곳에 둔다.
 */
export function personOf(row: unknown): PersonEmbed | null {
  if (!row || typeof row !== 'object') return null
  return one(((row as { people?: One<PersonEmbed> }).people) ?? null)
}

/** 팀 배열 순서 규칙 — 대표 팀이 첫 원소, 나머지는 code 순. toRosterMember·primaryTeamCode 가 공유한다. */
const byPrimaryThenCode = (a: { isPrimary: boolean; code: string }, b: { isPrimary: boolean; code: string }) =>
  Number(b.isPrimary) - Number(a.isPrimary) || a.code.localeCompare(b.code)

/**
 * `project_member_teams(is_primary, teams(code))` 임베드의 대표 팀 code — RosterMember.teams[0]?.code 와 같은 규칙.
 * 팀 code 만 필요한 부분 select 소비처(변경 이력·사용 현황 라벨)용.
 */
export function primaryTeamCode(links: unknown): string | null {
  const teams = ((links ?? []) as Array<{ is_primary?: boolean; teams?: One<{ code?: string }> }>)
    .flatMap(l => { const code = one(l.teams ?? null)?.code; return code ? [{ code, isPrimary: Boolean(l.is_primary) }] : [] })
    .sort(byPrimaryThenCode)
  return teams[0]?.code ?? null
}

/** `project_member_teams(is_primary, teams(code, name))` 임베드의 대표 팀 — primaryTeamCode 와 같은 팀, 표시용 이름을 함께 준다.
 *  이름이 비었거나 select 에 없으면 name 은 code 다(화면이 code 로 보인다). */
export function primaryTeamRef(links: unknown): { code: string; name: string } | null {
  const teams = ((links ?? []) as Array<{ is_primary?: boolean; teams?: One<{ code?: string; name?: string | null }> }>)
    .flatMap(l => { const t = one(l.teams ?? null); return t?.code ? [{ code: t.code, name: t.name?.trim() || t.code, isPrimary: Boolean(l.is_primary) }] : [] })
    .sort(byPrimaryThenCode)
  return teams[0] ? { code: teams[0].code, name: teams[0].name } : null
}

export function toRosterMember(r: Record<string, unknown>): RosterMember {
  const pe = personOf(r) as { display_name: string; email?: string | null; user_id: string | null; kind: 'account' | 'external'; active: boolean } | null
  if (!pe) throw new Error('ROSTER_SELECT 결과에 people 이 없다 — !inner 조인 누락')
  const teams = ((r.project_member_teams ?? []) as Array<{ team_id: string; is_primary: boolean; teams: One<{ id: string; code: string; name: string }> }>)
    .flatMap(l => { const t = one(l.teams); return t ? [{ id: t.id, code: t.code, name: t.name, isPrimary: l.is_primary }] : [] })
    .sort(byPrimaryThenCode)
  return {
    id: r.id as string, projectId: r.project_id as string, personId: r.person_id as string,
    name: pe.display_name, email: pe.email ?? null, userId: pe.user_id ?? null, kind: pe.kind,
    accessRole: (r.access_role as 'admin' | 'member' | null) ?? null,
    roleLabel: (r.role_label as string | null) ?? null, title: (r.title as string | null) ?? null,
    active: Boolean(r.active), sortOrder: Number(r.sort_order ?? 0), createdAt: r.created_at as string,
    teams, hasAccount: pe.user_id != null,
  }
}

/** ROSTER_SELECT 결과 → RosterMember[] (가나다순 — 앱 어디서 보든 명단은 같은 순서). */
export function mapRosterRows(rows: unknown[] | null): RosterMember[] {
  const mapped = ((rows ?? []) as Record<string, unknown>[]).map(toRosterMember)
  return sortByKoreanName(mapped, m => m.name)
}
