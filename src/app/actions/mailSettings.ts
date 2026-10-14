'use server'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { requireWorkspaceAdmin } from '@/lib/authz'
import { isWorkspaceAdminRole } from '@/lib/domain/authz'
import { SAFE_ID_RE } from '@/lib/domain/validate'
import { adminFor, type AdminClient } from '@/lib/supabase/adminFor'
import {
  canReusePassword, normalizeMailSettingsInput, reasonKey,
  type MailPreset, type MailSettingsInput, type NormalizedMailSettings,
} from '@/lib/mail/settingsInput'
import { loadWorkspaceMailRow, rowToSmtpEnv, vetMailHost, type WorkspaceMailRow } from '@/lib/mail/workspaceSmtp'
import {
  MAIL_HOST_NOT_ALLOWED, MAIL_SETTINGS_UNAVAILABLE, resolveMailStatus, resolveSmtpSettings, transportFromSettings,
  type MailStatus,
} from '@/lib/mail/transport'
import { smtpErrorMessage } from '@/lib/mail/errors'
import { loadDisplayBranding } from '@/lib/settings/displayBranding'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'

// 워크스페이스 발송 메일 설정(설계 2026-10-15 §3). 워크스페이스 관리자만 — 가드 앞에서는 id 모양(SAFE_ID_RE)만 보고,
// 존재·소속 판정은 requireWorkspaceAdmin 과 .eq('workspace_id', wid) 가 한다. service_role 은 adminFor({ workspaceId }) 로만 만든다
// (범위가 정해진 클라이언트 — 감사표 행이 생기지 않는다). 비밀번호는 응답·로그·오류 어디에도 싣지 않는다.

/** 비밀번호를 뺀 저장 설정 보기 — 저장된 행이 있으면 비밀번호도 있다(DB 제약 workspace_mail_settings_login) */
export interface MailSettingsView {
  preset: MailPreset; host: string; port: number; secure: boolean
  username: string; fromAddress: string | null; hasPassword: true
}

export type GetMailSettingsResult =
  | { ok: true; settings: MailSettingsView | null; status: MailStatus
      passwordSetBy: string | null; passwordSetAt: string | null; passwordSetterIsAdmin: boolean | 'unknown' | null }
  | { ok: false; error: string }

type Fail = { ok: false; error: string }

const SETTINGS_PATH = '/w/[slug]/settings'

const isWorkspaceIdArg = (v: unknown): v is string => typeof v === 'string' && SAFE_ID_RE.test(v)

/** 가드 뒤 그 워크스페이스로 범위를 묶은 service_role. uuid 가 아닌 id 는 adminFor 가 throw 한다 — 던지지 않고 조회 실패 문구로 */
function scopedAdmin(wid: string, where: string): { ok: true; admin: AdminClient } | Fail {
  try {
    return { ok: true, admin: adminFor({ workspaceId: wid }).admin }
  } catch (e) {
    console.error(`[${where}] 범위 클라이언트 생성 실패:`, e instanceof Error ? e.message : e)
    return { ok: false, error: MAIL_SETTINGS_UNAVAILABLE }
  }
}

/** 저장된 행. 조회 실패는 미설정으로 위장하지 않는다(3원칙 ①). 보관 응답은 가드(buildActor, 0056)가 먼저 닫으므로 여기 오면 모르는 상태 — 닫는다 */
async function loadStored(admin: AdminClient, wid: string, where: string): Promise<{ ok: true; row: WorkspaceMailRow | null } | Fail> {
  try {
    const r = await loadWorkspaceMailRow(admin, wid)
    if (r.kind === 'archived') return { ok: false, error: MAIL_SETTINGS_UNAVAILABLE }
    return { ok: true, row: r.kind === 'row' ? r.row : null }
  } catch (e) {
    console.error(`[${where}] 메일 설정 조회 실패:`, e instanceof Error ? e.message : e)
    return { ok: false, error: MAIL_SETTINGS_UNAVAILABLE }
  }
}

/**
 * 보낼·저장할 비밀번호. 빈칸(null)은 저장값 재사용 — 저장 행이 있고 정규화한 host·username 이 저장값과 같을 때만(canReusePassword, 설계 §3).
 * Gmail 은 host·username 이 고정이라 이 한 규칙이 Gmail↔직접 입력 사이의 재사용도 막는다. 저장과 테스트 발송이 같이 쓴다.
 */
function pickPassword(tr: ServerTranslate, v: NormalizedMailSettings, stored: WorkspaceMailRow | null):
  { ok: true; password: string; reusedFrom: WorkspaceMailRow | null } | Fail {
  if (v.password !== null) return { ok: true, password: v.password, reusedFrom: null }
  if (stored && canReusePassword({ host: v.host, username: v.username }, { host: stored.host, username: stored.username })) {
    return { ok: true, password: stored.password, reusedFrom: stored }
  }
  return { ok: false, error: tr(reasonKey('password_required')) }
}

