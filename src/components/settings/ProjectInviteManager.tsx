'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Copy, Send, ShieldAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useTeams } from '@/components/app/TeamsProvider'
import {
  createProjectInvite, revokeProjectInvite, type InviteRow,
} from '@/app/actions/projectInvites'
import { DEFAULT_INVITE_DAYS, MAX_INVITE_DAYS, inviteStatusLabel, type InviteStatus } from '@/lib/domain/invites'

const STATUS_CLASS: Record<InviteStatus, string> = {
  active: 'bg-done-weak text-done',
  redeemed: 'bg-brand-weak text-brand',
  revoked: 'bg-surface-2 text-ink-muted',
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

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short',
  }).format(d)
}

/**
 * 프로젝트 초대 발급·취소.
 *
 * 링크는 서버가 조립해 내려준 url 을 그대로 쓴다 — 여기서 window.location.origin 을 읽으면
 * 서버 프리렌더에서 죽고, 메일에 실린 링크와 화면의 링크가 갈릴 수도 있다.
 * DB 에는 토큰 해시만 있어(0003) 링크는 발급 응답에서 한 번만 온다 — 목록 행에는 링크가 없다.
 * 목록 조회가 실패했으면 loadError 로 받아 그 사실을 드러낸다: '초대 0건'으로 보이면
 * 관리자가 같은 주소로 다시 발급하다 중복 제약에 이유 없이 막힌다.
 */
