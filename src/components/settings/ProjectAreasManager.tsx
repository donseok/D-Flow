'use client'

// 주간 업무영역 편집기(SP4 §4.1.8·D26) — 설정 '팀·업무영역' 범주에 kind 고정(weekly_section)으로 붙는다. 이슈 영역은 SP5 가 같은
// 편집기를 그 kind 로 다시 쓴다(여기에는 종류 탭이 없다). 행 편집은 표 아래 폼 하나에서 한다(표 안 팝오버가 overflow 에 잘리지 않게).
// 저장은 upsertArea → RPC upsert_project_area — 활성 영역을 저장하면 이번 주 이후 주간 문서에 그 영역 행이 생긴다(rowsAdded).
// 코드는 새 영역에서만 입력한다 — 이름으로 미리 채우고 고칠 수 있으며 저장 뒤 불변이다(트리거 project_areas_guard). 삭제 없음: 비활성이 삭제다.
// SP3b 패턴 이행(상태 계약·빈 상태·글자 크기)은 SPU3 다(D52) — 지금 모양 그대로 기능만 붙인다.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { upsertArea } from '@/app/actions/projectAreas'
import { orderAreas } from '@/lib/domain/weeklySheet'
import { ISSUE_AREA_CODE_RE } from '@/lib/domain/issueAreas'
import type { AreaTeamKind, AreaTeamOption } from '@/lib/domain/areas'
import type { ConfigArea } from '@/lib/settings/projectConfig'
import type { Locale } from '@/lib/i18n/dict'
import { useToast } from '@/components/ui/Toast'
import { SettingsSaveBar } from './SettingsSaveBar'

const KIND_LABEL = { weekly_section: '업무영역', issue_area: '이슈 영역' } as const
const TEAM_KIND_LABEL: Record<AreaTeamKind, string> = { primary: '주', support: '보조' }
const DEACTIVATE_NOTE = '비활성으로 두면 이번 주 이후 주간 시트에서 숨겨지고, 이미 쓴 내용은 남습니다.'

/** codeTouched — 새 영역의 코드를 사용자가 직접 고쳤는가. 고치기 전에는 이름을 따라 채운다(기존 영역은 늘 true — 코드 불변) */
type Draft = {
  id?: string; code: string; codeTouched: boolean; name: string; sortOrder: string; active: boolean
  teams: Record<string, AreaTeamKind>
}

function toDraft(a: ConfigArea): Draft {
  return {
    id: a.id, code: a.code, codeTouched: true, name: a.name, sortOrder: String(a.sortOrder), active: a.active,
    teams: Object.fromEntries(a.teams.map(t => [t.teamId, t.kind])),
  }
}

