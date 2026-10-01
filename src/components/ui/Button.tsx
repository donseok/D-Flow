'use client'

import { useId, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

/**
 * 버튼 상태 계약(개정 §5.7.1, SP3b 스펙 §4.5, 계획 판정 Q25) — 기본·hover·pressed·focus·disabled·busy.
 * busy 와 '사유 있는 비활성'은 네이티브 disabled 가 아니라 aria-disabled + 클릭·제출 차단이다 — disabled 는 초점을 잃고
 * 스크린리더가 사유를 읽지 않는다(LoadErrorNotice 선례). busy 는 라벨을 남긴 채 가려 폭을 지킨다. 이동 전환 없음(색·opacity 만).
 * 기존 .btn* 호출부는 그대로 둔다(UI-5).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  variant?: ButtonVariant
  busy?: boolean
  disabled?: boolean
  /** 비활성 사유 — 있으면 옆 글로 보이고 aria-describedby 로 잇는다 */
  disabledReason?: string
  icon?: ReactNode
  children?: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-action text-action-fg hover:bg-action-hover active:bg-action-pressed',
  secondary: 'border border-border-input bg-surface text-fg hover:bg-surface-hover',
  ghost: 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
}
export const BUTTON_BASE =
  'relative inline-flex h-(--control-h) items-center justify-center gap-2 rounded-(--radius-control) px-4 text-control font-semibold ' +
  'transition-[color,background-color,border-color,opacity] duration-(--motion-fast) ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

export function Button({ variant = 'secondary', busy = false, disabled = false, disabledReason, icon, children, className = '', onClick, type = 'button', ...rest }: ButtonProps) {
  const reasonId = useId()
  const soft = busy || (disabled && !!disabledReason)
  const handle = (e: MouseEvent<HTMLButtonElement>) => {
    if (soft) { e.preventDefault(); return }   // 제출 버튼도 막는다(aria-disabled 는 제출을 막지 않는다)
    onClick?.(e)
  }
  const button = (
    <button
      {...rest}
      type={type}
      onClick={handle}
      disabled={disabled && !disabledReason && !busy}
      aria-disabled={soft ? true : undefined}
      aria-busy={busy ? true : undefined}
      aria-describedby={disabled && disabledReason ? reasonId : rest['aria-describedby']}
      className={`${BUTTON_BASE} ${VARIANT[variant]} ${className}`}
    >
      <span className={`inline-flex items-center gap-2 ${busy ? 'invisible' : ''}`}>{icon}{children}</span>
      {busy && <Loader2 className="absolute h-4 w-4 animate-spin" aria-hidden />}
    </button>
  )
  if (!(disabled && disabledReason)) return button
  return (
    <span className="inline-flex items-center gap-2">
      {button}
      <span id={reasonId} className="text-meta text-fg-secondary">{disabledReason}</span>
    </span>
  )
}
