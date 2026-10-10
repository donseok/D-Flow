/**
 * 워크스페이스 accent 주입(D23) — 순수. 저장 세트(branding.accent.light)의 여섯 키 = action 계열 여섯 변수. 여섯 값이 모두
 * 소문자 hex 일 때만 :root{…} 한 블록을 낸다(제품이 라이트 전용이라 세트는 하나다). 하나라도 아니면 '' — 제품 기본 코발트
 * (손상 저장값 로그는 해석기가 남긴다, SP3a D39).
 */
import type { AccentSet, AccentValue } from './accent'

const HEX = /^#[0-9a-f]{6}$/
const VARS: ReadonlyArray<[keyof AccentSet, string]> = [
  ['bg', '--color-action'], ['fg', '--color-action-fg'], ['hover', '--color-action-hover'],
  ['pressed', '--color-action-pressed'], ['soft', '--color-action-soft'], ['focus', '--color-border-focus'],
]
const valid = (s: AccentSet | null | undefined): s is AccentSet => !!s && VARS.every(([k]) => typeof s[k] === 'string' && HEX.test(s[k]))
const block = (sel: string, s: AccentSet) => `${sel}{${VARS.map(([k, v]) => `${v}:${s[k]}`).join(';')}}`

export function accentStyle(value: Pick<AccentValue, 'light'> | null | undefined): string {
  if (!value || !valid(value.light)) return ''
  return block(':root', value.light)
}
