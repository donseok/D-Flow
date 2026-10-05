'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { useEscHandler, ESC_PRIORITY } from '@/lib/ui/escStack'
import { DirtyConfirmDialog } from '@/components/ui/DirtyConfirmDialog'

const subscribeMounted = () => () => {}
const clientMounted = () => true
const serverMounted = () => false

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** 접근성 모달 — Escape/백드롭 닫기 + 포커스 트랩/복원. dirty 시 이탈 확인(D6-§7-exit). */
export function Modal({
  open, onClose, title, eyebrow, children, footer, size = 'md',
  dirty = false, dirtyConfirmTitle, dirtyConfirmDesc,
}: {
  open: boolean
  onClose: () => void
  title?: string
  eyebrow?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** 폼 수정 사항이 있는지 여부 (true일 경우 닫기 시 확인 다이얼로그 노출) */
  dirty?: boolean
  dirtyConfirmTitle?: string
  dirtyConfirmDesc?: string
}) {
  const { t } = useLocale()
  const panelRef = useRef<HTMLDivElement>(null)
  const [showDirtyConfirm, setShowDirtyConfirm] = useState(false)
  // SSR and the first hydration render both omit the portal, including direct ?focus links.
  const mounted = useSyncExternalStore(subscribeMounted, clientMounted, serverMounted)

  // onClose는 소비자가 인라인 화살표로 넘기는 게 보통이라 렌더마다 identity가 바뀐다.
  // 이를 effect 의존성에 넣으면 타이핑(리렌더)마다 트랩이 재설치되며 포커스를 빼앗으므로,
  // 최신 참조는 ref로 읽고 effect는 open 전환에만 반응한다.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])

  // autoFocus 자식이 있으면 effect 시점에는 이미 포커스가 모달 내부라 트리거를 알 수 없다.
  // 그 경우를 위해 닫힘→열림 전환 렌더(패널 DOM 생성 전) 시점의 activeElement를 캡처해 둔다.
  // 단, 연쇄 모달(A 닫힘+B 열림 한 커밋)에서는 이 스냅샷이 곧 detach될 A 내부 요소일 수
  // 있으므로 복원 대상은 아래 effect에서 하이브리드로 결정한다.
  const prevFocusRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  if (mounted && open !== wasOpenRef.current) {
    if (open && typeof document !== 'undefined') prevFocusRef.current = document.activeElement as HTMLElement | null
    wasOpenRef.current = open
  }

  const requestClose = () => {
    if (dirty) {
      setShowDirtyConfirm(true)
    } else {
      onCloseRef.current()
    }
  }

  // 모달 수준의 Esc 처리: 우선순위 MODAL(10), DirtyConfirm이 떠있지 않을 때만 활성화
  useEscHandler(
    () => {
      requestClose()
    },
    { priority: ESC_PRIORITY.MODAL, enabled: open && !showDirtyConfirm }
  )

  useEffect(() => {
    if (!open || !mounted) return
    const panel = panelRef.current
    // 복원 대상(트리거) 하이브리드 결정: effect 시점 activeElement가 패널 밖이면 그것 —
    // 연쇄 모달에서는 앞 모달의 cleanup(destroy가 create보다 먼저)이 이 시점에 이미
    // 진짜 트리거로 포커스를 복원해 뒀다. 패널 안이면(autoFocus 자식 선점) 렌더 스냅샷이 트리거다.
    const active = document.activeElement as HTMLElement | null
    const autoFocused = !!panel && panel.contains(active)
    const previouslyFocused = autoFocused ? prevFocusRef.current : active
    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null)
        : []

    // 열릴 때 다이얼로그 안으로 포커스 이동(첫 포커서블, 없으면 패널) — autoFocus 선점 시 존중.
    if (!autoFocused) (focusables()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const f = focusables()
      // 포커스가 트랩 밖으로 샌 경우(저장 중 disabled 전환 등) 다시 안으로 회수.
      if (!panel?.contains(document.activeElement)) { e.preventDefault(); (f[0] ?? panel)?.focus(); return }
      if (f.length === 0) { e.preventDefault(); return }
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      // 닫힐 때 트리거로 포커스 복원.
      previouslyFocused?.focus?.()
    }
  }, [open, mounted])

  if (!open || !mounted || typeof document === 'undefined') return null
  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg'

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-(--z-modal) flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
          {/* 등장 페이드는 배경·패널에 따로 — 바깥(조상)에 opacity 전환을 두면 전환 동안 배경의 backdrop-blur 가 꺼졌다가 끝에 켜진다 */}
          <button className="absolute inset-0 bg-black/45 backdrop-blur-sm transition-opacity duration-(--motion-menu) ease-(--ease-standard) starting:opacity-0" aria-label={t('common.close')} onClick={requestClose} tabIndex={-1} />
          <div ref={panelRef} tabIndex={-1} className={`relative z-10 w-full ${width} overflow-hidden rounded-(--radius-panel) border border-border bg-surface-raised shadow-(--shadow-modal) focus:outline-none transition-opacity duration-(--motion-menu) ease-(--ease-standard) starting:opacity-0`}>
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
              <div className="min-w-0">
                {eyebrow && <div className="text-meta font-semibold text-fg-muted">{eyebrow}</div>}
                {title && <h2 className="mt-0.5 text-base font-bold tracking-tight text-ink">{title}</h2>}
              </div>
              <button onClick={requestClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-muted transition hover:text-ink" aria-label={t('common.close')}><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-6 py-4">{footer}</div>}
          </div>
        </div>,
        document.body,
      )}
      {showDirtyConfirm && (
        <DirtyConfirmDialog
          open={showDirtyConfirm}
          title={dirtyConfirmTitle}
          description={dirtyConfirmDesc}
          onContinue={() => setShowDirtyConfirm(false)}
          onDiscard={() => {
            setShowDirtyConfirm(false)
            onCloseRef.current()
          }}
        />
      )}
    </>
  )
}
