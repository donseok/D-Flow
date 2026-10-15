import 'server-only'
import nodemailer from 'nodemailer'
import { adminFor } from '@/lib/supabase/adminFor'
import { mailFromName } from './fromName'
import { isValidEmail } from './recipients'
import { loadWorkspaceMailRow, rowToSmtpEnv, vetMailHost, type WorkspaceMailLoad } from './workspaceSmtp'

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
/** 워크스페이스 메일 설정을 확정하지 못했다(조회 실패·잘못된 id·보관된 워크스페이스) — 미설정으로 위장하지 않고, 보관 사실도 드러내지 않는다 */
export const MAIL_SETTINGS_UNAVAILABLE = '메일 발송 설정을 확인하지 못했습니다. 잠시 후 다시 시도하세요.'
/** 워크스페이스 행의 서버 주소가 사설·예약 대역으로 풀리거나 풀리지 않았다(설계 §2.4) */
export const MAIL_HOST_NOT_ALLOWED = '이 메일 서버 주소는 쓸 수 없습니다.'

/** 발송 설정의 출처와 유효성 — 설정 화면의 상태 줄과 발송(getTransport)이 같은 규칙으로 낸다 */
export type MailStatus =
  | { source: 'workspace'; valid: true; fromAddress: string } | { source: 'workspace'; valid: false }
  | { source: 'env'; valid: true; fromAddress: string } | { source: 'env'; valid: false }
  | { source: 'none' }

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
 * env 만 본다(동기) — 비밀번호 재설정 메일은 Supabase Auth 가 보내므로 워크스페이스 메일 설정과 무관하다(설계 범위 밖).
 */
export function mailConfigured(): boolean {
  return resolveSmtpSettings(process.env).ok
}

type SmtpSelection = { source: 'workspace' | 'env'; r: ReturnType<typeof resolveSmtpSettings> } | { error: string }

/**
 * 행 조회 결과 → 발송 설정(설계 §2.1 규칙 1–3). env 는 호출 시점의 process.env 를 읽는다. 갈래를 빠짐없이 적는다 —
 * 모르는 결과는 env 로 내려가지 않고 닫는다(fail-closed). null = 워크스페이스 없는 발송(env 만).
 */
function selectFromLoad(load: WorkspaceMailLoad | null): SmtpSelection {
  if (load === null) return { source: 'env', r: resolveSmtpSettings(process.env) }
  switch (load.kind) {
    case 'row': return { source: 'workspace', r: resolveSmtpSettings(rowToSmtpEnv(load.row)) }
    case 'none': return { source: 'env', r: resolveSmtpSettings(process.env) }
    case 'archived': return { error: MAIL_SETTINGS_UNAVAILABLE }
    default: {
      const unknownKind: never = load
      console.error('[mail] 워크스페이스 메일 설정 조회 결과를 모른다:', (unknownKind as { kind?: unknown })?.kind)
      return { error: MAIL_SETTINGS_UNAVAILABLE }
    }
  }
}

/**
 * 발송 설정 고르기 — 설계 §2.1 판정 규칙 한 벌(resolveMailStatus·getTransport 가 같이 쓴다). 캐시하지 않는다(저장한 다음 발송부터 바로 쓰인다).
 *  1. 행이 있으면 그 행만 본다 — unset 이든 invalid 든 env 로 내려가지 않는다(관리자가 정한 계정을 조용히 다른 계정으로 바꾸지 않는다).
 *  2. 보관된 워크스페이스의 행 → 보내지 않는다(env 로도 내려가지 않는다).
 *  3. 행이 없으면 배포 env(SMTP_*).
 *  4. 조회 실패(uuid 가 아닌 id 로 adminFor 가 throw 한 것 포함) → MAIL_SETTINGS_UNAVAILABLE — 미설정으로 위장하지 않는다.
 */
async function selectSmtp(workspaceId: string | null): Promise<SmtpSelection> {
  if (workspaceId === null) return selectFromLoad(null)
  let load: WorkspaceMailLoad
  try {
    const { admin } = adminFor({ workspaceId })
    load = await loadWorkspaceMailRow(admin, workspaceId)
  } catch (e) {
    console.error('[mail] 워크스페이스 메일 설정 조회 실패:', e instanceof Error ? e.message : 'unknown')
    return { error: MAIL_SETTINGS_UNAVAILABLE }
  }
  return selectFromLoad(load)
}

function statusOf(s: SmtpSelection): MailStatus | { error: string } {
  if ('error' in s) return { error: s.error }
  if (s.r.ok) {
    return s.source === 'workspace'
      ? { source: 'workspace', valid: true, fromAddress: s.r.settings.fromAddress }
      : { source: 'env', valid: true, fromAddress: s.r.settings.fromAddress }
  }
  if (s.source === 'workspace') return { source: 'workspace', valid: false }
  return s.r.kind === 'unset' ? { source: 'none' } : { source: 'env', valid: false }
}

