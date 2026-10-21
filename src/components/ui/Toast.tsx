'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle, Info, X, type LucideIcon } from 'lucide-react'
import { useLocale } from '@/components/providers/LocaleProvider'
import { TOUCH_TARGET } from './touchTarget'

type ToastVariant = 'success' | 'error' | 'info'

/** action — 다음 화면으로 가는 링크 하나(예: 등록 뒤 「작업 계획에서 보기」). 누르면 토스트도 닫힌다 */
type ToastInput = { title: string; description?: string; variant?: ToastVariant; action?: { label: string; href: string } }
type ToastItem = ToastInput & { id: number }

type ToastApi = { toast: (t: ToastInput) => void }

const ToastContext = createContext<ToastApi | null>(null)

/** 토스트를 띄우는 훅. `<ToastProvider>` 하위에서만 사용. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 는 <ToastProvider> 안에서만 사용할 수 있습니다.')
  return ctx
}

const AUTO_DISMISS_MS = 3500
/** 링크가 달린 토스트 — 읽고 누를 틈을 더 준다 */
const ACTION_DISMISS_MS = 8000

const VARIANT: Record<ToastVariant, { icon: LucideIcon; iconWrap: string }> = {
  success: { icon: CheckCircle2, iconWrap: 'bg-success-weak text-success' },
  error: { icon: AlertTriangle, iconWrap: 'bg-danger-weak text-danger' },
  info: { icon: Info, iconWrap: 'bg-action-soft text-action' },
}

/** 앱을 감싸 토스트 스택을 제공한다. 우측 하단에 쌓이며 자동/수동으로 닫힌다. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const seq = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput) => {
    seq.current += 1
    const item: ToastItem = { ...input, id: seq.current }
    setToasts(prev => [...prev, item])
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="pointer-events-none fixed bottom-32 right-4 z-(--z-toast) flex w-[min(92vw,360px)] flex-col gap-2.5"
        role="region"
        aria-label={t('ui.toastRegion')}
      >
        {/* dismiss 는 고정 함수 — 카드마다 새 화살표를 넘기면 다른 토스트가 오갈 때마다 모든 카드의 시간이 처음부터 다시 돈다 */}
        {toasts.map(item => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const { t } = useLocale()
  const [shown, setShown] = useState(false)
  const meta = VARIANT[item.variant ?? 'info']
  const Icon = meta.icon
  const close = useCallback(() => onDismiss(item.id), [onDismiss, item.id])

  // 진입 애니메이션 (prefers-reduced-motion 은 globals 의 transition 0.01ms 규칙으로 자동 처리)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // 자동 소멸 — 마우스가 위에 있거나 초점이 안에 있으면(링크·닫기로 Tab) 멈춘다. 둘 다 풀려야 처음부터 다시 센다
  const delay = item.action ? ACTION_DISMISS_MS : AUTO_DISMISS_MS
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovered = useRef(false)
  const focused = useRef(false)
  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }, [])
  const start = useCallback(() => {
    stop()
    if (hovered.current || focused.current) return
    timer.current = setTimeout(close, delay)
  }, [close, stop, delay])
  useEffect(() => {
    start()
    return stop
  }, [start, stop])

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => { hovered.current = true; stop() }}
      onMouseLeave={() => { hovered.current = false; start() }}
      onFocus={() => { focused.current = true; stop() }}
      onBlur={event => {
        // 카드 안에서 링크 → 닫기로 옮겨 가는 것은 떠난 것이 아니다
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        focused.current = false
        start()
      }}
      className={`card pointer-events-auto flex items-start gap-3 p-3.5 pr-2.5 transition duration-200 ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      }`}
      style={{ boxShadow: 'var(--shadow-lg)' }}
    >
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${meta.iconWrap}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="text-sm font-semibold text-fg">{item.title}</div>
        {item.description && <div className="mt-0.5 text-xs leading-5 text-fg-secondary">{item.description}</div>}
        {item.action && (
          <Link
            href={item.action.href}
            onClick={close}
            className="pointer-events-auto mt-1 inline-flex min-h-6 items-center text-meta font-semibold text-action underline underline-offset-2 hover:text-action-hover"
          >
            {item.action.label}
          </Link>
        )}
      </div>
      <button
        onClick={close}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-fg-muted transition hover:bg-surface-subtle hover:text-fg ${TOUCH_TARGET}`}
        aria-label={t('ui.toastDismiss')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