/** 발송 판정 한 벌(resolveSmtpSettings)로 본다 — 저장해도 workspace·invalid 가 될 값, 테스트로 보낼 수 없는 값을 거른다(env 로 내려가지 않는다) */
function smtpSettingsFor(v: NormalizedMailSettings, password: string) {
  return resolveSmtpSettings(rowToSmtpEnv({
    host: v.host, port: v.port, secure: v.secure, username: v.username, password, from_address: v.from_address,
  }))
}

/** 비밀번호를 넣은 사람 — 표시 이름과 지금 이 워크스페이스 관리자인지. 계정이 지워졌으면(on delete set null) 관리자가 아니다. 조회 실패는 'unknown'(3원칙) */
async function passwordSetter(tr: ServerTranslate, admin: AdminClient, wid: string, userId: string | null):
  Promise<{ name: string; isAdmin: boolean | 'unknown' }> {
  if (userId === null) return { name: tr('srv.mailSettings.setterDeleted'), isAdmin: false }
  const [profile, member] = await Promise.all([
    admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle(),
    admin.from('workspace_members').select('role').eq('workspace_id', wid).eq('user_id', userId).maybeSingle(),
  ])
  let name: string
  if (profile.error) {
    console.error('[getWorkspaceMailSettings] 설정자 이름 조회 실패:', profile.error.message)
    name = tr('srv.mailSettings.setterUnavailable')
  } else if (!profile.data) {
    name = tr('srv.mailSettings.setterDeleted')
  } else {
    name = (profile.data as { display_name: string | null }).display_name?.trim() || tr('srv.mailSettings.setterNoName')
  }
  let isAdmin: boolean | 'unknown'
  if (member.error) {
    console.error('[getWorkspaceMailSettings] 설정자 소속 조회 실패:', member.error.message)
    isAdmin = 'unknown'
  } else {
    isAdmin = isWorkspaceAdminRole((member.data as { role: string | null } | null)?.role)
  }
  return { name, isAdmin }
}

/** 설정 화면 — 비밀번호를 뺀 보기 + 발송 상태 + 비밀번호 설정자 */
export async function getWorkspaceMailSettings(wid: string): Promise<GetMailSettingsResult> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const a = scopedAdmin(wid, 'getWorkspaceMailSettings')
  if (!a.ok) return a

  const [stored, status] = await Promise.all([
    loadStored(a.admin, wid, 'getWorkspaceMailSettings'),
    resolveMailStatus(wid).catch((e: unknown): { error: string } => {
      console.error('[getWorkspaceMailSettings] 발송 상태 판정 실패:', e instanceof Error ? e.message : e)
      return { error: MAIL_SETTINGS_UNAVAILABLE }
    }),
  ])
  if (!stored.ok) return stored
  if ('error' in status) return { ok: false, error: status.error }

  const row = stored.row
  if (!row) return { ok: true, settings: null, status, passwordSetBy: null, passwordSetAt: null, passwordSetterIsAdmin: null }
  const setter = await passwordSetter(tr, a.admin, wid, row.password_set_by)
  return {
    ok: true,
    settings: {
      preset: row.preset, host: row.host, port: row.port, secure: row.secure,
      username: row.username, fromAddress: row.from_address, hasPassword: true,
    },
    status,
    passwordSetBy: setter.name,
    passwordSetAt: row.password_set_at,
    passwordSetterIsAdmin: setter.isAdmin,
  }
}

/**
 * 저장 — 검증 → (빈 비밀번호면 저장값 재사용 판정) → 쓰기. 새 비밀번호를 넣었을 때만 password_set_by·password_set_at 을 바꾼다(설계 §1.1).
 * DB 오류는 code·message 만 로그한다 — 검사 제약 위반의 details 에는 행 값(비밀번호 포함)이 실린다.
 */
export async function saveWorkspaceMailSettings(
  wid: string, input: MailSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const n = normalizeMailSettingsInput(input)
  if (!n.ok) return { ok: false, error: tr(reasonKey(n.code)) }
  const v = n.value
  const a = scopedAdmin(wid, 'saveWorkspaceMailSettings')
  if (!a.ok) return a

  let stored: WorkspaceMailRow | null = null
  if (v.password === null) {
    const s = await loadStored(a.admin, wid, 'saveWorkspaceMailSettings')
    if (!s.ok) return s
    stored = s.row
  }
  const pw = pickPassword(tr, v, stored)
  if (!pw.ok) return pw
  if (!smtpSettingsFor(v, pw.password).ok) return { ok: false, error: tr('srv.mailSettings.settingsUnusable') }

  const now = new Date().toISOString()
  const base = {
    preset: v.preset, host: v.host, port: v.port, secure: v.secure, username: v.username, from_address: v.from_address,
    updated_by: g.actor.userId, updated_at: now,
  }
  if (pw.reusedFrom) {
    // 비밀번호를 유지한 저장 — 비밀번호·설정자 칸을 싣지 않는다. 읽은 뒤 다른 관리자가 서버·계정을 바꿨으면
    // 저장값 조건(host·username)에 걸려 0행이 된다 — 남의 비밀번호를 새 서버로 옮기지 않게 다시 입력을 받는다.
    const { data, error } = await a.admin.from('workspace_mail_settings').update(base)
      .eq('workspace_id', wid).eq('host', pw.reusedFrom.host).eq('username', pw.reusedFrom.username)
      .select('workspace_id')
    if (error) {
      console.error('[saveWorkspaceMailSettings] 저장 실패:', { code: error.code, message: error.message })
      return { ok: false, error: tr('srv.mailSettings.saveFailed') }
    }
    if (!data || data.length === 0) return { ok: false, error: tr(reasonKey('password_required')) }
  } else {
    const { error } = await a.admin.from('workspace_mail_settings').upsert({
      workspace_id: wid, ...base, password: pw.password, password_set_by: g.actor.userId, password_set_at: now,
    }, { onConflict: 'workspace_id' })
    if (error) {
      console.error('[saveWorkspaceMailSettings] 저장 실패:', { code: error.code, message: error.message })
      return { ok: false, error: tr('srv.mailSettings.saveFailed') }
    }
  }
  revalidatePath(SETTINGS_PATH, 'page')
  return { ok: true }
}

