// 로고 경로(스펙 D19·§3.6 branding.logo) — 정책의 경로 판정(tests/rls/storage-realtime.test.ts ⑯)과 같은 표본에 같은 답을 내야 한다.
import { describe, expect, it } from 'vitest'
import { BRANDING_MAX_BYTES, makeBrandingPath, parseBrandingPath } from '@/lib/settings/brandingPath'

const WS = '00000000-0000-0000-7e57-00000000aa01'
const HASH = '0123456789abcdef'

describe('parseBrandingPath', () => {
  it('정확한 모양만 받는다 — ws/<uuid>/branding/<slot>-<16자 hex>.<png|jpg|webp>', () => {
    expect(parseBrandingPath(`ws/${WS}/branding/mark-${HASH}.png`)).toEqual({ ok: true, value: { workspaceId: WS, slot: 'mark', hash: HASH, ext: 'png' } })
    expect(parseBrandingPath(`ws/${WS}/branding/full_dark-${HASH}.webp`).ok).toBe(true)
    for (const bad of [
      `ws/${WS}/branding/extra/mark-${HASH}.png`, `ws/${WS}/branding/mark-${HASH}.svg`, `ws/not-a-uuid/branding/mark-${HASH}.png`,
      `ws/${WS}/branding/logo-${HASH}.png`, `ws/${WS}/branding/mark-${HASH.toUpperCase()}.png`, `ws/${WS.toUpperCase()}/branding/mark-${HASH}.png`,
      `p/${WS}/branding/mark-${HASH}.png`, `ws/${WS}/logo/mark-${HASH}.png`, `ws/${WS}/branding/mark-${HASH}.png/`, '', 42, null,
    ]) expect(parseBrandingPath(bad).ok, String(bad)).toBe(false)
  })
  it('makeBrandingPath 는 parse 의 역이다', () => {
    const p = { workspaceId: WS, slot: 'full' as const, hash: HASH, ext: 'jpg' as const }
    expect(parseBrandingPath(makeBrandingPath(p))).toEqual({ ok: true, value: p })
    expect(BRANDING_MAX_BYTES).toBe(262144)
  })
})
