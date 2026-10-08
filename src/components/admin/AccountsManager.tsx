'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useScope } from '@/components/app/ScopeContext'
import { wsHref } from '@/lib/workspace/paths'
import { UserPlus, Upload, KeyRound, UserCog, ShieldCheck, UserRound, Wand2, Copy, Check, Eye } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import {
  createAccount, bulkCreateAccounts, resetPassword, setPlatformAdmin, setWorkspaceRole,
  type AccountRow, type BulkResultRow,
} from '@/app/actions/accounts'
import { ACCOUNT_ROLES, type AccountRole } from '@/lib/domain/accounts'
import { isValidEmail } from '@/lib/domain/validate'

// accounts.ts 의 ERR_SELF_PLATFORM 원문('use server' 모듈이라 상수를 공유하지 못한다 — 바꾸면 둘 다).
const SELF_PLATFORM_HINT = '본인의 플랫폼 관리자 권한은 스스로 해제할 수 없습니다. 다른 슈퍼유저에게 요청하세요.'

const ROLE_LABEL: Record<AccountRole, string> = { admin: '관리자', member: '멤버', viewer: '조회' }

/** 워크스페이스 등급 — 계정의 전역 축(옛 계정 팀은 0003 에서 폐지). */
type WorkspaceRole = 'admin' | 'member'
const WS_ROLE_LABEL: Record<WorkspaceRole, string> = { admin: '관리자', member: '멤버' }

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
  /** 플랫폼 관리자만 true — 플랫폼 전용 조작(비밀번호 재설정·플랫폼 관리자 지정)을 그린다(SP3b D22). 액션 가드는 그대로 requireSuperuser.
   *  워크스페이스 관리자가 이 화면을 열게 되며, 눌러도 거부될 버튼을 보이지 않게 한다 */
  canPlatformOps: boolean
  /** 보는 사람 — 본인 행의 플랫폼 관리자 해제를 막는다(서버 액션도 거부). */
  currentUserId: string
}) {
  const router = useRouter()
  const scope = useScope()   // 화면 안 링크의 범위(D38 ①) — 없으면 옛 형식(스텁이 해석, D5)
  const [addOpen, setAddOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [resetting, setResetting] = useState<AccountRow | null>(null)

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <div className="eyebrow">Account board</div>
          <h2 className="mt-0.5 text-sm font-semibold text-fg">로그인 계정 · {accounts.length}개</h2>
        </div>
        <div className="flex items-center gap-2">
          {projects.length > 1 && (
            <select
              className="app-input h-9 w-auto text-xs"
              value={projectId}
              onChange={(e) => router.push(scope?.workspace
                ? wsHref(scope.workspace.slug, 'admin/accounts', { project: e.target.value })
                : `/admin/accounts?project=${encodeURIComponent(e.target.value)}`)}
              title="권한 표시·부여 대상 프로젝트"
            >
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <button onClick={() => setBulkOpen(true)} className="btn btn-ghost">
            <Upload className="h-4 w-4" />일괄 추가
          </button>
          <button onClick={() => setAddOpen(true)} className="btn btn-primary">
            <UserPlus className="h-4 w-4" />계정 추가
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {accounts.length === 0 ? (
          <EmptyState
            icon={UserRound}
            title="계정이 없습니다"
            description="계정 추가 또는 일괄 추가로 로그인 계정을 만드세요."
            action={<button onClick={() => setAddOpen(true)} className="btn btn-primary"><UserPlus className="h-4 w-4" />계정 추가</button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-semibold text-fg-muted">
                  <th className="py-2 pr-3">이메일</th>
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">워크스페이스 역할</th>
                  <th className="py-2 pr-3">이 프로젝트 권한</th>
                  {canPlatformOps && <th className="py-2 pr-3">플랫폼 관리자</th>}
                  <th className="py-2 pr-3">생성일</th>
                  {canPlatformOps && <th className="py-2 pr-3 text-right">작업</th>}
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
                      <Link href={`/p/${projectId}/members`} title="명단 화면에서 변경" data-access-role className={`chip ${
                        accountRole(a) === 'admin' ? 'bg-action-soft text-action'
                          : accountRole(a) === 'member' ? 'bg-progress-weak text-progress'
                            : 'bg-surface-subtle text-fg-muted'
                      }`}>
                        {accountRole(a) === 'admin' ? <UserCog className="h-3 w-3" /> : accountRole(a) === 'member' ? <UserRound className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        {ROLE_LABEL[accountRole(a)]}
                      </Link>
                    </td>
                    {canPlatformOps && (
                      <td className="py-2.5 pr-3">
                        <PlatformAdminCell account={a} isSelf={a.id === currentUserId} />
                      </td>
                    )}
                    <td className="py-2.5 pr-3 text-fg-muted">{a.createdAt.slice(0, 10)}</td>
                    {canPlatformOps && (
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => setResetting(a)} className="btn btn-ghost btn-sm" title="비밀번호 리셋">
                            <KeyRound className="h-3.5 w-3.5" />비번 리셋
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} projectId={projectId} workspaceId={workspaceId} />
      <BulkAddModal open={bulkOpen} onClose={() => setBulkOpen(false)} projectId={projectId} workspaceId={workspaceId} />
      {canPlatformOps && <ResetPasswordModal account={resetting} onClose={() => setResetting(null)} />}
    </div>
  )
}

/**
 * 워크스페이스 등급 토글(멤버 ↔ 관리자). 소속이 아니면 바꿀 행이 없다(소속 추가는 SP2).
 * 마지막 관리자 강등은 DB 트리거가 거부한다 — 액션이 돌려준 문구를 그대로 보여 준다.
 */
function WorkspaceRoleCell({ account, workspaceId }: { account: AccountRow; workspaceId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const current = account.workspaceRole
  if (!current) return <span className="text-fg-muted" title="이 워크스페이스 소속이 아닌 계정입니다.">—</span>
  const next: WorkspaceRole = current === 'admin' ? 'member' : 'admin'
  return (
    <button
      data-ws-role-toggle
      className={`chip ${current === 'admin' ? 'bg-action-soft text-action' : 'bg-surface-subtle text-fg-secondary'} disabled:opacity-50`}
      disabled={pending}
      title={`${WS_ROLE_LABEL[next]}(으)로 변경`}
      onClick={() => startTransition(async () => {
        try {
          const res = await setWorkspaceRole(workspaceId, account.id, next)
          if (res.ok) {
            toast({ title: `워크스페이스 ${WS_ROLE_LABEL[next]}(으)로 변경했습니다.`, description: account.email, variant: 'success' })
            router.refresh()
          } else {
            toast({ title: '변경 실패', description: res.error, variant: 'error' })
          }
        } catch {
          toast({ title: '변경 실패', description: '요청 처리 중 오류가 발생했습니다.', variant: 'error' })
        }
      })}
    >
      {current === 'admin' ? <UserCog className="h-3 w-3" /> : <UserRound className="h-3 w-3" />}{WS_ROLE_LABEL[current]}
    </button>
  )
}

/** 플랫폼 관리자(슈퍼유저) 토글 — 열 자체를 슈퍼유저에게만 렌더링한다(어포던스는 편의, 서버 액션이 재검증). */
function PlatformAdminCell({ account, isSelf }: { account: AccountRow; isSelf: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, startTransition] = useTransition()
  const selfLocked = isSelf && account.isPlatformAdmin

  return (
    <button
      data-platform-admin-toggle
      className={`chip ${account.isPlatformAdmin ? 'bg-success-weak text-success' : 'bg-surface-subtle text-fg-muted'} disabled:opacity-50`}
      disabled={pending || selfLocked}
      title={selfLocked ? SELF_PLATFORM_HINT : account.isPlatformAdmin ? '플랫폼 관리자 해제' : '플랫폼 관리자 지정'}
      onClick={() => startTransition(async () => {
        try {
          const res = await setPlatformAdmin(account.id, !account.isPlatformAdmin)
          if (res.ok) {
            toast({ title: account.isPlatformAdmin ? '플랫폼 관리자를 해제했습니다.' : '플랫폼 관리자로 지정했습니다.', description: account.email, variant: 'success' })
            router.refresh()
          } else {
            toast({ title: '변경 실패', description: res.error, variant: 'error' })
            // 거부는 이 표가 낡았다는 신호다(다른 슈퍼유저가 먼저 해제했거나 마지막 한 명이 됐다) — 다시 읽지 않으면
            // 칩은 그대로이고 누를 때마다 같은 거부가 돌아온다. 액션은 실패 때 revalidatePath 를 하지 않는다.
            router.refresh()
          }
        } catch {
          toast({ title: '변경 실패', description: '요청 처리 중 오류가 발생했습니다.', variant: 'error' })
        }
      })}
    >
      <ShieldCheck className="h-3 w-3" />{account.isPlatformAdmin ? '플랫폼 관리자' : '지정'}
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
  return (
    <select className="app-input" value={value} onChange={(e) => onChange(e.target.value as AccountRole)}>
      {ACCOUNT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
    </select>
  )
}

/** 워크스페이스 등급 select — 계정 관리는 워크스페이스 관리자 이상이라(setWorkspaceRole 과 같은 가드) 두 값 모두 고를 수 있다. */
function WorkspaceRoleSelect({ value, onChange }: {
  value: WorkspaceRole
  onChange: (r: WorkspaceRole) => void
}) {
  return (
    <select className="app-input" value={value} onChange={(e) => onChange(e.target.value as WorkspaceRole)}>
      {(['member', 'admin'] as const).map((r) => <option key={r} value={r}>{WS_ROLE_LABEL[r]}</option>)}
    </select>
  )
}

function AddAccountModal({ open, onClose, projectId, workspaceId }: {
  open: boolean; onClose: () => void; projectId: string; workspaceId: string
}) {
  const router = useRouter()
  const { toast } = useToast()
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
    if (!isValidEmail(email)) { setError('올바른 이메일을 입력하세요.'); return }
    if (password.length < 8) { setError('초기 비밀번호는 8자 이상이어야 합니다.'); return }
    startTransition(async () => {
      try {
        const res = await createAccount({
          email: email.trim(), password, name: name.trim() || null, workspaceRole: wsRole,
          projectId, accessRole: role === 'viewer' ? null : role, workspaceId,
        })
        if (res.ok) {
          toast({ title: '계정을 만들었습니다.', description: email.trim(), variant: 'success' })
          onClose(); router.refresh()
        } else {
          setError(res.error ?? '생성 실패')
        }
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="New account" title="계정 추가"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '생성 중…' : '계정 만들기'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="이메일 (로그인 아이디)">
          <input className="app-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@company.com" autoFocus />
        </Field>
        <Field label="이름 (선택)">
          <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="워크스페이스 역할">
            <WorkspaceRoleSelect value={wsRole} onChange={setWsRole} />
          </Field>
          <Field label="이 프로젝트 권한">
            <RoleSelect value={role} onChange={setRole} />
          </Field>
        </div>
        <Field label="초기 비밀번호 (8자 이상)">
          <div className="flex gap-2">
            <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="초기 비밀번호" />
            <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />생성</button>
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
        if (!res.ok) { setError(res.error ?? '처리 실패'); return }
        setResults(res.results)
        router.refresh() // 성공분을 목록에 반영
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  const okCount = results?.filter((r) => r.ok).length ?? 0
  const failCount = results?.filter((r) => !r.ok).length ?? 0

  return (
    <Modal
      open={open} onClose={onClose} eyebrow="Bulk create" title="일괄 추가" size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn btn-ghost" disabled={pending}>닫기</button>
          <button onClick={submit} className="btn btn-primary" disabled={pending || !text.trim()}>{pending ? '처리 중…' : '일괄 생성'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-surface-subtle px-3.5 py-3 text-xs leading-5 text-fg-secondary">
          한 줄에 하나씩, <b>이메일, 권한, 초기비번[, 이름]</b> 순서. 콤마 또는 탭 구분.<br />
          권한: <code>admin · member · viewer</code> — 선택한 프로젝트의 권한입니다(viewer = 명단 없이 조회 전용). 워크스페이스 역할은 멤버로 만들고, 플랫폼 관리자는 일괄 등록으로 지정할 수 없습니다.<br />
          예) <code>hong@company.com, member, password1, 홍길동</code>
        </div>
        <textarea
          className="app-input min-h-[160px] font-mono text-[13px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'user1@company.com, member, password1\nuser2@company.com, viewer, password2, 김철수'}
        />
        {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
        {results && (
          <div>
            <div className="mb-2 text-sm font-semibold text-fg">결과 — 성공 {okCount} · 실패 {failCount}</div>
            <div className="max-h-52 overflow-y-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      <td className="px-3 py-1.5 text-fg-muted">{r.lineNo}행</td>
                      <td className="px-3 py-1.5 text-fg">{r.email}</td>
                      <td className="px-3 py-1.5">
                        {r.ok
                          ? <span className="chip bg-success-weak text-success">성공</span>
                          : <span className="chip bg-danger-weak text-danger" title={r.error}>실패</span>}
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

function ResetPasswordModal({ account, onClose }: { account: AccountRow | null; onClose: () => void }) {
  const { toast } = useToast()
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
    if (password.length < 8) { setError('임시 비밀번호는 8자 이상이어야 합니다.'); return }
    startTransition(async () => {
      try {
        const res = await resetPassword(account.id, password)
        if (res.ok) {
          setDone(password) // 모달을 닫지 않고 값을 유지 — 전달 전 소실 방지
          toast({ title: '비밀번호를 리셋했습니다.', variant: 'success' })
        } else {
          setError(res.error ?? '리셋 실패')
        }
      } catch {
        setError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
      }
    })
  }

  async function copy() {
    if (!done) return
    try { await navigator.clipboard.writeText(done); setCopied(true) } catch { /* 클립보드 미지원 시 무시 */ }
  }

  return (
    <Modal
      open={!!account} onClose={onClose} eyebrow="Reset password" title="비밀번호 리셋"
      footer={
        done ? (
          <button onClick={onClose} className="btn btn-primary">닫기</button>
        ) : (
          <>
            <button onClick={onClose} className="btn btn-ghost" disabled={pending}>취소</button>
            <button onClick={submit} className="btn btn-primary" disabled={pending}>{pending ? '적용 중…' : '리셋'}</button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {done ? (
          <>
            <p className="text-sm text-fg-secondary"><b className="text-fg">{account?.email}</b> 의 임시 비밀번호가 설정되었습니다. 아래 값을 사용자에게 전달하세요. <b className="text-fg">이 창을 닫으면 다시 볼 수 없습니다.</b></p>
            <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{done}</code>
              <button type="button" onClick={copy} className="btn btn-ghost btn-sm shrink-0">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '복사됨' : '복사'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-fg-secondary"><b className="text-fg">{account?.email}</b> 의 비밀번호를 임시값으로 변경합니다. 사용자는 로그인 후 본인이 변경하게 하세요.</p>
            <Field label="임시 비밀번호 (8자 이상)">
              <div className="flex gap-2">
                <input className="app-input" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" onClick={() => setPassword(randomPassword())} className="btn btn-ghost shrink-0"><Wand2 className="h-4 w-4" />생성</button>
              </div>
            </Field>
            {error && <p role="alert" className="text-sm font-medium text-danger">{error}</p>}
          </>
        )}
      </div>
    </Modal>
  )
}
