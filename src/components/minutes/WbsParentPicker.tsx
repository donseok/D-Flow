'use client'

// 회의록 → WBS 등록 창의 「넣을 위치」(설계 docs/superpowers/specs/2026-10-21-minutes-to-wbs-design.md §4.2).
// 추천 위치(≤3, 「추천」 칩)와 지금 고른 위치를 라디오로 먼저 보이고, 「다른 위치 찾기…」를 펼치면 고를 수 있는 위치 전부
// (하위 없는 작업 포함 — 앞에 · 표시)를 경로(번호·이름)로 거른다. 맨 위(최상위)는 위치 후보가 없어도 늘 고를 수 있다.
// 값: null = 아직 안 고름, WBS_ROOT_PARENT = 맨 위(제출 때 parentId null), 그 밖 = 위치 id. 모르는 id 는 고르지 않은 것으로 본다.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { WBS_ROOT_PARENT, type MinuteWbsParentOption } from '@/lib/domain/minuteWbs'
import { ESC_PRIORITY, useEscHandler } from '@/lib/ui/escStack'

/** 라디오로 먼저 보이는 추천 수 — 준비 액션이 줄마다 위치 후보를 셋까지 준다(설계 §4.2) */
const RECOMMENDED_MAX = 3

export function WbsParentPicker({ options, value, recommendedIds, onChange, disabled = false }: {
  options: MinuteWbsParentOption[]
  /** null = 미선택, WBS_ROOT_PARENT = 맨 위 */
  value: string | null
  recommendedIds: string[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const { t } = useLocale()
  const baseId = useId()
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const byId = useMemo(() => new Map(options.map(option => [option.id, option])), [options])
  // 옵션에 없는 추천(그새 고를 수 없게 된 위치)·겹친 id 는 뺀다
  const recommended = useMemo(() => {
    const out: MinuteWbsParentOption[] = []
    for (const id of new Set(recommendedIds)) {
      const option = byId.get(id)
      if (option) out.push(option)
      if (out.length === RECOMMENDED_MAX) break
    }
    return out
  }, [byId, recommendedIds])
  const firstRecommended = recommended[0]?.id ?? null
  const resolved = value === WBS_ROOT_PARENT || (value != null && byId.has(value)) ? value : null
  const selected = resolved ?? firstRecommended
  // 추천 밖의 지금 값(검색으로 고른 위치·마지막으로 고른 위치)도 라디오로 — 펼치지 않아도 무엇이 골라졌는지 보인다
  const current = resolved != null && resolved !== WBS_ROOT_PARENT && !recommended.some(option => option.id === resolved)
    ? byId.get(resolved) ?? null
    : null

  // 고르지 않았으면(null·모르는 id) 첫 추천을 부모 상태에도 한 번 올린다 — 골라져 보이는 라디오와 제출 값이 어긋나지 않게.
  // 이 동작을 원치 않는 선택기(한꺼번에 바꾸기 등)는 recommendedIds 를 비워 넘긴다
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })
  useEffect(() => {
    if (resolved == null && firstRecommended != null) onChangeRef.current(firstRecommended)
  }, [resolved, firstRecommended])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])
  // 펼친 찾기는 Esc 로 먼저 접는다 — 창(모달)은 다음 Esc 에(escStack: 선택기 → 창, 한 번에 한 층). 초점이 목록에 있었으면 찾기 단추로 돌린다
  useEscHandler(() => {
    const focusInside = panelRef.current?.contains(document.activeElement) ?? false
    setSearchOpen(false)
    if (focusInside) toggleRef.current?.focus()
  }, { priority: ESC_PRIORITY.PICKER, enabled: searchOpen })

  const needle = query.trim().toLocaleLowerCase()
  const results = needle ? options.filter(option => option.path.toLocaleLowerCase().includes(needle)) : options
  const panelId = `${baseId}-search`

  const radio = (group: string, optionValue: string, label: ReactNode, chip: boolean) => {
    const on = selected === optionValue
    return (
      <label key={optionValue}
        className={`flex items-start gap-2 rounded-(--radius-control) px-2 py-1.5 text-sm text-fg ${on ? 'bg-surface-selected' : disabled ? '' : 'hover:bg-surface-hover'} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input type="radio" name={`${baseId}-${group}`} value={optionValue} checked={on} disabled={disabled}
          onChange={() => onChange(optionValue)} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">{label}</span>
        {chip && <span className="chip shrink-0 bg-action-soft text-action">{t('min.wbs.parentRecommended')}</span>}
      </label>
    )
  }

  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label={t('min.wbs.parent')} data-wbs-parent-choices className="space-y-0.5">
        {recommended.map(option => radio('choices', option.id, <OptionPath option={option} />, true))}
        {current && radio('choices', current.id, <OptionPath option={current} />, false)}
        {radio('choices', WBS_ROOT_PARENT, t('min.wbs.parentRoot'), false)}
      </div>
      {options.length === 0 ? (
        <p className="px-2 text-meta text-fg-muted">{t('min.wbs.parentNone')}</p>
      ) : (
        <button ref={toggleRef} type="button" aria-expanded={searchOpen} aria-controls={searchOpen ? panelId : undefined} disabled={disabled}
          onClick={() => setSearchOpen(open => !open)}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-(--radius-control) px-2 text-sm font-medium text-action hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50">
          <Search aria-hidden className="h-3.5 w-3.5" />
          {t('min.wbs.parentSearch')}
          <ChevronDown aria-hidden className={`h-3.5 w-3.5 ${searchOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
      {searchOpen && options.length > 0 && (
        <div ref={panelRef} id={panelId} className="space-y-1.5">
          <input ref={searchRef} type="search" value={query} disabled={disabled} aria-label={t('min.wbs.parentSearch')}
            onChange={event => setQuery(event.target.value)} className="app-input" />
          {results.length === 0 ? (
            <p className="px-2 text-meta text-fg-muted">{t('min.wbs.parentNone')}</p>
          ) : (
            <div role="radiogroup" aria-label={t('min.wbs.parentSearch')} data-wbs-parent-results
              className="max-h-56 space-y-0.5 overflow-y-auto rounded-(--radius-control) border border-border p-1">
              {results.map(option => radio('results', option.id, <OptionPath option={option} />, false))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 경로 — 하위 없는 작업(고르면 묶음으로 바뀐다)은 앞에 · */
function OptionPath({ option }: { option: MinuteWbsParentOption }) {
  return <>{option.leaf && <span aria-hidden className="mr-1 text-fg-muted">·</span>}{option.path}</>
}
