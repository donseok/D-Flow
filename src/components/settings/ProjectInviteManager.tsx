'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Send, ShieldAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useTeamLabel } from '@/components/app/TeamsProvider'
import { TeamMultiSelect, type TeamOption } from '@/components/roster/TeamMultiSelect'
import {
  createProjectInvite, revokeProjectInvite, type InviteRow,
} from '@/app/actions/projectInvites'
import type { ProjectActorView } from '@/lib/domain/authz'
import { canGrantAdmin } from '@/lib/domain/roster'
import { DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, inviteStatusLabel, type InviteStatus } from '@/lib/domain/invites'
import type { DictKey } from '@/lib/i18n/dict'

type AccessRole = 'admin' | 'member'
/** 합류 시 권한. null = 조회 전용으로 명단에만 오른다. */
const ACCESS_LABEL: Record<AccessRole, DictKey> = { admin: 'wbs.roleAdmin', member: 'att.col.member' }

const STATUS_CLASS: Record<InviteStatus, string> = {
  active: 'bg-success-weak text-success',
  redeemed: 'bg-action-soft text-action',
  revoked: 'bg-surface-subtle text-fg-secondary',
  expired: 'bg-pending-weak text-pending',
}

/** 복사 성공 아이콘 유지 시간 — 눈으로 알아볼 최소치. */
const COPIED_MS = 1500

/**
 * 취소 버튼을 노출할 상태.
 *
 * 만료 행에도 필요하다 — 부분 유니크는 만료 여부를 보지 않으므로 만료된 초대가 남아 있으면
 * 같은 주소로 다시 보낼 수 없다(actions 의 ERR_DUP_EXPIRED 가 "목록에서 취소한 뒤"라고
 * 안내한다). 여기서 만료를 빼면 그 안내가 가리키는 버튼이 화면에 없는 막다른 길이 된다.
 */
function canRevoke(s: InviteStatus): boolean {
  return s === 'active' || s === 'expired'
}

