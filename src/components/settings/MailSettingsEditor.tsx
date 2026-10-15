'use client'
// 워크스페이스 설정 › 메일 발송(설계 2026-10-15 §4). 서버가 읽은 보기(비밀번호 없음)와 발송 판정(status)을 그리고,
// 저장·테스트 발송·삭제는 서버 액션이 다시 판정한다(워크스페이스 관리자 가드 + 같은 순수 검사). 폼은 같은 검사를 먼저 돌려
// 서버에 가기 전에 사유를 보인다 — 비밀번호 빈칸 재사용 규칙(같은 host·username)도 같은 함수(canReusePassword)다.
// 비밀번호 칸은 늘 빈 값으로 시작하고 저장값을 내려받지 않는다. 숨김은 조건부 렌더로만 한다(상태 변형 display 유틸 금지 — CLAUDE.md CSS).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Info, Save, Send, ShieldAlert, Trash2 } from 'lucide-react'
import {
  deleteWorkspaceMailSettings, saveWorkspaceMailSettings, sendWorkspaceTestMail, type GetMailSettingsResult,
} from '@/app/actions/mailSettings'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import type { DictKey } from '@/lib/i18n/dict'
import { formatStampIn } from '@/lib/i18n/format'
import { fill } from '@/lib/i18n/translate'
import {
  MAIL_PORTS, canReusePassword, normalizeMailSettingsInput, reasonKey,
  type MailPreset, type MailSettingsInput,
} from '@/lib/mail/settingsInput'

type Initial = Extract<GetMailSettingsResult, { ok: true }>
type Status = Initial['status']
type Tone = 'ok' | 'warn' | 'bad'

const TONE_CLASS: Record<Tone, { box: string; icon: string }> = {
  ok: { box: 'bg-success-weak', icon: 'text-success' },
  warn: { box: 'bg-warning-weak', icon: 'text-warning' },
  bad: { box: 'bg-danger-weak', icon: 'text-danger' },
}

/** 판정 다섯 갈래 → 표지·색·문구 */
function statusView(s: Status, t: (k: DictKey) => string): { variant: string; tone: Tone; text: string } {
  if (s.source === 'workspace') {
    return s.valid
      ? { variant: 'workspace-valid', tone: 'ok', text: fill(t('mailSettings.status.workspaceValid'), { from: s.fromAddress }) }
      : { variant: 'workspace-invalid', tone: 'bad', text: t('mailSettings.status.workspaceInvalid') }
  }
  if (s.source === 'env') {
    return s.valid
      ? { variant: 'env-valid', tone: 'ok', text: t('mailSettings.status.envValid') }
      : { variant: 'env-invalid', tone: 'bad', text: t('mailSettings.status.envInvalid') }
  }
  return { variant: 'none', tone: 'warn', text: t('mailSettings.status.none') }
}

/** 라벨 + 안내 — id 는 호출부가 고정(smtp-*)한다. Field(useId)를 쓰지 않는 까닭: 로그인 폼과 겹치지 않는 고정 name/id 가 계약이다 */
function Row({ htmlFor, label, hint, children }: { htmlFor: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-fg-secondary">{label}</label>
      {children}
      {hint && <p className="text-meta leading-4 text-fg-muted">{hint}</p>}
    </div>
  )
}

type EditorProps = {
  workspaceId: string
  initial: Initial
  /** 비밀번호 설정 시각을 찍을 tz(워크스페이스 달력) — 없거나 손상이면 시각 칸은 '—' */
  timeZone?: string | null
}

/** 저장 행의 지문 — 행이 바뀌면(저장·삭제 뒤 router.refresh) 폼을 새로 띄워 칸을 새 initial 로 다시 맞춘다. 행 없음은 'none' */
function storedFingerprint(initial: Initial): string {
  const s = initial.settings
  return s ? JSON.stringify([s.preset, s.host, s.port, s.secure, s.username, s.fromAddress, initial.passwordSetAt]) : 'none'
}