/** 설정 화면의 상태 줄. DNS 검사·연결은 하지 않는다(발송 때만) */
export async function resolveMailStatus(workspaceId: string | null): Promise<MailStatus | { error: string }> {
  return statusOf(await selectSmtp(workspaceId))
}

/**
 * 이미 읽은 행 조회 결과로 상태 줄 — resolveMailStatus 와 같은 판정이다. 설정 화면(getWorkspaceMailSettings)이 행을 한 번만 읽어
 * 보기와 상태가 같은 행을 말하게 한다. 조회·DNS 는 하지 않는다(env 는 호출 시점에 읽는다)
 */
export function statusFromLoad(load: WorkspaceMailLoad): MailStatus | { error: string } {
  return statusOf(selectFromLoad(load))
}

/** DNS 검사 — 검사 자체가 던져도 거부로 닫는다(해석 오류 원문은 싣지 않는다). 테스트 발송(actions/mailSettings.ts)도 이것을 쓴다 */
export async function vetOrDeny(host: string): Promise<{ ok: true; address: string } | { ok: false }> {
  try { return await vetMailHost(host) } catch { return { ok: false } }
}

/**
 * 검증이 끝난 설정으로 트랜스포트를 만든다 — 순수 구성(nodemailer·타임아웃·from 은 이 파일만 안다). 테스트 발송도 이것을 쓴다.
 * connectTo(vetMailHost 가 통과시킨 IP)가 있으면 그 IP 로 접속한다 — nodemailer 가 이름을 다시 풀지 않아 검사와 접속 사이에
 * DNS 리바인딩이 끼어들 틈이 없다. 인증서 검사·SNI(tls.servername)는 원래 호스트 이름으로 한다.
 * `name` 은 달지 않는다 — 클라이언트 자신의 EHLO 이름이라 서버 이름을 대면 MTA 가 거절한다(설계 §2.2 문구와 일부러 다르다).
 * `from` 은 이 모듈이 소유한다(호출자가 바꿀 수 없다).
 */
export function transportFromSettings(settings: SmtpSettings, opts: { fromName?: string; connectTo?: string } = {}): Transport {
  const fromName = mailFromName(opts.fromName)
  const tx = nodemailer.createTransport({
    host: opts.connectTo ?? settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: settings.requireTLS,
    ...(settings.auth ? { auth: settings.auth } : {}),
    ...(opts.connectTo ? { tls: { servername: settings.host } } : {}),
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: TIMEOUT_MS,
  })

  return {
    ok: true,
    send: async (msg) => {
      const info = await tx.sendMail({
        from: { name: fromName, address: settings.fromAddress },
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

/**
 * SMTP 트랜스포트 — 워크스페이스 메일 설정 → 배포 env(SMTP_*) → 미설정(설계 §2.1). 설정이 없거나 잘못되면 **throw 하지 않고**
 * ok:false 를 낸다 — 로컬·Preview 에서 화면을 죽이지 않기 위해서다. 오류의 키 이름은 서버 로그에만 — 반환 문구는 사용자에게 그대로 뜬다.
 * 'unset → SMTP_NOT_CONFIGURED' 는 env 경로에만 해당한다(행이 있으면 무엇이 비었든 SMTP_MISCONFIGURED).
 * 워크스페이스 행만 연결 전에 서버 주소 검사(vetMailHost)를 지난다 — env 는 운영자가 정한 값이라(로컬 inbucket 127.0.0.1 포함) 면제한다.
 */
export async function getTransport(opts: { workspaceId: string | null; fromName?: string }): Promise<Transport> {
  const s = await selectSmtp(opts.workspaceId)
  if ('error' in s) return { ok: false, error: s.error }
  if (!s.r.ok) {
    // 워크스페이스 행의 사유는 종류만 — resolveSmtpSettings 의 reason 은 env 키 이름(SMTP_*)으로 적혀 행에는 맞지 않는다
    if (s.source === 'workspace') console.error('[mail] 워크스페이스 메일 설정 행이 발송 규칙을 통과하지 못했다:', s.r.kind)
    else if (s.r.kind === 'invalid') console.error('[mail] SMTP 설정 오류:', s.r.reason)
    return { ok: false, error: s.source === 'env' && s.r.kind === 'unset' ? SMTP_NOT_CONFIGURED : SMTP_MISCONFIGURED }
  }
  if (s.source === 'env') return transportFromSettings(s.r.settings, { fromName: opts.fromName })
  const vet = await vetOrDeny(s.r.settings.host)
  if (!vet.ok) return { ok: false, error: MAIL_HOST_NOT_ALLOWED }
  return transportFromSettings(s.r.settings, { fromName: opts.fromName, connectTo: vet.address })
}
