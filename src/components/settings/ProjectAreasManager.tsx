'use client'

// 담당 영역 관리 절 — kind 탭 2개(주간 구분·이슈 영역). 행 편집은 표 아래 폼 하나에서 한다(표 안 팝오버가 overflow 에 잘리지 않게).
// 코드는 새 영역에서만 입력한다 — 기존 영역은 읽기 전용(트리거 project_areas_guard 와 같은 규칙). 삭제 없음: 비활성이 삭제다.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { upsertArea, type AreaRow } from '@/app/actions/projectAreas'
import type { AreaKind, AreaTeamKind } from '@/lib/domain/areas'
import { useToast } from '@/components/ui/Toast'

/** active=false 인 팀은 이미 배정된 영역에서만 보인다(해제할 수 있게) — 새로 고를 수는 없다. */
export interface AreaTeamOption { id: string; code: string; active: boolean }

const KIND_LABEL: Record<AreaKind, string> = { weekly_section: '주간 구분', issue_area: '이슈 영역' }
const TEAM_KIND_LABEL: Record<AreaTeamKind, string> = { primary: '주', support: '보조' }

type Draft = { id?: string; code: string; name: string; sortOrder: string; active: boolean; teams: Record<string, AreaTeamKind> }

function toDraft(a: AreaRow): Draft {
  return {
    id: a.id, code: a.code, name: a.name, sortOrder: String(a.sortOrder), active: a.active,
    teams: Object.fromEntries(a.teams.map(t => [t.teamId, t.kind])),
  }
}

