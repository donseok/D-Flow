'use client'

// 프로젝트 스코프 팀 관리(0071) — admin/TeamsManager 를 본뜨되 가드·액션·문구가 다르다.
// 회의록 팀 루트는 여기서 만들지 않는다 — 이 프로젝트에 연결한 회의록이 처음 편철될 때 지연 생성된다(lib/minutes/folders 의 루트 보장).
// 삭제 버튼은 없다: 비활성화가 삭제(공용 팀과 동일 관례).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Plus, Power } from 'lucide-react'
import { addProjectTeam, copyGlobalTeams, updateProjectTeam } from '@/app/actions/projectTeams'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TeamNameCell } from '@/components/settings/TeamNameCell'
import { TeamAddForm, EMPTY_TEAM_DRAFT, type TeamDraft } from '@/components/settings/TeamAddForm'
import { TeamColorPicker } from '@/components/settings/TeamColorPicker'

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
const INHERITANCE_WARNING =
  '이 프로젝트는 더 이상 공용 팀을 따르지 않습니다. 기존 WBS 담당이 공용 팀에 걸려 있으면 화면에서 \'목록 밖 팀\'으로 처리됩니다(칸반 미배정·엑셀 열 덧붙임). 계속할까요?'
/** '공용 팀 전환으로 시작'의 확인 문구 — 전환 RPC 의 실제 결과(SP4 D54·T14) */
const CONVERT_WARNING =
  '이 프로젝트가 쓰던 워크스페이스 공용 팀을 같은 코드·이름·색의 이 프로젝트 팀으로 바꿉니다. 작업 담당·명단의 팀·업무영역 담당·수락 전 초대의 팀 연결도 새 팀으로 함께 옮깁니다. 이후 공용 팀의 이름 바꾸기·추가·비활성은 이 프로젝트에 반영되지 않으며, 전환은 되돌릴 수 없습니다. 계속할까요?'

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

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? '실패했습니다.'); return }
      router.refresh()
    })
  }

  function doAdd(name: string, code: string | null) {
    run(async () => {
      const r = await addProjectTeam(projectId, name, code)
      if (r.ok) { setDraft(EMPTY_TEAM_DRAFT); toast({ title: `'${name}' 팀을 추가했습니다.`, variant: 'success' }) }
      return r
    })
  }

  function doCopy() {
    run(async () => {
      const r = await copyGlobalTeams(projectId)
      if (r.ok) toast({ title: '공용 팀을 이 프로젝트 팀으로 전환했습니다 — 담당·명단·업무영역·초대의 팀 연결도 옮겼습니다.', variant: 'success' })
      return r
    })
  }

  function submitAdd() {
    const name = draft.name.trim()
    if (!name) { setError('팀 이름을 입력하세요.'); return }
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
      title={confirming?.type === 'copy' ? '공용 팀을 이 프로젝트 팀으로 전환' : '공용 팀 상속 종료'}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => setConfirming(null)}>
            취소
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={confirmProceed}>
            {pending ? '처리 중…' : confirming?.type === 'copy' ? '전환하기' : '계속'}
          </button>
        </>
      }
    >
      <p className="text-sm leading-6 text-fg-secondary">{confirming?.type === 'copy' ? CONVERT_WARNING : INHERITANCE_WARNING}</p>
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
              현재 워크스페이스 공용 팀을 상속 중입니다. 이 프로젝트만의 팀을 정의하면 상속이 끊깁니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirming({ type: 'copy' })} className="btn btn-primary"
                disabled={pending || !hasGlobalTeams}
                title={hasGlobalTeams ? undefined : '공용 팀이 없습니다. 워크스페이스 관리의 팀 관리에서 먼저 공용 팀을 등록하세요.'}>
                <Copy className="h-4 w-4" />공용 팀 전환으로 시작
              </button>
              <button type="button" onClick={() => setShowAddInput(true)} className="btn btn-ghost" disabled={pending || showAddInput}>
                <Plus className="h-4 w-4" />빈 목록에서 시작
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
          <h2 className="text-base font-semibold text-fg">팀 목록</h2>
          <p className="text-sm text-fg-secondary">
            이 프로젝트의 WBS 담당·명단·칸반·보고서가 이 목록을 씁니다. 비활성화하면 화면에서 숨겨지고
            기존 데이터는 보존됩니다.
          </p>
        </div>
        <TeamAddForm value={draft} onChange={setDraft} onSubmit={submitAdd} pending={pending} />
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
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
                        const r = await updateProjectTeam(projectId, t.id, { colorSlot: slot })
                        if (r.ok) toast({ title: tr('settings.teams.colorSaved').replace('{name}', t.name), variant: 'success' })
                        return r
                      })} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <TeamNameCell team={t} disabled={pending}
                      onRename={async (name) => {
                        const r = await updateProjectTeam(projectId, t.id, { name })
                        if (r.ok) { toast({ title: `'${t.name}' 팀 이름을 '${name}'(으)로 바꿨습니다.`, variant: 'success' }); router.refresh() }
                        return r
                      }} />
                  </td>
                  <td className="py-2.5 pr-3">
                    <span data-team-code className="font-mono text-xs text-fg-secondary" title={tr('settings.teams.codeTitle')}>{t.code}</span>
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
                        onClick={() => run(() => updateProjectTeam(projectId, t.id, { progressVisible: !t.progressVisible }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.progressVisible ? '팀별 진척현황에서 숨기기' : '팀별 진척현황에 표시'}>
                        {t.progressVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        진척
                      </button>
                      <button
                        onClick={() => run(() => updateProjectTeam(projectId, t.id, { active: !t.active }))}
                        className="btn btn-ghost btn-sm" disabled={pending}
                        title={t.active ? '비활성화(화면에서 숨김, 데이터 보존)' : '다시 활성화'}>
                        <Power className="h-3.5 w-3.5" />
                        {t.active ? '비활성화' : '활성화'}
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
    </section>
  )
}
