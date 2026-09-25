'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { setPrimaryTeam, toggleTeam } from '@/lib/domain/roster'

export interface TeamOption { id: string; code: string }

/** 목록 최대 높이(max-h-56 = 14rem) + 여백 — 아래 공간이 이보다 작으면 위로 연다. */
const POPOVER_MAX_H = 240
/** 목록 폭(w-56 = 14rem)과 화면 가장자리 여백 — 오른쪽 끝 버튼에서도 목록이 화면 밖으로 나가지 않게. */
const POPOVER_W = 224
const EDGE = 8

/** 목록 안 Tab 정지점 — 같은 name 의 라디오 묶음은 탭 순서에 하나(체크된 것, 없으면 첫 것)만 선다. */
function tabStops(root: HTMLElement): HTMLInputElement[] {
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input:not([disabled])')]
  const radios = inputs.filter(i => i.type === 'radio')
  const radioStop = radios.find(i => i.checked) ?? radios[0]
  return inputs.filter(i => i.type !== 'radio' || i === radioStop)
}

/** 기준 사각형이 overflow 로 자르는 조상(표의 가로 스크롤 등) 영역을 완전히 벗어났는가 — 그러면 fixed 목록만 허공에 남는다. */
function outsideClippingAncestor(el: HTMLElement, r: DOMRect): boolean {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (!/(auto|scroll|hidden|clip)/.test(`${s.overflowX} ${s.overflowY}`)) continue
    const c = p.getBoundingClientRect()
    if (r.right < c.left || r.left > c.right || r.bottom < c.top || r.top > c.bottom) return true
  }
  return false
}

/**
 * 명단 한 행의 팀 — 체크 목록(여러 팀) + 대표 팀 라디오. value 첫 원소가 대표 팀(RPC p_team_ids 규칙).
 * 닫힌 상태는 칩 요약(대표 팀 굵게)이라 표 폭을 적게 쓴다. 바깥 클릭·Esc 로 닫힌다.
 * 목록은 body 포털 + fixed 로 띄운다 — 명단 표의 overflow-x-auto 가 absolute 팝오버를 잘랐다(행 1개일 때 목록이 안 보임).
 * 포털은 문서 끝이라 탭 순서가 버튼 뒤에 이어지지 않는다 — 열 때 목록 첫 입력으로 포커스를 옮기고, 목록 양 끝의 Tab/Shift+Tab·Esc 는
 * 닫고 버튼으로 돌려보낸다. 포커스가 버튼·목록 둘 다를 떠나면 닫는다.
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
  const buttonRef = useRef<HTMLButtonElement>(null)
  const codeOf = new Map(options.map(o => [o.id, o.code]))

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return
      setOpen(false); setPos(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function close(returnFocus: boolean) {
    setOpen(false)
    setPos(null)
    if (returnFocus) buttonRef.current?.focus()
  }

  // 버튼 아래(공간이 모자라면 위)에 붙인다. 스크롤·리사이즈마다 다시 잰다(fixed 라 따라가지 않는다).
  // 버튼이 화면이나 스크롤 컨테이너 밖으로 사라지면 닫는다 — 기준 없이 떠 있는 목록이 남지 않게.
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const el = rootRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight || outsideClippingAncestor(el, r)) { setOpen(false); setPos(null); return }
      const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - POPOVER_W - EDGE))
      const below = window.innerHeight - r.bottom
      setPos(below < POPOVER_MAX_H && r.top > below
        ? { position: 'fixed', left, bottom: window.innerHeight - r.top + 4 }
        : { position: 'fixed', left, top: r.bottom + 4 })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  // 목록이 처음 자리를 잡으면 첫 입력으로 포커스를 옮긴다.
  const placed = pos !== null
  useEffect(() => {
    if (open && placed) popRef.current?.querySelector<HTMLElement>('input')?.focus()
  }, [open, placed])

  function onKeyDown(e: KeyboardEvent) {
    if (!open) return
    if (e.key === 'Escape') { e.preventDefault(); close(true); return }
    if (e.key !== 'Tab' || !popRef.current?.contains(e.target as Node)) return
    const stops = tabStops(popRef.current)
    const edge = e.shiftKey ? stops[0] : stops[stops.length - 1]
    if (e.target === edge) { e.preventDefault(); close(true) }
  }

  // focusout 의 relatedTarget 은 환경마다 비어 올 수 있어, 한 틱 뒤 실제 activeElement 로 판정한다.
  // 목록 안 빈 곳을 눌러도 목록 div(tabIndex -1)가 포커스를 받으므로, 여기서 body 는 '밖으로 나갔다'(문서 끝 너머 등)는 뜻이다.
  function onBlur() {
    if (!open) return
    setTimeout(() => {
      const a = document.activeElement
      if (a && (rootRef.current?.contains(a) || popRef.current?.contains(a))) return
      setOpen(false); setPos(null)
    }, 0)
  }

  return (
    // 키·포커스 이벤트는 포털이어도 React 트리로 버블링돼 이 div 가 받는다.
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="app-input flex h-8 min-w-[7rem] items-center gap-1 text-left text-xs"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={disabled}
        onClick={() => { if (open) close(false); else setOpen(true) }}
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
        <div ref={popRef} role="group" aria-label={label} style={pos} tabIndex={-1}
          className="z-50 outline-none w-56 rounded-lg border border-line bg-surface p-2 shadow-lg">
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
