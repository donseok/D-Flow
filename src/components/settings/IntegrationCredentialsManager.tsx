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
import { BRAND } from '@/lib/branding'

interface ProjectOption {
  id: string
  name: string
}

interface TeamOption {
  id: string
  code: string
  name: string
}

const EXPIRES_OPTIONS = [
  { value: 30, label: '30일' },
  { value: 90, label: '90일 (기본)' },
  { value: 180, label: '180일' },
  { value: 365, label: '365일 (1년)' },
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
      toast({ title: '오류', description: res.error, variant: 'error' })
    }
    setLoading(false)
  }, [workspaceId, toast])

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
      setIssueError('토큰 이름을 입력하세요.')
      return
    }
    if (!allProjects && selectedProjects.length === 0) {
      setIssueError('허용할 프로젝트를 1개 이상 선택하세요.')
      return
    }

    const teamMap: Record<string, string> = {}
    for (const m of teamMappings) {
      const c = m.code.trim()
      if (!c) continue
      if (!m.teamId) {
        setIssueError(`'${c}'에 매핑할 팀을 선택하세요.`)
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
      toast({ title: '발급 완료', description: `'${trimmed}' 자격증명이 생성되었습니다.` })
      await reload()
    } catch {
      setIssueError('요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.')
    } finally {
      setIssuing(false)
    }
  }

  async function copyToken(str: string) {
    try {
      await navigator.clipboard.writeText(str)
      setCopied(true)
      toast({ title: '복사 완료', description: '토큰이 클립보드에 복사되었습니다.' })
      setTimeout(() => setCopied(false), 2500)
    } catch {
      toast({ title: '복사 실패', description: '클립보드 권한을 확인하세요.', variant: 'error' })
    }
  }

  async function confirmRevoke() {
    if (!revokingCred) return
    setRevoking(true)
    try {
      const res = await revokeIntegrationCredential(revokingCred.id, workspaceId)
      if (res.ok) {
        toast({ title: '회수 완료', description: `'${revokingCred.name}' 토큰이 회수되었습니다.` })
        setRevokingCred(null)
        await reload()
      } else {
        toast({ title: '회수 실패', description: res.error, variant: 'error' })
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
    if (c.revoked_at || !c.enabled) return { label: '회수됨', color: 'bg-muted text-muted-foreground' }
    const isExpired = new Date(c.expires_at).getTime() < Date.now()
    if (isExpired) return { label: '만료됨', color: 'bg-destructive/10 text-destructive border-destructive/20' }
    return { label: '활성', color: 'bg-success-weak text-success border-success/20' }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 및 발급 버튼 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            연동 자격증명 (API 토큰)
          </h2>
          <p className="text-sm text-muted-foreground">
            회의록 외부 연동(또박또박) 및 에이전트 실행을 위한 API 토큰을 발급하고 관리합니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenIssue}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          회의록 연동 토큰 발급
        </button>
      </div>

      {/* 필터 탭 */}
      <div className="flex border-b border-border text-sm">
        <button
          type="button"
          onClick={() => setFilterKind('all')}
          className={`border-b-2 px-4 py-2 font-medium transition ${
            filterKind === 'all'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          전체 ({credentials.length})
        </button>
        <button
          type="button"
          onClick={() => setFilterKind('minutes_api')}
          className={`border-b-2 px-4 py-2 font-medium transition ${
            filterKind === 'minutes_api'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          회의록 연동 ({credentials.filter(c => c.kind === 'minutes_api').length})
        </button>
        <button
          type="button"
          onClick={() => setFilterKind('agent_runner')}
          className={`border-b-2 px-4 py-2 font-medium transition ${
            filterKind === 'agent_runner'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          에이전트 토큰 ({credentials.filter(c => c.kind === 'agent_runner').length})
        </button>
      </div>

      {/* 목록 뷰 */}
      {loading ? (
        <div className="flex justify-center py-12 text-sm text-muted-foreground">
          자격증명 목록을 불러오는 중...
        </div>
      ) : filteredCredentials.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="등록된 연동 자격증명이 없습니다"
          description={
            filterKind === 'agent_runner'
              ? '에이전트 토큰은 사용자가 내 계정(/account) 페이지에서 직접 발급합니다.'
              : '우측 상단의 발급 버튼을 눌러 새 회의록 연동 토큰을 생성하세요.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">종류 / 이름</th>
                  <th scope="col" className="px-4 py-3">접두사 (Prefix)</th>
                  <th scope="col" className="px-4 py-3">허용 범위 / 소유자</th>
                  <th scope="col" className="px-4 py-3">상태</th>
                  <th scope="col" className="px-4 py-3">최근 사용 / 만료</th>
                  <th scope="col" className="px-4 py-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredCredentials.map(c => {
                  const status = getStatus(c)
                  const isRevocable = !c.revoked_at && c.enabled

                  return (
                    <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ${
                              c.kind === 'minutes_api'
                                ? 'bg-action-soft text-action'
                                : 'bg-neutral-weak text-neutral'
                            }`}>
                              {c.kind === 'minutes_api' ? '회의록 연동' : '에이전트'}
                            </span>
                            <span className="font-semibold text-foreground">{c.name}</span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            발급일: {c.created_at ? c.created_at.slice(0, 10) : ''}
                          </span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 font-mono text-xs text-muted-foreground">
                        <div className="inline-flex items-center gap-1.5 rounded bg-muted/60 px-2 py-1">
                          <span>{c.token_prefix}...</span>
                          <button
                            type="button"
                            onClick={() => copyToken(c.token_prefix)}
                            className="text-muted-foreground hover:text-foreground"
                            title="접두사 복사"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        {c.kind === 'agent_runner' ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{c.owner_name || '이름 없음'}</span>
                            <span>{c.owner_email || '이메일 없음'}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span>
                              {c.project_ids === null ? (
                                <span className="font-medium text-foreground">전체 프로젝트</span>
                              ) : (
                                <span className="font-medium text-foreground">
                                  {c.project_ids.length}개 프로젝트 (
                                  {c.project_ids.map(id => projectMap.get(id) || id).slice(0, 2).join(', ')}
                                  {c.project_ids.length > 2 ? ` 외 ${c.project_ids.length - 2}건` : ''}
                                  )
                                </span>
                              )}
                            </span>
                            {c.default_project_id && (
                              <span className="text-xs">
                                기본 프로젝트: {projectMap.get(c.default_project_id) || c.default_project_id}
                              </span>
                            )}
                            {c.default_team_id && (
                              <span className="text-xs">
                                기본 팀: {teamMap.get(c.default_team_id) || c.default_team_id}
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

                      <td className="px-4 py-3.5 text-xs text-muted-foreground">
                        <div className="flex flex-col">
                          <span>사용: {c.last_used_at ? c.last_used_at.slice(0, 16).replace('T', ' ') : '미사용'}</span>
                          <span>만료: {c.expires_at ? c.expires_at.slice(0, 10) : ''}</span>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        {isRevocable ? (
                          <button
                            type="button"
                            onClick={() => setRevokingCred(c)}
                            className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-destructive transition hover:bg-destructive/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            회수
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">회수됨</span>
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
          title="새 회의록 연동 토큰 발급 (minutes_api)"
        >
          <div className="space-y-4 py-2">
            {issueError && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive border border-destructive/20">
                {issueError}
              </div>
            )}

            <div>
              <label htmlFor="token-name" className="block text-sm font-medium text-foreground">
                토큰 이름 <span className="text-destructive">*</span>
              </label>
              <input
                id="token-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="예: 또박또박 연동 토큰 (본사)"
                maxLength={64}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                자격증명의 용도나 식별 가능한 시스템 이름을 입력하세요 (1~64자).
              </p>
            </div>

            {/* 허용 프로젝트 범위 */}
            <div>
              <label className="block text-sm font-medium text-foreground">허용 프로젝트 범위</label>
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="project-scope"
                    checked={allProjects}
                    onChange={() => setAllProjects(true)}
                    className="text-primary focus:ring-primary"
                  />
                  <span>이 워크스페이스의 모든 프로젝트 허용 (기본)</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="project-scope"
                    checked={!allProjects}
                    onChange={() => setAllProjects(false)}
                    className="text-primary focus:ring-primary"
                  />
                  <span>특정 프로젝트만 허용</span>
                </label>
              </div>

              {!allProjects && (
                <div className="mt-3 max-h-36 overflow-y-auto rounded-md border border-input p-2 space-y-1 bg-muted/20">
                  {projects.length === 0 ? (
                    <p className="text-xs text-muted-foreground p-2">워크스페이스에 프로젝트가 없습니다.</p>
                  ) : (
                    projects.map(p => (
                      <label key={p.id} className="flex items-center gap-2 text-xs py-1 px-1.5 rounded hover:bg-muted/40 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedProjects.includes(p.id)}
                          onChange={() => handleToggleProject(p.id)}
                          className="rounded text-primary focus:ring-primary"
                        />
                        <span className="font-medium text-foreground">{p.name}</span>
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 기본 프로젝트 선택 */}
            <div>
              <label htmlFor="default-project" className="block text-sm font-medium text-foreground">
                기본 프로젝트 (선택)
              </label>
              <select
                id="default-project"
                value={defaultProjectId}
                onChange={e => setDefaultProjectId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">(지정 안 함 — 요청 페이로드 또는 미지정으로 처리)</option>
                {(allProjects ? projects : projects.filter(p => selectedProjects.includes(p.id))).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                외부 시스템이 프로젝트를 지정하지 않고 전송할 때 자동으로 귀속될 기본 프로젝트입니다.
              </p>
            </div>

            {/* 기본 팀 선택 */}
            <div>
              <label htmlFor="default-team" className="block text-sm font-medium text-foreground">
                기본 팀 (선택)
              </label>
              <select
                id="default-team"
                value={defaultTeamId}
                onChange={e => setDefaultTeamId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">(지정 안 함)</option>
                {teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name ? `${t.name} (${t.code})` : t.code}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-muted-foreground">
                팀 매핑이 일치하지 않을 때 폴백으로 적용될 기본 팀입니다.
              </p>
            </div>

            {/* 팀 코드 매핑 */}
            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-foreground">팀 코드 매핑 (선택)</label>
                <button
                  type="button"
                  onClick={handleAddMapping}
                  className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> 매핑 추가
                </button>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                외부 시스템의 팀 코드와 {BRAND.productName} 팀이 다를 때 매핑을 지정합니다.
              </p>

              {teamMappings.length > 0 && (
                <div className="mt-2 space-y-2">
                  {teamMappings.map((m, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={m.code}
                        onChange={e => handleUpdateMapping(idx, 'code', e.target.value)}
                        placeholder="외부 팀 코드 (예: ERP_DEV)"
                        className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <span className="text-muted-foreground text-xs">→</span>
                      <select
                        value={m.teamId}
                        onChange={e => handleUpdateMapping(idx, 'teamId', e.target.value)}
                        className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
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
                        className="p-1 text-muted-foreground hover:text-destructive"
                        title="삭제"
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
              <label htmlFor="token-expires" className="block text-sm font-medium text-foreground">
                유효 기간
              </label>
              <select
                id="token-expires"
                value={expiresDays}
                onChange={e => setExpiresDays(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {EXPIRES_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
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
                className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitIssue}
                disabled={issuing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50"
              >
                {issuing ? '발급 중...' : '토큰 발급'}
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
          title="새 연동 토큰이 발급되었습니다"
        >
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-warning-weak p-3.5 text-sm text-warning border border-warning/20 flex gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
              <div className="space-y-1">
                <p className="font-semibold">이 토큰은 지금 한 번만 확인할 수 있습니다.</p>
                <p className="text-xs">
                  창을 닫으면 토큰의 전체 문자열을 다시 조회할 수 없습니다. 지금 복사하여 연동 시스템(또박또박의 Authorization 헤더 등)에 등록하세요.
                </p>
              </div>
            </div>

            <div>
              <span className="block text-xs font-semibold text-muted-foreground">토큰 이름</span>
              <span className="text-sm font-medium text-foreground">{issuedResult.name}</span>
            </div>

            <div>
              <span className="block text-xs font-semibold text-muted-foreground mb-1">토큰 (Bearer Token)</span>
              <div className="relative">
                <input
                  type="text"
                  readOnly
                  value={issuedResult.token}
                  className="w-full rounded-md border border-input bg-muted/40 font-mono text-xs px-3 py-2 pr-12 text-foreground select-all"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => copyToken(issuedResult.token)}
                  className="absolute right-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-background border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted transition"
                >
                  {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  <span>{copied ? '복사됨' : '복사'}</span>
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setIssuedResult(null)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition"
              >
                확인 및 닫기
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
          title="자격증명 회수 확인"
        >
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-destructive/10 p-3.5 text-sm text-destructive border border-destructive/20 flex gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-semibold">정말 이 자격증명을 회수하시겠습니까?</p>
                <p className="text-xs mt-1">
                  &apos;{revokingCred.name}&apos; ({revokingCred.token_prefix}...) 토큰이 즉시 비활성화되며, 이 토큰을 사용하는 외부 연동 및 API 호출이 즉시 거부(401)됩니다. 회수한 토큰은 되돌릴 수 없습니다.
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setRevokingCred(null)}
                disabled={revoking}
                className="rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition"
              >
                취소
              </button>
              <button
                type="button"
                onClick={confirmRevoke}
                disabled={revoking}
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition disabled:opacity-50"
              >
                {revoking ? '회수 중...' : '자격증명 회수'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