export function MailSettingsEditor(props: EditorProps) {
  // 칸 상태는 첫 initial 로만 시작한다 — 지문을 key 로 걸어, 지운 값·저장 전 입력이 새로 그린 뒤에도 남지 않게 한다.
  // 행이 그대로인 새로 그리기(다른 설정 칸 저장 등)는 지문이 같아 입력 중인 값을 지우지 않는다
  return <MailSettingsForm key={storedFingerprint(props.initial)} {...props} />
}

function MailSettingsForm({ workspaceId, initial, timeZone = null }: EditorProps) {
  const { t } = useLocale()
  const router = useRouter()
  const { toast } = useToast()
  const saved = initial.settings
  const [preset, setPreset] = useState<MailPreset>(saved?.preset ?? 'gmail')
  const [address, setAddress] = useState(saved?.preset === 'gmail' ? saved.username : '')
  const [host, setHost] = useState(saved?.preset === 'custom' ? saved.host : '')
  const [port, setPort] = useState(saved?.preset === 'custom' ? String(saved.port) : '587')
  const [secure, setSecure] = useState(saved?.preset === 'custom' ? saved.secure : false)
  const [username, setUsername] = useState(saved?.preset === 'custom' ? saved.username : '')
  const [fromAddress, setFromAddress] = useState(saved?.preset === 'custom' ? (saved.fromAddress ?? '') : '')
  // 비밀번호는 늘 빈 값으로 시작한다 — 빈칸 = 저장값 재사용(같은 host·username 일 때만, 서버가 다시 본다)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [action, setAction] = useState<'save' | 'test' | null>(null)
  const [pending, startTransition] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const busy = pending || deletePending

  const view = statusView(initial.status, t)
  const tone = TONE_CLASS[view.tone]
  const StatusIcon = view.tone === 'ok' ? CheckCircle2 : view.tone === 'bad' ? AlertTriangle : Info

  function clearMessages() { setError(null); setNotice(null) }

  function choosePreset(next: MailPreset) {
    if (next === preset) return
    // 입력하던 비밀번호를 다른 방식(다른 서버)으로 들고 가지 않는다
    setPreset(next); setPassword(''); clearMessages()
  }

  function choosePort(next: string) {
    setPort(next)
    // 포트와 보안 연결의 짝(DB 제약 workspace_mail_settings_tls): 465 는 SSL, 587·25 는 STARTTLS. 2525 는 그대로 둔다
    if (next === '465') setSecure(true)
    else if (next === '587' || next === '25') setSecure(false)
    clearMessages()
  }

  function buildInput(): MailSettingsInput {
    return preset === 'gmail'
      ? { preset, address, password }
      : { preset, host, port: Number(port), secure, username, password, fromAddress }
  }

  /** 서버와 같은 순수 검사 — 통과하면 null, 아니면 사유 문구 */
  function precheck(input: MailSettingsInput): string | null {
    const n = normalizeMailSettingsInput(input)
    if (!n.ok) return t(reasonKey(n.code))
    const stored = saved ? { host: saved.host, username: saved.username } : null
    if (n.value.password === null && !canReusePassword(n.value, stored)) return t(reasonKey('password_required'))
    return null
  }

  function run(kind: 'save' | 'test') {
    clearMessages()
    const input = buildInput()
    const reason = precheck(input)
    if (reason) { setError(reason); return }
    setAction(kind)
    startTransition(async () => {
      try {
        if (kind === 'test') {
          const res = await sendWorkspaceTestMail(workspaceId, input)
          if (!res.ok) { setError(res.error); return }
          setNotice(fill(t('mailSettings.testSent'), { to: res.to }))
          return
        }
        const res = await saveWorkspaceMailSettings(workspaceId, input)
        if (!res.ok) { setError(res.error); return }
        setPassword('')
        toast({ title: t('mailSettings.saved'), variant: 'success' })
        router.refresh()
      } catch {
        setError(t('wsAccounts.requestFailed'))
      } finally {
        setAction(null)
      }
    })
  }

  function confirmDelete() {
    clearMessages()
    startDelete(async () => {
      try {
        const res = await deleteWorkspaceMailSettings(workspaceId)
        // 성공이든 실패든 대화상자는 닫는다 — 실패 사유는 편집기 아래에 남겨야 보인다
        setConfirming(false)
        if (!res.ok) { setError(res.error); return }
        setPassword('')
        toast({ title: t('mailSettings.deleted'), variant: 'success' })
        router.refresh()
      } catch {
        setConfirming(false)
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  const passwordInput = (
    <input
      id="smtp-password"
      name="smtp-password"
      type="password"
      // 크로미움은 비밀번호 칸의 "off" 를 무시하고 로그인 비밀번호를 채운다 — new-password 로 막는다(설계 §4-5)
      autoComplete="new-password"
      className="app-input w-full"
      value={password}
      onChange={(e) => { setPassword(e.target.value); clearMessages() }}
      placeholder={saved ? t('mailSettings.passwordKeptPh') : undefined}
      disabled={busy}
    />
  )

  return (
    <div className="space-y-4">
      <div role="status" data-mail-status={view.variant}
        className={`flex items-start gap-2.5 rounded-xl border border-border px-3.5 py-3 ${tone.box}`}>
        <StatusIcon className={`mt-0.5 h-4 w-4 shrink-0 ${tone.icon}`} aria-hidden />
        <p className="text-sm leading-5 text-fg">{view.text}</p>
      </div>

      {saved && (
        <div className="space-y-1.5">
          <p data-mail-password-set className="text-xs text-fg-secondary">
            {fill(t('mailSettings.passwordSet'), {
              name: initial.passwordSetBy ?? t('mailSettings.passwordSetByUnknown'),
              at: formatStampIn(initial.passwordSetAt, timeZone),
            })}
          </p>
          {initial.passwordSetterIsAdmin === false && (
            <div role="status" data-mail-setter-warning className="flex items-start gap-2.5 rounded-xl border border-border bg-warning-weak px-3.5 py-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs leading-5 text-fg">{t('mailSettings.setterNotAdmin')}</p>
            </div>
          )}
          {initial.passwordSetterIsAdmin === 'unknown' && (
            <p role="status" data-mail-setter-unknown className="text-xs text-fg-secondary">{t('mailSettings.setterUnknown')}</p>
          )}
        </div>
      )}

      <div role="radiogroup" aria-label={t('mailSettings.preset.label')} className="flex flex-wrap gap-4">
        {(['gmail', 'custom'] as const).map(p => (
          <label key={p} className="flex items-center gap-1.5 text-sm text-fg">
            <input type="radio" name="smtp-preset" value={p} checked={preset === p} disabled={busy}
              onChange={() => choosePreset(p)} />
            {t(p === 'gmail' ? 'mailSettings.preset.gmail' : 'mailSettings.preset.custom')}
          </label>
        ))}
      </div>

      {preset === 'gmail' ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row htmlFor="smtp-username" label={t('mailSettings.gmail.address')}>
              <input id="smtp-username" name="smtp-username" type="email" autoComplete="off" className="app-input w-full"
                value={address} onChange={(e) => { setAddress(e.target.value); clearMessages() }}
                placeholder="name@gmail.com" disabled={busy} />
            </Row>
            <Row htmlFor="smtp-password" label={t('mailSettings.gmail.appPassword')}>{passwordInput}</Row>
          </div>
          <p className="text-xs leading-5 text-fg-secondary">{t('mailSettings.gmail.howto')}</p>
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-pending-weak px-3.5 py-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pending" aria-hidden />
            <p className="text-xs leading-5 text-fg">{t('mailSettings.sendsNotice')} {t('mailSettings.gmail.dedicated')}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Row htmlFor="smtp-host" label={t('mailSettings.custom.host')}>
              <input id="smtp-host" name="smtp-host" autoComplete="off" className="app-input w-full font-mono"
                value={host} onChange={(e) => { setHost(e.target.value); clearMessages() }}
                placeholder="smtp.example.com" disabled={busy} />
            </Row>
            <div className="grid grid-cols-2 gap-3">
              <Row htmlFor="smtp-port" label={t('mailSettings.custom.port')}>
                <select id="smtp-port" name="smtp-port" className="app-input w-full" value={port}
                  onChange={(e) => choosePort(e.target.value)} disabled={busy}>
                  {MAIL_PORTS.map(p => <option key={p} value={String(p)}>{p}</option>)}
                </select>
              </Row>
              <Row htmlFor="smtp-secure" label={t('mailSettings.custom.secure')}>
                <select id="smtp-secure" name="smtp-secure" className="app-input w-full" value={secure ? 'ssl' : 'starttls'}
                  onChange={(e) => { setSecure(e.target.value === 'ssl'); clearMessages() }} disabled={busy}>
                  <option value="ssl">{t('mailSettings.custom.ssl')}</option>
                  <option value="starttls">{t('mailSettings.custom.starttls')}</option>
                </select>
              </Row>
            </div>
            <Row htmlFor="smtp-username" label={t('mailSettings.custom.username')}>
              <input id="smtp-username" name="smtp-username" autoComplete="off" className="app-input w-full"
                value={username} onChange={(e) => { setUsername(e.target.value); clearMessages() }} disabled={busy} />
            </Row>
            <Row htmlFor="smtp-password" label={t('mailSettings.custom.password')}>{passwordInput}</Row>
            <Row htmlFor="smtp-from" label={t('mailSettings.custom.from')} hint={t('mailSettings.custom.fromHint')}>
              <input id="smtp-from" name="smtp-from" type="email" autoComplete="off" className="app-input w-full"
                value={fromAddress} onChange={(e) => { setFromAddress(e.target.value); clearMessages() }} disabled={busy} />
            </Row>
          </div>
          <p className="text-xs leading-5 text-fg-secondary">{t('mailSettings.sendsNotice')}</p>
        </div>
      )}

      <p className="text-xs leading-5 text-fg-muted">{t('mailSettings.fromNameNote')}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" data-mail-test icon={<Send className="h-4 w-4" />}
          busy={pending && action === 'test'} disabled={busy && action !== 'test'} onClick={() => run('test')}>
          {pending && action === 'test' ? t('mailSettings.testing') : t('mailSettings.test')}
        </Button>
        <Button variant="primary" data-mail-save icon={<Save className="h-4 w-4" />}
          busy={pending && action === 'save'} disabled={busy && action !== 'save'} onClick={() => run('save')}>
          {pending && action === 'save' ? t('mailSettings.saving') : t('common.save')}
        </Button>
        {saved && (
          <Button variant="ghost" data-mail-delete className="text-danger" icon={<Trash2 className="h-4 w-4" />}
            disabled={busy} onClick={() => { clearMessages(); setConfirming(true) }}>
            {t('mailSettings.delete')}
          </Button>
        )}
        <span className="basis-full text-meta text-fg-muted">{t('mailSettings.testHint')}</span>
      </div>

      {notice && <p role="status" data-mail-notice className="text-sm font-medium text-success">{notice}</p>}
      {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}

      <Modal
        open={confirming}
        onClose={() => { if (!deletePending) setConfirming(false) }}
        title={t('mailSettings.deleteTitle')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={deletePending} onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" data-mail-delete-confirm busy={deletePending} onClick={confirmDelete}>
              {deletePending ? t('mailSettings.deleting') : t('mailSettings.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-fg-secondary">{t('mailSettings.deleteConfirm')}</p>
      </Modal>
    </div>
  )
}
