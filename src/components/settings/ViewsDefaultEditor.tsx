'use client'
import { useId, useRef, type KeyboardEvent } from 'react'
import { ConfigStateNotice } from './ConfigStateNotice'
import { SettingsSaveBar } from './SettingsSaveBar'
import { useSettingsCommand } from './useSettingsCommand'
import { DEFAULT_VIEWS, parseViewsDefault, type ViewsDefault, type WbsView } from '@/lib/wbs/view'

const OPTIONS: readonly { value: WbsView; label: string; desc: string }[] = [
  { value: 'sheet', label: '표', desc: '행과 열로 편집합니다.' },
  { value: 'timeline', label: '간트', desc: '일정 막대로 봅니다.' },
  { value: 'board', label: '보드', desc: '카드로 묶어 봅니다(칸반).' },
]
const fromLatest = (v: unknown) => { const p = parseViewsDefault(v ?? DEFAULT_VIEWS); return p.ok ? p.value : null }

/**
 * 작업 계획 기본 보기(views.default — SP3b 스펙 §6.4 표, D43, 네 연결 ②). 보드는 칸반이 effective 일 때만 고를 수 있다 —
 * 저장값이 보드면 칸반이 꺼져 있어도 선택된 채 보이고(값을 잃지 않는다) 다른 값을 골라 저장할 수 있다(Review Focus 3).
 * 서버의 필드 오류(views.default — 보드 교차 검사)는 라디오 묶음의 aria-invalid·aria-describedby 로 배선한다(UI-1 Field 와 같은 배선).
 */
export function ViewsDefaultEditor({ projectId, revision, initial, invalidReason, kanbanOn, labelledBy }: {
  projectId: string; revision: number; initial: ViewsDefault | null; invalidReason?: string; kanbanOn: boolean
  /** 묶음 이름이 될 머리(h4)의 id — 있으면 aria-labelledby, 없으면 aria-label(단독 렌더) */
  labelledBy?: string
}) {
  const c = useSettingsCommand<ViewsDefault>({ scope: { projectId }, key: 'views.default', revision, initial, empty: DEFAULT_VIEWS, fromLatest })
  const errId = useId(), descBase = useId(), offId = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const blocked = (v: WbsView) => v === 'board' && !kanbanOn
  const locked = c.pending || c.uncertain
  const pick = (v: WbsView) => { if (!blocked(v) && !locked) c.setDraft({ wbs: v }) }
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    for (let k = 1; k < OPTIONS.length; k++) {                        // 비활성(보드)은 건너뛴다
      const j = (i + dir * k + OPTIONS.length) % OPTIONS.length
      if (!blocked(OPTIONS[j].value)) { pick(OPTIONS[j].value); refs.current[j]?.focus(); return }
    }
  }
  const boardWanted = c.draft.wbs === 'board' && !kanbanOn            // 저장값 보드 + 칸반 꺼짐 — 그대로는 저장하지 않는다(서버가 거부한다)
  return <div className="space-y-3">
    {invalidReason && c.needsRepair && <ConfigStateNotice kind="invalid" locale="ko" keyName="views.default" message={invalidReason} isAdmin settingsHref="#project-modules" />}
    <div role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : '작업 계획 기본 보기'} aria-invalid={c.fieldError ? true : undefined} aria-describedby={c.fieldError ? errId : undefined}
      className="grid gap-2 sm:grid-cols-3">
      {OPTIONS.map((o, i) => {
        const on = c.draft.wbs === o.value
        // 접근 이름은 보기 이름(aria-label), 설명과 꺼짐 사유는 aria-describedby 로 잇는다(u3-3 리뷰 P2-6)
        const describedBy = blocked(o.value) ? `${descBase}-${o.value} ${offId}` : `${descBase}-${o.value}`
        return <button key={o.value} ref={(el) => { refs.current[i] = el }} type="button" role="radio" aria-checked={on} aria-label={o.label}
          aria-describedby={describedBy} aria-disabled={blocked(o.value) || undefined} tabIndex={on ? 0 : -1} onClick={() => pick(o.value)} onKeyDown={(e) => onKey(e, i)}
          className={`rounded-(--radius-control) border p-3 text-left ${on ? 'border-action bg-surface-selected' : 'border-border bg-surface hover:bg-surface-hover'} aria-disabled:cursor-not-allowed aria-disabled:opacity-60`}>
          <span className="block text-sm font-semibold text-fg">{o.label}{blocked(o.value) ? ' (칸반 꺼짐)' : ''}</span>
          <span id={`${descBase}-${o.value}`} className="block text-meta text-fg-secondary">{o.desc}</span>
        </button>
      })}
    </div>
    {!kanbanOn && <div id={offId}><ConfigStateNotice kind="disabled" locale="ko" compact message="칸반이 꺼져 있어 보드를 기본 보기로 고를 수 없습니다. 작업 계획은 표로 열립니다." isAdmin settingsHref="#project-modules" /></div>}
    {c.fieldError && <p id={errId} role="alert" className="text-meta font-semibold text-danger">{c.fieldError}</p>}
    {c.conflict && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-(--radius-panel) border border-border bg-surface-subtle p-3 text-sm text-fg">
      <span>다른 사용자가 기본 보기를 바꿨습니다.</span>
      <button type="button" className="btn btn-ghost" disabled={!c.conflict.value} onClick={c.useLatest}>최신 값으로 다시 보기</button>
      {/* 최신 값이 손상이어도 갇히지 않게 — 내 선택을 최신 revision 위에 다시 저장할 수 있다 */}
      <button type="button" className="btn btn-ghost" onClick={c.keepMine}>내 선택 유지</button>
    </div>}
    {c.error && <ConfigStateNotice kind="patch" locale="ko" message={c.error} />}
    <SettingsSaveBar notice={c.notice}>
      <button type="button" className="btn btn-primary" aria-label="기본 보기 저장" disabled={c.pending || (!c.dirty && !c.uncertain) || boardWanted || !!c.conflict} onClick={c.save}>
        {c.uncertain ? '저장 결과 확인 및 재시도' : '기본 보기 저장'}
      </button>
    </SettingsSaveBar>
  </div>
}
