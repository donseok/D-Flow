'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import {
  createAgentToken, listMyAgentTokens, revokeAgentToken,
} from '@/app/actions/agentTokens'

type TokenRow = {
  id: string; name: string; token_prefix: string; scopes: string[]
  workspace_id: string; project_ids: string[] | null; project_id: string | null; expires_at: string; revoked_at: string | null; last_seen_at: string | null
}

// 스코프 설명(스테이징 실사용 피드백 2026-08-11) — 52명+ 로스터에서 claim 스코프가 조회를
// 포함한다는 사실이 체크박스 라벨만으론 드러나지 않아 오발급 문의가 있었다.
// work:report 는 **폐지됐다**(2026-08-25) — claim 할 수 있으면 그 결과도 적을 수 있어야 하고,
// claim 이 무제한인 이상 보고만 따로 막는 건 실질 방어선이 아니었다. 신규 발급에는 붙이지 않는다
// (옛 토큰에 남은 work:report 는 서버가 work:claim 과 동등하게 받아준다 — externalApi 참조).
const SCOPE_OPTIONS: readonly { value: string; labelKey: DictKey; descKey: DictKey }[] = [
  { value: 'work:read', labelKey: 'account.scope.workRead.label', descKey: 'account.scope.workRead.desc' },
  { value: 'work:claim', labelKey: 'account.scope.workClaim.label', descKey: 'account.scope.workClaim.desc' },
] as const

const EXPIRES_OPTIONS = [30, 90, 180] as const

