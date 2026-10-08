export const WBS_FONT_SCALE_STORAGE_KEY = 'dflow-wbs-font-scale'
export const WBS_FONT_SCALES = [100, 115, 130] as const
export const WBS_FONT_SCALE_DEFAULT = 100

export type WbsFontScale = (typeof WBS_FONT_SCALES)[number]

export function parseWbsFontScale(value: unknown): WbsFontScale | null {
  const numberValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : Number.NaN
  return WBS_FONT_SCALES.find(scale => scale === numberValue) ?? null
}

export function stepWbsFontScale(current: WbsFontScale, direction: 1 | -1): WbsFontScale {
  const index = WBS_FONT_SCALES.indexOf(current)
  const nextIndex = Math.min(WBS_FONT_SCALES.length - 1, Math.max(0, index + direction))
  return WBS_FONT_SCALES[nextIndex]
}

function scaledPx(base: number, scale: WbsFontScale): string {
  return `${Number((base * scale / 100).toFixed(2))}px`
}

function cappedScaledPx(base: number, scale: WbsFontScale, maximum: number): string {
  return `${Number(Math.min(base * scale / 100, maximum).toFixed(2))}px`
}

/**
 * 표 폭은 그대로 두고 텍스트 계층만 같은 비율로 확대하는 CSS 변수 묶음.
 * 읽는 글자(셀·번호·머리·칩·배지·담당)는 100% 에서 12px 이 하한이다(개정 §5.5.6). 12px 미만은 간트 눈금(timeline·day)·
 * 막대 안팎 퍼센트(bar)·담당 표지 도형(owner-mark)뿐이고 tests/css/min-font-size.test.ts 의 허용 목록에 적혀 있다.
 */
export function wbsFontScaleVariables(scale: WbsFontScale): Record<string, string> {
  return {
    '--wbs-cell-font': scaledPx(12, scale),
    // 하한을 12px 로 올린 계층은 옛 최대값(130% 때 번호 14.3·머리 13·담당 13.65)을 상한으로 둔다 — 고정 폭 열에서 더 커지지 않게.
    '--wbs-index-font': cappedScaledPx(12, scale, 14.3),
    '--wbs-head-font': cappedScaledPx(12, scale, 13),
    '--wbs-timeline-font': scaledPx(9.5, scale),
    '--wbs-day-font': scaledPx(9, scale),
    // 고정 폭 상태/구분 열은 내부 패딩까지 있어 상한이 없으면 라벨 자체가 사라진다.
    '--wbs-chip-font': cappedScaledPx(12, scale, 13),
    '--wbs-badge-font': cappedScaledPx(12, scale, 12),
    '--wbs-owner-font': cappedScaledPx(12, scale, 13.65),
    '--wbs-owner-mark-font': scaledPx(9, scale),
    '--wbs-bar-font': scaledPx(9, scale),
  }
}
