'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useScope } from '@/components/app/ScopeContext'
import { wsHref } from '@/lib/workspace/paths'
import { UserPlus, Upload, KeyRound, UserCog, ShieldCheck, UserRound, UserMinus, Wand2, Copy, Check, Eye } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import {
  createAccount, bulkCreateAccounts, previewWorkspaceMemberRemoval, removeWorkspaceMember, resetPassword, setPlatformAdmin, setWorkspaceRole,
  type AccountRow, type BulkResultRow, type MemberRemovalPreview,
} from '@/app/actions/accounts'
import { useLocale } from '@/components/providers/LocaleProvider'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { buttonClass } from '@/components/ui/buttonStyles'
import type { DictKey } from '@/lib/i18n/dict'
import { ACCOUNT_ROLES, type AccountRole } from '@/lib/domain/accounts'
import { isValidEmail } from '@/lib/domain/validate'

// accounts.ts 의 ERR_SELF_PLATFORM 원문('use server' 모듈이라 상수를 공유하지 못한다 — 바꾸면 둘 다).
const SELF_PLATFORM_HINT_KEY = 'wsAccounts.selfPlatformHint' satisfies DictKey

/** '{n}' 꼴 자리 채우기 — 사전 문구의 수·이름 */
const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))

const ROLE_LABEL_KEY: Record<AccountRole, DictKey> = { admin: 'wsAccounts.role.admin', member: 'wsAccounts.role.member', viewer: 'wsAccounts.role.viewer' }

/** 워크스페이스 등급 — 계정의 전역 축(옛 계정 팀은 0003 에서 폐지). */
type WorkspaceRole = 'admin' | 'member'
const WS_ROLE_LABEL_KEY: Record<WorkspaceRole, DictKey> = { admin: 'wsAccounts.role.admin', member: 'wsAccounts.role.member' }

/** 이 프로젝트 권한 — 명단 행 access_role, 없으면 조회 전용. */
function accountRole(a: AccountRow): AccountRole {
  return a.accessRole ?? 'viewer'
}

/** 브라우저 crypto 로 임시 비밀번호(12자) 생성 — 리셋/추가 시 [생성] 버튼용. */
function randomPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr, (n) => chars[n % chars.length]).join('')
}

