// 권한 변경 이력(authz_events — 0012, SP4 _authz_carry)의 표시 규칙 — 순수 모듈. before·after 는 트리거가 쓴 jsonb 라 모양이 정해져 있다:
//   platform_admin  {granted: true[, granted_by]}                — 지정은 before 없음, 해제는 after 없음
//   workspace_role  {role[, invited_by]}                         — 소속 추가는 before 없음, 제거는 after 없음, 변경은 둘 다
//   project_access  {access_role[, access_granted_by][, active]} — 부여는 before 없음, 회수는 after 없음, 변경(권한·활성)은 둘 다.
//                   active 는 SP4 부터 실린다 — 그 전 기록에는 없고 그때는 권한 칸만 읽는다. 부여·회수 기록의 active 가 false 면
//                   `부여 (멤버, 비활성)` 처럼 꼬리를 붙인다(비활성 행 — 권한이 생기지 않았거나 이미 정지돼 있었다)
//   project_access  {person_active}                              — 인물의 비활성·재활성(SP4) — 그 인물의 권한 있는 명단 행마다 한 기록
//   password_reset  {reset: true}                                — 관리자가 한 비밀번호 재설정(0053 record_password_reset). before 없음. 권한이 바뀐 것은
//                   아니지만 "그 계정으로 로그인할 수 있게 만든" 조작이라 같은 이력에 남긴다. 비밀번호 값은 어디에도 없다
//   project_deleted {name, removed: {표: 건수}}                  — 프로젝트 삭제(0058 delete_project). after 없음. 프로젝트 행이 사라져 이름은 여기에만 남는다
// 문구는 사전(libUi 의 authz.* · 역할 이름은 role.admin·role.member)에서 읽는다. 문구를 만드는 함수는 번역 함수(Translate)를 선택 인자로 받고,
// 넘기지 않으면 종전의 한국어다 — 화면으로 가는 액션(actions/authzEvents.ts)만 serverTranslator() 를 넘긴다(스펙 §3.4 T11 은 이 한국어 기본값을 지킨다).
// 모르는 모양은 지어내지 않는다 — 읽을 수 있는 값만 쓰고 아니면 그대로 알린다(3원칙: 모르면 unknown).
import type { DictKey } from '@/lib/i18n/dict'
import { koTranslate, type Translate } from '@/lib/i18n/translate'

export type AuthzEventKind = 'platform_admin' | 'workspace_role' | 'project_access' | 'password_reset' | 'project_deleted'
export type AuthzEventCause = 'direct' | 'cascade' | 'parent_deleted'

/** 종류·원인 라벨의 사전 키 — 화면은 이 표로 읽는다(플랫폼 관리자는 기존 role.platformAdmin 을 재사용) */
export const AUTHZ_KIND_KEY = {
  platform_admin: 'role.platformAdmin', workspace_role: 'authz.kind.workspace_role', project_access: 'authz.kind.project_access', password_reset: 'authz.kind.password_reset',
  project_deleted: 'authz.kind.project_deleted',
} as const satisfies Record<AuthzEventKind, DictKey>
export const AUTHZ_CAUSE_KEY = {
  direct: 'authz.cause.direct', cascade: 'authz.cause.cascade', parent_deleted: 'authz.cause.parent_deleted',
} as const satisfies Record<AuthzEventCause, DictKey>
/** 한국어 고정 라벨 — 번역 함수를 넘기지 않는 호출부의 종전 출력(사전 ko 와 같은 글자) */
export const AUTHZ_KIND_LABEL: Record<AuthzEventKind, string> = {
  platform_admin: koTranslate(AUTHZ_KIND_KEY.platform_admin), workspace_role: koTranslate(AUTHZ_KIND_KEY.workspace_role),
  project_access: koTranslate(AUTHZ_KIND_KEY.project_access), password_reset: koTranslate(AUTHZ_KIND_KEY.password_reset),
  project_deleted: koTranslate(AUTHZ_KIND_KEY.project_deleted),
}
export const AUTHZ_CAUSE_LABEL: Record<AuthzEventCause, string> = {
  direct: koTranslate(AUTHZ_CAUSE_KEY.direct), cascade: koTranslate(AUTHZ_CAUSE_KEY.cascade), parent_deleted: koTranslate(AUTHZ_CAUSE_KEY.parent_deleted),
}
/** t 는 화면이 넘기는 번역 함수 — 없으면 한국어(종전 출력 그대로) */
export const authzKindLabel = (kind: AuthzEventKind, t: Translate = koTranslate): string => t(AUTHZ_KIND_KEY[kind])
export const authzCauseLabel = (cause: AuthzEventCause, t: Translate = koTranslate): string => t(AUTHZ_CAUSE_KEY[cause])

