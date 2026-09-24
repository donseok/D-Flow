// 프로젝트 초대 순수 함수 — 서버 액션(projectInvites·inviteRedeem)과 초대 화면이 공유한다.
// 부수효과·now() 참조 없음: 시각은 전부 인자로 주입받는다.
import { isValidPassword } from '@/lib/domain/accounts'
import { isValidEmail, UUID_RE } from '@/lib/domain/validate'

/** 공개 라우트 토큰 형식 검증 — DB 조회 전 비정상 입력 차단. 선례: src/lib/minutes/share.ts isShareToken */
export function isInviteToken(s: string): boolean {
  return UUID_RE.test(s)
}

/** DB check 제약(email = lower(btrim(email)))과 같은 규칙. 소비 RPC 의 이메일 대조도 이 형태를 전제한다. */
export function normalizeInviteEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** 명시적 전체 허용 값. 미설정을 '제한 없음'으로 읽지 않기 위해 전체 허용은 이 값으로만 켠다. */
export const ANY_DOMAIN = '*'

/** 최소한의 호스트명 형태 — 라벨은 영숫자·하이픈(양끝 하이픈 금지), 점으로 구분된 라벨이 2개 이상.
 *  통과해도 '실재하는' 도메인이란 보장은 아니다 — 설정 오타·와일드카드 흔적을 조용히 반영하지
 *  않기 위한 최소 방어선일 뿐이다. */
const HOSTNAME_LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const HOSTNAME_RE = new RegExp(`^${HOSTNAME_LABEL}(?:\\.${HOSTNAME_LABEL})+$`)

/** 끝의 '.' 하나만 벗겨낸다(FQDN 표기 'example.com.' 흡수). 두 개 이상 연속이면 그대로 두어
 *  아래 호스트명 형태 검사에서 걸러지게 한다. */
function stripTrailingDot(s: string): string {
  return s.length > 1 && s.endsWith('.') && !s.endsWith('..') ? s.slice(0, -1) : s
}

/** 허용 도메인 목록 파싱(쉼표·공백 구분). 미설정·공백이면 [] — 초대 불가(fail-closed).
 *  '*' 가 하나라도 있으면 ['*']. 형태가 깨진 항목(호스트명 아님·'*' 를 부분 포함)은 조용히
 *  반영하지 않고 버린다 — 그대로 두면 거부 문구가 "이런 도메인도 되는 줄" 오해를 부르고,
 *  '*.example.com' 같은 항목은 와일드카드 서브도메인 허용처럼 보이지만 실제로는 리터럴
 *  비교라 절대 매치되지 않는다(무의미한 설정을 조용히 삼키지 않는다). */
export function parseAllowedDomains(raw: string | undefined): string[] {
  const out: string[] = []
  for (const part of (raw ?? '').split(/[\s,]+/)) {
    // '@example.com' 처럼 적어도 받아들인다(설정 실수가 잦은 형태).
    const trimmed = part.trim().toLowerCase().replace(/^@/, '')
    if (!trimmed) continue
    if (trimmed === ANY_DOMAIN) return [ANY_DOMAIN]
    if (trimmed.includes(ANY_DOMAIN)) {
      console.error(`[invites] INVITE_ALLOWED_DOMAINS 항목을 건너뜁니다('*' 는 단독일 때만 전체 허용): ${trimmed}`)
      continue
    }
    const d = stripTrailingDot(trimmed)
    if (!HOSTNAME_RE.test(d)) {
      console.error(`[invites] INVITE_ALLOWED_DOMAINS 항목을 건너뜁니다(호스트명 형태가 아님): ${trimmed}`)
      continue
    }
    if (!out.includes(d)) out.push(d)
  }
  return out
}

/** normalizeInviteEmail 을 거치지 않은 값이 와도 안전하도록 자기완결적으로 검증한다 —
 *  호출부가 isValidEmail 을 먼저 돌렸는지에 기대지 않는다(redeem 재검사 등 새 호출부가 생겨도
 *  안전). 형식이 깨졌거나 '@' 가 둘 이상이면 무조건 거부. 빈 목록은 전부 거부.
 *  '@' 뒤 전체가 목록의 한 항목과 정확히 같아야 한다 — 'a.example.com' 같은 서브도메인은
 *  불허(사칭 차단). */
