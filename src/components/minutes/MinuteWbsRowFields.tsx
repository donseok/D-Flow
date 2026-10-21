'use client'

// 회의록 → WBS 등록 창의 줄 하나 — 작업명·넣을 위치·(한 건 창만) 계획 시작일·계획 종료일·담당자(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §3.1·§4.2·§4.3).
// 하위 없는 작업을 위치로 고르면 그 작업이 묶음 항목으로 바뀌는 영향을 모두 보이고 확인을 받는다 — confirmParentLeaf 는 서버로 가고
// RPC 가 다시 본다(그새 말단이 된 부모를 확인 없이 바꾸지 않는다, §5.3). 값은 부모가 쥐고 onChange 는 늘 줄 전체를 낸다.
// 계획 시작일은 채우지 않는다(근거 없는 계획 데이터를 만들지 않는다 — §4.3). 사람이 넣으면 넣은 대로, 시작이 종료보다 늦으면 안내한다(서버도 거부).

import { useId } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { formatPct1 } from '@/lib/domain/format'
import { WBS_ROOT_PARENT, type MinuteWbsDraftRow, type MinuteWbsParentOption } from '@/lib/domain/minuteWbs'
import { WBS_NAME_MAX } from '@/lib/domain/wbsValueRules'
import { fill } from '@/lib/i18n/translate'
import { WbsParentPicker } from './WbsParentPicker'

/** 줄 하나의 입력 — 날짜·담당자의 빈 값은 ''(입력 칸의 값), 위치는 null = 아직 안 고름, WBS_ROOT_PARENT = 맨 위 */
export interface MinuteWbsRowState { name: string; parentValue: string | null; plannedStart: string; plannedEnd: string; assigneeMemberId: string; confirmParentLeaf: boolean }

/** 초안 → 줄 상태. 위치는 첫 추천 → 이 화면에서 마지막으로 고른 위치 → 미선택(null) 순(설계 §4.2 "추천이 없을 때"). 계획 시작일은 늘 비운다(§4.3) */
export function rowStateFromDraft(draft: MinuteWbsDraftRow, lastParentId: string | null): MinuteWbsRowState {
  return {
    name: draft.name,
    parentValue: draft.parentIds[0] ?? lastParentId ?? null,
    plannedStart: '',
    plannedEnd: draft.plannedEnd ?? '',
    assigneeMemberId: draft.assigneeMemberId ?? '',
    confirmParentLeaf: false,
  }
}

/** 시작이 종료보다 늦은가 — 둘 다 있을 때만 본다(같은 날은 된다 — 등록 RPC 의 WBS_DATE_RANGE_INVALID 와 같은 규칙). 'YYYY-MM-DD' 는 글자 순서가 날짜 순서다 */
export function plannedDatesReversed(state: Pick<MinuteWbsRowState, 'plannedStart' | 'plannedEnd'>): boolean {
  return state.plannedStart !== '' && state.plannedEnd !== '' && state.plannedStart > state.plannedEnd
}

