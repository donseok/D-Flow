'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Check, Copy, KeyRound, Plus, Trash2,
  AlertTriangle
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import {
  createMinutesApiCredential,
  listWorkspaceCredentials,
  revokeIntegrationCredential,
  type WorkspaceCredentialItem,
} from '@/app/actions/integrations'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'

interface ProjectOption {
  id: string
  name: string
}

interface TeamOption {
  id: string
  code: string
  name: string
}

const EXPIRES_OPTIONS: readonly { value: number; label: DictKey }[] = [
  { value: 30, label: 'settings.cred.expires.d30' },
  { value: 90, label: 'settings.cred.expires.d90' },
  { value: 180, label: 'settings.cred.expires.d180' },
  { value: 365, label: 'settings.cred.expires.d365' },
]

export function IntegrationCredentialsManager({
  workspaceId,
  projects = [],
  teams = [],
}: {
  workspaceId: string
  projects: ProjectOption[]
  teams: TeamOption[]
}) {
  const { t } = useLocale()
  const { toast } = useToast()
  const [credentials, setCredentials] = useState<WorkspaceCredentialItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterKind, setFilterKind] = useState<'all' | 'minutes_api' | 'agent_runner'>('all')

  // 발급 모달 상태
  const [issueOpen, setIssueOpen] = useState(false)
  const [name, setName] = useState('')
  const [allProjects, setAllProjects] = useState(true)
  const [selectedProjects, setSelectedProjects] = useState<string[]>([])
  const [defaultProjectId, setDefaultProjectId] = useState<string>('')
  const [defaultTeamId, setDefaultTeamId] = useState<string>('')
  const [teamMappings, setTeamMappings] = useState<Array<{ code: string; teamId: string }>>([])
  const [expiresDays, setExpiresDays] = useState(90)
  const [issuing, setIssuing] = useState(false)
  const [issueError, setIssueError] = useState<string | null>(null)

  // 발급 완료 토큰 1회 노출 모달
  const [issuedResult, setIssuedResult] = useState<{ token: string; prefix: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)

  // 회수 확인 모달
  const [revokingCred, setRevokingCred] = useState<WorkspaceCredentialItem | null>(null)
  const [revoking, setRevoking] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    const res = await listWorkspaceCredentials(workspaceId)
    if (res.ok) {
      setCredentials(res.credentials)
    } else {
      toast({ title: t('settings.cred.error'), description: res.error, variant: 'error' })
    }
    setLoading(false)
  }, [workspaceId, toast, t])

  useEffect(() => {
    void reload()
  }, [reload])

  function handleOpenIssue() {
    setName('')
    setAllProjects(true)
    setSelectedProjects([])
    setDefaultProjectId('')
    setDefaultTeamId('')
    setTeamMappings([])
    setExpiresDays(90)
    setIssueError(null)
    setIssueOpen(true)
  }

  function handleToggleProject(pid: string) {
    setSelectedProjects(prev => {
      const next = prev.includes(pid) ? prev.filter(id => id !== pid) : [...prev, pid]
      if (defaultProjectId && !next.includes(defaultProjectId)) {
        setDefaultProjectId('')
      }
      return next
    })
  }

  function handleAddMapping() {
    setTeamMappings(prev => [...prev, { code: '', teamId: teams[0]?.id ?? '' }])
  }

  function handleRemoveMapping(idx: number) {
    setTeamMappings(prev => prev.filter((_, i) => i !== idx))
  }

  function handleUpdateMapping(idx: number, field: 'code' | 'teamId', val: string) {
    setTeamMappings(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: val }
      return next
    })
  }

  async function submitIssue() {
    setIssueError(null)
    const trimmed = name.trim()
    if (!trimmed) {
      setIssueError(t('settings.cred.nameRequired'))
      return
    }
    if (!allProjects && selectedProjects.length === 0) {
      setIssueError(t('settings.cred.projectRequired'))
      return
    }

    const teamMap: Record<string, string> = {}
    for (const m of teamMappings) {
      const c = m.code.trim()
      if (!c) continue
      if (!m.teamId) {
        setIssueError(t('settings.cred.mapTeamRequired').replace('{c}', String(c)))
        return
      }
      teamMap[c] = m.teamId
    }

    setIssuing(true)
    try {
      const res = await createMinutesApiCredential({
        workspaceId,
        name: trimmed,
        projectIds: allProjects ? null : selectedProjects,
        defaultProjectId: defaultProjectId || null,
        defaultTeamId: defaultTeamId || null,
        teamMap,
        expiresDays,
      })

      if (!res.ok) {
        setIssueError(res.error)
        return
      }

      setIssueOpen(false)
      setIssuedResult({ token: res.token, prefix: res.prefix, name: trimmed })
      setCopied(false)
      toast({ title: t('settings.cred.issuedToast'), description: t('settings.cred.created').replace('{trimmed}', String(trimmed)) })
      await reload()
    } catch {
      setIssueError(t('wsAccounts.requestFailed'))
    } finally {
      setIssuing(false)
    }
  }

  async function copyToken(str: string) {
    try {
      await navigator.clipboard.writeText(str)
      setCopied(true)
      toast({ title: t('settings.cred.copiedToast'), description: t('settings.cred.copiedDesc') })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast({ title: t('settings.cred.copyFailed'), description: t('settings.cred.copyFailedDesc'), variant: 'error' })
    }
  }

  async function confirmRevoke() {
    if (!revokingCred) return
    setRevoking(true)
    try {
      const res = await revokeIntegrationCredential(revokingCred.id, workspaceId)
      if (res.ok) {
        toast({ title: t('settings.cred.revokedToast'), description: t('settings.cred.revokedDesc').replace('{name}', String(revokingCred.name)) })
        setRevokingCred(null)
        await reload()
      } else {
        toast({ title: t('settings.cred.revokeFailed'), description: res.error, variant: 'error' })
      }
    } finally {
      setRevoking(false)
    }
  }

  const filteredCredentials = credentials.filter(c => {
    if (filterKind === 'all') return true
    return c.kind === filterKind
  })

  const projectMap = new Map(projects.map(p => [p.id, p.name]))
  const teamMap = new Map(teams.map(t => [t.id, t.name || t.code]))

  function getStatus(c: WorkspaceCredentialItem) {
    if (c.revoked_at || !c.enabled) return { label: t('settings.cred.statusRevoked'), color: 'bg-surface-subtle text-fg-secondary' }
    const isExpired = new Date(c.expires_at).getTime() < Date.now()
    if (isExpired) return { label: t('settings.cred.statusExpired'), color: 'bg-danger-weak text-danger border-danger/20' }
    return { label: t('settings.forms.active'), color: 'bg-success-weak text-success border-success/20' }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 및 발급 버튼 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-fg flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-action" />
            {t('settings.cred.title')}
          </h2>
          <p className="text-sm text-fg-secondary">
            {t('settings.cred.desc')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenIssue}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-action px-3.5 py-2 text-sm font-medium text-action-fg transition hover:bg-action-hover focus:outline-none focus:ring-2 focus:ring-border-focus focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          {t('settings.cred.issueMinutes')}
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex border-b border-border text-sm">
        <button
          type="button"
          onClick={() => setFilterKind('all')}
          className={`border-b-2 px-4 py-2 font-medium transition ${
            filterKind === 'all'
              ? 'border-action text-action'
              : 'border-transparent text-fg-secondary hover:text-fg'
          }`}
        >
          {t('settings.cred.tabAll').replace('{n}', String(credentials.length))}
        </button>
        <button
          type="button"
          onClick={() => setFilterKind('minutes_api')}
          className={`border-b-2 px-4 py-2 font-medium transition ${
            filterKind === 'minutes_api'
              ? 'border-action text-action'
              : 'border-transparent text-fg-secondary hover:text-fg'
          }`}
        >
          {t('settings.cred.tabMinutes').replace('{n}', String(credentials.filter(c => c.kind === 'minutes_api').length))}
        </button>
        <button
          type="button"
          onClick={() => setFilterKind('agent_runner')}
          className={`border-b-2 px-4 py-2 font-medium transition ${
            filterKind === 'agent_runner'
              ? 'border-action text-action'
              : 'border-transparent text-fg-secondary hover:text-fg'
          }`}
        >
          {t('settings.cred.tabAgents').replace('{n}', String(credentials.filter(c => c.kind === 'agent_runner').length))}
        </button>
      </div>

      {/* 목록 뷰 */}
      {loading ? (
        <div className="flex justify-center py-12 text-sm text-fg-secondary">
          {t('settings.cred.loading')}
        </div>
      ) : filteredCredentials.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('settings.cred.emptyTitle')}
          description={
            filterKind === 'agent_runner'
              ? t('settings.cred.emptyAgents')
              : t('settings.cred.emptyMinutes')
          }
        />
      ) : (
        <div className="overflow-hidden rounded-(--radius-panel) border border-border bg-surface shadow-(--shadow-card)">
          <div className="overflow-x-auto">
            <table className="data-table w-full text-left text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-4 py-3">{t('settings.cred.colKindName')}</th>
                  <th scope="col" className="px-4 py-3">{t('settings.cred.colPrefix')}</th>
                  <th scope="col" className="px-4 py-3">{t('settings.cred.colScopeOwner')}</th>
                  <th scope="col" className="px-4 py-3">{t('issue.col.status')}</th>
                  <th scope="col" className="px-4 py-3">{t('settings.cred.colUsedExpires')}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t('wsAccounts.colActions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCredentials.map(c => {
                  const status = getStatus(c)
                  const isRevocable = !c.revoked_at && c.enabled

                  return (
                    <tr key={c.id} className="hover:bg-surface-hover transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              c.kind === 'minutes_api'
                                ? 'bg-action-soft text-action'
                                : 'bg-neutral-weak text-neutral'
                            }`}>
                              {c.kind === 'minutes_api' ? t('settings.cred.kindMinutes') : t('nav.projectAgents')}
                            </span>
                            <span className="font-semibold text-fg">{c.name}</span>
                          </div>
                          <span className="text-xs text-fg-secondary">
                            {t('settings.cred.issuedOn').replace('{v}', String(c.created_at ? c.created_at.slice(0, 10) : ''))}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 font-mono text-xs text-fg-secondary">
                        <div className="inline-flex items-center gap-1.5 rounded bg-surface-subtle px-2 py-1">
                          <span>{c.token_prefix}...</span>
                          <button
                            type="button"
                            onClick={() => copyToken(c.token_prefix)}
                            className="text-fg-secondary hover:text-fg"
                            title={t('settings.cred.copyPrefix')}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-fg-secondary">
                        {c.kind === 'agent_runner' ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-fg">{c.owner_name || t('min.hl.unnamed')}</span>
                            <span>{c.owner_email || t('settings.cred.noEmail')}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span>
                              {c.project_ids === null ? (
                                <span className="font-medium text-fg">{t('nav.allProjects')}</span>
                              ) : (
                                <span className="font-medium text-fg">
                                  {t('settings.cred.projectCount').replace('{n}', String(c.project_ids.length)).replace('{v}', String(c.project_ids.map(id => projectMap.get(id) || id).slice(0, 2).join(', '))).replace('{v2}', String(c.project_ids.length > 2 ? t('settings.cred.moreCount').replace('{n}', String(c.project_ids.length - 2)) : ''))}
                                </span>
                              )}
                            </span>
                            {c.default_project_id && (
                              <span className="text-xs">
                                {t('settings.cred.defaultProject').replace('{default_project_id}', String(projectMap.get(c.default_project_id) || c.default_project_id))}
                              </span>
                            )}
                            {c.default_team_id && (
                              <span className="text-xs">
                                {t('settings.cred.defaultTeam').replace('{default_team_id}', String(teamMap.get(c.default_team_id) || c.default_team_id))}
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${status.color}`}>
                          {status.label}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-fg-secondary">
                        <div className="flex flex-col">
                          <span>{t('settings.cred.used')} {c.last_used_at ? c.last_used_at.slice(0, 16).replace('T', ' ') : t('settings.cred.unused')}</span>
                          <span>{t('settings.cred.expiresOn').replace('{v}', String(c.expires_at ? c.expires_at.slice(0, 10) : ''))}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        {isRevocable ? (
                          <button
                            type="button"
                            onClick={() => setRevokingCred(c)}
                            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-danger-weak"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('settings.cred.revoke')}
                          </button>
                        ) : (
                          <span className="text-xs text-fg-secondary">{t('settings.cred.statusRevoked')}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 발급 모달 */}
      {issueOpen && (
        <Modal
          open={issueOpen}
          onClose={() => !issuing && setIssueOpen(false)}
          title={t('settings.cred.issueTitle')}
        >
          <div className="space-y-4 py-2">
            {issueError && (
              <div className="rounded-lg bg-danger-weak p-3 text-sm text-danger border border-danger/20">
                {issueError}
              </div>
            )}

            <div>
              <label htmlFor="token-name" className="block text-sm font-medium text-fg">
                {t('settings.cred.tokenName')} <span className="text-danger">*</span>
              </label>
              <input
                id="token-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('settings.cred.tokenNamePh')}
                maxLength={64}
                className="mt-1 block w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
              <p className="mt-1 text-xs text-fg-secondary">
                {t('settings.cred.tokenNameHint')}
              </p>
            </div>

            {/* 허용 프로젝트 범위 */}
            <div>
              <label className="block text-sm font-medium text-fg">{t('settings.cred.scopeTitle')}</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="project-scope"
                    checked={allProjects}
                    onChange={() => setAllProjects(true)}
                    className="text-action focus:ring-border-focus"
                  />
                  <span>{t('settings.cred.scopeAll')}</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="project-scope"
                    checked={!allProjects}
                    onChange={() => setAllProjects(false)}
                    className="text-action focus:ring-border-focus"
                  />
                  <span>{t('settings.cred.scopeSome')}</span>
                </label>
              </div>

              {!allProjects && (
                <div className="mt-3 max-h-36 overflow-y-auto rounded-md border border-border-input p-2 space-y-1 bg-surface-subtle">
                  {projects.length === 0 ? (
                    <p className="text-xs text-fg-secondary p-2">{t('settings.cred.noProjects')}</p>
                  ) : (
                    projects.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-surface-hover cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedProjects.includes(p.id)}
                          onChange={() => handleToggleProject(p.id)}
                          className="rounded text-action focus:ring-border-focus"
                        />
                        <span className="font-medium text-fg">{p.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 기본 프로젝트 선택 */}
            <div>
              <label htmlFor="default-project" className="block text-sm font-medium text-fg">
                {t('settings.cred.defaultProjectLabel')}
              </label>
              <select
                id="default-project"
                value={defaultProjectId}
                onChange={e => setDefaultProjectId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              >
                <option value="">{t('settings.cred.defaultProjectNone')}</option>
                {(allProjects ? projects : projects.filter(p => selectedProjects.includes(p.id))).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-fg-secondary">
                {t('settings.cred.defaultProjectHint')}
              </p>
            </div>

            {/* 기본 팀 선택 */}
            <div>
              <label htmlFor="default-team" className="block text-sm font-medium text-fg">
                {t('settings.cred.defaultTeamLabel')}
              </label>
              <select
                id="default-team"
                value={defaultTeamId}
                onChange={e => setDefaultTeamId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              >
                <option value="">{t('settings.cred.notSet')}</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name ? `${t.name} (${t.code})` : t.code}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-fg-secondary">
                {t('settings.cred.defaultTeamHint')}
              </p>
            </div>

            {/* 팀 코드 매핑 */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-fg">{t('settings.cred.teamMapLabel')}</label>
                <button
                  type="button"
                  onClick={handleAddMapping}
                  className="text-xs text-action font-medium hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> {t('settings.cred.addMapping')}
                </button>
              </div>
              <p className="mt-0.5 text-xs text-fg-secondary">
                {t('settings.cred.teamMapHint')}
              </p>

              {teamMappings.length > 0 && (
                <div className="mt-2 space-y-2">
                  {teamMappings.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={m.code}
                        onChange={e => handleUpdateMapping(idx, 'code', e.target.value)}
                        placeholder={t('settings.cred.externalCodePh')}
                        className="flex-1 rounded-md border border-border-input bg-surface px-2.5 py-1.5 text-xs focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                      />
                      <span className="text-fg-secondary text-xs">→</span>
                      <select
                        value={m.teamId}
                        onChange={e => handleUpdateMapping(idx, 'teamId', e.target.value)}
                        className="flex-1 rounded-md border border-border-input bg-surface px-2.5 py-1.5 text-xs focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                      >
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name ? `${t.name} (${t.code})` : t.code}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => handleRemoveMapping(idx)}
                        className="p-1 text-fg-secondary hover:text-danger"
                        title={t('common.delete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 만료 기간 */}
            <div>
              <label htmlFor="token-expires" className="block text-sm font-medium text-fg">
                {t('settings.cred.validity')}
              </label>
              <select
                id="token-expires"
                value={expiresDays}
                onChange={e => setExpiresDays(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              >
                {EXPIRES_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.label)}
                  </option>
                ))}
              </select>
            </div>

            {/* 제출 버튼 */}
            <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIssueOpen(false)}
                disabled={issuing}
                className="rounded-lg border border-border-input bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-hover transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={submitIssue}
                disabled={issuing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-action px-4 py-2 text-sm font-medium text-action-fg hover:bg-action-hover transition disabled:opacity-50"
              >
                {issuing ? t('settings.cred.issuing') : t('settings.cred.issue')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 발급된 토큰 1회 노출 모달 */}
      {issuedResult && (
        <Modal
          open={Boolean(issuedResult)}
          onClose={() => setIssuedResult(null)}
          title={t('settings.cred.issuedTitle')}
        >
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-warning-weak p-3.5 text-sm text-warning border border-warning/20 flex gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="font-semibold">{t('settings.cred.onceTitle')}</p>
                <p className="text-xs">
                  {t('settings.cred.onceDesc')}
                </p>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-fg-secondary">{t('settings.cred.tokenName')}</span>
              <span className="text-sm font-medium text-fg">{issuedResult.name}</span>
            </div>

            <div>
              <span className="block text-xs font-semibold text-fg-secondary mb-1">{t('settings.cred.bearer')}</span>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  value={issuedResult.token}
                  className="w-full rounded-md border border-border-input bg-surface-subtle font-mono text-xs px-3 py-2 pr-12 text-fg select-all"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => copyToken(issuedResult.token)}
                  className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-surface border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-surface-hover transition"
                >
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? t('settings.invite.copied') : t('settings.cred.copy')}</span>
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIssuedResult(null)}
                className="rounded-lg bg-action px-4 py-2 text-sm font-medium text-action-fg hover:bg-action-hover transition"
              >
                {t('settings.cred.confirmClose')}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* 회수 확인 모달 */}
      {revokingCred && (
        <Modal
          open={Boolean(revokingCred)}
          onClose={() => !revoking && setRevokingCred(null)}
          title={t('settings.cred.revokeTitle')}
        >
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-danger-weak p-3.5 text-sm text-danger border border-danger/20 flex gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
              <div>
                <p className="font-semibold">{t('settings.cred.revokeAsk')}</p>
                <p className="text-xs mt-1">
                  {t('settings.cred.revokeDesc').replace('{name}', String(revokingCred.name)).replace('{token_prefix}', String(revokingCred.token_prefix))}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setRevokingCred(null)}
                disabled={revoking}
                className="rounded-lg border border-border-input bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-hover transition"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmRevoke}
                disabled={revoking}
                className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-4 py-2 text-sm font-medium text-danger-fg hover:bg-danger/90 transition disabled:opacity-50"
              >
                {revoking ? t('settings.cred.revoking') : t('settings.cred.revokeGo')}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
