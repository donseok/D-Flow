/**
 * 버튼 모양의 한 원천(개정 §5.7.1, 계획 판정 Q16·Q25) — 'use client' 가 아닌 모듈이라 서버 컴포넌트(StatusMessage 의 링크 행동 등)도
 * 문자열 그대로 import 한다. Button 은 이 클래스에 상태 계약(aria-disabled·busy)을 더한다. 높이는 조작 높이 토큰(--control-h)
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-action text-action-fg hover:bg-action-hover active:bg-action-pressed',
  secondary: 'border border-border-input bg-surface text-fg hover:bg-surface-hover hover:border-border-focus/50',
  ghost: 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
}
export const BUTTON_BASE =
  'relative inline-flex h-(--control-h) items-center justify-center gap-2 rounded-(--radius-control) px-3.5 text-control font-semibold ' +
  'transition-[color,background-color,border-color,opacity,box-shadow] duration-(--motion-fast) ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

/** 상태 계약이 필요 없는 버튼 모양(링크·단순 버튼) @param {ButtonVariant} variant */
export const buttonClass = (variant: ButtonVariant = 'secondary') => `${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`