export function isAllowedInviteDomain(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf('@')
  if (!isValidEmail(email) || email.indexOf('@') !== at) return false
  if (domains.includes(ANY_DOMAIN)) return true
  const host = stripTrailingDot(email.slice(at + 1).toLowerCase())
  return domains.some((d) => stripTrailingDot(d.trim().toLowerCase().replace(/^@/, '')) === host)
}

export const DEFAULT_INVITE_DAYS = 7
export const MAX_INVITE_DAYS = 30

/** 1~30 정수만 통과. 그 외는 null.
 *  폼이 문자열로 보내므로 '7' 같은 십진 정수 문자열도 받는다('7.5'·'-1'·''·공백은 거부). */
export function normalizeInviteDays(v: unknown): number | null {
  const n = typeof v === 'number' ? v
    : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim())
      : NaN
  if (!Number.isInteger(n)) return null
  if (n < 1 || n > MAX_INVITE_DAYS) return null
  return n
}

export interface InviteStateRow {
  expiresAt: string
  revokedAt: string | null
  redeemedAt: string | null
}
export type InviteStatus = 'active' | 'redeemed' | 'revoked' | 'expired'

/** 우선순위: revoked > redeemed > expired > active.
 *  expiresAt 파싱 실패는 'expired' — 판단 근거가 깨졌을 때 링크를 살려두지 않는다(fail-closed).
 *  만료 경계는 소비 RPC(expires_at > now())와 같게 잡는다: expiresAt === now 는 이미 만료. */
export function inviteStatus(row: InviteStateRow, now: Date): InviteStatus {
  if (row.revokedAt) return 'revoked'
  if (row.redeemedAt) return 'redeemed'
  const exp = new Date(row.expiresAt).getTime()
  if (Number.isNaN(exp)) return 'expired'
  return exp > now.getTime() ? 'active' : 'expired'
}

export function inviteStatusLabel(s: InviteStatus): string {
  switch (s) {
    case 'active': return '유효'
    case 'redeemed': return '합류 완료'
    case 'revoked': return '취소됨'
    case 'expired': return '만료됨'
  }
}

/** 메일·화면 표시용 마스킹: 'mina.park@example.com' → 'mi*******@example.com'.
 *  로컬파트가 2자 이하면 첫 1자만 남긴다. 별표는 최소 1개 — 1자 주소가 그대로 드러나지 않게. */
export function maskEmail(email: string): string {
  const e = normalizeInviteEmail(email)
  const at = e.lastIndexOf('@')
  // 형식이 깨졌으면 무엇도 흘리지 않는다.
  if (at < 1 || at === e.length - 1) return '***'
  const local = e.slice(0, at)
  const keep = local.length > 2 ? 2 : 1
  return local.slice(0, keep) + '*'.repeat(Math.max(local.length - keep, 1)) + e.slice(at)
}

export interface SignupInput { name: string; password: string; passwordConfirmation: string }

/** 가입 폼 검증. 이메일은 초대 행이 정하므로 검증 대상이 아니다(폼에 입력란도 없다).
 *  인증 게이트가 없는 공개 액션(redeemInviteWithSignup)의 첫 관문이라, 타입을 신뢰하지 않고
 *  형상부터 확인한다 — 조작된 요청이 {} 나 { name: 1 } 을 보내도 TypeError 대신 거부로 끝난다. */
export function validateSignupInput(i: SignupInput): { ok: true } | { ok: false; error: string } {
  const o = i as unknown as Record<string, unknown> | null | undefined
  if (!o || typeof o !== 'object'
    || typeof o.name !== 'string'
    || typeof o.password !== 'string'
    || typeof o.passwordConfirmation !== 'string') {
    return { ok: false, error: '입력값을 확인해 주세요.' }
  }
  if (!i.name.trim()) return { ok: false, error: '이름을 입력해 주세요.' }
  if (!isValidPassword(i.password)) return { ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }
  if (i.password !== i.passwordConfirmation) return { ok: false, error: '비밀번호가 일치하지 않습니다.' }
  return { ok: true }
}