/** PAT 발급·목록·폐기(결정 D). 평문은 발급 직후 1회만 표시. */
export function MyTokensSection({ projects, workspaces = [], currentWorkspaceId, workspaceError = false }: {
  projects: { id: string; name: string; workspace_id?: string }[]
  workspaces?: { id: string; name: string }[]
  currentWorkspaceId?: string
  workspaceError?: boolean
}) {
  const { toast } = useToast()
  const { t } = useLocale()
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [workspaceId, setWorkspaceId] = useState(workspaces.some(w => w.id === currentWorkspaceId) ? currentWorkspaceId! : workspaces[0]?.id ?? '')
  const [allProjects, setAllProjects] = useState(true)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [scopes, setScopes] = useState<string[]>(['work:read'])
  const [expiresDays, setExpiresDays] = useState<number>(90)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ token: string; prefix: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [revoking, setRevoking] = useState<TokenRow | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const r = await listMyAgentTokens()
    if (!r.ok) { setLoadError(r.error); setLoading(false); return }
    setLoadError(null)
    setTokens(r.tokens as TokenRow[])
    setLoading(false)
  }, [])
  useEffect(() => { void reload() }, [reload])

  function toggleScope(value: string) {
    setScopes((prev) => prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value])
  }

  async function submitIssue() {
    setIssueError(null)
    const trimmed = name.trim()
    if (!trimmed) { setIssueError(t('account.pat.err.name')); return }
    if (!workspaceId || workspaceError) { setIssueError(t('account.pat.err.workspace')); return }
    if (!allProjects && selectedProjects.length === 0) { setIssueError(t('account.pat.err.projects')); return }
    if (scopes.length === 0) { setIssueError(t('account.pat.err.scopes')); return }
    setIssuing(true)
    try {
      const r = await createAgentToken({
        name: trimmed, workspaceId, projectIds: allProjects ? null : selectedProjects, scopes, expiresDays,
      })
      if (!r.ok) { setIssueError(r.error); return }
      setIssued({ token: r.token, prefix: r.prefix })
      setCopied(false)
      setName('')
      setSelectedProjects([])
      setAllProjects(true)
      setScopes(['work:read'])
      setExpiresDays(90)
      await reload()
    } catch {
      setIssueError(t('wsAccounts.requestFailed'))
    } finally {
      setIssuing(false)
    }
  }

  async function copyIssued() {
    if (!issued) return
    try { await navigator.clipboard.writeText(issued.token); setCopied(true) } catch { /* 클립보드 미지원 시 무시 */ }
  }

  async function confirmRevoke() {
    if (!revoking) return
    setRevokeBusy(true)
    try {
      const r = await revokeAgentToken(revoking.id)
      if (!r.ok) { toast({ title: r.error ?? t('account.pat.revokeFailed'), variant: 'error' }); return }
      toast({ title: t('account.pat.revoked'), variant: 'success' })
      setRevoking(null)
      await reload()
    } finally {
      setRevokeBusy(false)
    }
  }

  const projectName = (token: TokenRow) => {
    const workspace = workspaces.find(w => w.id === token.workspace_id)?.name ?? token.workspace_id
    const names = token.project_ids === null ? t('account.pat.allProjects') : token.project_ids.map(id => projects.find(p => p.id === id)?.name ?? id).join(', ')
    return `${workspace} · ${names}`
  }
  const candidates = projects.filter(p => p.workspace_id === workspaceId)

  return (
    <div className="card w-full min-w-0 max-w-full overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('account.pat.title')}</h2>
        </div>
      </div>

      <div className="grid w-full min-w-0 max-w-full grid-cols-1 gap-6 p-5 sm:p-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="w-full min-w-0 max-w-full">
          {loadError && <p role="alert" className="mb-3 text-sm font-medium text-danger">{t('account.pat.loadFailed')}{loadError}</p>}
          {loading ? (
            <p className="text-sm text-fg-muted">{t('common.loading')}</p>
          ) : tokens.length === 0 ? (
            <EmptyState icon={KeyRound} title={t('account.pat.empty')} description={t('account.pat.emptyDesc')} />
          ) : (
            <div className="w-full min-w-0 max-w-full overflow-x-auto">
              <table className="data-table w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    <th className="py-2 pr-3">{t('account.pat.colName')}</th>
                    <th className="py-2 pr-3">prefix</th>
                    <th className="py-2 pr-3">{t('account.pat.scopes')}</th>
                    <th className="py-2 pr-3">{t('account.pat.colProjects')}</th>
                    <th className="py-2 pr-3">{t('account.pat.expires')}</th>
                    <th className="py-2 pr-3">{t('account.pat.colLastUsed')}</th>
                    <th className="py-2 pr-3 text-right">{t('account.pat.colActions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((tk) => {
                    const isRevoked = !!tk.revoked_at
                    const isExpired = Date.parse(tk.expires_at) <= Date.now()
                    return (
                      <tr key={tk.id} className="border-b border-border/60">
                        <td className="py-2.5 pr-3 font-medium text-fg">{tk.name}</td>
                        <td className="py-2.5 pr-3 font-mono text-xs text-fg-secondary">{tk.token_prefix}</td>
                        <td className="py-2.5 pr-3 text-fg-secondary">{tk.scopes.join(', ')}</td>
                        <td className="py-2.5 pr-3 text-fg-secondary">{projectName(tk)}</td>
                        <td className="py-2.5 pr-3 text-fg-muted">{tk.expires_at.slice(0, 10)}</td>
                        <td className="py-2.5 pr-3 text-fg-muted">{tk.last_seen_at ? tk.last_seen_at.slice(0, 10) : '—'}</td>
                        <td className="py-2.5 pr-3 text-right">
                          {isRevoked ? (
                            <span className="chip bg-surface-subtle text-fg-muted">{t('account.pat.revokedBadge')}</span>
                          ) : isExpired ? (
                            <span className="chip bg-surface-subtle text-fg-muted">{t('account.pat.expiredBadge')}</span>
                          ) : (
                            <button onClick={() => setRevoking(tk)} className="btn btn-ghost btn-sm" title={t('account.pat.revoke')}>
                              <Trash2 className="h-3.5 w-3.5" />{t('account.pat.revoke')}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="w-full min-w-0 max-w-full rounded-2xl border border-border bg-surface-subtle p-4">
          <h3 className="text-sm font-semibold text-fg">{t('account.pat.issueTitle')}</h3>
          <div className="mt-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('account.pat.colName')}</span>
              <input className="app-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('account.pat.namePlaceholder')} maxLength={64} disabled={issuing} />
            </label>
            {workspaceError && <p role="alert" className="text-sm text-danger">{t('account.pat.wsLoadFailed')}</p>}
            {workspaces.length > 1 ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('account.pat.workspace')}</span>
                <select aria-label={t('account.pat.workspace')} className="app-input" value={workspaceId} disabled={issuing || workspaceError} onChange={e => {
                  setWorkspaceId(e.target.value); setSelectedProjects([]); setAllProjects(true)
                }}>
                  {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label>
            ) : <p className="text-sm text-fg-secondary">{t('account.pat.workspacePrefix')}{workspaces[0]?.name ?? t('account.pat.noWorkspace')}</p>}
            <fieldset className="min-w-0 space-y-2" disabled={issuing || workspaceError}>
              <legend className="text-xs font-semibold text-fg-secondary">{t('account.pat.allowedProjects')}</legend>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input type="checkbox" checked={allProjects} onChange={e => setAllProjects(e.target.checked)} />
                {t('account.pat.allInWorkspace')}
              </label>
              {!allProjects && candidates.map(p => (
                <label key={p.id} className="flex items-center gap-2 text-sm text-fg">
                  <input type="checkbox" checked={selectedProjects.includes(p.id)} onChange={e => setSelectedProjects(prev => e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id))} />
                  <span className="min-w-0 break-words">{p.name}</span>
                </label>
              ))}
              {!allProjects && candidates.length === 0 && <p className="text-xs text-fg-muted">{t('account.pat.noCandidates')}</p>}
            </fieldset>
            <div>
              <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('account.pat.scopes')}</span>
              <div className="flex flex-col gap-1.5">
                {SCOPE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-start gap-2 text-sm text-fg">
                    <input type="checkbox" checked={scopes.includes(opt.value)} onChange={() => toggleScope(opt.value)} disabled={issuing} className="mt-0.5" />
                    <span className="min-w-0 break-words">
                      {t(opt.labelKey)}
                      <span className="block text-xs text-fg-muted">{t(opt.descKey)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('account.pat.expires')}</span>
              <select className="app-input" value={expiresDays} onChange={(e) => setExpiresDays(Number(e.target.value))} disabled={issuing}>
                {EXPIRES_OPTIONS.map((d) => <option key={d} value={d}>{d}{t('account.pat.daysUnit')}</option>)}
              </select>
            </label>
            {issueError && <p role="alert" className="text-sm font-medium text-danger">{issueError}</p>}
            <button onClick={submitIssue} className="btn btn-primary w-full" disabled={issuing || workspaceError || !workspaceId}>
              {issuing ? t('account.pat.issuing') : t('account.pat.issue')}
            </button>
          </div>

          {issued && (
            <div className="mt-4 rounded-xl border border-border bg-surface px-3.5 py-3">
              <p className="text-xs font-medium text-danger">{t('account.pat.onceNotice')}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-subtle px-2.5 py-1.5 font-mono text-xs text-fg">{issued.token}</code>
                <button type="button" onClick={copyIssued} className="btn btn-ghost btn-sm shrink-0">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? t('account.pat.copied') : t('account.pat.copy')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={!!revoking} onClose={() => setRevoking(null)} title={t('account.pat.revokeTitle')}
        footer={
          <>
            <button onClick={() => setRevoking(null)} className="btn btn-ghost" disabled={revokeBusy}>{t('common.cancel')}</button>
            <button onClick={confirmRevoke} className="btn btn-primary" disabled={revokeBusy}>{revokeBusy ? t('account.pat.revoking') : t('account.pat.revoke')}</button>
          </>
        }
      >
        <p className="text-sm text-fg-secondary">
          <b className="text-fg">{revoking?.name}</b>{t('account.pat.revokeBody')}
        </p>
      </Modal>
    </div>
  )
}