export function AccountsManager({ accounts, projectId, workspaceId, projects, canPlatformOps, currentUserId }: {
  accounts: AccountRow[]
  /** 역할 열·역할 변경이 대상으로 삼는 프로젝트 */
  projectId: string
  /** 그 프로젝트의 워크스페이스 — 워크스페이스 등급 열·변경과 새 계정(단건·일괄) 소속의 대상 */
  workspaceId: string
  projects: { id: string; name: string }[]
  /** 플랫폼 관리자만 true — 플랫폼 전용 조작(플랫폼 관리자 지정)을 그린다(SP3b D22). 액션 가드는 그대로 requireSuperuser.
   *  워크스페이스 관리자가 이 화면을 열게 되며, 눌러도 거부될 버튼을 보이지 않게 한다. 비밀번호 재설정·워크스페이스에서 제거는 행마다
   *  판정이 갈려(row.passwordReset·row.removal) 누구에게나 그리되, 안 되는 행은 잠그고 사유를 툴팁으로 보인다 */
  canPlatformOps: boolean
  /** 보는 사람 — 본인 행의 플랫폼 관리자 해제를 막는다(서버 액션도 거부). */
  currentUserId: string
}) {
  const router = useRouter()
  const scope = useScope()   // 화면 안 링크의 범위(D38 ①) — 없으면 옛 형식(스텁이 해석, D5)
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [resetting, setResetting] = useState<AccountRow | null>(null)
  const [removing, setRemoving] = useState<AccountRow | null>(null)
  const { t } = useLocale()

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('wsAccounts.count').replace('{n}', String(accounts.length))}</h2>
        </div>
        <div className="flex items-center gap-2">
          {projects.length > 1 && (
            <select
              className="app-input h-9 w-auto text-xs"
              value={projectId}
              onChange={(e) => router.push(scope?.workspace
                ? wsHref(scope.workspace.slug, 'admin/accounts', { project: e.target.value })
                : `/admin/accounts?project=${encodeURIComponent(e.target.value)}`)}
              title={t('wsAccounts.projectPicker')}
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={() => setBulkOpen(true)} className="btn btn-ghost">
            <Upload className="h-4 w-4" />{t('wsAccounts.bulkAdd')}
          </button>
          <button onClick={() => setAddOpen(true)} className="btn btn-primary">
            <UserPlus className="h-4 w-4" />{t('wsAccounts.add')}
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {accounts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title={t('wsAccounts.empty')}
            description={t('wsAccounts.emptyDesc')}
            action={<button onClick={() => setAddOpen(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" />{t('wsAccounts.add')}</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
                  <th className="py-2 pr-3">{t('wsAccounts.colEmail')}</th>
                  <th className="py-2 pr-3">{t('wsAccounts.colName')}</th>
                  <th className="py-2 pr-3">{t('wsAccounts.colWsRole')}</th>
                  <th className="py-2 pr-3">{t('wsAccounts.colProjectAccess')}</th>
                  {canPlatformOps && <th className="py-2 pr-3">{t('wsAccounts.platformAdmin')}</th>}
                  <th className="py-2 pr-3">{t('wsAccounts.colCreated')}</th>
                  <th className="py-2 pr-3 text-right">{t('wsAccounts.colActions')}</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} data-account-row={a.id} className="border-b border-border/60">
                    <td className="py-2.5 pr-3 font-medium text-fg">{a.email}</td>
                    <td className="py-2.5 pr-3 text-fg-secondary">{a.name ?? '—'}</td>
                    <td className="py-2.5 pr-3">
                      <WorkspaceRoleCell account={a} workspaceId={workspaceId} />
                    </td>
                    <td className="py-2.5 pr-3">
                      {/* 프로젝트 권한은 명단 행의 권한이다(0003) — 팀·역할과 한 행이라 명단 화면에서만 바꾼다. */}
                      <Link href={`/p/${projectId}/members`} title={t('wsAccounts.changeOnRoster')} data-access-role className={`chip ${
                        accountRole(a) === 'admin' ? 'bg-action-soft text-action'
                          : accountRole(a) === 'member' ? 'bg-progress-weak text-progress'
                            : 'bg-surface-subtle text-fg-muted'
                      }`}>
                        {accountRole(a) === 'admin' ? <UserCog className="h-3 w-3" /> : accountRole(a) === 'member' ? <UserRound className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {t(ROLE_LABEL_KEY[accountRole(a)])}
                      </Link>
                    </td>
                    {canPlatformOps && (
                      <td className="py-2.5 pr-3">
                        <PlatformAdminCell account={a} isSelf={a.id === currentUserId} />
                      </td>
                    )}
                    <td className="py-2.5 pr-3 text-fg-muted">{a.createdAt.slice(0, 10)}</td>
                    <td className="py-2.5 pr-3">
                      {/* 안 되는 행은 버튼을 숨기지 않고 잠근다 — 왜 안 되는지(사유 툴팁)가 "버튼이 없다"보다 낫다. 서버 액션이 다시 판정한다 */}
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          data-reset-password
                          onClick={() => setResetting(a)}
                          className="btn btn-ghost btn-sm disabled:opacity-50"
                          disabled={a.passwordReset !== 'ok'}
                          title={a.passwordReset === 'ok' ? t('wsAccounts.reset') : t(`wsAccounts.reset.${a.passwordReset}` as DictKey)}
                        >
                          <KeyRound className="h-3.5 w-3.5" />{t('wsAccounts.reset')}
                        </button>
                        <button
                          data-remove-member
                          onClick={() => setRemoving(a)}
                          className="btn btn-ghost btn-sm disabled:opacity-50"
                          disabled={a.removal !== 'ok'}
                          title={a.removal === 'ok' ? t('wsAccounts.remove') : t(`wsAccounts.remove.${a.removal}` as DictKey)}
                        >
                          <UserMinus className="h-3.5 w-3.5" />{t('wsAccounts.remove')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} projectId={projectId} workspaceId={workspaceId} />
      <BulkAddModal open={bulkOpen} onClose={() => setBulkOpen(false)} projectId={projectId} workspaceId={workspaceId} />
      <ResetPasswordModal account={resetting} workspaceId={workspaceId} onClose={() => setResetting(null)} />
      <RemoveMemberModal account={removing} workspaceId={workspaceId} onClose={() => setRemoving(null)} />
    </div>
  )
}

/**
 * 워크스페이스 등급 토글(멤버 ↔ 관리자). 소속이 아니면 바꿀 행이 없다(소속 추가는 SP2).
 * 마지막 관리자 강등은 DB 트리거가 거부한다 — 액션이 돌려준 문구를 그대로 보여 준다.
 */
function WorkspaceRoleCell({ account, workspaceId }: { account: AccountRow; workspaceId: string }) {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const current = account.workspaceRole
  if (!current) return <span className="text-fg-muted" title={t('wsAccounts.reset.not_member')}>—</span>
  const next: WorkspaceRole = current === 'admin' ? 'member' : 'admin'
  return (
    <button
      data-ws-role-toggle
      className={`chip ${current === 'admin' ? 'bg-action-soft text-action' : 'bg-surface-subtle text-fg-secondary'} disabled:opacity-50`}
      disabled={pending}
      title={t('wsAccounts.role.changeTo').replace('{role}', () => t(WS_ROLE_LABEL_KEY[next]))}
      onClick={() => startTransition(async () => {
        try {
          const res = await setWorkspaceRole(workspaceId, account.id, next)
          if (res.ok) {
            toast({ title: t('wsAccounts.role.changed').replace('{role}', () => t(WS_ROLE_LABEL_KEY[next])), description: account.email, variant: 'success' })
            router.refresh()
          } else {
            toast({ title: t('wsAccounts.changeFailed'), description: res.error, variant: 'error' })
          }
        } catch {
          toast({ title: t('wsAccounts.changeFailed'), description: t('wsAccounts.requestFailedShort'), variant: 'error' })
        }
      })}
    >
      {current === 'admin' ? <UserCog className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}{t(WS_ROLE_LABEL_KEY[current])}
    </button>
  )
}

/** 플랫폼 관리자(슈퍼유저) 토글 — 열 자체를 슈퍼유저에게만 렌더링한다(어포던스는 편의, 서버 액션이 재검증). */
function PlatformAdminCell({ account, isSelf }: { account: AccountRow; isSelf: boolean }) {
  const router = useRouter()
  const { t } = useLocale()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const selfLocked = isSelf && account.isPlatformAdmin

  return (
    <button
      data-platform-admin-toggle
      className={`chip ${account.isPlatformAdmin ? 'bg-success-weak text-success' : 'bg-surface-subtle text-fg-muted'} disabled:opacity-50`}
      disabled={pending || selfLocked}
      title={selfLocked ? t(SELF_PLATFORM_HINT_KEY) : account.isPlatformAdmin ? t('wsAccounts.platform.unset') : t('wsAccounts.platform.set')}
      onClick={() => startTransition(async () => {
        try {
          const res = await setPlatformAdmin(account.id, !account.isPlatformAdmin)
          if (res.ok) {
            toast({ title: account.isPlatformAdmin ? t('wsAccounts.platform.unsetDone') : t('wsAccounts.platform.setDone'), description: account.email, variant: 'success' })
            router.refresh()
          } else {
            toast({ title: t('wsAccounts.changeFailed'), description: res.error, variant: 'error' })
            // 거부는 이 표가 낡았다는 신호다(다른 슈퍼유저가 먼저 해제했거나 마지막 한 명이 됐다) — 다시 읽지 않으면
            // 칩은 그대로이고 누를 때마다 같은 거부가 돌아온다. 액션은 실패 때 revalidatePath 를 하지 않는다.
            router.refresh()
          }
        } catch {
          toast({ title: t('wsAccounts.changeFailed'), description: t('wsAccounts.requestFailedShort'), variant: 'error' })
        }
      })}
    >
      <ShieldCheck className="h-3 w-3" />{account.isPlatformAdmin ? t('wsAccounts.platformAdmin') : t('wsAccounts.platform.assign')}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{label}</span>
      {children}
    </label>
  )
}

/** 역할 select(계정 추가) — 세 값 모두 고를 수 있다. 계정 추가는 워크스페이스 관리자 이상(createAccount 의 requireWorkspaceAdmin)이고
 *  그 등급은 그 워크스페이스 모든 프로젝트의 관리자를 승계하므로 프로젝트 관리자 부여도 서버가 허용한다(일괄 추가와 같은 규칙). */
function RoleSelect({ value, onChange }: {
  value: AccountRole
  onChange: (r: AccountRole) => void
}) {
  const { t } = useLocale()
  return (
    <select className="app-input" value={value} onChange={(e) => onChange(e.target.value as AccountRole)}>
      {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>)}
    </select>
  )
}

/** 워크스페이스 등급 select — 계정 관리는 워크스페이스 관리자 이상이라(setWorkspaceRole 과 같은 가드) 두 값 모두 고를 수 있다. */
function WorkspaceRoleSelect({ value, onChange }: {
  value: WorkspaceRole
  onChange: (r: WorkspaceRole) => void
}) {
  const { t } = useLocale()
  return (
    <select className="app-input" value={value} onChange={(e) => onChange(e.target.value as WorkspaceRole)}>
      {(['member', 'admin'] as const).map((r) => <option key={r} value={r}>{t(WS_ROLE_LABEL_KEY[r])}</option>)}
    </select>
  )
}

function AddAccountModal({ open, onClose, projectId, workspaceId }: {
  open: boolean; onClose: () => void; projectId: string; workspaceId: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [wsRole, setWsRole] = useState<WorkspaceRole>('member')
  // 새 계정은 조회 권한으로 시작한다(설계 D7) — 쓰기 권한은 만든 뒤 명시적으로 부여.
  const [role, setRole] = useState<AccountRole>('viewer')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setEmail(''); setName(''); setWsRole('member'); setRole('viewer'); setPassword(''); setError(null)
  }, [open])

  function submit() {
    setError(null)
    if (!isValidEmail(email)) { setError(t('wsAccounts.err.email')); return }
    if (password.length < 8) { setError(t('wsAccounts.err.initialPw')); return }
    startTransition(async () => {
      try {
        const res = await createAccount({
          email: email.trim(), password, name: name.trim() || null, workspaceRole: wsRole,
          projectId, accessRole: role === 'viewer' ? null : role, workspaceId,
        })
        if (res.ok) {
          toast({ title: t('wsAccounts.created'), description: email.trim(), variant: 'success' })
          onClose(); router.refresh()
        } else {
          setError(res.error ?? t('wsAccounts.createFailed'))
        }
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} title={t('wsAccounts.add')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? t('wsAccounts.creating') : t('wsAccounts.create')}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('wsAccounts.field.email')}>
          <input className="app-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" autoFocus />
        </Field>
        <Field label={t('wsAccounts.field.name')}>
          <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('wsAccounts.field.namePlaceholder')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('wsAccounts.colWsRole')}>
            <WorkspaceRoleSelect value={wsRole} onChange={setWsRole} />
          </Field>
          <Field label={t('wsAccounts.colProjectAccess')}>
            <RoleSelect value={role} onChange={setRole} />
          </Field>
        </div>
        <Field label={t('wsAccounts.field.initialPw')}>
          <div className="flex gap-2">
            <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('wsAccounts.field.initialPwPlaceholder')} />
            <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />{t('wsAccounts.generate')}</button>
          </div>
        </Field>
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
      </div>
    </Modal>
  )
}

function BulkAddModal({ open, onClose, projectId, workspaceId }: {
  open: boolean; onClose: () => void; projectId: string; workspaceId: string
}) {
  const router = useRouter()
  const { t } = useLocale()
  const [text, setText] = useState('')
  const [results, setResults] = useState<BulkResultRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setText(''); setResults(null); setError(null)
  }, [open])

  function submit() {
    setError(null); setResults(null)
    startTransition(async () => {
      try {
        const res = await bulkCreateAccounts(workspaceId, text, projectId)
        if (!res.ok) { setError(res.error ?? t('wsAccounts.bulk.failed')); return }
        setResults(res.results)
        router.refresh() // 성공분을 목록에 반영
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Modal
      open={open} onClose={onClose} title={t('wsAccounts.bulkAdd')} size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.close')}</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending || !text.trim()}>{pending ? t('wsAccounts.bulk.pending') : t('wsAccounts.bulk.run')}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-subtle px-3.5 py-3 text-xs leading-5 text-fg-secondary">
          {t('wsAccounts.bulk.help1')}<b>{t('wsAccounts.bulk.helpFormat')}</b>{t('wsAccounts.bulk.help2')}<br />
          {t('wsAccounts.bulk.accessLabel')}<code>admin · member · viewer</code>{t('wsAccounts.bulk.accessNote')}<br />
          {t('wsAccounts.bulk.exampleLabel')}<code>{t('wsAccounts.bulk.example')}</code>
        </div>
        <textarea
          className="app-input min-h-[160px] font-mono text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('wsAccounts.bulk.placeholder')}
        />
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        {results && (
          <div>
            <div className="mb-2 text-sm font-semibold text-fg">{t('wsAccounts.bulk.resultOk')}{okCount}{t('wsAccounts.bulk.resultFail')}{failCount}</div>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5 text-fg-muted">{t('wsAccounts.bulk.lineNo').replace('{n}', String(r.lineNo))}</td>
                      <td className="px-3 py-1.5 text-fg">{r.email}</td>
                      <td className="px-3 py-1.5">
                        {r.ok
                          ? <span className="chip bg-success-weak text-success">{t('wsAccounts.bulk.ok')}</span>
                          : <span className="chip bg-danger-weak text-danger" title={r.error}>{t('wsAccounts.bulk.fail')}</span>}
                      </td>
                      <td className="px-3 py-1.5 text-fg-secondary">{r.error ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function ResetPasswordModal({ account, workspaceId, onClose }: { account: AccountRow | null; workspaceId: string; onClose: () => void }) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [password, setPassword] = useState('')
  const [done, setDone] = useState<string | null>(null) // 적용 완료된 임시 비밀번호 — 전달용으로 유지
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (account) { setPassword(randomPassword()); setDone(null); setCopied(false); setError(null) }
  }, [account])

  function submit() {
    setError(null)
    if (!account) return
    if (password.length < 8) { setError(t('wsAccounts.err.tempPw')); return }
    startTransition(async () => {
      try {
        const res = await resetPassword(workspaceId, account.id, password)
        if (res.ok) {
          setDone(password) // 모달을 닫지 않고 값을 유지 — 전달 전 소실 방지
          toast({ title: t('wsAccounts.resetDone'), variant: 'success' })
        } else {
          setError(res.error ?? t('wsAccounts.resetFailed'))
        }
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  async function copy() {
    if (!done) return
    try { await navigator.clipboard.writeText(done); setCopied(true) } catch { /* 클립보드 미지원 시 무시 */ }
  }

  return (
    <Modal
      open={!!account} onClose={onClose} title={t('wsAccounts.resetTitle')}
      footer={
        done ? (
          <button onClick={onClose} className="btn btn-primary">{t('common.close')}</button>
        ) : (
          <>
            <button onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('common.cancel')}</button>
            <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? t('wsAccounts.applying') : t('wsAccounts.resetRun')}</button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {done ? (
          <>
            <p className="text-sm text-fg-secondary"><b className="text-fg">{account?.email}</b>{t('wsAccounts.resetDoneBody')}<b className="text-fg">{t('wsAccounts.resetOnce')}</b></p>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{done}</code>
              <button type="button" onClick={copy} className="btn btn-ghost btn-sm shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? t('account.pat.copied') : t('account.pat.copy')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-secondary"><b className="text-fg">{account?.email}</b>{t('wsAccounts.resetBody')}</p>
            <Field label={t('wsAccounts.field.tempPw')}>
              <div className="flex gap-2">
                <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />{t('wsAccounts.generate')}</button>
              </div>
            </Field>
            {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}

/**
 * "워크스페이스에서 제거" 확인 — 열리면 영향(권한이 회수될 프로젝트 수·회수될 초대·닫힐 토큰)을 먼저 읽어 보여 주고, 읽은 뒤에만 확인을 연다.
 * 미리보기를 못 읽으면 확인도 잠근다 — 무엇이 바뀌는지 모르는 채로 누르게 하지 않는다(조회 실패를 "영향 없음"으로 그리지 않는다).
 * 수치는 안내다: 제거는 서버(RPC)가 같은 범위를 다시 재서 한 트랜잭션으로 한다.
 */
function RemoveMemberModal({ account, workspaceId, onClose }: { account: AccountRow | null; workspaceId: string; onClose: () => void }) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [preview, setPreview] = useState<MemberRemovalPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const accountId = account?.id ?? null

  useEffect(() => {
    setPreview(null); setError(null)
    if (!accountId) return
    let alive = true
    previewWorkspaceMemberRemoval(workspaceId, accountId)
      .then((res) => {
        if (!alive) return
        if (res.ok) setPreview(res.preview)
        else setError(res.error)
      })
      .catch(() => { if (alive) setError(t('wsAccounts.requestFailed')) })
    return () => { alive = false }
    // t 는 바뀌지 않는다(고정 사전) — 의존성에 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, workspaceId])

  function submit() {
    if (!account || !preview) return
    startTransition(async () => {
      try {
        const res = await removeWorkspaceMember(workspaceId, account.id)
        if (res.ok) {
          toast({ title: t('wsAccounts.remove.done'), description: account.email, variant: 'success' })
          onClose(); router.refresh()
        } else {
          setError(res.error ?? t('wsAccounts.remove.failed'))
          // 거부는 이 표가 낡았다는 신호일 수 있다(그 사이 등급이 바뀌었거나 이미 빠졌다) — 다시 읽는다
          router.refresh()
        }
      } catch {
        setError(t('wsAccounts.requestFailed'))
      }
    })
  }

  const lines = preview ? [
    preview.projects > 0 ? fill(t('wsAccounts.remove.previewProjects'), { n: preview.projects }) : null,
    preview.invites > 0 ? fill(t('wsAccounts.remove.previewInvites'), { n: preview.invites }) : null,
    preview.tokens > 0 ? fill(t('wsAccounts.remove.previewTokens'), { n: preview.tokens }) : null,
  ].filter((l): l is string => l !== null) : []

  return (
    <Modal
      open={!!account} onClose={onClose} title={t('wsAccounts.remove.title')}
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>{t('wsAccounts.remove.cancel')}</button>
          <button data-remove-confirm onClick={submit} className={buttonClass('danger')} disabled={pending || !preview}>
            {pending ? t('wsAccounts.remove.pending') : t('wsAccounts.remove.confirm')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">{fill(t('wsAccounts.remove.body'), { email: account?.email ?? '' })}</p>
        {preview ? (
          <div data-remove-preview className="rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
            <p className="text-xs font-semibold text-fg-secondary">{t('wsAccounts.remove.previewTitle')}</p>
            {lines.length > 0
              ? <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-fg">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
              : <p className="mt-1.5 text-sm text-fg">{t('wsAccounts.remove.previewNone')}</p>}
          </div>
        ) : error ? null : (
          <p className="text-sm text-fg-muted">{t('wsAccounts.remove.previewLoading')}</p>
        )}
        {error && (preview
          ? <p role="alert" className="text-sm font-medium text-danger">{error}</p>
          : <StatusMessage kind="partial_error" title={t('wsAccounts.remove.previewFailed')} detail={error} />)}
      </div>
    </Modal>
  )
}
