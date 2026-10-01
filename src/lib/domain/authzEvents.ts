// 권한 변경 이력(authz_events, 0012)의 표시 규칙 — 순수 모듈. before·after 는 트리거가 쓴 jsonb 라 모양이 정해져 있다:
//   platform_admin  {granted: true[, granted_by]}      — 지정은 before 없음, 해제는 after 없음
//   workspace_role  {role[, invited_by]}               — 소속 추가는 before 없음, 제거는 after 없음, 변경은 둘 다
//   project_access  {access_role[, access_granted_by]} — 부여는 before 없음, 회수는 after 없음, 변경은 둘 다
// 모르는 모양은 지어내지 않는다 — 읽을 수 있는 값만 쓰고 아니면 그대로 알린다(3원칙: 모르면 unknown).
export type AuthzEventKind = 'platform_admin' | 'workspace_role' | 'project_access'
export type AuthzEventCause = 'direct' | 'cascade' | 'parent_deleted'

export const AUTHZ_KIND_LABEL: Record<AuthzEventKind, string> = {
  platform_admin: '플랫폼 관리자', workspace_role: '워크스페이스 등급', project_access: '프로젝트 권한',
}
export const AUTHZ_CAUSE_LABEL: Record<AuthzEventCause, string> = {
  direct: '직접 변경', cascade: '연쇄(소속 변경)', parent_deleted: '상위 삭제',
}
const ROLE_LABEL: Record<string, string> = { admin: '관리자', member: '멤버' }
const UNREADABLE = '변경 내용을 읽지 못했습니다'

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null)
const roleText = (v: unknown): string | null => (typeof v === 'string' && v ? (ROLE_LABEL[v] ?? v) : null)

export function describeAuthzChange(kind: AuthzEventKind, before: unknown, after: unknown): string {
  const b = before === null ? null : obj(before)
  const a = after === null ? null : obj(after)
  if ((before !== null && b === null) || (after !== null && a === null) || (b === null && a === null)) return UNREADABLE
  if (kind === 'platform_admin') {
    if (b === null && a?.granted === true) return '플랫폼 관리자 지정'
    if (a === null && b?.granted === true) return '플랫폼 관리자 해제'
    return UNREADABLE
  }
  const field = kind === 'workspace_role' ? 'role' : 'access_role'
  const was = b === null ? null : roleText(b[field])
  const now = a === null ? null : roleText(a[field])
  if (b === null) {
    if (!now) return UNREADABLE
    return kind === 'workspace_role' ? `소속 추가 — ${now}` : `권한 부여 — ${now}`
  }
  if (a === null) {
    if (!was) return UNREADABLE
    return kind === 'workspace_role' ? `소속 제거 — ${was}` : `권한 회수 — ${was}`
  }
  if (!was || !now) return UNREADABLE
  return `${was} → ${now}`
}
