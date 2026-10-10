/**
 * 버튼 모양의 한 원천(개정 §5.7.1, 계획 판정 Q16·Q25) — 'use client' 가 아닌 모듈이라 서버 컴포넌트(StatusMessage 의 링크 행동 등)도
 * 문자열 그대로 import 한다. Button 은 이 클래스에 상태 계약(aria-disabled·busy)을 더한다. 높이는 조작 높이 토큰(--control-h)
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger'

/**
 * 2026-10-10 디자인 정비(사용자 승인 시안): 주 버튼은 action 채움, 보조는 흰 바탕 + 경계.
 * 유령은 중립 글자 그대로 둔다 — 취소·초기화 같은 물러나는 동작이 주 버튼과 같은 파랑이 되면 위계가 흐려진다(글자 링크형 "전체 보기"는 링크가 맡는다).
 * 위험도 채움 그대로다 — 확인 상자의 확정 버튼이고, 손으로 적은 위험 버튼들과 모양이 갈리지 않게.
 * quiet 는 유령과 같은 모양의 이름표다(IconButton 이 쓴다).
 */
export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-action text-action-fg hover:bg-action-hover active:bg-action-pressed',
  secondary: 'border border-border-input bg-surface text-fg hover:bg-surface-hover hover:border-border-focus/50',
  ghost: 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
  quiet: 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
}
export const BUTTON_BASE =
  'relative inline-flex h-(--control-h) items-center justify-center gap-2 rounded-(--radius-control) px-3.5 text-control font-semibold ' +
  'transition-[color,background-color,border-color,opacity,box-shadow] duration-(--motion-fast) ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50'

/** 상태 계약이 필요 없는 버튼 모양(링크·단순 버튼) @param {ButtonVariant} variant */
export const buttonClass = (variant: ButtonVariant = 'secondary') => `${BUTTON_BASE} ${BUTTON_VARIANT[variant]}`

