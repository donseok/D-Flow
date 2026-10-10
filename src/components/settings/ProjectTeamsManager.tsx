'use client'

// 프로젝트 스코프 팀 관리(0071) — admin/TeamsManager 를 본뜨되 가드·액션·문구가 다르다.
// 회의록 팀 루트는 여기서 만들지 않는다 — 이 프로젝트에 연결한 회의록이 처음 편철될 때 지연 생성된다(lib/minutes/folders 의 루트 보장).
// 삭제 버튼은 없다: 비활성화가 삭제(공용 팀과 동일 관례).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Merge, Plus, Power } from 'lucide-react'
import {
  addProjectTeam, changeProjectTeamCode, copyGlobalTeams, mergeProjectTeams, previewProjectTeamMerge, updateProjectTeam,
} from '@/app/actions/projectTeams'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { DictKey } from '@/lib/i18n/dict'
import { TeamNameCell } from '@/components/settings/TeamNameCell'
import { TeamAddForm, EMPTY_TEAM_DRAFT, type TeamDraft } from '@/components/settings/TeamAddForm'
import { TeamColorPicker } from '@/components/settings/TeamColorPicker'
import { TeamCodeCell } from '@/components/settings/TeamCodeCell'
import { TeamMergeDialog } from '@/components/settings/TeamMergeDialog'

/** admin/TeamsManager.tsx 의 AdminTeamRow 와 형태가 같지만 별개 선언이다 — 액션·문구가
 *  프로젝트 스코프로 갈라져 있어 import 로 묶으면 오히려 결합이 생긴다(브리프 지시). */
export interface AdminTeamRow {
  id: string
  code: string
  name: string
  color: string
  sortOrder: number
  active: boolean
  progressVisible: boolean
}

/** 상속 중(프로젝트 팀 0개) 상태에서 '빈 목록에서 시작'의 첫 추가를 실행하기 전에만 뜨는 경고. */
const INHERITANCE_WARNING: DictKey =
  'settings.projTeams.inheritWarning'
/** '공용 팀 전환으로 시작'의 확인 문구 — 전환 RPC 의 실제 결과(SP4 D54·T14) */
const CONVERT_WARNING: DictKey =
  'settings.projTeams.convertWarning'

type PendingAction = { type: 'add'; name: string; code: string | null } | { type: 'copy' }

