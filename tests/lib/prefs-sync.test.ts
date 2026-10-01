import { describe, it, expect } from 'vitest'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'

const local: LocalPrefs = { sidebarCollapsed: false, theme: 'light', locale: 'ko' }
const noTheme: LocalPrefs = { ...local, theme: null }

describe('computePrefsSync', () => {
  it('서버가 비어있으면 로컬 전체를 백필하고 apply 없음(로컬 테마 선호가 있을 때)', () => {
    const r = computePrefsSync({}, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual(local)
  })

  it('로컬 테마 선호가 없으면 테마는 백필하지 않는다 — 고른 적 없는 사용자에게 light 를 저장하지 않는다(D10)', () => {
    const r = computePrefsSync({}, noTheme)
    expect('theme' in r.backfill).toBe(false)
    expect(r.backfill).toEqual({ sidebarCollapsed: false, locale: 'ko' })
  })

  it('서버 값이 로컬과 다르면 apply, 같으면 무시', () => {
    const r = computePrefsSync({ theme: 'dark', locale: 'ko' }, local)
    expect(r.apply).toEqual({ theme: 'dark' })
    expect(r.backfill).toEqual({ sidebarCollapsed: false })
    expect('locale' in r.apply).toBe(false)
    expect('locale' in r.backfill).toBe(false)
  })

  it('서버 system 은 적용한다(3값), 로컬 선호가 없어도 서버가 이긴다', () => {
    expect(computePrefsSync({ theme: 'system' }, local).apply).toEqual({ theme: 'system' })
    expect(computePrefsSync({ theme: 'system' }, noTheme).apply).toEqual({ theme: 'system' })
  })

  it('형식 밖 서버 테마는 없음으로 본다 — 적용하지 않고, 로컬 선호가 있으면 그 값으로 덮는다', () => {
    const bad = { theme: 'purple' } as unknown as Parameters<typeof computePrefsSync>[0]
    expect(computePrefsSync(bad, noTheme).apply).toEqual({})
    expect('theme' in computePrefsSync(bad, noTheme).backfill).toBe(false)
    expect(computePrefsSync(bad, local).backfill.theme).toBe('light')
  })

  it('서버 값이 로컬과 전부 같으면 apply·backfill 모두 비어있음', () => {
    const r = computePrefsSync({ sidebarCollapsed: false, theme: 'light', locale: 'ko' }, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual({})
  })

  it('서버 값이 명시적 null 이면 "없음"으로 취급해 백필한다(로컬 선호가 있을 때)', () => {
    const r = computePrefsSync(
      { sidebarCollapsed: false, locale: 'ko', theme: null } as unknown as Parameters<typeof computePrefsSync>[0],
      local,
    )
    expect(r.backfill).toEqual({ theme: 'light' })
    expect(r.apply).toEqual({})
  })

  it('boolean 키가 로컬과 다르면 apply 되고, false 를 "없음"으로 오인하지 않는다', () => {
    const r = computePrefsSync({ sidebarCollapsed: true }, local)
    expect(r.apply).toEqual({ sidebarCollapsed: true })
    expect('sidebarCollapsed' in r.backfill).toBe(false)
    const off = computePrefsSync({ sidebarCollapsed: false }, { ...local, sidebarCollapsed: true })
    expect(off.apply).toEqual({ sidebarCollapsed: false })
    expect('sidebarCollapsed' in off.backfill).toBe(false)
  })

  it('은퇴 키(heroCollapsed)는 동기화하지 않는다 — 서버에 남아 있어도 적용·백필 없음(SP3b D9)', () => {
    const r = computePrefsSync({ sidebarCollapsed: false, theme: 'light', locale: 'ko', heroCollapsed: false } as Parameters<typeof computePrefsSync>[0], local)
    expect(r).toEqual({ apply: {}, backfill: {} })
  })
})
