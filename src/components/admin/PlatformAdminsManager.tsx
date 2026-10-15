'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShieldCheck, ShieldOff, Search, UserPlus } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { setPlatformAdmin } from '@/app/actions/accounts'
import { findAccountByEmail, type PlatformAdminCandidate, type PlatformAdminRow } from '@/app/actions/platformAdmins'

/** 플랫폼 관리자 표 + 해제 + 이메일로 찾아 지정. 판정은 전부 서버(setPlatformAdmin·RPC·트리거)가 다시 한다 — 화면의 잠금은 어포던스다. */
export function PlatformAdminsManager({ rows, currentUserId, accountsHref }: {
  rows: PlatformAdminRow[]
  /** 보는 사람 — 본인 행의 해제를 잠근다(액션도 거부) */
  currentUserId: string
  /** 없는 계정 안내의 멤버·초대 링크. null = 링크 없이 문구만 */
  accountsHref: string | null
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
              <th className="py-2 pr-3">{t('platformAdmins.colGrantedAt')}</th>
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
                  <td className="py-2.5 pr-3 text-fg-muted">{r.grantedAt.slice(0, 10)}</td>
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

/** 지정·해제 한 번 — 성공·거부·예외 모두 refresh 한다(거부는 표가 낡았다는 신호다: 다른 관리자가 먼저 바꿨거나 마지막 한 명이 됐다. 예외는 결과를 모르니 다시 읽는다) */
function useToggle() {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const run = (userId: string, label: string, value: boolean, done: () => void) => startTransition(async () => {
    try {
      const res = await setPlatformAdmin(userId, value)
      if (res.ok) toast({ title: value ? t('wsAccounts.platform.setDone') : t('wsAccounts.platform.unsetDone'), description: label, variant: 'success' })
      else toast({ title: t('wsAccounts.changeFailed'), description: res.error, variant: 'error' })
    } catch {
      toast({ title: t('wsAccounts.changeFailed'), description: t('wsAccounts.requestFailedShort'), variant: 'error' })
    } finally {
      router.refresh() // 성공·거부·예외 어느 쪽이든 — 예외도 서버에서 반영됐을 수 있어 낡은 표를 남기지 않는다
      done()
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

  useEffect(() => { if (open) { setEmail(''); setLookup({ kind: 'idle' }) } }, [open])

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

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose() }}
      title={t('platformAdmins.add')}
      footer={<button className="btn btn-ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</button>}
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('platformAdmins.emailLabel')}</span>
          <div className="flex gap-2">
            <input data-platform-admin-email className="app-input" type="email" value={email} autoFocus disabled={finding}
              onChange={(e) => { setEmail(e.target.value); setLookup({ kind: 'idle' }) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && !busy) find() }} placeholder="user@company.com" />
            <button className="btn btn-ghost shrink-0" disabled={busy || !email.trim()} onClick={find}>
              <Search className="h-4 w-4" />{finding ? t('platformAdmins.finding') : t('platformAdmins.find')}
            </button>
          </div>
        </label>

        {lookup.kind === 'error' && <p role="alert" className="text-sm font-medium text-danger">{lookup.message}</p>}

        {lookup.kind === 'none' && (
          <div className="space-y-2 text-sm text-fg-secondary">
            <p>{t('platformAdmins.notFound')}</p>
            {accountsHref && <Link href={accountsHref} className="font-medium text-action underline">{t('platformAdmins.goAccounts')}</Link>}
          </div>
        )}

        {lookup.kind === 'found' && (
          <div className="space-y-3 rounded-(--radius-panel) border border-border p-4 text-sm">
            <div>
              <p className="font-semibold text-fg">{lookup.account.name}</p>
              <p className="break-all text-fg-secondary">{lookup.account.email}</p>
            </div>
            <ul className="space-y-0.5 text-fg-secondary">
              {lookup.account.workspaces.length === 0
                ? <li>{t('platformAdmins.noWorkspaces')}</li>
                : lookup.account.workspaces.map((w, i) => (
                  <li key={`${w.name}-${i}`}>
                    {w.name}{w.archived ? ` ${t('platformAdmins.archived')}` : ''} · {t(w.role === 'admin' ? 'wsAccounts.role.admin' : 'wsAccounts.role.member')}
                  </li>
                ))}
            </ul>
            {lookup.account.isPlatformAdmin ? (
              <p className="font-medium text-fg">{t('platformAdmins.already')}</p>
            ) : (
              <>
                <p className="leading-6 text-fg-secondary">
                  <strong className="break-all text-fg">{lookup.account.email}</strong>{t('wsAccounts.platform.setConfirm')}
                </p>
                <button data-platform-admin-grant className="btn btn-primary" disabled={busy}
                  onClick={() => { const a = (lookup as { account: PlatformAdminCandidate }).account; run(a.userId, a.email, true, onClose) }}>
                  <ShieldCheck className="h-4 w-4" />{t('platformAdmins.grant')}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