export function ProjectTeamsManager({ projectId, teams, inherited, hasGlobalTeams }: {
  projectId: string
  teams: AdminTeamRow[]
  inherited: boolean
  /** 공용 활성 팀이 1개 이상 있는가 — 없으면 '공용 팀 전환으로 시작'은 지어낼 것이 없어 막는다. */
  hasGlobalTeams: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t: tr } = useLocale()
  const [draft, setDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 상속 안내 패널에서 '빈 목록에서 시작'을 눌렀을 때만 추가 입력을 드러낸다.
  const [showAddInput, setShowAddInput] = useState(false)
  const [confirming, setConfirming] = useState<PendingAction | null>(null)
  // 합치기 모달의 원본 팀 — 한 번에 한 팀만
  const [merging, setMerging] = useState<AdminTeamRow | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? tr('settings.projTeams.failed')); return }
      router.refresh()
    })
  }

  function doAdd(name: string, code: string | null) {
    run(async () => {
      const r = await addProjectTeam(projectId, name, code)
      if (r.ok) { setDraft(EMPTY_TEAM_DRAFT); toast({ title: tr('settings.projTeams.added').replace('{name}', String(name)), variant: 'success' }) }
      return r
    })
  }

  function doCopy() {
    run(async () => {
      const r = await copyGlobalTeams(projectId)
      if (r.ok) toast({ title: tr('settings.projTeams.converted'), variant: 'success' })
      return r
    })
  }

  function submitAdd() {
    const name = draft.name.trim()
    if (!name) { setError(tr('settings.teamName.required')); return }
    // 코드 칸이 비면 넘기지 않는다 — 액션이 이름에서 기본 코드를 만든다(화면이 미리 보인 값과 같은 함수)
    const code = draft.code.trim() || null
    // 상속 중일 때만 경고 — 이미 프로젝트 팀이 정의돼 있으면(inherited=false) 곧장 추가한다.
    if (inherited) { setConfirming({ type: 'add', name, code }); return }
    doAdd(name, code)
  }

  function confirmProceed() {
    const action = confirming
    setConfirming(null)
    if (!action) return
    if (action.type === 'add') doAdd(action.name, action.code)
    else doCopy()
  }

  /** 정렬 스왑 — 인접 행과 순번을 맞바꾼다. 한 액션이 두 행을 바꾸고 둘째가 실패하면 첫 행을 되돌린다(공용 팀 화면과 같다). */
  function move(idx: number, dir: -1 | 1) {
    const a = teams[idx], b = teams[idx + dir]
    if (!a || !b) return
    run(() => updateProjectTeam(projectId, a.id, { swapOrderWith: b.id }))
  }

  const warningModal = (
    <Modal
      open={!!confirming}
      onClose={() => { if (!pending) setConfirming(null) }}
      title={confirming?.type === 'copy' ? tr('settings.projTeams.convertTitle') : tr('settings.projTeams.stopInheritTitle')}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(null)}>
            {tr('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={confirmProceed}>
            {pending ? tr('wbs.processing') : confirming?.type === 'copy' ? tr('settings.projTeams.convertGo') : tr('min.issue.continue')}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-fg-secondary">{tr(confirming?.type === 'copy' ? CONVERT_WARNING : INHERITANCE_WARNING)}</p>
    </Modal>
  )

  if (inherited) {
    return (
      <section className="card overflow-hidden">
        <div className="p-5 sm:p-6">
          {error && (
            <p role="alert" className="mb-3 rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>
          )}
          <div className="panel-soft flex flex-col gap-4 p-5">
            <p className="text-sm leading-6 text-fg">
              {tr('settings.projTeams.inheriting')}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming({ type: 'copy' })} className="btn btn-primary"
                disabled={pending || !hasGlobalTeams}
                title={hasGlobalTeams ? undefined : tr('settings.projTeams.noShared')}>
                <Copy className="h-4 w-4" />{tr('settings.projTeams.startConvert')}
              </button>
              <button type="button" onClick={() => setShowAddInput(true)} className="btn btn-ghost" disabled={pending || showAddInput}>
                <Plus className="h-4 w-4" />{tr('settings.projTeams.startEmpty')}
              </button>
            </div>
            {/* 공용 팀도 없으면 이 프로젝트에는 팀이 하나도 없다 — 상속할 것이 없다는 사실과 첫 팀을 만드는 길을 알린다 */}
            {!hasGlobalTeams && <p data-team-empty className="text-sm leading-6 text-fg-secondary">{tr('settings.teams.noCommonHint')}</p>}
            {showAddInput && (
              <div className="border-t border-border pt-4">
                <TeamAddForm value={draft} onChange={setDraft} onSubmit={submitAdd} pending={pending} autoFocus
                  onCancel={() => { setShowAddInput(false); setDraft(EMPTY_TEAM_DRAFT); setError(null) }} />
              </div>
            )}
          </div>
          <p className="mt-4 text-xs leading-5 text-fg-muted">{tr('settings.teams.projectScopeNote')}</p>
        </div>
        {warningModal}
      </section>
    )
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-fg">{tr('settings.projTeams.listTitle')}</h2>
          <p className="text-sm text-fg-secondary">
            {tr('settings.projTeams.listDesc')}
          </p>
        </div>
        <TeamAddForm value={draft} onChange={setDraft} onSubmit={submitAdd} pending={pending} />
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="overflow-x-auto">
          <table className="data-table w-full min-w-[760px] whitespace-nowrap text-sm">
            <thead>
              <tr>
                <th className="py-2 pr-3">{tr('settings.vocab.order')}</th>
                <th className="px-2.5 py-2">{tr('settings.teams.colColor')}</th>
                <th className="py-2 pr-3">{tr('settings.teams.colName')}</th>
                <th className="py-2 pr-3">{tr('settings.teams.colCode')}</th>
                <th className="py-2 pr-3">{tr('issue.col.status')}</th>
                <th className="py-2 pr-3">{tr('dash.teamProgress.title')}</th>
                <th className="py-2 pr-3 text-right">{tr('wsAccounts.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id} data-team-row={t.id} className={`border-b border-border/60 ${t.active ? '' : 'opacity-60'}`}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => move(i, -1)} disabled={pending || i === 0}
                        className="btn btn-ghost btn-sm" aria-label={tr('settings.projTeams.moveUp').replace('{name}', String(t.name))}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={pending || i === teams.length - 1}
                        className="btn btn-ghost btn-sm" aria-label={tr('settings.projTeams.moveDown').replace('{name}', String(t.name))}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5">
                    <TeamColorPicker team={t} disabled={pending}
                      onPick={(slot) => run(async () => {
                        const r = await updateProjectTeam(projectId, t.id, { colorSlot: slot })
                        if (r.ok) toast({ title: tr('settings.teams.colorSaved').replace('{name}', t.name), variant: 'success' })
                        return r
                      })} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <TeamNameCell team={t} disabled={pending}
                      onRename={async (name) => {
                        const r = await updateProjectTeam(projectId, t.id, { name })
                        if (r.ok) { toast({ title: tr('settings.projTeams.renamed').replace('{name}', String(t.name)).replace('{name2}', String(name)), variant: 'success' }); router.refresh() }
                        return r
                      }} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <TeamCodeCell team={t} disabled={pending}
                      onChange={async (code) => {
                        const r = await changeProjectTeamCode(projectId, t.id, code)
                        if (r.ok) {
                          toast({ title: tr('settings.teams.codeSaved').replace('{name}', t.name).replace('{code}', code), variant: 'success' })
                          // 코드는 바뀌었고 엑셀 양식만 못 맞춘 경우 — 서버 문구를 한 번 더 알린다
                          if (r.notice) toast({ title: r.notice, variant: 'info' })
                          router.refresh()
                        }
                        return r
                      }} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`chip ${t.active ? 'bg-success-weak text-success' : 'bg-surface-subtle text-fg-muted'}`}>
                      {t.active ? tr('settings.forms.active') : tr('issue.analysis.areaInactive')}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`chip ${t.progressVisible ? 'bg-action-soft text-action' : 'bg-surface-subtle text-fg-muted'}`}>
                      {t.progressVisible ? tr('settings.projTeams.shown') : tr('wiki.view.archived')}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => run(() => updateProjectTeam(projectId, t.id, { progressVisible: !t.progressVisible }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.progressVisible ? tr('settings.projTeams.hideProgress') : tr('settings.projTeams.showProgress')}>
                        {t.progressVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        {tr('ui.progress')}
                      </button>
                      <button
                        onClick={() => run(() => updateProjectTeam(projectId, t.id, { active: !t.active }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.active ? tr('settings.projTeams.deactivateTitle') : tr('settings.projTeams.reactivate')}>
                        <Power className="h-3.5 w-3.5" />
                        {t.active ? tr('settings.projTeams.deactivate') : tr('settings.forms.activate')}
                      </button>
                      <button onClick={() => { setError(null); setMerging(t) }} data-team-merge-open={t.id}
                        className="btn btn-ghost btn-sm" disabled={pending} title={tr('settings.teams.mergeDialogTitle')}
                        aria-label={tr('settings.teams.mergeAction').replace('{name}', t.name)}>
                        <Merge className="h-3.5 w-3.5" />
                        {tr('settings.teams.merge')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-fg-muted">{tr('settings.teams.codeExplain')} {tr('settings.teams.projectScopeNote')}</p>
      </div>
      <TeamMergeDialog source={merging} teams={teams} onClose={() => setMerging(null)}
        onPreview={(targetId) => previewProjectTeamMerge(projectId, merging!.id, targetId)}
        onMerge={(targetId) => mergeProjectTeams(projectId, merging!.id, targetId)}
        onMerged={(target, summary) => {
          const renamed = summary.foldersRenamed > 0 ? ` ${tr('settings.teams.mergeDoneRenamed').replace('{n}', String(summary.foldersRenamed))}` : ''
          toast({ title: tr('settings.teams.mergeDone').replace('{source}', merging!.name).replace('{target}', target.name) + renamed, variant: 'success' })
          setMerging(null)
          router.refresh()
        }} />
    </section>
  )
}
