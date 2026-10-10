import { describe, it, expect } from 'vitest'
import { computePrefsSync, type LocalPrefs } from '@/lib/prefs/sync'

const local: LocalPrefs = { sidebarCollapsed: false }

describe('computePrefsSync', () => {
  it('서버가 비어있으면 로컬 전체를 백필하고 apply 없음', () => {
    const r = computePrefsSync({}, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual(local)
  })

  it('서버 값이 로컬과 전부 같으면 apply·backfill 모두 비어있음', () => {
    const r = computePrefsSync({ sidebarCollapsed: false }, local)
    expect(r.apply).toEqual({})
    expect(r.backfill).toEqual({})
  })

  it('서버 값이 명시적 null 이면 "없음"으로 취급해 백필한다', () => {
    const r = computePrefsSync({ sidebarCollapsed: null } as unknown as Parameters<typeof computePrefsSync>[0], local)
    expect(r.backfill).toEqual({ sidebarCollapsed: false })
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

  it('은퇴 키(heroCollapsed·locale·theme)는 동기화하지 않는다 — 서버에 남아 있어도 적용·백필 없음(SP3b D9, 한국어 전용·라이트 전용 결정 2026-10-10)', () => {
    const r = computePrefsSync({ sidebarCollapsed: false, theme: 'dark', locale: 'en', heroCollapsed: false } as Parameters<typeof computePrefsSync>[0], local)
    expect(r).toEqual({ apply: {}, backfill: {} })
  })
})
