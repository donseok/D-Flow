'use client'

// 팀 기준정보 관리 테이블 — AccountsManager 와 동일한 카드·버튼·칩 컨벤션.
// 삭제 버튼은 의도적으로 없다: 비활성화가 삭제(데이터 보존, 사용자 결정 2026-07-24).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Eye, EyeOff, Merge, Power, Users } from 'lucide-react'
import { addTeam, changeTeamCode, mergeTeams, previewTeamMerge, updateTeam } from '@/app/actions/teams'
import { useToast } from '@/components/ui/Toast'
import { EmptyState } from '@/components/ui/EmptyState'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TeamNameCell } from '@/components/settings/TeamNameCell'
import { TeamAddForm, EMPTY_TEAM_DRAFT, type TeamDraft } from '@/components/settings/TeamAddForm'
import { TeamColorPicker } from '@/components/settings/TeamColorPicker'
import { TeamCodeCell } from '@/components/settings/TeamCodeCell'
import { TeamMergeDialog } from '@/components/settings/TeamMergeDialog'

export interface AdminTeamRow {
  id: string
  code: string
  name: string
  color: string
  sortOrder: number
  active: boolean
  progressVisible: boolean
}

export function TeamsManager({ teams, workspaceId }: {
  teams: AdminTeamRow[]
  /** 공용 팀을 추가할 워크스페이스 — SP3 전까지 페이지가 유일 소속으로 정해 넘긴다. */
  workspaceId: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t: tr } = useLocale()
  const [draft, setDraft] = useState<TeamDraft>(EMPTY_TEAM_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 합치기 모달의 원본 팀 — 한 번에 한 팀만
  const [merging, setMerging] = useState<AdminTeamRow | null>(null)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? '실패했습니다.'); return }
      router.refresh()
    })
  }

  function submitAdd() {
    const name = draft.name.trim()
    if (!name) { setError('팀 이름을 입력하세요.'); return }
    // 코드 칸이 비면 넘기지 않는다 — 액션이 이름에서 기본 코드를 만든다(화면이 미리 보인 값과 같은 함수)
    const code = draft.code.trim() || null
    run(async () => {
      const r = await addTeam(workspaceId, name, code)
      if (r.ok) { setDraft(EMPTY_TEAM_DRAFT); toast({ title: `'${name}' 팀을 추가했습니다.`, variant: 'success' }) }
      return r
    })
  }

  /** 정렬 스왑 — 인접 행과 순번을 맞바꾼다. 한 액션이 두 행을 바꾸고 둘째가 실패하면 첫 행을 되돌린다(옛 화면은 액션 두 번이라
   *  사이에 실패하면 두 팀이 같은 순번으로 남았다). */
  function move(idx: number, dir: -1 | 1) {
    const a = teams[idx], b = teams[idx + dir]
    if (!a || !b) return
    run(() => updateTeam(a.id, { swapOrderWith: b.id }))
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-fg">팀 목록</h2>
          <p className="text-sm text-fg-secondary">
            여기 등록된 팀이 탭·필터·검증·엑셀·회의록 편철의 단일 기준입니다. 비활성화하면 화면에서
            숨겨지고 기존 데이터는 보존됩니다.
          </p>
        </div>
        <TeamAddForm value={draft} onChange={setDraft} onSubmit={submitAdd} pending={pending} />
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>
        )}
        {teams.length === 0 ? (
          <EmptyState icon={Users} title={tr('settings.teams.emptyTitle')} description={tr('settings.teams.emptyDescCommon')} />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] whitespace-nowrap text-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="py-2 pr-3">순서</th>
                <th className="px-2.5 py-2">{tr('settings.teams.colColor')}</th>
                <th className="py-2 pr-3">{tr('settings.teams.colName')}</th>
                <th className="py-2 pr-3">{tr('settings.teams.colCode')}</th>
                <th className="py-2 pr-3">상태</th>
                <th className="py-2 pr-3">팀별 진척현황</th>
                <th className="py-2 pr-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id} data-team-row={t.id} className={`border-b border-border/60 ${t.active ? '' : 'opacity-60'}`}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-1">
                      <button onClick={() => move(i, -1)} disabled={pending || i === 0}
                        className="btn btn-ghost btn-sm" aria-label={`${t.name} 위로`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={pending || i === teams.length - 1}
                        className="btn btn-ghost btn-sm" aria-label={`${t.name} 아래로`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-2.5 py-2.5">
                    <TeamColorPicker team={t} disabled={pending}
                      onPick={(slot) => run(async () => {
                        const r = await updateTeam(t.id, { colorSlot: slot })
                        if (r.ok) toast({ title: tr('settings.teams.colorSaved').replace('{name}', t.name), variant: 'success' })
                        return r
                      })} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <TeamNameCell team={t} disabled={pending}
                      onRename={async (name) => {
                        const r = await updateTeam(t.id, { name })
                        if (r.ok) { toast({ title: `'${t.name}' 팀 이름을 '${name}'(으)로 바꿨습니다.`, variant: 'success' }); router.refresh() }
                        return r
                      }} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <TeamCodeCell team={t} disabled={pending}
                      onChange={async (code) => {
                        const r = await changeTeamCode(workspaceId, t.id, code)
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
                      {t.active ? '활성' : '비활성'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`chip ${t.progressVisible ? 'bg-action-soft text-action' : 'bg-surface-subtle text-fg-muted'}`}>
                      {t.progressVisible ? '표시' : '숨김'}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => run(() => updateTeam(t.id, { progressVisible: !t.progressVisible }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.progressVisible ? '팀별 진척현황에서 숨기기' : '팀별 진척현황에 표시'}>
                        {t.progressVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        진척
                      </button>
                      <button
                        onClick={() => run(() => updateTeam(t.id, { active: !t.active }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.active ? '비활성화(화면에서 숨김, 데이터 보존)' : '다시 활성화'}>
                        <Power className="h-3.5 w-3.5" />
                        {t.active ? '비활성화' : '활성화'}
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
        )}
        <p className="mt-3 text-xs leading-5 text-fg-muted">
          {tr('settings.teams.codeExplain')}{' '}
          팀 추가 시 회의록 보관함에 그 팀의 최상위 폴더(자동 편철 앵커)가 함께 생성됩니다. 이름을 바꾸면
          그 폴더 이름도 따라 바뀝니다.
        </p>
      </div>
      <TeamMergeDialog source={merging} teams={teams} onClose={() => setMerging(null)}
        onPreview={(targetId) => previewTeamMerge(workspaceId, merging!.id, targetId)}
        onMerge={(targetId) => mergeTeams(workspaceId, merging!.id, targetId)}
        onMerged={(target, summary) => {
          const renamed = summary.foldersRenamed > 0 ? ` ${tr('settings.teams.mergeDoneRenamed').replace('{n}', String(summary.foldersRenamed))}` : ''
          toast({ title: tr('settings.teams.mergeDone').replace('{source}', merging!.name).replace('{target}', target.name) + renamed, variant: 'success' })
          setMerging(null)
          router.refresh()
        }} />
    </section>
  )
}
