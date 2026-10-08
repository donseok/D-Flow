'use client'

// 팀 기준정보 관리 테이블 — AccountsManager 와 동일한 카드·버튼·칩 컨벤션.
// 삭제 버튼은 의도적으로 없다: 비활성화가 삭제(데이터 보존, 사용자 결정 2026-07-24).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Power } from 'lucide-react'
import { addTeam, updateTeam } from '@/app/actions/teams'
import { useToast } from '@/components/ui/Toast'
import { TeamNameCell } from '@/components/settings/TeamNameCell'
import { teamSlot } from '@/lib/domain/teamColor'

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
  const [newCode, setNewCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null)
    startTransition(async () => {
      const r = await fn()
      if (!r.ok) { setError(r.error ?? '실패했습니다.'); return }
      router.refresh()
    })
  }

  function submitAdd() {
    const code = newCode.trim()
    if (!code) { setError('팀 이름을 입력하세요.'); return }
    run(async () => {
      const r = await addTeam(workspaceId, code)
      if (r.ok) { setNewCode(''); toast({ title: `'${code}' 팀을 추가했습니다.`, variant: 'success' }) }
      return r
    })
  }

  /** 정렬 스왑 — 인접 행과 sortOrder 교환(2건 update). */
  function move(idx: number, dir: -1 | 1) {
    const a = teams[idx], b = teams[idx + dir]
    if (!a || !b) return
    run(async () => {
      const r1 = await updateTeam(a.id, { sortOrder: b.sortOrder })
      if (!r1.ok) return r1
      return updateTeam(b.id, { sortOrder: a.sortOrder })
    })
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
        <div className="flex items-center gap-2">
          <input
            value={newCode}
            onChange={e => setNewCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
            placeholder="새 팀 이름"
            maxLength={20}
            className="app-input w-40"
            disabled={pending}
          />
          <button onClick={submitAdd} className="btn btn-primary" disabled={pending}>
            <Plus className="h-4 w-4" />팀 추가
          </button>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-fg-muted">
                <th className="py-2 pr-3">순서</th>
                <th className="py-2 pr-3">팀</th>
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
                        className="btn btn-ghost btn-sm" aria-label={`${t.code} 위로`}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={pending || i === teams.length - 1}
                        className="btn btn-ghost btn-sm" aria-label={`${t.code} 아래로`}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <TeamNameCell team={t} disabled={pending} chip={teamSlot(t).chip}
                      onRename={async (name) => {
                        const r = await updateTeam(t.id, { name })
                        if (r.ok) { toast({ title: `'${t.code}' 팀 이름을 '${name}'(으)로 바꿨습니다.`, variant: 'success' }); router.refresh() }
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
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          팀 추가 시 회의록 보관함에 그 팀의 최상위 폴더(자동 편철 앵커)가 함께 생성됩니다. 이름을 바꾸면
          그 폴더 이름도 따라 바뀌고, 팀 코드(엑셀·필터·봇이 쓰는 식별자)는 그대로입니다.
        </p>
      </div>
    </section>
  )
}