export function ProjectInviteManager({ projectId, rows, loadError }: {
  projectId: string
  rows: InviteRow[]
  loadError: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  // /p/[projectId] 레이아웃이 이 프로젝트의 팀(id 포함)을 주입한다 — 초대는 팀 id 로 저장한다.
  const teamOptions = useTeams()
  const teamHintId = useId()
  const [email, setEmail] = useState('')
  // '' = 팀 없이 초대(명단에는 오르되 팀은 관리자가 나중에 정한다).
  const [teamId, setTeamId] = useState<string>(teamOptions[0]?.id ?? '')
  // 발급 직후의 링크 — 한 번만 온다(목록에서는 다시 만들 수 없다). 다음 발급·새로고침 전까지 보여 준다.
  const [issued, setIssued] = useState<InviteRow | null>(null)
  const [days, setDays] = useState(String(DEFAULT_INVITE_DAYS))
  const [formError, setFormError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<InviteRow | null>(null)
  const [pending, startTransition] = useTransition()
  const [revokePending, startRevoke] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    startTransition(async () => {
      try {
        // days 는 폼 문자열이라 빈 값·소수를 그대로 넘긴다 — 판정은 서버 한 곳에서만 한다.
        // 옛 화면 계약 그대로 멤버 권한으로 초대한다(권한·역할 라벨·여러 팀 선택은 Phase B 초대 UI).
        const res = await createProjectInvite(projectId, {
          email, accessRole: 'member', teamIds: teamId ? [teamId] : [], days: Number(days),
        })
        if (!res.ok) { setFormError(res.error); return }
        setIssued(res.row)
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
        setEmail('')
        router.refresh()
      } catch {
        setFormError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  async function copyLink(row: InviteRow) {
    if (!row.url) return
    try {
      await navigator.clipboard.writeText(row.url)
      setCopiedId(row.id)
      setTimeout(() => setCopiedId(id => (id === row.id ? null : id)), COPIED_MS)
    } catch {
      setRowErrors(prev => ({ ...prev, [row.id]: '링크를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.' }))
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
      <h4 className="text-sm font-semibold text-ink">초대 링크</h4>

      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-pending-weak px-3.5 py-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-pending" />
        <p className="text-xs leading-5 text-ink">
          합류한 사람은 이 프로젝트뿐 아니라 전체 회의록·WBS·이슈·근태를 조회할 수 있습니다. 신뢰할 수 있는 인원에게만 발급하세요.
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">이메일</span>
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
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">팀</span>
          <select
            className="app-input sm:w-32"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            aria-describedby={teamHintId}
          >
            <option value="">팀 없음</option>
            {teamOptions.map(t => <option key={t.id} value={t.id}>{t.code}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink-muted">유효기간(일)</span>
          <input
            type="number"
            className="app-input sm:w-24"
            value={days}
            min={1}
            max={MAX_INVITE_DAYS}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          <Send className="h-4 w-4" />{pending ? '보내는 중…' : '초대 보내기'}
        </button>
        {/* 힌트는 select 아래가 아니라 폼 전체 폭의 한 줄로 둔다 — items-end 그리드에서
            한 칸만 높아지면 입력들의 밑선이 어긋난다. 연결은 aria-describedby 가 한다. */}
        <p id={teamHintId} className="text-xs leading-5 text-ink-subtle sm:col-span-4">
          합류하면 이 프로젝트 명단에 선택한 팀으로 오릅니다. 이미 명단에 있는 사람은 기존 팀이 그대로 남고
          이 팀이 <strong className="font-semibold text-ink-muted">더해집니다</strong>.
        </p>
      </form>
      {formError && <p role="alert" className="text-sm font-medium text-delayed">{formError}</p>}
      {issued?.url && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/50 px-3.5 py-3">
          <p className="min-w-0 flex-1 text-xs leading-5 text-ink-muted">
            <strong className="font-semibold text-ink">{issued.email}</strong> 초대 링크 —
            링크는 발급 시 한 번만 표시됩니다. 메일이 닿지 않았으면 지금 복사해 전달하세요.
          </p>
          <button type="button" className="btn btn-ghost h-8 px-3 text-xs" onClick={() => void copyLink(issued)}>
            {copiedId === issued.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedId === issued.id ? '복사됨' : '링크 복사'}
          </button>
          {rowErrors[issued.id] ? (
            <p role="alert" className="w-full text-xs font-medium text-delayed">{rowErrors[issued.id]}</p>
          ) : null}
        </div>
      )}

      {loadError ? (
        <p role="alert" className="text-sm font-medium text-delayed">{loadError}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-subtle">발급한 초대가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                <th className="py-2 pr-3">이메일</th>
                <th className="py-2 pr-3">팀</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">만료</th>
                <th className="py-2 pr-3">합류</th>
                <th className="py-2 pr-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-line/60 align-top">
                  <td className="py-2.5 pr-3 font-medium text-ink">{row.email}</td>
                  <td className="py-2.5 pr-3">
                    {row.teamCodes.length > 0
                      ? <span className="chip bg-surface-2 text-ink-muted">{row.teamCodes.join(', ')}</span>
                      : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`badge ${STATUS_CLASS[row.status]}`}>{inviteStatusLabel(row.status)}</span>
                  </td>
                  <td className="py-2.5 pr-3 tabular-nums text-ink-muted">{fmtDateTime(row.expiresAt)}</td>
                  <td className="py-2.5 pr-3 tabular-nums text-ink-muted">
                    {row.redeemedAt ? fmtDateTime(row.redeemedAt) : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {canRevoke(row.status) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {/* 목록 행에는 링크가 없다(토큰 해시만 저장) — 발급 직후 위 상자에서만 복사할 수 있다. */}
                        {row.url ? (
                          <button
                            type="button"
                            className="btn btn-ghost h-8 px-3 text-xs"
                            onClick={() => void copyLink(row)}
                          >
                            {copiedId === row.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copiedId === row.id ? '복사됨' : '링크 복사'}
                          </button>
                        ) : row.status === 'active' ? (
                          <span className="text-xs text-ink-subtle">링크는 발급 시 한 번만 표시됩니다</span>
                        ) : null}
                        <button
                          type="button"
                          className="btn btn-ghost h-8 px-3 text-xs text-delayed"
                          onClick={() => { setRowErrors(prev => ({ ...prev, [row.id]: '' })); setRevoking(row) }}
                        >
                          취소
                        </button>
                      </div>
                    )}
                    {rowErrors[row.id] ? (
                      <p role="alert" className="mt-1 text-xs font-medium text-delayed">{rowErrors[row.id]}</p>
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
        <p className="text-sm text-ink-muted">
          이 초대를 취소할까요? 이미 합류한 사람은 영향받지 않습니다.
        </p>
        {/* 만료 행에서 '취소'는 무의미해 보인다 — 왜 눌러야 하는지 그 자리에서 말해 준다. */}
        {revoking?.status === 'expired' && (
          <p className="mt-2 text-sm text-ink-muted">
            만료된 초대가 남아 있는 동안에는 같은 주소로 다시 보낼 수 없습니다. 취소하면 재발급할 수 있습니다.
          </p>
        )}
        {revoking && <p className="mt-2 text-sm font-semibold text-ink">{revoking.email}</p>}
      </Modal>
    </div>
  )
}
