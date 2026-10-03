// 캡처의 accent 셋(W24) — .mjs 는 TS 를 import 하지 못해 파생 세트를 JSON 으로 둔다. 이 테스트가 JSON = deriveAccent 결과를 고정한다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveAccent } from '@/lib/settings/accent'
import { ACCENT_CAPTURE_NAMES, accentPatch } from '../../scripts/ui-capture.mjs'

const accents = JSON.parse(readFileSync('scripts/ui-capture.accents.json', 'utf8'))

describe('ui-capture.accents.json', () => {
  it('세 이름이고 default 는 null(코발트 기본)', () => {
    expect(Object.keys(accents).sort()).toEqual([...ACCENT_CAPTURE_NAMES].sort())
    expect(accents.default).toBeNull()
  })
  it('light·dark 는 UI-1 표본(아주 밝은 색·아주 어두운 색)의 파생 세트와 같다', () => {
    const light = deriveAccent('#ffe066'); const dark = deriveAccent('#1b1f3b')
    expect(light.ok && dark.ok).toBe(true)
    if (light.ok) expect(accents.light).toEqual(light.value)
    if (dark.ok) expect(accents.dark).toEqual(dark.value)
  })
})

describe('accentPatch', () => {
  it('지금 값과 같으면 쓰지 않는다(이력 행을 늘리지 않는다)', () => {
    expect(accentPatch({ 'branding.accent': accents.light }, 'light', accents)).toBeNull()
    expect(accentPatch({}, 'default', accents)).toBeNull()                       // 미설정 = null 과 같다
    expect(accentPatch({ 'branding.accent': null }, 'default', accents)).toBeNull()
  })
  it('다르면 그 값 하나만', () => {
    expect(accentPatch({}, 'dark', accents)).toEqual({ 'branding.accent': accents.dark })
    expect(accentPatch({ 'branding.accent': accents.dark }, 'default', accents)).toEqual({ 'branding.accent': null })
  })
  it('같은 값이면 키 순서가 달라도 쓰지 않는다(jsonb 는 키 순서를 보존하지 않는다)', () => {
    const reordered = JSON.parse(JSON.stringify(accents.light), (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value)
    expect(accentPatch({ 'branding.accent': reordered }, 'light', accents)).toBeNull()
  })
  it('모르는 이름은 throw', () => { expect(() => accentPatch({}, 'neon', accents)).toThrow() })
})
