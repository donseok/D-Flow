// 강조색(branding.accent) 파생·검증 — 개정 §5.11.2 를 순수 함수로. 서버가 저장할 때 base 에서 세트를 계산해 함께
// 저장하고(edit.toStored), 저장값은 parseAccentValue 가 모양만 본다. 거부 응답은 실패한 쌍과 대비값을 싣는다.
// 제품이 라이트 전용(2026-10-10)이라 세트는 light 하나다 — 옛 저장값의 dark 세트는 읽을 때 버린다(parseAccentValue).
// 임계값(D30): 상태색과 hue 거리 20° 미만이면서 C > 0.08 이면 거부 — SP3b UI-1 이 표본 10종으로 20°·0.08 유지를 확정했다
// (tests/settings/accent.test.ts 의 표: 흔한 초록 #2b8a3e 15.5° 거부 · 주황 #f76707 23.6° 통과가 경계, 실현 가능 구간 hue (15.5°, 23.6°] —
// 2026-10-10 디자인 정비로 상태색이 바뀐 뒤 다시 잰 거리다. 옛 값은 18.0°·25.4° 였고 20° 는 여전히 구간 안이다).
import { ACCENT_TOKENS } from './accentTokens'

export type Hex = string
export interface AccentSet { bg: Hex; fg: Hex; hover: Hex; pressed: Hex; soft: Hex; focus: Hex }
export interface AccentValue { base: Hex; light: AccentSet }
export interface AccentFailure { pair: string; contrast: number; min: number }
/** 상태색과 가까워 거부된 이유 — 대비 쌍이 아니라 hue 거리다(쇼케이스·설정 편집기가 '왜'를 보인다) */
export interface AccentHueReject { status: 'danger' | 'success'; distance: number; min: number }
export type AccentDerivation = { ok: true; value: AccentValue } | { ok: false; error: string; failures: AccentFailure[]; hue?: AccentHueReject }
export const ACCENT_THRESHOLDS = { hueDistanceDeg: 20, chroma: 0.08 } as const
type Thresholds = { hueDistanceDeg: number; chroma: number; minContrast?: number; minFocusContrast?: number }