/** 설정 삭제 = 행 삭제(끄기). 영향 행으로 결과를 정한다 — 0행을 성공으로 보고하지 않는다. 지운 뒤에는 env(있으면)로 돌아간다 */
export async function deleteWorkspaceMailSettings(wid: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const a = scopedAdmin(wid, 'deleteWorkspaceMailSettings')
  if (!a.ok) return a

  const { data, error } = await a.admin.from('workspace_mail_settings').delete()
    .eq('workspace_id', wid)
    .select('workspace_id')
  if (error) {
    console.error('[deleteWorkspaceMailSettings] 삭제 실패:', { code: error.code, message: error.message })
    return { ok: false, error: tr('srv.mailSettings.deleteFailed') }
  }
  if (!data || data.length === 0) return { ok: false, error: tr('srv.mailSettings.nothingToDelete') }
  revalidatePath(SETTINGS_PATH, 'page')
  return { ok: true }
}

/**
 * 테스트 메일 — 저장 전 폼 값으로 로그인한 **본인 주소에만** 1통(설계 §3). 수신자를 입력으로 받지 않는다(임의 주소 발송 통로 차단).
 * 순서: 가드 → 검증 → 본인 주소 → 재사용 규칙 → 발송 판정(env 로 내려가지 않는다) → 서버 주소 검사(§2.4) → 트랜스포트 → 발송.
 */
export async function sendWorkspaceTestMail(
  wid: string, input: MailSettingsInput,
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  const tr = await serverTranslator()
  if (!isWorkspaceIdArg(wid)) return { ok: false, error: tr('err.invalidWorkspace') }
  const g = await requireWorkspaceAdmin(wid)
  if (!g.ok) return { ok: false, error: g.error }
  const n = normalizeMailSettingsInput(input)
  if (!n.ok) return { ok: false, error: tr(reasonKey(n.code)) }
  const v = n.value

  const user = await getSession()
  const to = user?.email?.trim()
  if (!to) return { ok: false, error: tr('srv.mailSettings.testNoRecipient') }

  const a = scopedAdmin(wid, 'sendWorkspaceTestMail')
  if (!a.ok) return a
  let stored: WorkspaceMailRow | null = null
  if (v.password === null) {
    const s = await loadStored(a.admin, wid, 'sendWorkspaceTestMail')
    if (!s.ok) return s
    stored = s.row
  }
  const pw = pickPassword(tr, v, stored)
  if (!pw.ok) return pw
  const resolved = smtpSettingsFor(v, pw.password)
  if (!resolved.ok) return { ok: false, error: tr('srv.mailSettings.settingsUnusable') }

  // 관리자가 넣은 호스트로 서버가 직접 접속한다 — 사설·예약 대역으로 풀리면 연결하지 않고, 통과한 IP 로만 붙는다(재해석 차단)
  const vet = await vetMailHost(resolved.settings.host)
  if (!vet.ok) return { ok: false, error: MAIL_HOST_NOT_ALLOWED }

  const branding = await loadDisplayBranding(wid, a.admin)
  const transport = transportFromSettings(resolved.settings, { fromName: branding.mailFromName, connectTo: vet.address })
  if (!transport.ok) return { ok: false, error: transport.error }

  const body = tr('srv.mailSettings.testBody')
  try {
    const { rejected } = await transport.send({
      to: [to], replyTo: null,
      subject: fill(tr('srv.mailSettings.testSubject'), { product: branding.productName }),
      html: `<p>${body}</p>`,
      text: body,
    })
    const self = to.toLowerCase()
    if (rejected.some(r => r.trim().toLowerCase() === self)) {
      return { ok: false, error: fill(tr('srv.mailSettings.testRecipientRejected'), { to }) }
    }
    return { ok: true, to }
  } catch (e) {
    // SMTP 원문에는 계정·호스트(때로는 보낸 자격 증명)가 섞인다 — 로그에도 code·responseCode 만 남긴다
    const err = e as { code?: unknown; responseCode?: unknown } | null
    console.error('[sendWorkspaceTestMail] 발송 실패:', { code: err?.code ?? 'unknown', responseCode: err?.responseCode ?? null })
    return { ok: false, error: smtpErrorMessage(tr, e, { test: true }) }
  }
}
