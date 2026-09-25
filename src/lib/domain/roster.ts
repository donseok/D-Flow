// 명단 관리 화면(RosterManager)의 순수 계층 — 행 편집 초안·검증·팀 선택·권한 셀 판정. IO 없음.
// 검증 문구는 서버 액션(upsertRosterMember)과 같다 — 화면이 먼저 거르고, 액션·RPC 가 다시 본다.
import type { RosterInput } from '@/app/actions/roster'
import type { RosterMember } from '@/lib/data/memberSelect'
import { isWorkspaceAdminRole, type ProjectActorView } from '@/lib/domain/authz'
import { isValidEmail } from '@/lib/domain/validate'

export type AccessRole = 'admin' | 'member'

/** 한 행의 입력 상태. 문자열 필드는 input value 그대로(빈 문자열 = 없음). teamIds 첫 원소가 대표 팀. */
export interface RosterDraft {
  personId: string | null
  name: string
  email: string
  accessRole: AccessRole | null
  roleLabel: string
  title: string
  teamIds: string[]
  /** 비활성 토글 — 기록이 있어 지울 수 없는 사람을 명단에서 내리는 방법. */
  active: boolean
}

export const ERR_ACCESS_NEEDS_EMAIL = '권한을 주려면 이메일(계정)이 필요합니다.'
/** 같은 워크스페이스에 같은 이메일의 인물이 있다 — people (workspace_id, email) 유일(rosterWriteError 와 같은 문구). */
export const ERR_DUPLICATE_EMAIL = '같은 이메일의 사람이 이미 있습니다. 목록에서 선택하세요.'

export function emptyDraft(): RosterDraft {
  return { personId: null, name: '', email: '', accessRole: null, roleLabel: '', title: '', teamIds: [], active: true }
}

export function draftFromMember(m: RosterMember): RosterDraft {
  return {
    personId: m.personId, name: m.name, email: m.email ?? '', accessRole: m.accessRole,
    roleLabel: m.roleLabel ?? '', title: m.title ?? '', teamIds: m.teams.map(t => t.id), active: m.active,
  }
}

const trimOrNull = (v: string): string | null => v.trim() || null

export function validateDraft(d: RosterDraft): { ok: true; input: RosterInput } | { ok: false; error: string } {
  const name = d.name.trim()
  if (!name) return { ok: false, error: '이름을 입력하세요.' }
  const email = d.email.trim()
  if (email && !isValidEmail(email)) return { ok: false, error: '올바른 이메일 형식이 아닙니다.' }
  if (d.accessRole !== null && !email) return { ok: false, error: ERR_ACCESS_NEEDS_EMAIL }
  return {
    ok: true,
    input: {
      personId: d.personId, name, email: email ? email.toLowerCase() : null, accessRole: d.accessRole,
      roleLabel: trimOrNull(d.roleLabel), title: trimOrNull(d.title), teamIds: [...new Set(d.teamIds)], active: d.active,
    },
  }
}

/** 관리자 부여·회수 셀 활성 — 워크스페이스 관리자 이상. 최종 판정은 가드와 RPC(PROJECT_MEMBER_ADMIN_SLOT)가 한다. */
export function canGrantAdmin(view: ProjectActorView | null): boolean {
  if (!view) return false
  return view.isSuperuser || isWorkspaceAdminRole(view.workspaceRole)
}

const ACCESS_ROLE_LABEL: Record<AccessRole, string> = { admin: '관리자', member: '멤버' }

export function accessRoleLabel(r: AccessRole | null): string {
  return r ? ACCESS_ROLE_LABEL[r] : '없음(조회 전용)'
}

/** 체크 토글 — 새 팀은 뒤에 붙는다(대표는 그대로). 대표 팀을 빼면 다음 팀이 대표가 된다. */
export function toggleTeam(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
}

/** 대표 팀 지정 — 그 팀을 맨 앞으로. 선택되지 않은 팀이면 선택하면서 대표로. */
export function setPrimaryTeam(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter(x => x !== id)]
}

/** 이미 명단에 있는 같은 이메일의 행 — '사람 추가' 가 그 사람의 행을 조용히 덮어쓰지 않게 먼저 막는다. */
export function findRosterByEmail(rows: readonly RosterMember[], email: string): RosterMember | null {
  const key = email.trim().toLowerCase()
  if (!key) return null
  return rows.find(r => r.email?.toLowerCase() === key) ?? null
}

/** 저장 버튼 활성 판정 — 초안이 원본 행과 다른가. 팀은 순서까지 본다(대표 팀 변경). */
export function isDraftDirty(d: RosterDraft, m: RosterMember): boolean {
  const o = draftFromMember(m)
  return d.name !== o.name || d.accessRole !== o.accessRole || d.roleLabel !== o.roleLabel || d.title !== o.title
    || d.active !== o.active || d.teamIds.join(',') !== o.teamIds.join(',')
}
