// 강조색 파생·거부(개정 §5.11.2, 스펙 D30). 값을 못 박지 않고 규칙(대비 하한·상태색 거리·소문자 hex)을 잰다 — 임계값은 SP3b UI-1 이 조정한다.
import { describe, expect, it } from 'vitest'
import { ACCENT_THRESHOLDS, contrastRatio, deriveAccent, hexToOklch, oklchToHex, parseAccentInput, parseAccentValue } from '@/lib/settings/accent'
import { ACCENT_TOKENS } from '@/lib/settings/accentTokens'

const HEX = /^#[0-9a-f]{6}$/

describe('deriveAccent', () => {
  it('제품 action 색에서 라이트·다크 세트를 만든다 — 대비 하한을 지키고 전부 소문자 hex', () => {
    const r = deriveAccent('#315CDB')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { light, dark, base } = r.value
    expect(base).toBe('#315cdb')
    for (const set of [light, dark]) for (const v of Object.values(set)) expect(v).toMatch(HEX)
    expect(light.fg).toBe('#ffffff')
    expect(contrastRatio(light.fg, light.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.fg, dark.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.bg, ACCENT_TOKENS.dark.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.focus, ACCENT_TOKENS.light.canvas)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(dark.focus, ACCENT_TOKENS.dark.canvas)).toBeGreaterThanOrEqual(3)
    expect(light.focus).toBe(light.bg)
    expect(hexToOklch(light.hover)!.L).toBeLessThan(hexToOklch(light.bg)!.L)
    expect(hexToOklch(light.pressed)!.L).toBeLessThan(hexToOklch(light.hover)!.L)
  })
  it('밝은 입력은 흰 글자 대비 4.5 가 되도록 L 을 낮춘다(#ffff00 → 어두운 노랑)', () => {
    const r = deriveAccent('#ffff00')
    expect(r.ok).toBe(true)
    if (r.ok) expect(contrastRatio('#ffffff', r.value.light.bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('상태색과 hue 가 20° 안이고 C 가 0.08 을 넘으면 거부한다 — danger·success 자체와 그 이웃', () => {
    for (const hex of [ACCENT_TOKENS.light.danger, ACCENT_TOKENS.light.success, '#c0392b']) {
      const r = deriveAccent(hex)
      expect(r.ok, hex).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/상태색/)
    }
    // 채도가 낮은 회색은 hue 가 어디든 통과한다
    expect(deriveAccent('#808080').ok).toBe(true)
    expect(ACCENT_THRESHOLDS).toEqual({ hueDistanceDeg: 20, chroma: 0.08 })
  })
  it('거부 응답은 실패한 쌍과 대비값을 싣는다 — 하한을 인위로 올려 본다', () => {
    const strict = { ...ACCENT_THRESHOLDS, minContrast: 30 }
    const r = deriveAccent('#315cdb', strict as never)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.failures.length).toBeGreaterThan(0)
      expect(r.failures[0]).toEqual({ pair: expect.any(String), contrast: expect.any(Number), min: 30 })
    }
  })
  it('hex 가 아니면 거부', () => {
    expect(deriveAccent('red')).toMatchObject({ ok: false })
    expect(deriveAccent('#31')).toMatchObject({ ok: false })
  })
  it('OKLCH 왕복 — hex → oklch → hex 가 같다(색역 안)', () => {
    for (const hex of ['#315cdb', '#000000', '#ffffff', '#197455']) expect(oklchToHex(hexToOklch(hex)!)).toBe(hex)
  })
})

describe('parseAccentInput·parseAccentValue', () => {
  it('입력은 hex 하나(대소문자 허용) 또는 null — 세트를 보내면 거부', () => {
    expect(parseAccentInput('#315CDB')).toEqual({ ok: true, value: '#315CDB' })
    expect(parseAccentInput(null)).toEqual({ ok: true, value: null })
    expect(parseAccentInput({ base: '#315cdb' }).ok).toBe(false)
    expect(parseAccentInput('315cdb').ok).toBe(false)
  })
  it('저장 형태는 정확히 { base, light, dark } 이고 세트는 정확히 여섯 키, 값은 소문자 hex 여야 한다', () => {
    const d = deriveAccent('#315cdb')
    if (!d.ok) throw new Error('파생 실패')
    expect(parseAccentValue(d.value)).toEqual({ ok: true, value: d.value })
    expect(parseAccentValue(null)).toEqual({ ok: true, value: null })
    expect(parseAccentValue({ ...d.value, extra: 1 }).ok).toBe(false)
    expect(parseAccentValue({ ...d.value, light: { ...d.value.light, shadow: '#000000' } }).ok).toBe(false)
    expect(parseAccentValue({ ...d.value, base: '#315CDB' }).ok).toBe(false)
    expect(parseAccentValue({ ...d.value, light: { ...d.value.light, bg: 'red;}' } }).ok).toBe(false)
    expect(parseAccentValue({ ...d.value, dark: { ...d.value.dark, fg: '</style>' } }).ok).toBe(false)
    expect(parseAccentValue('#315cdb').ok).toBe(false)
  })
})
