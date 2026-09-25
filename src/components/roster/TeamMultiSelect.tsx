'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { setPrimaryTeam, toggleTeam } from '@/lib/domain/roster'

export interface TeamOption { id: string; code: string }

/** 목록 최대 높이(max-h-56 = 14rem) + 여백 — 아래 공간이 이보다 작으면 위로 연다. */
const POPOVER_MAX_H = 240

/**
 * 명단 한 행의 팀 — 체크 목록(여러 팀) + 대표 팀 라디오. value 첫 원소가 대표 팀(RPC p_team_ids 규칙).
 * 닫힌 상태는 칩 요약(대표 팀 굵게)이라 표 폭을 적게 쓴다. 바깥 클릭·Esc 로 닫힌다.
 * 목록은 body 포털 + fixed 로 띄운다 — 명단 표의 overflow-x-auto 가 absolute 팝오버를 잘랐다(행 1개일 때 목록이 안 보임).
 */
export function TeamMultiSelect({ options, value, onChange, label, disabled = false }: {
  options: readonly TeamOption[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  /** 스크린리더 이름 — "<이름> 팀" */
  label: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const codeOf = new Map(options.map(o => [o.id, o.code]))

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 버튼 아래(공간이 모자라면 위)에 붙인다. 스크롤·리사이즈마다 다시 잰다(fixed 라 따라가지 않는다).
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const r = rootRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom
      setPos(below < POPOVER_MAX_H && r.top > below
        ? { position: 'fixed', left: r.left, bottom: window.innerHeight - r.top + 4 }
        : { position: 'fixed', left: r.left, top: r.bottom + 4 })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  return (
    <div ref={rootRef} className="relative" onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}>
      <button
        type="button"
        className="app-input flex h-8 min-w-[7rem] items-center gap-1 text-left text-xs"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {value.length === 0 ? <span className="text-ink-subtle">팀 없음</span> : value.map((id, i) => (
            <span key={id} className={`chip bg-surface-2 ${i === 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
              {codeOf.get(id) ?? '?'}
            </span>
          ))}
        </span>
        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
      </button>
      {open && pos && createPortal(
        // Esc 는 포털이어도 React 트리로 버블링돼 바깥 div 의 onKeyDown 이 받는다.
        <div ref={popRef} role="group" aria-label={label} style={pos}
          className="z-50 w-56 rounded-lg border border-line bg-surface p-2 shadow-lg">
          {options.length === 0 ? (
            <p className="px-1 py-1 text-xs text-ink-subtle">이 프로젝트에 팀이 없습니다.</p>
          ) : (
            <ul className="max-h-56 space-y-0.5 overflow-y-auto">
              {options.map(o => {
                const checked = value.includes(o.id)
                return (
                  <li key={o.id} className="flex items-center justify-between gap-2 rounded-md px-1 py-1 text-xs">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input type="checkbox" checked={checked} data-team-check={o.code}
                        onChange={() => onChange(toggleTeam(value, o.id))} />
                      <span className="truncate text-ink">{o.code}</span>
                    </label>
                    <label className="flex shrink-0 items-center gap-1 text-ink-subtle" title="대표 팀">
                      <input type="radio" name={`${label}-primary`} checked={value[0] === o.id} data-team-primary={o.code}
                        aria-label={`${o.code} 대표 팀`}
                        onChange={() => onChange(setPrimaryTeam(value, o.id))} />
                      대표
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