function fmtDateTime(iso: string, timeZone: string | null, locale = 'ko-KR'): string {
  const d = new Date(iso)
  if (timeZone === null || Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(d)
}

/**
 * 프로젝트 초대 발급·취소. 폼은 이메일·권한·역할 라벨·팀(여러 개, 첫 팀이 대표 후보)·유효기간.
 *
 * 링크는 서버가 조립해 내려준 url 을 그대로 쓴다 — 여기서 window.location.origin 을 읽으면
 * 서버 프리렌더에서 죽고, 메일에 실린 링크와 화면의 링크가 갈릴 수도 있다.
 * DB 에는 토큰 해시만 있어(0003) 링크는 발급 응답에서 한 번만 온다 — 목록 행에는 링크가 없다.
 * 목록 조회가 실패했으면 loadError 로 받아 그 사실을 드러낸다: '초대 0건'으로 보이면
 * 관리자가 같은 주소로 다시 발급하다 중복 제약에 이유 없이 막힌다.
 */
export function ProjectInviteManager({ projectId, rows, loadError, teamOptions, actorView, timeZone, timeZoneError = null, locale, domainNotice = null }: {
  projectId: string
  rows: InviteRow[]
  loadError: string | null
  /** 이 프로젝트에서 고를 수 있는 활성 팀 — 초대는 팀 id 로 저장한다. */
  teamOptions: readonly TeamOption[]
  actorView: ProjectActorView | null
  /** 만료·합류 시각을 찍을 시간대(프로젝트 calendar.timezone) — 서버가 내려준다. null 이면 달력을 읽지 못한 것 —
   *  발급·취소는 달력과 무관하게 그대로 쓰고 시각 칸만 '—' + timeZoneError 사유(A-4 리뷰 N6) */
  timeZone: string | null
  /** timeZone 이 null 인 까닭(설정 손상 키·조회 실패 문구) */
  timeZoneError?: string | null
  /** 시각 포맷의 locale — 없으면 'ko-KR' */
  locale?: string
  /** 초대 허용 도메인이 비어 있다(지금 보내면 어떤 주소든 거부된다) — 거부되기 전에 미리 알린다. settingsHref 는 워크스페이스 관리자에게만
   *  (그 설정을 고칠 수 있는 사람) 싣고, 아니면 null 이라 관리자에게 요청하라고 안내한다. 도메인이 있거나 읽지 못했으면 prop 자체가 null */
  domainNotice?: { settingsHref: string | null } | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const teamLabelOf = useTeamLabel()
  const { t } = useLocale()
  // 관리자 초대는 그 프로젝트 워크스페이스의 관리자만 — createProjectInvite 의 워크스페이스 관리자 가드(SP2)와 같은 판정.
  const canInviteAdmin = canGrantAdmin(actorView)
  const [email, setEmail] = useState('')
  const [accessRole, setAccessRole] = useState<AccessRole | null>('member')
  const [roleLabel, setRoleLabel] = useState('')
  // 빈 배열 = 팀 없이 초대(명단에는 오르되 팀은 관리자가 나중에 정한다). 첫 원소가 대표 팀 후보.
  const [teamIds, setTeamIds] = useState<string[]>([])
  // 발급 직후의 링크 — 한 번만 온다(목록에서는 다시 만들 수 없다). 다음 발급·새로고침 전까지 보여 준다.
  const [issued, setIssued] = useState<InviteRow | null>(null)
  const [days, setDays] = useState(String(DEFAULT_INVITE_DAYS))
  const [formError, setFormError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<InviteRow | null>(null)
  const [pending, startTransition] = useTransition()
  const [revokePending, startRevoke] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    startTransition(async () => {
      try {
        // days 는 폼 문자열이라 빈 값·소수를 그대로 넘긴다 — 판정은 서버 한 곳에서만 한다.
        const res = await createProjectInvite(projectId, {
          email, accessRole, roleLabel: roleLabel.trim() || null, teamIds, days: Number(days),
        })
        if (!res.ok) { setFormError(res.error); return }
        setIssued(res.row)
        setCopied(false); setCopyError(null)
        toast(res.mailed
          ? {
              title: t('settings.invite.sent'),
              description: res.alreadyAccount
                ? t('settings.invite.existingAccount').replace('{email}', String(res.row.email))
                : res.row.email,
              variant: 'success',
            }
          : {
              title: t('settings.invite.mailFailed'),
              description: res.mailError,
              variant: 'info',
            })
        setEmail(''); setRoleLabel('')
        router.refresh()
      } catch {
        setFormError(t('wsAccounts.requestFailed'))
      }
    })
  }

  async function copyIssued() {
    if (!issued?.url) return
    try {
      await navigator.clipboard.writeText(issued.url)
      setCopied(true); setCopyError(null)
      setTimeout(() => setCopied(false), COPIED_MS)
    } catch {
      setCopyError(t('settings.invite.copyFailed'))
    }
  }

  function confirmRevoke() {
    const target = revoking
    if (!target) return
    setRowErrors(prev => ({ ...prev, [target.id]: '' }))
    startRevoke(async () => {
      try {
        const res = await revokeProjectInvite(projectId, target.id)
        // 성공이든 실패든 모달은 닫는다 — 실패 사유는 그 행 아래에 남겨야 보인다.
        setRevoking(null)
        if (!res.ok) { setRowErrors(prev => ({ ...prev, [target.id]: res.error })); return }
        toast({ title: t('settings.invite.revoked'), variant: 'success' })
        router.refresh()
      } catch {
        setRevoking(null)
        setRowErrors(prev => ({ ...prev, [target.id]: t('wsAccounts.requestFailed') }))
      }
    })
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-fg">{t('settings.invite.linkTitle')}</h4>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-pending-weak px-3.5 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
        <p className="text-xs leading-5 text-fg">
          {t('settings.invite.trustNote')}
        </p>
      </div>

      {domainNotice && (
        <div role="status" data-invite-domain-notice className="flex items-start gap-2.5 rounded-xl border border-border bg-warning-weak px-3.5 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs leading-5 text-fg">
            {t(domainNotice.settingsHref ? 'members.invite.noDomainsAdmin' : 'members.invite.noDomainsAsk')}
            {domainNotice.settingsHref && (
              <>
                {' '}
                <a href={domainNotice.settingsHref} className="font-semibold text-action underline underline-offset-2 hover:text-action-hover">
                  {t('members.invite.openWorkspaceSettings')}
                </a>
              </>
            )}
          </p>
        </div>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[14rem] flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('login.email')}</span>
          <input
            type="email"
            className="app-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="off"
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('settings.invite.access')}</span>
          <select
            className="app-input w-36"
            aria-label={t('settings.invite.accessAria')}
            value={accessRole ?? ''}
            onChange={(e) => setAccessRole(e.target.value === '' ? null : e.target.value as AccessRole)}
          >
            <option value="">{t('settings.invite.viewOnlyOption')}</option>
            <option value="member">{t(ACCESS_LABEL.member)}</option>
            {canInviteAdmin && <option value="admin">{t(ACCESS_LABEL.admin)}</option>}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('settings.invite.roleLabel')}</span>
          <input
            className="app-input w-32"
            aria-label={t('settings.invite.roleLabel')}
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
            placeholder={t('settings.invite.roleLabelPh')}
          />
        </label>
        <div className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('att.col.team')}</span>
          <TeamMultiSelect options={teamOptions} value={teamIds} onChange={setTeamIds} label={t('settings.invite.teamsAria')} />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('settings.invite.expiryDays')}</span>
          <input
            type="number"
            className="app-input w-24"
            value={days}
            min={1}
            max={MAX_INVITE_DAYS}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Send className="h-4 w-4" />{pending ? t('forgot.submitting') : t('settings.invite.send')}
        </button>
        <p className="basis-full text-xs leading-5 text-fg-muted">
          {t('settings.invite.joinNote')} <strong className="font-semibold text-fg-secondary">{t('settings.invite.joinNoteAdded')}</strong>.
        </p>
      </form>
      {formError && <p role="alert" className="text-sm font-medium text-danger">{formError}</p>}
      {issued?.url && (
        <div data-issued-invite className="space-y-2 rounded-xl border border-border bg-surface-subtle/50 px-3.5 py-3">
          <p className="text-xs leading-5 text-fg-secondary">
            <strong className="font-semibold text-fg">{issued.email}</strong> {t('settings.invite.linkOf')}{' '}
            <strong className="font-semibold text-fg">{t('settings.invite.linkOnce')}</strong>{' '}
            {t('settings.invite.linkCopyNow')}
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              className="app-input h-8 min-w-0 flex-1 font-mono text-xs"
              value={issued.url}
              aria-label={t('settings.invite.linkTitle')}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-ghost h-8 shrink-0 px-3 text-xs" onClick={() => void copyIssued()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t('settings.invite.copied') : t('settings.invite.copyLink')}
            </button>
            <button type="button" className="btn btn-ghost h-8 shrink-0 px-3 text-xs" onClick={() => setIssued(null)}>
              {t('common.close')}
            </button>
          </div>
          {copyError ? <p role="alert" className="text-xs font-medium text-danger">{copyError}</p> : null}
        </div>
      )}

      {timeZone === null && (
        <p role="status" data-invite-time-unavailable className="text-xs text-fg-secondary">
          {t('settings.invite.timeUnavailable')} {timeZoneError ?? t('settings.invite.calendarUnreadable')} {t('settings.invite.timeUnavailableTail')}
        </p>
      )}
      {loadError ? (
        <p role="alert" className="text-sm font-medium text-danger">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('settings.invite.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
                <th className="py-2 pr-3">{t('login.email')}</th>
                <th className="py-2 pr-3">{t('settings.invite.access')}</th>
                <th className="py-2 pr-3">{t('att.col.team')}</th>
                <th className="py-2 pr-3">{t('issue.col.status')}</th>
                <th className="py-2 pr-3">{t('settings.invite.colExpires')}</th>
                <th className="py-2 pr-3">{t('settings.invite.colJoined')}</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-3 font-medium text-fg">{row.email}</td>
                  <td className="py-2.5 pr-3 text-fg-secondary">
                    {row.accessRole ? t(ACCESS_LABEL[row.accessRole]) : t('settings.invite.viewOnly')}
                    {row.roleLabel && <span className="ml-1.5 chip bg-surface-subtle text-fg-secondary">{row.roleLabel}</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {row.teamCodes.length > 0
                      ? <span className="chip bg-surface-subtle text-fg-secondary">{row.teamCodes.map(teamLabelOf).join(', ')}</span>
                      : <span className="text-fg-muted">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`badge ${STATUS_CLASS[row.status]}`}>{inviteStatusLabel(row.status)}</span>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-fg-secondary">{fmtDateTime(row.expiresAt, timeZone, locale)}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-fg-secondary">
                    {row.redeemedAt ? fmtDateTime(row.redeemedAt, timeZone, locale) : <span className="text-fg-muted">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {canRevoke(row.status) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 목록 행에는 링크가 없다(토큰 해시만 저장) — 발급 직후 위 상자에서만 복사할 수 있다. */}
                        {row.status === 'active' && (
                          <span className="text-xs text-fg-muted">{t('settings.invite.linkShownOnce')}</span>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost h-8 px-3 text-xs text-danger"
                          onClick={() => { setRowErrors(prev => ({ ...prev, [row.id]: '' })); setRevoking(row) }}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    )}
                    {rowErrors[row.id] ? (
                      <p role="alert" className="mt-1 text-xs font-medium text-danger">{rowErrors[row.id]}</p>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!revoking}
        onClose={() => { if (!revokePending) setRevoking(null) }}
        title={t('settings.invite.cancelInvite')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={revokePending} onClick={() => setRevoking(null)}>
              {t('common.close')}
            </button>
            <button type="button" className="btn btn-primary" disabled={revokePending} onClick={confirmRevoke}>
              {revokePending ? t('settings.invite.cancelling') : t('settings.invite.cancelInvite')}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-secondary">
          {t('settings.invite.cancelConfirm')}
        </p>
        {/* 만료 행에서 '취소'는 무의미해 보인다 — 왜 눌러야 하는지 그 자리에서 말해 준다. */}
        {revoking?.status === 'expired' && (
          <p className="mt-2 text-sm text-fg-secondary">
            {t('settings.invite.expiredNote')}
          </p>
        )}
        {revoking && <p className="mt-2 text-sm font-semibold text-fg">{revoking.email}</p>}
      </Modal>
    </div>
  )
}