const ROLE_KEY: Record<string, DictKey> = { admin: 'role.admin', member: 'role.member' }
const JOIN = ' · '

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null)
const roleText = (v: unknown, t: Translate): string | null => (typeof v === 'string' && v ? (ROLE_KEY[v] ? t(ROLE_KEY[v]) : v) : null)
const flag = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** 인물 기록 — 전·후가 둘 다 boolean 이고 값이 바뀌었을 때만 읽는다 */
function describePersonActive(b: Record<string, unknown> | null, a: Record<string, unknown> | null, t: Translate): string {
  const was = b === null ? null : flag(b.person_active)
  const now = a === null ? null : flag(a.person_active)
  if (was === null || now === null || was === now) return t('authz.unreadable')
  // 인물의 활성 전환(SP4) — 그 인물의 권한 있는 명단 행마다 같은 문구
  return now ? t('authz.person.on') : t('authz.person.off')
}

/** 명단 행의 변경(전·후 둘 다 있음) — 권한 칸과 활성 칸을 따로 읽어 바뀐 것만 잇는다 */
function describeRosterChange(b: Record<string, unknown>, a: Record<string, unknown>, t: Translate): string {
  const was = roleText(b.access_role, t)
  const now = roleText(a.access_role, t)
  const wasActive = flag(b.active)
  const nowActive = flag(a.active)
  const parts: string[] = []
  if (b.access_role !== a.access_role) {
    if (was && now) parts.push(`${was} → ${now}`)
    else if (was && a.access_role === null) parts.push(`${t('authz.revoke')} (${was})`)
    else if (now && b.access_role === null) parts.push(`${t('authz.grant')} (${now})`)
    else return t('authz.unreadable')
  }
  if (wasActive !== null && nowActive !== null && wasActive !== nowActive) {
    // 명단 행의 활성 전환(SP4) — 권한이 그대로면 `비활성화 (관리자)` 꼴, 권한과 함께 바뀌면 연결자 뒤에 붙인다
    const label = nowActive ? t('authz.active.on') : t('authz.active.off')
    if (parts.length) parts.push(label)
    else if (now) parts.push(`${label} (${now})`)
    else return t('authz.unreadable')
  }
  return parts.length ? parts.join(JOIN) : t('authz.unreadable')
}

/** t 는 화면이 넘기는 번역 함수(요약의 언어) — 없으면 한국어(종전 출력 그대로). 모르는 역할 값은 번역하지 않고 원문을 보인다 */
export function describeAuthzChange(kind: AuthzEventKind, before: unknown, after: unknown, t: Translate = koTranslate): string {
  const unreadable = t('authz.unreadable')
  const b = before === null ? null : obj(before)
  const a = after === null ? null : obj(after)
  if ((before !== null && b === null) || (after !== null && a === null) || (b === null && a === null)) return unreadable
  if (kind === 'platform_admin') {
    if (b === null && a?.granted === true) return t('authz.platform.assign')
    if (a === null && b?.granted === true) return t('authz.platform.revoke')
    return unreadable
  }
  if (kind === 'password_reset') return b === null && a?.reset === true ? t('authz.passwordReset') : unreadable
  if (kind === 'project_deleted') {
    // 지운 프로젝트의 이름은 이 기록에만 남는다 — 이름을 읽지 못하면 지어내지 않는다
    const name = a === null && typeof b?.name === 'string' ? b.name.trim() : ''
    return name ? `${t('authz.projectDeleted')} (${name})` : unreadable
  }
  if (kind === 'project_access' && ((b !== null && 'person_active' in b) || (a !== null && 'person_active' in a))) {
    return describePersonActive(b, a, t)
  }
  const field = kind === 'workspace_role' ? 'role' : 'access_role'
  const was = b === null ? null : roleText(b[field], t)
  const now = a === null ? null : roleText(a[field], t)
  // 명단 행의 추가·삭제는 그 행의 active 도 싣는다(SP4) — false 면 꼬리를 붙인다(권한이 생기지 않았거나 이미 정지돼 있었다 — A1-3 리뷰 M2).
  // `부여 (멤버, 비활성)` 꼴로 괄호 안에 잇는다. 없는 옛 기록·워크스페이스 등급은 그대로
  const tail = (row: Record<string, unknown>): string => (kind === 'project_access' && flag(row.active) === false ? `, ${t('authz.inactiveTail')}` : '')
  if (b === null) {
    if (!now || a === null) return unreadable
    return kind === 'workspace_role' ? `${t('authz.memberAdd')} (${now})` : `${t('authz.grant')} (${now}${tail(a)})`
  }
  if (a === null) {
    if (!was) return unreadable
    return kind === 'workspace_role' ? `${t('authz.memberRemove')} (${was})` : `${t('authz.revoke')} (${was}${tail(b)})`
  }
  if (kind === 'project_access') return describeRosterChange(b, a, t)
  if (!was || !now) return unreadable
  return `${was} → ${now}`
}