export function MinuteWbsRowFields({ state, draft, parents, members, onChange, disabled = false, showPlannedStart = false }: {
  state: MinuteWbsRowState
  draft: MinuteWbsDraftRow
  parents: MinuteWbsParentOption[]
  members: { id: string; name: string }[]
  onChange: (next: MinuteWbsRowState) => void
  disabled?: boolean
  /** 계획 시작일 칸 — 한 건 창만(한꺼번에 줄은 종료일만, 설계 §3.2) */
  showPlannedStart?: boolean
}) {
  const { t } = useLocale()
  const baseId = useId()
  const noticeId = `${baseId}-leaf`
  const dateHintId = `${baseId}-dates`
  const reversed = showPlannedStart && plannedDatesReversed(state)
  const set = (patch: Partial<MinuteWbsRowState>) => onChange({ ...state, ...patch })
  const parent = state.parentValue == null ? null : parents.find(option => option.id === state.parentValue) ?? null
  // 모르는 id(다른 프로젝트에서 고른 마지막 위치 등)는 선택기도 고르지 않은 것으로 그린다 — 안내도 같이
  const placed = state.parentValue === WBS_ROOT_PARENT || parent != null
  const leaf = parent?.leaf ? parent : null
  // 말단이 묶음으로 바뀔 때 잃거나 남는 것 — 있는 것만(설계 §4.2: 영향을 모두 보인다)
  const leafEffects = leaf
    ? [
        leaf.actualPct != null ? fill(t('min.wbs.leafActual'), { n: formatPct1(leaf.actualPct) }) : null,
        leaf.assigneeMemberId ? t('min.wbs.leafAssignee') : null,
        leaf.dependencyCount > 0 ? fill(t('min.wbs.leafDeps'), { n: leaf.dependencyCount }) : null,
      ].filter((line): line is string => line != null)
    : []

  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="mb-1 block font-medium text-fg">{t('min.wbs.name')}</span>
        <input value={state.name} maxLength={WBS_NAME_MAX} disabled={disabled} aria-required
          onChange={event => set({ name: event.target.value })} className="app-input" />
      </label>
      <div>
        <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-fg">{t('min.wbs.parent')}</span>
          {!placed && <span className="text-meta text-fg-muted">{t('min.wbs.parentPlaceholder')}</span>}
        </div>
        <WbsParentPicker options={parents} value={state.parentValue} recommendedIds={draft.parentIds} disabled={disabled}
          // 위치가 바뀌면 말단 확인을 다시 받는다(같은 값이면 그대로)
          onChange={value => set({ parentValue: value, confirmParentLeaf: value === state.parentValue && state.confirmParentLeaf })} />
        <div aria-live="polite">
          {leaf && (
            <div className="mt-2 space-y-2 rounded-lg border border-warning/30 bg-warning-weak px-3 py-2.5">
              <div id={noticeId} className="flex items-start gap-2 text-meta text-fg">
                <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold">{t('min.wbs.leafNotice')}</p>
                  {leafEffects.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {leafEffects.map(line => <li key={line}>{line}</li>)}
                    </ul>
                  )}
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2 font-medium text-fg">
                <input type="checkbox" checked={state.confirmParentLeaf} disabled={disabled} aria-describedby={noticeId}
                  onChange={event => set({ confirmParentLeaf: event.target.checked })} />
                {t('min.wbs.leafConfirm')}
              </label>
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {showPlannedStart && (
          <label className="block min-w-0">
            <span className="mb-1 block font-medium text-fg">{t('min.wbs.plannedStart')}</span>
            <input type="date" value={state.plannedStart} disabled={disabled}
              aria-invalid={reversed || undefined} aria-describedby={reversed ? dateHintId : undefined}
              onChange={event => set({ plannedStart: event.target.value })} className="app-input" />
          </label>
        )}
        <label className="block min-w-0">
          <span className="mb-1 block font-medium text-fg">{t('min.wbs.plannedEnd')}</span>
          <input type="date" value={state.plannedEnd} disabled={disabled}
            onChange={event => set({ plannedEnd: event.target.value })} className="app-input" />
        </label>
        {/* 시작일 칸이 있으면 담당자는 다음 줄 전체 폭 */}
        <label className={`block min-w-0 ${showPlannedStart ? 'col-span-2' : ''}`}>
          <span className="mb-1 block font-medium text-fg">{t('min.wbs.assignee')}</span>
          <select value={state.assigneeMemberId} disabled={disabled}
            onChange={event => set({ assigneeMemberId: event.target.value })} className="app-input">
            <option value="">{t('min.wbs.assigneeNone')}</option>
            {members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
      </div>
      {/* 시작 > 종료 — 서버가 거부하는 값이라 등록 단추도 막힌다(등록 창의 rowReady). 바뀌면 낭독기에도 알린다 */}
      {showPlannedStart && (
        <div aria-live="polite">
          {reversed && <p id={dateHintId} className="text-meta text-danger">{t('min.wbs.dateOrder')}</p>}
        </div>
      )}
    </div>
  )
}