export function ProjectAreasManager({ projectId, areas, teamOptions }: {
  projectId: string
  areas: Record<AreaKind, AreaRow[]>
  teamOptions: readonly AreaTeamOption[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [kind, setKind] = useState<AreaKind>('weekly_section')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const rows = areas[kind]
  const teamOf = new Map(teamOptions.map(t => [t.id, t]))
  const teamLabel = (id: string) => {
    const t = teamOf.get(id)
    if (!t) return '알 수 없는 팀'
    return t.active ? t.code : `${t.code}(비활성)`
  }

  function switchKind(k: AreaKind) { setKind(k); setDraft(null); setError(null) }
  function startNew() {
    const next = rows.reduce((m, a) => Math.max(m, a.sortOrder), -1) + 1
    setError(null)
    setDraft({ code: '', name: '', sortOrder: String(next), active: true, teams: {} })
  }

  function save() {
    if (!draft) return
    // 빈 칸을 Number('') = 0 으로 조용히 바꾸지 않는다. 소수·문자는 validateArea 가 거부한다.
    if (!draft.sortOrder.trim()) { setError('순서를 입력하세요.'); return }
    const sortOrder = Number(draft.sortOrder)
    setError(null)
    startTransition(async () => {
      const r = await upsertArea(projectId, {
        ...(draft.id ? { id: draft.id } : {}),
        kind, code: draft.code, name: draft.name, sortOrder, active: draft.active,
        teams: Object.entries(draft.teams).map(([teamId, k]) => ({ teamId, kind: k })),
      })
      if (!r.ok) { setError(r.error); return }
      toast({ title: `'${draft.code.trim()}' 영역을 저장했습니다.`, variant: 'success' })
      setDraft(null)
      router.refresh()
    })
  }

  // 폼의 팀: 활성 팀 + 이 영역에 이미 배정된 비활성 팀(해제용).
  const formTeams = draft ? teamOptions.filter(t => t.active || draft.teams[t.id]) : []

  function setTeam(teamId: string, v: AreaTeamKind | '') {
    setDraft(d => {
      if (!d) return d
      const teams = { ...d.teams }
      if (v) teams[teamId] = v
      else delete teams[teamId]
      return { ...d, teams }
    })
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <div role="tablist" aria-label="영역 종류" className="flex gap-1">
          {(Object.keys(KIND_LABEL) as AreaKind[]).map(k => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} data-area-kind={k}
              onClick={() => switchKind(k)}
              className={`btn btn-sm ${kind === k ? 'btn-primary' : 'btn-ghost'}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <button type="button" onClick={startNew} className="btn btn-primary" disabled={pending}>
          <Plus className="h-4 w-4" />새 영역
        </button>
      </div>

      <div className="p-5 sm:p-6">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-subtle">아직 {KIND_LABEL[kind]}이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-subtle">
                  <th className="py-2 pr-3">순서</th>
                  <th className="py-2 pr-3">코드</th>
                  <th className="py-2 pr-3">이름</th>
                  <th className="py-2 pr-3">담당 팀</th>
                  <th className="py-2 pr-3">상태</th>
                  <th className="py-2 pr-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id} data-area-row={a.code} className={`border-b border-line/60 ${a.active ? '' : 'opacity-60'}`}>
                    <td className="py-2.5 pr-3 tabular-nums">{a.sortOrder}</td>
                    <td className="py-2.5 pr-3 text-xs font-semibold text-ink-muted">{a.code}</td>
                    <td className="py-2.5 pr-3 font-medium text-ink">{a.name}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {a.teams.length === 0 ? <span className="text-ink-subtle">—</span> : a.teams.map(t => (
                          <span key={t.teamId} className={`chip bg-surface-2 ${t.kind === 'primary' ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                            {teamLabel(t.teamId)} · {TEAM_KIND_LABEL[t.kind]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`chip ${a.active ? 'bg-done-weak text-done' : 'bg-surface-2 text-ink-subtle'}`}>
                        {a.active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
                        aria-label={`${a.code} 편집`} onClick={() => { setError(null); setDraft(toDraft(a)) }}>
                        <Pencil className="h-3.5 w-3.5" />편집
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && (
          <form className="panel-soft mt-4 space-y-4 p-5" onSubmit={e => { e.preventDefault(); save() }}>
            <p className="text-sm font-semibold text-ink">
              {draft.id ? `${KIND_LABEL[kind]} 편집` : `새 ${KIND_LABEL[kind]}`}
            </p>
            {error && <p role="alert" className="rounded-lg bg-delayed-weak px-3 py-2 text-sm text-delayed">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr_6rem]">
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                코드
                <input className={`app-input ${draft.id ? 'bg-surface-2 text-ink-muted' : ''}`} value={draft.code} readOnly={!!draft.id} aria-readonly={!!draft.id}
                  data-area-code title={draft.id ? '코드는 바꿀 수 없습니다. 새 영역을 만들고 이전 영역을 비활성으로 두세요.' : undefined}
                  onChange={e => setDraft({ ...draft, code: e.target.value })} disabled={pending} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                이름
                <input className="app-input" value={draft.name} data-area-name
                  onChange={e => setDraft({ ...draft, name: e.target.value })} disabled={pending} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                순서
                <input className="app-input" type="number" step={1} value={draft.sortOrder} data-area-order
                  onChange={e => setDraft({ ...draft, sortOrder: e.target.value })} disabled={pending} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-ink-muted">담당 팀</legend>
              {formTeams.length === 0 ? (
                <p className="text-xs text-ink-subtle">이 프로젝트에 팀이 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {formTeams.map(t => (
                    <label key={t.id} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line px-2 py-1 text-xs ${t.active ? 'text-ink' : 'text-ink-subtle'}`}>
                      {t.active ? t.code : `${t.code}(비활성)`}
                      <select className="app-input h-7 py-0 text-xs" value={draft.teams[t.id] ?? ''} data-area-team={t.code}
                        aria-label={`${t.code} 담당 구분`}
                        onChange={e => setTeam(t.id, e.target.value as AreaTeamKind | '')} disabled={pending}>
                        <option value="">—</option>
                        <option value="primary">{TEAM_KIND_LABEL.primary}</option>
                        <option value="support">{TEAM_KIND_LABEL.support}</option>
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={draft.active} data-area-active
                onChange={e => setDraft({ ...draft, active: e.target.checked })} disabled={pending} />
              활성
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? '저장 중…' : '저장'}</button>
              <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setDraft(null); setError(null) }}>취소</button>
            </div>
          </form>
        )}
        <p className="mt-3 text-xs leading-5 text-ink-subtle">
          영역 코드는 만든 뒤 바꿀 수 없습니다. 쓰지 않는 영역은 비활성으로 두세요.
        </p>
      </div>
    </section>
  )
}