const HEX_LOWER = /^#[0-9a-f]{6}$/
const HEX_ANY = /^#[0-9a-fA-F]{6}$/
const SET_KEYS = ['bg', 'fg', 'hover', 'pressed', 'soft', 'focus'] as const
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_ANY.test(hex)) return null
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
const rgbToHex = (rgb: number[]): Hex => '#' + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function linearToOklab([r, g, b]: number[]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
function oklabToLinear([L, a, b]: number[]): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function hexToOklch(hex: string): { L: number; C: number; h: number } | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [L, a, b] = linearToOklab(rgb.map(toLinear))
  const C = Math.hypot(a, b)
  if (C < 1e-6) return { L, C: 0, h: 0 }
  return { L, C, h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}
const inGamut = (lin: number[]) => lin.every((c) => c >= -1e-6 && c <= 1 + 1e-6)
/** 색역 밖이면 C 를 줄여 안으로 넣는다 — hue·L 은 지킨다 */
export function oklchToHex({ L, C, h }: { L: number; C: number; h: number }): Hex {
  const rad = (h * Math.PI) / 180
  let c = C
  for (let i = 0; i < 40; i++) {
    const lin = oklabToLinear([L, c * Math.cos(rad), c * Math.sin(rad)])
    if (inGamut(lin)) return rgbToHex(lin.map(toGamma))
    c *= 0.9
  }
  return rgbToHex(oklabToLinear([L, 0, 0]).map((x) => toGamma(clamp01(x))))
}
function relativeLuminance(hex: Hex): number {
  const [r, g, b] = hexToRgb(hex)!.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG 상대 명도 대비(1~21) */
export function contrastRatio(a: Hex, b: Hex): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const hueDistance = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

export function deriveAccent(baseHex: string, thresholds: Thresholds = ACCENT_THRESHOLDS): AccentDerivation {
  const base = hexToOklch(baseHex)
  if (!base) return { ok: false, error: '강조색은 #rrggbb 형식이어야 합니다.', failures: [] }
  const minContrast = thresholds.minContrast ?? 4.5
  const minFocus = thresholds.minFocusContrast ?? 3
  // 3. 상태색과의 거리 — 위험·성공과 헷갈리는 색은 받지 않는다(채도가 낮으면 무채색이라 봐 준다)
  for (const [name, hex] of [['danger', ACCENT_TOKENS.light.danger], ['success', ACCENT_TOKENS.light.success]] as const) {
    const t = hexToOklch(hex)!
    const distance = hueDistance(base.h, t.h)
    if (base.C > thresholds.chroma && distance < thresholds.hueDistanceDeg) {
      return { ok: false, error: `상태색(${name})과 색상이 가까워 강조색으로 쓸 수 없습니다.`, failures: [],
        hue: { status: name, distance: Math.round(distance * 10) / 10, min: thresholds.hueDistanceDeg } }
    }
  }
  // 1. 흰 글자 대비가 하한이 될 때까지 L 을 낮춘다
  let L = base.L
  let bg = oklchToHex({ L, C: base.C, h: base.h })
  for (let i = 0; i < 100 && contrastRatio('#ffffff', bg) < minContrast && L > 0.05; i++) {
    L -= 0.01
    bg = oklchToHex({ L, C: base.C, h: base.h })
  }
  const light: AccentSet = {
    bg, fg: '#ffffff',
    hover: oklchToHex({ L: L - 0.05, C: base.C, h: base.h }),
    pressed: oklchToHex({ L: L - 0.1, C: base.C, h: base.h }),
    soft: oklchToHex({ L: 0.96, C: 0.03, h: base.h }),
    focus: bg,
  }
  // 2. 하한 검사 — 한 쌍이라도 미달이면 거부하고 쌍과 값을 돌려준다
  const failures: AccentFailure[] = []
  const need = (pair: string, a: Hex, b: Hex, min: number) => {
    const c = contrastRatio(a, b)
    if (c < min) failures.push({ pair, contrast: Math.round(c * 100) / 100, min })
  }
  need('light.fg/light.bg', light.fg, light.bg, minContrast)
  need('light.focus/light.canvas', light.focus, ACCENT_TOKENS.light.canvas, minFocus)
  if (failures.length) return { ok: false, error: '강조색의 대비가 하한에 미치지 못합니다.', failures }
  return { ok: true, value: { base: baseHex.toLowerCase(), light } }
}

/** 편집 입력 — hex 하나 또는 null(기본값으로). 세트를 직접 보내면 거부한다(개정 §2.3.1 ④) */
export function parseAccentInput(raw: unknown): { ok: true; value: Hex | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw === 'string' && HEX_ANY.test(raw)) return { ok: true, value: raw }
  return { ok: false, error: '강조색은 #rrggbb 하나 또는 비움이어야 합니다.' }
}

function isAccentSet(x: unknown): x is AccentSet {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false
  const keys = Object.keys(x)
  if (keys.length !== SET_KEYS.length || SET_KEYS.some((k) => !keys.includes(k))) return false
  return SET_KEYS.every((k) => typeof (x as Record<string, unknown>)[k] === 'string' && HEX_LOWER.test((x as Record<string, string>)[k]))
}
/**
 * 저장 형태 — { base, light }, 세트는 정확히 여섯 키, 모든 값이 소문자 hex. 아니면 거부(읽을 때는 invalid).
 * 라이트 전용 결정(2026-10-10) 전에 저장된 값에는 dark 세트가 함께 있다 — 그 키는 내용을 보지 않고 버린다(주입하지 않으므로 검사할 이유가 없고,
 * 거부하면 멀쩡한 강조색이 손상 값으로 뜬다). 그 밖의 여분 키는 그대로 거부한다.
 */
export function parseAccentValue(raw: unknown): { ok: true; value: AccentValue | null } | { ok: false; error: string } {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '강조색 저장값은 객체여야 합니다.' }
  const o = raw as Record<string, unknown>
  const keys = Object.keys(o).filter((k) => k !== 'dark').sort()
  if (keys.join(',') !== 'base,light') return { ok: false, error: '강조색 저장값은 base·light 만 가져야 합니다.' }
  if (typeof o.base !== 'string' || !HEX_LOWER.test(o.base)) return { ok: false, error: 'base 는 소문자 #rrggbb 여야 합니다.' }
  if (!isAccentSet(o.light)) return { ok: false, error: '세트는 bg·fg·hover·pressed·soft·focus 여섯 소문자 hex 여야 합니다.' }
  return { ok: true, value: { base: o.base, light: o.light } }
}
