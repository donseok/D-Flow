'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Send, ShieldAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { TeamMultiSelect, type TeamOption } from '@/components/roster/TeamMultiSelect'
import {
  createProjectInvite, revokeProjectInvite, type InviteRow,
} from '@/app/actions/projectInvites'
import type { ProjectActorView } from '@/lib/domain/authz'
import { canGrantAdmin } from '@/lib/domain/roster'
import { DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, inviteStatusLabel, type InviteStatus } from '@/lib/domain/invites'

type AccessRole = 'admin' | 'member'
/** 합류 시 권한. null = 조회 전용으로 명단에만 오른다. */
const ACCESS_LABEL: Record<AccessRole, string> = { admin: '관리자', member: '멤버' }

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
export function ProjectInviteManager({ projectId, rows, loadError, teamOptions, actorView, timeZone, timeZoneError = null, locale }: {
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
}) {
  const router = useRouter()
  const { toast } = useToast()
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
              title: '초대 메일을 보냈습니다.',
              description: res.alreadyAccount
                ? `${res.row.email} · 이미 계정이 있는 주소라 로그인 후 합류하게 됩니다.`
                : res.row.email,
              variant: 'success',
            }
          : {
              title: '초대는 만들었지만 메일 발송에 실패했습니다. 링크를 복사해 전달해 주세요.',
              description: res.mailError,
              variant: 'info',
            })
        setEmail(''); setRoleLabel('')
        router.refresh()
      } catch {
        setFormError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
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
      setCopyError('링크를 복사하지 못했습니다. 위 칸에서 직접 선택해 복사해 주세요.')
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
        toast({ title: '초대를 취소했습니다.', variant: 'success' })
        router.refresh()
      } catch {
        setRevoking(null)
        setRowErrors(prev => ({ ...prev, [target.id]: '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.' }))
      }
    })
  }

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-fg">초대 링크</h4>

      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-pending-weak px-3.5 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
        <p className="text-xs leading-5 text-fg">
          합류한 사람은 이 프로젝트뿐 아니라 전체 회의록·WBS·이슈·근태를 조회할 수 있습니다. 신뢰할 수 있는 인원에게만 발급하세요.
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <label className="block min-w-[14rem] flex-1">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">이메일</span>
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
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">권한</span>
          <select
            className="app-input w-36"
            aria-label="초대 권한"
            value={accessRole ?? ''}
            onChange={(e) => setAccessRole(e.target.value === '' ? null : e.target.value as AccessRole)}
          >
            <option value="">없음(조회 전용)</option>
            <option value="member">{ACCESS_LABEL.member}</option>
            {canInviteAdmin && <option value="admin">{ACCESS_LABEL.admin}</option>}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">역할 라벨</span>
          <input
            className="app-input w-32"
            aria-label="역할 라벨"
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
            placeholder="예: PL"
          />
        </label>
        <div className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">팀</span>
          <TeamMultiSelect options={teamOptions} value={teamIds} onChange={setTeamIds} label="초대 팀" />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">유효기간(일)</span>
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
          <Send className="h-4 w-4" />{pending ? '보내는 중…' : '초대 보내기'}
        </button>
        <p className="basis-full text-xs leading-5 text-fg-muted">
          합류하면 이 프로젝트 명단에 선택한 팀(첫 팀이 대표)으로 오릅니다. 이미 명단에 있는 사람은 기존 팀이 그대로 남고
          이 팀이 <strong className="font-semibold text-fg-secondary">더해집니다</strong>.
        </p>
      </form>
      {formError && <p role="alert" className="text-sm font-medium text-danger">{formError}</p>}
      {issued?.url && (
        <div data-issued-invite className="space-y-2 rounded-xl border border-border bg-surface-subtle/50 px-3.5 py-3">
          <p className="text-xs leading-5 text-fg-secondary">
            <strong className="font-semibold text-fg">{issued.email}</strong> 초대 링크 —{' '}
            <strong className="font-semibold text-fg">이 링크는 다시 볼 수 없습니다.</strong>{' '}
            메일이 닿지 않았으면 지금 복사해 전달하세요. 다시 보내려면 초대를 취소하고 새로 발급합니다.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              className="app-input h-8 min-w-0 flex-1 font-mono text-xs"
              value={issued.url}
              aria-label="초대 링크"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn btn-ghost h-8 shrink-0 px-3 text-xs" onClick={() => void copyIssued()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '복사됨' : '링크 복사'}
            </button>
            <button type="button" className="btn btn-ghost h-8 shrink-0 px-3 text-xs" onClick={() => setIssued(null)}>
              닫기
            </button>
          </div>
          {copyError ? <p role="alert" className="text-xs font-medium text-danger">{copyError}</p> : null}
        </div>
      )}

      {timeZone === null && (
        <p role="status" data-invite-time-unavailable className="text-xs text-fg-secondary">
          만료·합류 시각을 표시하지 못했습니다 — {timeZoneError ?? '프로젝트 달력 설정을 읽지 못했습니다.'} 초대 발급·취소는 그대로 됩니다.
        </p>
      )}
      {loadError ? (
        <p role="alert" className="text-sm font-medium text-danger">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-muted">발급한 초대가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                <th className="py-2 pr-3">이메일</th>
                <th className="py-2 pr-3">권한</th>
                <th className="py-2 pr-3">팀</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">만료</th>
                <th className="py-2 pr-3">합류</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-border/60 align-top">
                  <td className="py-2.5 pr-3 font-medium text-fg">{row.email}</td>
                  <td className="py-2.5 pr-3 text-fg-secondary">
                    {row.accessRole ? ACCESS_LABEL[row.accessRole] : '조회 전용'}
                    {row.roleLabel && <span className="ml-1.5 chip bg-surface-subtle text-fg-secondary">{row.roleLabel}</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {row.teamCodes.length > 0
                      ? <span className="chip bg-surface-subtle text-fg-secondary">{row.teamCodes.join(', ')}</span>
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
                          <span className="text-xs text-fg-muted">링크는 발급 시 한 번만 표시됩니다</span>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost h-8 px-3 text-xs text-danger"
                          onClick={() => { setRowErrors(prev => ({ ...prev, [row.id]: '' })); setRevoking(row) }}
                        >
                          취소
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
        eyebrow="Invite"
        title="초대 취소"
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-ghost" disabled={revokePending} onClick={() => setRevoking(null)}>
              닫기
            </button>
            <button type="button" className="btn btn-primary" disabled={revokePending} onClick={confirmRevoke}>
              {revokePending ? '취소 중…' : '초대 취소'}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-secondary">
          이 초대를 취소할까요? 이미 합류한 사람은 영향받지 않습니다.
        </p>
        {/* 만료 행에서 '취소'는 무의미해 보인다 — 왜 눌러야 하는지 그 자리에서 말해 준다. */}
        {revoking?.status === 'expired' && (
          <p className="mt-2 text-sm text-fg-secondary">
            만료된 초대가 남아 있는 동안에는 같은 주소로 다시 보낼 수 없습니다. 취소하면 재발급할 수 있습니다.
          </p>
        )}
        {revoking && <p className="mt-2 text-sm font-semibold text-fg">{revoking.email}</p>}
      </Modal>
    </div>
  )
}
