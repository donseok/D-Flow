// 권한 변경 이력(authz_events — 0012, SP4 _authz_carry)의 표시 규칙 — 순수 모듈. before·after 는 트리거가 쓴 jsonb 라 모양이 정해져 있다:
//   platform_admin  {granted: true[, granted_by]}                — 지정은 before 없음, 해제는 after 없음
//   workspace_role  {role[, invited_by]}                         — 소속 추가는 before 없음, 제거는 after 없음, 변경은 둘 다
//   project_access  {access_role[, access_granted_by][, active]} — 부여는 before 없음, 회수는 after 없음, 변경(권한·활성)은 둘 다.
//                   active 는 SP4 부터 실린다 — 그 전 기록에는 없고 그때는 권한 칸만 읽는다. 부여·회수 기록의 active 가 false 면
//                   `부여 (멤버, 비활성)` 처럼 꼬리를 붙인다(비활성 행 — 권한이 생기지 않았거나 이미 정지돼 있었다)
//   project_access  {person_active}                              — 인물의 비활성·재활성(SP4) — 그 인물의 권한 있는 명단 행마다 한 기록
//   password_reset  {reset: true}                                — 관리자가 한 비밀번호 재설정(0053 record_password_reset). before 없음. 권한이 바뀐 것은
//                   아니지만 "그 계정으로 로그인할 수 있게 만든" 조작이라 같은 이력에 남긴다. 비밀번호 값은 어디에도 없다
// 문구는 이 모듈의 한국어 상수다 — 소비 경로(actions/authzEvents.ts 의 summary)가 한국어 표시 문자열 계약이라 사전 키로 내지 않는다(스펙 §3.4 T11).
// 모르는 모양은 지어내지 않는다 — 읽을 수 있는 값만 쓰고 아니면 그대로 알린다(3원칙: 모르면 unknown).
export type AuthzEventKind = 'platform_admin' | 'workspace_role' | 'project_access' | 'password_reset'
export type AuthzEventCause = 'direct' | 'cascade' | 'parent_deleted'

export const AUTHZ_KIND_LABEL: Record<AuthzEventKind, string> = {
  platform_admin: '플랫폼 관리자', workspace_role: '워크스페이스 등급', project_access: '프로젝트 권한', password_reset: '비밀번호',
}
export const AUTHZ_CAUSE_LABEL: Record<AuthzEventCause, string> = {
  direct: '직접 변경', cascade: '연쇄(소속 변경)', parent_deleted: '상위 삭제',
}
const ROLE_LABEL: Record<string, string> = { admin: '관리자', member: '멤버' }
/** 명단 행의 활성 전환(SP4) — 권한이 그대로면 `비활성화 (관리자)` 꼴, 권한과 함께 바뀌면 연결자 뒤에 붙인다 */
const ACTIVE_LABEL = { off: '비활성화', on: '다시 활성' } as const
/** 인물의 활성 전환(SP4) — 그 인물의 권한 있는 명단 행마다 같은 문구 */
const PERSON_ACTIVE_LABEL = { off: '인물 비활성 (권한 정지)', on: '인물 다시 활성' } as const
/** 비활성 명단 행의 추가·삭제(A1-3 리뷰 M2) — 권한이 생기지 않았거나 이미 정지돼 있었다. `부여 (멤버, 비활성)` 꼴로 괄호 안에 잇는다 */
const INACTIVE_TAIL = '비활성'
const UNREADABLE = '변경 내용을 읽지 못했습니다'
const JOIN = ' · '

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null)
const roleText = (v: unknown): string | null => (typeof v === 'string' && v ? (ROLE_LABEL[v] ?? v) : null)
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** 인물 기록 — 전·후가 둘 다 boolean 이고 값이 바뀌었을 때만 읽는다 */
function describePersonActive(b: Record<string, unknown> | null, a: Record<string, unknown> | null): string {
  const was = b === null ? null : flag(b.person_active)
  const now = a === null ? null : flag(a.person_active)
  if (was === null || now === null || was === now) return UNREADABLE
  return now ? PERSON_ACTIVE_LABEL.on : PERSON_ACTIVE_LABEL.off
}

/** 명단 행의 변경(전·후 둘 다 있음) — 권한 칸과 활성 칸을 따로 읽어 바뀐 것만 잇는다 */
function describeRosterChange(b: Record<string, unknown>, a: Record<string, unknown>): string {
  const was = roleText(b.access_role)
  const now = roleText(a.access_role)
  const wasActive = flag(b.active)
  const nowActive = flag(a.active)
  const parts: string[] = []
  if (b.access_role !== a.access_role) {
    if (was && now) parts.push(`${was} → ${now}`)
    else if (was && a.access_role === null) parts.push(`회수 (${was})`)
    else if (now && b.access_role === null) parts.push(`부여 (${now})`)
    else return UNREADABLE
  }
  if (wasActive !== null && nowActive !== null && wasActive !== nowActive) {
    const label = nowActive ? ACTIVE_LABEL.on : ACTIVE_LABEL.off
    if (parts.length) parts.push(label)
    else if (now) parts.push(`${label} (${now})`)
    else return UNREADABLE
  }
  return parts.length ? parts.join(JOIN) : UNREADABLE
}

export function describeAuthzChange(kind: AuthzEventKind, before: unknown, after: unknown): string {
  const b = before === null ? null : obj(before)
  const a = after === null ? null : obj(after)
  if ((before !== null && b === null) || (after !== null && a === null) || (b === null && a === null)) return UNREADABLE
  if (kind === 'platform_admin') {
    if (b === null && a?.granted === true) return '지정'
    if (a === null && b?.granted === true) return '해제'
    return UNREADABLE
  }
  if (kind === 'password_reset') return b === null && a?.reset === true ? '관리자가 재설정' : UNREADABLE
  if (kind === 'project_access' && ((b !== null && 'person_active' in b) || (a !== null && 'person_active' in a))) {
    return describePersonActive(b, a)
  }
  const field = kind === 'workspace_role' ? 'role' : 'access_role'
  const was = b === null ? null : roleText(b[field])
  const now = a === null ? null : roleText(a[field])
  // 명단 행의 추가·삭제는 그 행의 active 도 싣는다(SP4) — false 면 꼬리를 붙인다. 없는 옛 기록·워크스페이스 등급은 그대로
  const tail = (row: Record<string, unknown>): string => (kind === 'project_access' && flag(row.active) === false ? `, ${INACTIVE_TAIL}` : '')
  if (b === null) {
    if (!now || a === null) return UNREADABLE
    return kind === 'workspace_role' ? `소속 추가 (${now})` : `부여 (${now}${tail(a)})`
  }
  if (a === null) {
    if (!was) return UNREADABLE
    return kind === 'workspace_role' ? `소속 제거 (${was})` : `회수 (${was}${tail(b)})`
  }
  if (kind === 'project_access') return describeRosterChange(b, a)
  if (!was || !now) return UNREADABLE
  return `${was} → ${now}`
}
