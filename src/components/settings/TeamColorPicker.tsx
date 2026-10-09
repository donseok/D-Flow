'use client'
// 팀 색 선택(공용 팀·프로젝트 팀 관리 화면 공용) — 테마 슬롯(category-1..8) 여덟 개에서만 고른다. 임의 hex 는 받지 않는다(다크 대비).
// 닫힌 상태는 지금 색의 견본 단추 하나(보이는 크기 24px, 누르는 영역 44px — TOUCH_TARGET), 열면 그 아래 여덟 견본(각 44px 칸).
// 목록은 표의 가로 스크롤(overflow-x-auto)에 잘리지 않게 body 포털 + fixed 로 띄운다(TeamMultiSelect 와 같은 이유). Esc·바깥 클릭·
// 고르기로 닫히고 포커스는 단추로 돌아간다. 저장은 호출부(updateTeam·updateProjectTeam 의 colorSlot)가 한다.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { CATEGORY_SLOTS, teamSlotIndex } from '@/lib/domain/teamColor'
import { TOUCH_TARGET } from '@/components/ui/touchTarget'

export function TeamColorPicker({ team, disabled, onPick }: {
  team: { id: string; name: string; color: string }
  disabled: boolean
  /** slot = 1~8 */
  onPick: (slot: number) => void
}) {
  const { t } = useLocale()
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const current = teamSlotIndex(team)

  const close = (returnFocus: boolean) => { setOpen(false); setPos(null); if (returnFocus) buttonRef.current?.focus() }

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const r = buttonRef.current.getBoundingClientRect()
    // 좁은 화면에서 오른쪽으로 넘치지 않게 왼쪽 자리를 당긴다(목록 폭 = 44px × 4 + 안쪽 여백)
    const width = 44 * 4 + 16
    setPos({ position: 'fixed', top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), width })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node
      if (buttonRef.current?.contains(n) || popRef.current?.contains(n)) return
      setOpen(false); setPos(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 열리면 지금 색(없으면 첫 견본)으로 포커스를 옮긴다 — 포털은 문서 끝이라 탭 순서가 단추 뒤에 이어지지 않는다
  useEffect(() => {
    if (!open || !pos) return
    const el = popRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? popRef.current?.querySelector<HTMLButtonElement>('button')
    el?.focus()
  }, [open, pos])

  return (
    <>
      <button ref={buttonRef} type="button" data-team-color={team.id} data-team-color-slot={current} disabled={disabled}
        aria-haspopup="true" aria-expanded={open} aria-label={t('settings.teams.colorPick').replace('{name}', team.name)}
        onClick={() => (open ? close(false) : setOpen(true))}
        className={`inline-flex size-6 shrink-0 rounded-full ring-1 ring-border transition hover:ring-2 hover:ring-border-focus disabled:opacity-50 ${CATEGORY_SLOTS[current - 1].bar} ${TOUCH_TARGET}`} />
      {open && pos && createPortal(
        <div ref={popRef} style={pos} role="radiogroup" aria-label={t('settings.teams.colorGroup').replace('{name}', team.name)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); close(true); return }
            if (e.key !== 'Tab') return
            // 목록 양 끝의 Tab·Shift+Tab 은 닫고 단추로 돌려보낸다(포털은 문서 끝 — 그대로 두면 포커스가 페이지 밖으로 나간다)
            const items = [...(popRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
            const edge = e.shiftKey ? items[0] : items[items.length - 1]
            if (document.activeElement === edge) { e.preventDefault(); close(true) }
          }}
          className="z-50 grid grid-cols-4 rounded-lg border border-border bg-surface p-2 shadow-lg outline-none">
          {CATEGORY_SLOTS.map((slot, i) => {
            const n = i + 1
            const on = n === current
            return (
              <button key={n} type="button" role="radio" aria-checked={on} data-team-color-option={n}
                aria-label={t('settings.teams.colorOption').replace('{n}', String(n))}
                onClick={() => { close(true); if (!on) onPick(n) }}
                className="flex size-11 items-center justify-center rounded-md hover:bg-surface-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus">
                <span className={`flex size-6 items-center justify-center rounded-full text-category-fg ${slot.bar} ${on ? 'ring-2 ring-border-focus ring-offset-2 ring-offset-surface' : ''}`}>
                  {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                </span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
