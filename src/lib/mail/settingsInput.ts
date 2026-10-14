// 워크스페이스 발송 메일 설정의 입력 정규화 — 순수. 설정 화면(MailSettingsEditor, 클라이언트)과 서버 액션(actions/mailSettings.ts)이
// 같은 규칙 한 벌을 쓴다(설계 2026-10-15 §3). 클라이언트 번들에도 실리므로 'server-only' 를 두지 않고,
// transport.ts(server-only·nodemailer)를 값으로 가져오지 않는다 — 가져오는 것은 순수 모듈(domain/hostname·mail/recipients)뿐이다.
// 여기를 통과한 값은 저장 행의 DB 제약(0059 workspace_mail_settings 의 login·from·tls·gmail·host)과 발송 판정(resolveSmtpSettings)을
// 함께 통과한다 — 저장한 행이 발송 때 'invalid' 로 읽히지 않게 한다. 비밀번호 필요 판정은 저장값이 있어야 하므로 호출자 몫이다(canReusePassword).
import type { DictKey } from '@/lib/i18n/dict'
import { toAsciiHostname } from '@/lib/domain/hostname'
import { isValidEmail } from '@/lib/mail/recipients'

export type MailPreset = 'gmail' | 'custom'
/** SMTP 표준 포트 넷 — 임의 포트로 내부망을 두드리는 탐침을 막는다(DB check 와 같은 목록) */
export const MAIL_PORTS = [25, 465, 587, 2525] as const
/** Gmail 프리셋의 고정 서버(465·SSL) — DB 제약 workspace_mail_settings_gmail 과 같은 값 */
export const GMAIL_HOST = 'smtp.gmail.com'

export type MailSettingsReason =
  | 'preset_invalid' | 'address_invalid' | 'host_invalid' | 'port_invalid'
  | 'tls_mismatch' | 'username_required' | 'from_invalid' | 'password_required'

export interface MailSettingsInput {
  preset: MailPreset
  address?: string; password?: string            // gmail
  host?: string; port?: number | string; secure?: boolean; username?: string; fromAddress?: string // custom (+password)
}

/** 저장할 꼴. password null = 입력 빈칸(저장값 재사용 후보) */
export interface NormalizedMailSettings {
  preset: MailPreset; host: string; port: number; secure: boolean
  username: string; password: string | null; from_address: string | null
}

type NormalizeResult = { ok: true; value: NormalizedMailSettings } | { ok: false; code: MailSettingsReason }

const fail = (code: MailSettingsReason): NormalizeResult => ({ ok: false, code })
/** 문자열이 아니면 빈 문자열 — 폼 밖에서 온 값(숫자·객체)을 그대로 쓰지 않는다 */
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** 서버 주소 → 저장 꼴(소문자·끝 점 하나 제거·퓨니코드 — 설계 §2.4). IP 리터럴·단일 레이블(localhost)·IPv6·
 *  URL 구분자(: / ? #)가 섞인 값은 null. 단일 레이블은 toAsciiHostname 도 거르지만 규칙을 여기서 한 번 더 드러낸다 */
function normalizeHost(raw: string): string | null {
  const v = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!v || !v.includes('.')) return null
  return toAsciiHostname(v)
}

/** 숫자 또는 숫자만인 문자열 → 표준 포트 넷 중 하나. 아니면 null */
function normalizePort(raw: unknown): number | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const n = typeof raw === 'number' ? raw : /^\d{1,5}$/.test(s) ? Number(s) : NaN
  return (MAIL_PORTS as readonly number[]).includes(n) ? n : null
}