export function ProjectAreasManager({ projectId, kind, areas, teamOptions, locale = 'ko' }: {
  projectId: string
  /** 영역 종류 — A1 은 주간 업무영역 하나다(이슈 영역은 SP5) */
  kind: 'weekly_section' | 'issue_area'
  locale?: Locale
  areas: readonly ConfigArea[]
  teamOptions: readonly AreaTeamOption[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  // 시트와 같은 순서(sortOrder, code, id) — 해석기는 sort_order 로만 정렬해 동률의 순서가 고정되지 않는다
  const rows = orderAreas(areas.filter(a => a.kind === kind))
  const label = locale === 'ko' ? KIND_LABEL[kind] : kind === 'issue_area' ? 'Issue areas' : 'Work areas'
  const issueArea = kind === 'issue_area'
  const text = locale === 'ko' ? { new: '새 영역', code: '코드', name: '이름', order: '순서', teams: '담당 팀', status: '상태', action: '작업', active: '활성', inactive: '비활성', edit: '편집', empty: issueArea ? '이슈 영역을 추가할 수 있습니다.' : '영역을 하나 이상 저장해야 주간보고를 시작할 수 있습니다.' } : { new: 'New area', code: 'Code', name: 'Name', order: 'Order', teams: 'Teams', status: 'Status', action: 'Actions', active: 'Active', inactive: 'Inactive', edit: 'Edit', empty: issueArea ? 'Add issue areas when needed.' : 'Add at least one area to start weekly reporting.' }
  const teamOf = new Map(teamOptions.map(t => [t.id, t]))
  const teamLabel = (id: string) => {
    const t = teamOf.get(id)
    if (!t) return '알 수 없는 팀'
    return t.active ? t.code : `${t.code}(비활성)`
  }

  function startNew() {
    const next = rows.reduce((m, a) => Math.max(m, a.sortOrder), -1) + 1
    setError(null)
    setDraft({ code: '', codeTouched: false, name: '', sortOrder: String(next), active: true, teams: {} })
  }

  /** 이름 입력 — 새 영역은 코드를 직접 고치기 전까지 이름을 따라 채운다(스펙 §4.1.8). 기존 영역의 코드는 불변이라 건드리지 않는다 */
  function setName(name: string) {
    setDraft(d => (d ? { ...d, name, code: !d.id && !d.codeTouched ? name : d.code } : d))
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
      toast({
        title: `'${draft.code.trim()}' 영역을 저장했습니다.`,
        // RPC 가 활성 영역을 이번 주 이후 주간 문서에 채운다 — 생긴 행이 있으면 알린다
        description: r.rowsAdded > 0 ? `이번 주 이후 주간 시트 ${r.rowsAdded}곳에 이 영역 행을 더했습니다.` : undefined,
        variant: 'success',
      })
      setDraft(null)
      router.refresh()
    })
  }

  // 폼의 팀: 활성 팀 + 이 영역에 이미 배정된 비활성·목록 밖 팀(해제용).
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
    <section className="card overflow-hidden" data-area-editor={kind}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <p className="text-sm font-semibold text-fg">{label} {rows.length}개</p>
        <button type="button" onClick={startNew} className="btn btn-primary" disabled={pending}>
          <Plus className="h-4 w-4" />{text.new}
        </button>
      </div>

      <div className="p-5 sm:p-6">
        {rows.length === 0 ? (
          <p className="text-sm text-fg-muted">{locale === 'ko' ? `아직 ${label}이 없습니다. ${text.empty}` : text.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-fg-muted">
                  <th className="py-2 pr-3">{text.order}</th>
                  <th className="py-2 pr-3">{text.code}</th>
                  <th className="py-2 pr-3">{text.name}</th>
                  <th className="py-2 pr-3">{text.teams}</th>
                  <th className="py-2 pr-3">{text.status}</th>
                  <th className="py-2 pr-3 text-right">{text.action}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id} data-area-row={a.code} className={`border-b border-border/60 ${a.active ? '' : 'opacity-60'}`}>
                    <td className="py-2.5 pr-3 tabular-nums">{a.sortOrder}</td>
                    <td className="py-2.5 pr-3 text-xs font-semibold text-fg-secondary">{a.code}</td>
                    <td className="py-2.5 pr-3 font-medium text-fg">{a.name}</td>
                    <td className="py-2.5 pr-3">
                      <span className="flex flex-wrap gap-1">
                        {a.teams.length === 0 ? <span className="text-fg-muted">—</span> : a.teams.map(t => (
                          <span key={t.teamId} className={`chip bg-surface-subtle ${t.kind === 'primary' ? 'font-semibold text-fg' : 'text-fg-secondary'}`}>
                            {teamLabel(t.teamId)} · {TEAM_KIND_LABEL[t.kind]}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={`chip ${a.active ? 'bg-success-weak text-success' : 'bg-surface-subtle text-fg-muted'}`}>
                        {a.active ? text.active : text.inactive}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <button type="button" className="btn btn-ghost btn-sm" disabled={pending}
                        aria-label={`${a.code} ${text.edit}`} onClick={() => { setError(null); setDraft(toDraft(a)) }}>
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
            <p className="text-sm font-semibold text-fg">{draft.id ? `${label} ${text.edit}` : `새 ${label}`}</p>
            {error && <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-[10rem_1fr_6rem]">
              <label className="flex flex-col gap-1 text-xs text-fg-secondary">
                {text.code}{issueArea ? ' · 영문 대문자·숫자 1~8자' : ''}
                <input className={`app-input ${draft.id ? 'bg-surface-subtle text-fg-secondary' : ''}`} value={draft.code} readOnly={!!draft.id} aria-readonly={!!draft.id}
                  data-area-code
                  pattern={issueArea ? ISSUE_AREA_CODE_RE.source.replace(/^\^|\$$/g, '') : undefined}
                  title={draft.id ? '코드는 바꿀 수 없습니다. 새 영역을 만들고 이전 영역을 비활성으로 두세요.' : issueArea ? '이슈 코드의 {area} 자리에 들어갑니다. 만든 뒤 바꿀 수 없습니다.' : '이름으로 미리 채웁니다. 저장한 뒤에는 바꿀 수 없습니다.'}
                  onChange={e => setDraft({ ...draft, code: e.target.value, codeTouched: true })} disabled={pending} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-fg-secondary">
                {text.name}
                <input className="app-input" value={draft.name} data-area-name
                  onChange={e => setName(e.target.value)} disabled={pending} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-fg-secondary">
                {text.order}
                <input className="app-input" type="number" step={1} value={draft.sortOrder} data-area-order
                  onChange={e => setDraft({ ...draft, sortOrder: e.target.value })} disabled={pending} />
              </label>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-xs text-fg-secondary">{text.teams}</legend>
              {formTeams.length === 0 ? (
                <p className="text-xs text-fg-muted">이 프로젝트에 팀이 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {formTeams.map(t => (
                    <label key={t.id} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-2 py-1 text-xs ${t.active ? 'text-fg' : 'text-fg-muted'}`}>
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
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={draft.active} data-area-active
                onChange={e => setDraft({ ...draft, active: e.target.checked })} disabled={pending} />
              활성
            </label>
            {!draft.active && <p data-area-deactivate-note className="text-xs leading-5 text-fg-secondary">{DEACTIVATE_NOTE}</p>}
            <SettingsSaveBar tone="subtle">
              <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => { setDraft(null); setError(null) }}>취소</button>
              <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? '저장 중…' : '저장'}</button>
            </SettingsSaveBar>
          </form>
        )}
        <p className="mt-3 text-xs leading-5 text-fg-muted">
          영역 코드는 만든 뒤 바꿀 수 없습니다. 쓰지 않는 영역은 비활성으로 두세요.
        </p>
      </div>
    </section>
  )
}
