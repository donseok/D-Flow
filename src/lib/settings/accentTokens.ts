// 강조색 파생·검증의 기준 색 — 개정 §5.5.3(canvas·surface·action)·§5.5.4(danger·success). 소문자 hex. SP3b UI-1 이 같은 모듈을 쓴다.
// 값은 globals.css 의 의미 토큰과 같아야 한다(tests/css/contrast-tokens 의 메타 단언) — 2026-10-10 디자인 정비로 다섯 가운데 넷이 바뀌었다.
export const ACCENT_TOKENS = {
  light: { canvas: '#f4f6fa', surface: '#ffffff', action: '#2456e6', danger: '#c62f3e', success: '#0f7b55' },
} as const