/**
 * 폼·액션 입력 → 저장할 꼴. 검사 순서: 방식 → (Gmail) 주소 / (직접 입력) 서버 주소 → 포트 → 포트-보안 짝 → 계정 → 보내는 주소.
 * - Gmail: address·password 만 읽는다. host=smtp.gmail.com·port=465·secure=true·username=주소(trim·소문자)·from_address=null(→ 계정).
 *   비밀번호의 공백은 모두 지운다(구글이 앱 비밀번호를 4자씩 띄워 보여준다). 주소 도메인은 묻지 않는다(Google Workspace 도메인도 같은 서버다).
 * - 직접 입력: secure 가 불리언이 아니면 포트로 정한다(465 → SSL, 나머지 → STARTTLS). 465+평문·587/25+SSL 은 tls_mismatch.
 *   계정은 trim 만 한다(대소문자를 가리는 서버가 있다). 보내는 주소를 비우면 계정이 이메일 형식이어야 한다 — 아니면 발송 판정이 invalid 로 읽는다.
 *   비밀번호는 trim(발송 판정이 trim 해서 읽는다 — 앞뒤 공백은 어차피 쓰이지 않는다).
 * - 비밀번호가 비면 null — 저장값 재사용 후보다. 재사용 가부(password_required)는 canReusePassword 로 호출자가 정한다.
 */
export function normalizeMailSettingsInput(input: unknown): NormalizeResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('preset_invalid')
  const o = input as Record<string, unknown>

  if (o.preset === 'gmail') {
    const address = str(o.address).trim().toLowerCase()
    if (!isValidEmail(address)) return fail('address_invalid')
    const password = str(o.password).replace(/\s+/g, '')
    return {
      ok: true,
      value: { preset: 'gmail', host: GMAIL_HOST, port: 465, secure: true, username: address, password: password || null, from_address: null },
    }
  }
  if (o.preset !== 'custom') return fail('preset_invalid')

  const host = normalizeHost(str(o.host))
  if (!host) return fail('host_invalid')
  const port = normalizePort(o.port)
  if (port === null) return fail('port_invalid')
  const secure = typeof o.secure === 'boolean' ? o.secure : port === 465
  if ((port === 465 && !secure) || ((port === 587 || port === 25) && secure)) return fail('tls_mismatch')
  const username = str(o.username).trim()
  if (!username) return fail('username_required')
  const from = str(o.fromAddress).trim()
  if (from ? !isValidEmail(from) : !isValidEmail(username)) return fail('from_invalid')
  const password = str(o.password).trim()
  return {
    ok: true,
    value: { preset: 'custom', host, port, secure, username, password: password || null, from_address: from || null },
  }
}

/** 비교 키 — 저장값(이미 정규형)과 새 값(정규화 전일 수도 있다)을 같은 꼴로. 형태가 아닌 호스트는 trim·소문자·끝 점만 */
const hostKey = (h: string): string => {
  const v = h.trim().toLowerCase().replace(/\.$/, '')
  return toAsciiHostname(v) ?? v
}
const userKey = (u: string): string => u.trim().toLowerCase()

/** 빈 비밀번호일 때 저장값을 재사용해도 되는가 — host 동일(정규화 후) && username 동일(trim·소문자).
 *  저장 행이 없거나 어느 한쪽이 비면 false. Gmail 은 host·username 이 고정이라 이 한 규칙이 Gmail↔직접 입력 사이의 재사용도 막는다
 *  (다른 서버·다른 계정에 남의 비밀번호를 보내지 않는다). 저장과 테스트 발송이 같은 규칙을 쓴다(설계 §3) */
export function canReusePassword(
  next: { host: string; username: string },
  stored: { host: string; username: string } | null,
): boolean {
  if (!stored) return false
  const h = hostKey(next.host), u = userKey(next.username)
  if (!h || !u) return false
  return h === hostKey(stored.host) && u === userKey(stored.username)
}

/** 사유 코드 → 공용 사전 키(settingsUi.ts — 폼과 서버가 같은 문구). 표가 Record 라 코드를 더하면 여기서 타입이 깨진다 */
const REASON_KEY = {
  preset_invalid: 'mailSettings.reason.preset_invalid',
  address_invalid: 'mailSettings.reason.address_invalid',
  host_invalid: 'mailSettings.reason.host_invalid',
  port_invalid: 'mailSettings.reason.port_invalid',
  tls_mismatch: 'mailSettings.reason.tls_mismatch',
  username_required: 'mailSettings.reason.username_required',
  from_invalid: 'mailSettings.reason.from_invalid',
  password_required: 'mailSettings.reason.password_required',
} as const satisfies Record<MailSettingsReason, DictKey>

/** 사유 코드 → 공용 사전 키 'mailSettings.reason.<code>' */
export function reasonKey(code: MailSettingsReason): DictKey {
  return REASON_KEY[code]
}
