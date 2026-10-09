import 'server-only'
import nodemailer from 'nodemailer'
import { mailFromName } from './fromName'
import { isValidEmail } from './recipients'

export interface MailMessage {
  to: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
}

export type Transport =
  | { ok: true; send: (msg: MailMessage) => Promise<{ rejected: string[] }> }
  | { ok: false; error: string }

export type SmtpSettings = {
  host: string; port: number; secure: boolean; requireTLS: boolean
  auth: { user: string; pass: string } | null
  fromAddress: string
}

export const SMTP_NOT_CONFIGURED = '메일 발송이 설정되지 않았습니다.'
export const SMTP_MISCONFIGURED = '메일 발송 설정이 올바르지 않습니다. 관리자에게 문의하세요.'

// nodemailer 기본 타임아웃은 훨씬 길다. 사용자가 저장 버튼 앞에서 기다리는 동기 경로이므로 짧게 묶는다.
const TIMEOUT_MS = 10_000

/**
 * env → SMTP 설정(순수, 호출 시점에 읽는다). 실패 사유(reason)는 키 이름을 담는 서버 로그 전용이다.
 * 명시값을 엄격히 읽는다 — 공급자 기본값은 없고, 모호한 조합(465+평문, 587+SSL)은 추측하지 않고 invalid 로 낸다.
 */
export function resolveSmtpSettings(env: Record<string, string | undefined>):
  | { ok: true; settings: SmtpSettings }
  | { ok: false; kind: 'unset' | 'invalid'; reason: string } {
  const v = (k: string) => env[k]?.trim() ?? ''
  const invalid = (reason: string) => ({ ok: false as const, kind: 'invalid' as const, reason })
  const host = v('SMTP_HOST')
  if (!host) return { ok: false, kind: 'unset', reason: 'SMTP_HOST 없음' }
  const portRaw = v('SMTP_PORT'), secureRaw = v('SMTP_SECURE'), authRaw = v('SMTP_AUTH')
  const user = v('SMTP_USER'), pass = v('SMTP_PASS'), fromRaw = v('SMTP_FROM_ADDRESS')

  if (secureRaw && secureRaw !== 'true' && secureRaw !== 'false') return invalid('SMTP_SECURE 는 true|false 만')
  if (portRaw && !/^\d+$/.test(portRaw)) return invalid('SMTP_PORT 가 숫자가 아님')
  const portNum = portRaw ? Number(portRaw) : null
  if (portNum !== null && (portNum < 1 || portNum > 65535)) return invalid('SMTP_PORT 범위(1-65535) 밖')
  const secure = secureRaw ? secureRaw === 'true' : portNum === 465
  const port = portNum ?? (secure ? 465 : 587)
  if (port === 465 && !secure) return invalid('SMTP_PORT 465 는 SMTP_SECURE=true')
  if ((port === 587 || port === 25) && secure) return invalid('SMTP_PORT 587·25 는 SMTP_SECURE=false(STARTTLS)')
  if (authRaw && authRaw !== 'none') return invalid('SMTP_AUTH 는 비우거나 none')

  let auth: SmtpSettings['auth'] = null
  if (authRaw === 'none') {
    if (user || pass) return invalid('SMTP_AUTH=none 이면 SMTP_USER·SMTP_PASS 를 비운다')
    if (!fromRaw) return invalid('SMTP_AUTH=none 이면 SMTP_FROM_ADDRESS 필수')
  } else {
    if (!user && !pass) return { ok: false, kind: 'unset', reason: 'SMTP_USER·SMTP_PASS 없음(무인증 릴레이는 SMTP_AUTH=none)' }
    if (!user || !pass) return invalid('SMTP_USER·SMTP_PASS 는 둘 다 필요')
    auth = { user, pass }
  }
  const fromAddress = fromRaw || (isValidEmail(user) ? user : '')
  if (!fromAddress || !isValidEmail(fromAddress)) return invalid('발신 주소 없음(SMTP_FROM_ADDRESS 또는 이메일 형식 SMTP_USER)')
  // 인증이 있는데 처음부터 TLS 가 아니면 STARTTLS 를 강제한다 — 서버가 STARTTLS 를 안 주면 평문 로그인 대신 실패한다.
  return { ok: true, settings: { host, port, secure, requireTLS: auth !== null && !secure, auth, fromAddress } }
}

/**
 * 이 배포가 메일을 보내도록 구성됐는가 — 보내기 전에 화면이 길을 열지 닫을지 정할 때 쓴다(비밀번호 재설정 링크 등).
 * 잘못된 설정(invalid)은 구성되지 않은 것으로 본다: 보내면 실패할 길을 열어 두지 않는다. 사유는 getTransport 가 보낼 때 로그에 남긴다.
 */
export function mailConfigured(): boolean {
  return resolveSmtpSettings(process.env).ok
}

/**
 * SMTP 트랜스포트 — 공급자 중립(회사 SMTP·Gmail·로컬 inbucket 모두 env 로). 설정이 없거나 잘못되면 **throw 하지 않고**
 * ok:false 를 낸다 — 로컬·Preview 에서 화면을 죽이지 않기 위해서다. `from` 은 이 모듈이 소유한다(호출자가 바꿀 수 없다).
 * env 는 호출 시점에 읽는다(fromName.ts 와 같은 관례). 오류의 키 이름은 서버 로그에만 — 반환 문구는 사용자에게 그대로 뜬다.
 */
export function getTransport(workspaceFromName?: string): Transport {
  const r = resolveSmtpSettings(process.env)
  if (!r.ok) {
    if (r.kind === 'invalid') console.error('[mail] SMTP 설정 오류:', r.reason)
    return { ok: false, error: r.kind === 'unset' ? SMTP_NOT_CONFIGURED : SMTP_MISCONFIGURED }
  }
  const s = r.settings
  const fromName = mailFromName(workspaceFromName)
  const tx = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    requireTLS: s.requireTLS,
    ...(s.auth ? { auth: s.auth } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })

  return {
    ok: true,
    send: async (msg) => {
      const info = await tx.sendMail({
        from: { name: fromName, address: s.fromAddress },
        to: msg.to,
        replyTo: msg.replyTo ?? undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      })
      // nodemailer 의 rejected 는 문자열 또는 주소 객체가 섞여 올 수 있다.
      const rejected = (info.rejected ?? []) as unknown[]
      return {
        rejected: rejected.map(r =>
          typeof r === 'string' ? r : String((r as { address?: string })?.address ?? r)),
      }
    },
  }
}
