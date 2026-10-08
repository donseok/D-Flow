'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { GitCompareArrows } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'

/** 비교 한 줄 — 값은 화면에 보일 글자로 넘긴다(빈 문자열 = 비어 있음). base 는 편집을 시작할 때 본 값(알 때만) */
export interface ConflictField { key: string; label: string; mine: string; latest: string; base?: string }

export interface ConflictResolverProps {
  open: boolean
  /** 무엇이 충돌했는지(행·항목 이름) — 제목 아래 한 줄 */
  target?: string
  fields: readonly ConflictField[]
  /** 내 값을 서버의 현재 값 기준으로 다시 저장한다 — 호출자가 최신 기준(latest)을 기대값으로 한 번만 쓴다 */
  onKeepMine: () => void
  /** 내 입력을 버리고 서버 값을 받는다 — 쓰지 않는다 */
  onTakeLatest: () => void
  /** 아무것도 정하지 않고 편집으로 돌아간다(Esc·바깥 누름과 같다) — 입력은 그대로다 */
  onContinue: () => void
  busy?: boolean
}

const FOCUSABLE = 'button:not([disabled])'
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()
const BTN = 'rounded-(--radius-control) border border-border-input bg-surface px-3.5 py-1.5 text-sm font-medium text-fg shadow-xs transition-[color,background-color,border-color,box-shadow] duration-(--motion-fast) hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-60'

/**
 * 저장 충돌 비교(개정 §5.8.1 `Editing/Saving → Conflict`, Q05). 내 값·서버의 현재 값(·편집 시작 때 값)을 나란히 보이고
 * 셋 중 하나를 고르게 한다. 조용히 덮지도, 조용히 버리지도 않는다 — 닫는 길(Esc·바깥)은 '계속 편집'이라 입력이 남는다.
 * 층은 이탈 확인과 같다(`--z-modal-alert` — 모달 위·토스트 아래). 포커스는 상자 안에 가두고 닫히면 원래 자리로 돌린다.
 */
export function ConflictResolver({ open, target, fields, onKeepMine, onTakeLatest, onContinue, busy = false }: ConflictResolverProps) {
  const { t } = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const onContinueRef = useRef(onContinue)
  useEffect(() => { onContinueRef.current = onContinue }, [onContinue])

  // 셀·모달보다 먼저 받는다 — 비교가 떠 있는 동안의 Esc 는 아래 층(셀 편집·모달)을 닫지 않는다
  useEscHandler(() => { onContinueRef.current() }, { priority: ESC_PRIORITY.PICKER + 10, enabled: open })

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    // 가장 안전한 선택(아무것도 쓰지도 버리지도 않는다)에 먼저 둔다
    continueRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      const f = panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
      if (f.length === 0) { e.preventDefault(); return }
      const first = f[0]
      const last = f[f.length - 1]
      if (!panel?.contains(document.activeElement)) { e.preventDefault(); first.focus(); return }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      // 닫히며 편집기가 사라졌을 수 있다 — 남아 있을 때만 돌려준다
      if (previouslyFocused?.isConnected) previouslyFocused.focus?.()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null
  const show = (v: string) => (v === '' ? t('common.conflictEmpty') : v)
  const hasBase = fields.some(f => f.base !== undefined)

  return createPortal(
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-resolver-title"
      aria-describedby="conflict-resolver-desc"
      data-testid="conflict-resolver"
      className="fixed inset-0 z-(--z-modal-alert) flex items-center justify-center p-4"
      // 포털이어도 React 이벤트는 부모 컴포넌트로 올라간다 — 상자 안의 누름·키가 아래 셀·행의 처리기로 새지 않게 막는다
      onClick={stop} onMouseDown={stop} onKeyDown={stop}
    >
      <div className="fixed inset-0 bg-black/50" onClick={() => onContinueRef.current()} aria-hidden="true" />
      <div ref={panelRef} className="relative w-full max-w-lg rounded-(--radius-panel) border border-border bg-surface-raised p-5 shadow-(--shadow-modal)">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning-weak text-warning">
            <GitCompareArrows className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="conflict-resolver-title" className="text-base font-semibold text-fg">{t('common.conflictTitle')}</h3>
            {target && <p className="mt-0.5 truncate text-sm font-medium text-fg">{target}</p>}
            <p id="conflict-resolver-desc" className="mt-1 text-sm leading-relaxed text-fg-secondary">{t('common.conflictDesc')}</p>
          </div>
        </div>

        <div className="mt-4 max-h-[50vh] space-y-2 overflow-y-auto">
          {fields.map(f => (
            <div key={f.key} data-conflict-field={f.key} className="rounded-(--radius-control) border border-border bg-surface p-3">
              <p className="mb-2 text-sm font-semibold text-fg">{f.label}</p>
              <dl className={`grid gap-2 text-sm ${hasBase ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                <div>
                  <dt className="text-xs text-fg-muted">{t('common.conflictMine')}</dt>
                  <dd data-conflict-value="mine" className="whitespace-pre-wrap break-words text-fg">{show(f.mine)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-fg-muted">{t('common.conflictLatest')}</dt>
                  <dd data-conflict-value="latest" className="whitespace-pre-wrap break-words text-fg">{show(f.latest)}</dd>
                </div>
                {f.base !== undefined && (
                  <div>
                    <dt className="text-xs text-fg-muted">{t('common.conflictBase')}</dt>
                    <dd data-conflict-value="base" className="whitespace-pre-wrap break-words text-fg-secondary">{show(f.base)}</dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button ref={continueRef} type="button" data-conflict-action="continue" className={BTN} disabled={busy} onClick={onContinue}>
            {t('common.continueEditing')}
          </button>
          <button type="button" data-conflict-action="latest" className={BTN} disabled={busy} onClick={onTakeLatest}>
            {t('common.conflictTakeLatest')}
          </button>
          <button type="button" data-conflict-action="mine" disabled={busy} onClick={onKeepMine}
            className="rounded-(--radius-control) bg-action px-3.5 py-1.5 text-sm font-medium text-action-fg shadow-xs transition-[color,background-color,opacity,box-shadow] duration-(--motion-fast) hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-60">
            {t('common.conflictKeepMine')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
