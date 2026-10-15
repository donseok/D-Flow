'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, ShieldOff, Search, UserPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { stampIn } from '@/lib/domain/calendar'
import { setPlatformAdmin } from '@/app/actions/accounts'
import { findAccountByEmail, type PlatformAdminCandidate, type PlatformAdminRow } from '@/app/actions/platformAdmins'

/** 플랫폼 관리자 표 + 해제 + 이메일로 찾아 지정. 판정은 전부 서버(setPlatformAdmin·RPC·트리거)가 다시 한다 — 화면의 잠금은 어포던스다. */
export function PlatformAdminsManager({ rows, currentUserId, accountsHref, timeZone }: {
  rows: PlatformAdminRow[]
  /** 보는 사람 — 본인 행의 해제를 잠근다(액션도 거부) */
  currentUserId: string
  /** 없는 계정 안내의 멤버·초대 링크. null = 링크 없이 문구만 */
  accountsHref: string | null
  /**
   * 지정 일시를 보이는 IANA tz — 페이지가 워크스페이스 달력(설정)에서 읽어 넘긴다. 코드에 고정 리터럴을 두지 않는다(런타임 상수 가드, 스펙 D45).
   * UTC 날짜를 그대로 자르면 한국 시간 0~9시 지정이 전날로 보인다 — 머리에 tz 이름을 보여 어느 시간대의 시각인지 밝힌다
   */
  timeZone: string
}) {
  const { t } = useLocale()
  const [unsetting, setUnsetting] = useState<PlatformAdminRow | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <h2 className="text-sm font-semibold text-fg">{t('platformAdmins.listTitle').replace('{n}', String(rows.length))}</h2>
        <button onClick={() => setAdding(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" />{t('platformAdmins.add')}</button>
      </div>
      <div className="overflow-x-auto p-5 sm:p-6">
        <table className="data-table w-full min-w-[720px] text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">{t('platformAdmins.colName')}</th>
              <th className="py-2 pr-3">{t('platformAdmins.colEmail')}</th>
              <th className="py-2 pr-3">{t('platformAdmins.colGrantedBy')}</th>
              <th className="py-2 pr-3">{t('platformAdmins.colGrantedAt')} <span className="font-normal text-fg-muted">({timeZone})</span></th>
              <th className="py-2 pr-3 text-right">{t('platformAdmins.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.userId === currentUserId
              return (
                <tr key={r.userId} data-platform-admin-row={r.userId} className="border-b border-border/60">
                  <td className="py-2.5 pr-3 font-medium text-fg">{r.name ?? '—'}</td>
                  <td className="py-2.5 pr-3 text-fg-secondary">{r.email ?? t('platformAdmins.noProfile')}</td>
                  <td className="py-2.5 pr-3 text-fg-secondary">{r.grantedBy ? (r.grantedBy.name ?? r.grantedBy.email ?? t('platformAdmins.noProfile')) : '—'}</td>
                  <td className="py-2.5 pr-3 text-fg-muted">{stampIn(timeZone, r.grantedAt)}</td>
                  <td className="py-2.5 pr-3">
                    <div className="flex justify-end">
                      <button
                        data-platform-admin-unset
                        className="btn btn-ghost btn-sm disabled:opacity-50"
                        disabled={isSelf}
                        title={isSelf ? t('wsAccounts.selfPlatformHint') : t('platformAdmins.unsetTitle')}
                        onClick={() => setUnsetting(r)}
                      >
                        <ShieldOff className="h-3.5 w-3.5" />{t('platformAdmins.unset')}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <UnsetModal row={unsetting} onClose={() => setUnsetting(null)} />
      <AddModal open={adding} onClose={() => setAdding(false)} accountsHref={accountsHref} />
    </div>
  )
}

/**
 * 지정·해제 한 번 — 성공·거부·예외 모두 refresh 한다(거부는 표가 낡았다는 신호다: 다른 관리자가 먼저 바꿨거나 마지막 한 명이 됐다. 예외는 결과를 모르니 다시 읽는다).
 * done(= 모달 닫기)은 **성공했을 때만** 부른다 — 거부·예외면 모달과 찾은 결과를 남겨 사유(토스트)를 읽고 다시 누르거나 취소할 수 있게 한다.
 */
function useToggle() {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const run = (userId: string, label: string, value: boolean, done: () => void) => startTransition(async () => {
    let succeeded = false
    try {
      const res = await setPlatformAdmin(userId, value)
      if (res.ok) {
        succeeded = true
        toast({ title: value ? t('wsAccounts.platform.setDone') : t('wsAccounts.platform.unsetDone'), description: label, variant: 'success' })
      } else toast({ title: t('wsAccounts.changeFailed'), description: res.error, variant: 'error' })
    } catch {
      toast({ title: t('wsAccounts.changeFailed'), description: t('wsAccounts.requestFailedShort'), variant: 'error' })
    } finally {
      router.refresh() // 성공·거부·예외 어느 쪽이든 — 예외도 서버에서 반영됐을 수 있어 낡은 표를 남기지 않는다
      if (succeeded) done()
    }
  })
  return { pending, run }
}

function UnsetModal({ row, onClose }: { row: PlatformAdminRow | null; onClose: () => void }) {
  const { t } = useLocale()
  const { pending, run } = useToggle()
  const label = row?.email ?? row?.userId ?? ''
  return (
    <Modal
      open={row !== null}
      onClose={() => { if (!pending) onClose() }}
      size="sm"
      title={t('platformAdmins.unsetTitle')}
      footer={
        <>
          <button className="btn btn-ghost" disabled={pending} onClick={onClose}>{t('common.cancel')}</button>
          <button data-platform-admin-confirm className="btn btn-primary" disabled={pending || !row}
            onClick={() => row && run(row.userId, label, false, onClose)}>{t('platformAdmins.unset')}</button>
        </>
      }
    >
      <p className="text-sm leading-6 text-fg-secondary">
        <strong className="break-all text-fg">{label}</strong>{t('wsAccounts.platform.unsetConfirm')}
      </p>
    </Modal>
  )
}

type Lookup = { kind: 'idle' } | { kind: 'found'; account: PlatformAdminCandidate } | { kind: 'none' } | { kind: 'error'; message: string }

function AddModal({ open, onClose, accountsHref }: { open: boolean; onClose: () => void; accountsHref: string | null }) {
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' })
  const [finding, startFind] = useTransition()
  const { pending, run } = useToggle()
  const emailId = useId()
  const emailRef = useRef<HTMLInputElement>(null)
  const wasFinding = useRef(false)

  useEffect(() => { if (open) { setEmail(''); setLookup({ kind: 'idle' }) } }, [open])
  // 찾는 동안 입력이 disabled 라 포커스가 body 로 빠진다 — 찾기가 끝나 입력이 다시 enabled 된 커밋 뒤에 되돌린다(성공·없음·오류·예외 모두)
  useEffect(() => {
    if (wasFinding.current && !finding) emailRef.current?.focus()
    wasFinding.current = finding
  }, [finding])

  const find = () => startFind(async () => {
    try {
      const res = await findAccountByEmail(email)
      if (!res.ok) setLookup({ kind: 'error', message: res.error })
      else setLookup(res.account ? { kind: 'found', account: res.account } : { kind: 'none' })
    } catch {
      setLookup({ kind: 'error', message: t('wsAccounts.requestFailedShort') })
    }
  })
  const busy = finding || pending
  const found = lookup.kind === 'found' ? lookup.account : null

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose() }}
      title={t('platformAdmins.add')}
      footer={<button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>}
    >
      <div>
        <div>
          {/* 라벨은 입력만 잇는다 — 찾기 버튼이 같은 label 안에 있으면 입력의 접근 이름이 '계정 이메일 찾기'가 된다 */}
          <label htmlFor={emailId} className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('platformAdmins.emailLabel')}</label>
          <div className="flex gap-2">
            <input id={emailId} ref={emailRef} data-platform-admin-email className="app-input" type="email" value={email} autoFocus disabled={finding}
              onChange={(e) => { setEmail(e.target.value); setLookup({ kind: 'idle' }) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && !busy) find() }} placeholder="user@company.com" />
            <button className="btn btn-ghost shrink-0" disabled={busy || !email.trim()} onClick={find}>
              <Search className="h-4 w-4" />{finding ? t('platformAdmins.finding') : t('platformAdmins.find')}
            </button>
          </div>
        </div>

        {lookup.kind === 'error' && <p role="alert" className="mt-4 text-sm font-medium text-danger">{lookup.message}</p>}

        {/* 찾기 결과(없음·찾음·이미 관리자)는 상태 영역 — 화면을 보지 않아도 결과가 읽힌다. 영역은 늘 있어야 바뀐 내용이 알려진다.
            간격은 결과 블록의 mt-4 가 낸다(빈 영역이 여백을 만들지 않게 space-y 를 쓰지 않는다) */}
        <div role="status">
          {lookup.kind === 'none' && (
            <div className="mt-4 space-y-2 text-sm text-fg-secondary">
              <p>{t('platformAdmins.notFound')}</p>
              {accountsHref && <Link href={accountsHref} className="font-medium text-action underline">{t('platformAdmins.goAccounts')}</Link>}
            </div>
          )}

          {found && (
            <div className="mt-4 space-y-3 rounded-(--radius-panel) border border-border p-4 text-sm">
              <div>
                <p className="font-semibold text-fg">{found.name}</p>
                <p className="break-all text-fg-secondary">{found.email}</p>
              </div>
              <ul className="space-y-0.5 text-fg-secondary">
                {found.workspaces.length === 0
                  ? <li>{t('platformAdmins.noWorkspaces')}</li>
                  : found.workspaces.map((w, i) => (
                    <li key={`${w.name}-${i}`}>
                      {w.name}{w.archived ? ` ${t('platformAdmins.archived')}` : ''} · {t(w.role === 'admin' ? 'wsAccounts.role.admin' : 'wsAccounts.role.member')}
                    </li>
                  ))}
              </ul>
              {found.isPlatformAdmin ? (
                <p className="font-medium text-fg">{t('platformAdmins.already')}</p>
              ) : (
                <>
                  <p className="leading-6 text-fg-secondary">
                    <strong className="break-all text-fg">{found.email}</strong>{t('wsAccounts.platform.setConfirm')}
                  </p>
                  <button data-platform-admin-grant className="btn btn-primary" disabled={busy}
                    onClick={() => run(found.userId, found.email, true, onClose)}>
                    <ShieldCheck className="h-4 w-4" />{t('platformAdmins.grant')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
