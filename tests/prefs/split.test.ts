import { describe, expect, it } from 'vitest'
import { ACCOUNT_PREF_KEYS, FAVORITES_MAX, RECENT_MAX, RETIRED_PREF_KEYS, WORKSPACE_PREF_KEYS, mergePrefs, pushRecent, splitPrefs } from '@/lib/prefs/split'
import type { UiPrefs } from '@/lib/domain/types'

const U = (n: number) => `00000000-0000-0000-7e57-0000000016${String(40 + n).padStart(2, '0')}`

/** UiPrefs 의 키 전부 — 타입이 새 키를 얻으면 이 목록을 고치라고 컴파일러가 알린다(Record<keyof UiPrefs, true>) */
const ALL: Record<keyof UiPrefs, true> = {
  theme: true, locale: true, sidebarCollapsed: true, dashSections: true, minutesView: true, minuteFontSize: true, minutesExplorerLayout: true,
  wbsHideDone: true, wbsOutline: true, wbsGanttScale: true, notif: true,
  startPage: true, favoriteProjectIds: true, recentProjects: true, notifRead: true,
  heroCollapsed: true, lastProjectId: true,
}

describe('두 목록 — 서로소이고 합집합 = UiPrefs 키(은퇴 둘 제외)', () => {
  it('서로소·합집합', () => {
    const a = new Set<string>(ACCOUNT_PREF_KEYS), w = new Set<string>(WORKSPACE_PREF_KEYS)
    expect([...a].filter((k) => w.has(k))).toEqual([])
    expect([...a, ...w, ...RETIRED_PREF_KEYS].sort()).toEqual(Object.keys(ALL).sort())
  })
})

describe('splitPrefs', () => {
  it('계정·워크스페이스로 가르고 은퇴·모르는 키는 버린다', () => {
    expect(splitPrefs({ theme: 'dark', startPage: 'my_work', heroCollapsed: true, ...({ evil: 1 } as object) } as Partial<UiPrefs>))
      .toEqual({ account: { theme: 'dark' }, workspace: { startPage: 'my_work' }, dropped: ['heroCollapsed', 'evil'] })
  })
  it('형식 검사 — 즐겨찾기 uuid·상한 20(중복 제거), 최근 {id,at}·상한 10, startPage 닫힌 값', () => {
    const many = Array.from({ length: 25 }, (_, i) => U(i % 22))
    const r = splitPrefs({ favoriteProjectIds: [...many, 'not-uuid'], startPage: 'nope' as UiPrefs['startPage'], recentProjects: [{ id: U(1), at: '2026-10-01T00:00:00Z' }, { id: 'x', at: 'y' } as never] })
    expect(r.workspace.favoriteProjectIds).toHaveLength(FAVORITES_MAX)
    expect(new Set(r.workspace.favoriteProjectIds).size).toBe(FAVORITES_MAX)
    expect(r.workspace.recentProjects).toEqual([{ id: U(1), at: '2026-10-01T00:00:00Z' }])
    expect(r.workspace).not.toHaveProperty('startPage')
    expect(r.dropped).toContain('startPage')
  })
})

describe('mergePrefs·pushRecent', () => {
  it('워크스페이스 키는 워크스페이스 행, 계정 키는 계정 행에서만 읽는다(섞여 있어도)', () => {
    expect(mergePrefs({ theme: 'dark', startPage: 'projects' } as Partial<UiPrefs>, { startPage: 'home', theme: 'light' } as Partial<UiPrefs>))
      .toEqual({ theme: 'dark', startPage: 'home' })
  })
  it('pushRecent — 앞에 넣고 중복 제거, 10개로 자른다', () => {
    let list: { id: string; at: string }[] = []
    for (let i = 0; i < 12; i++) list = pushRecent(list, U(i), `2026-10-01T00:00:${String(i).padStart(2, '0')}Z`)
    list = pushRecent(list, U(5), '2026-10-01T01:00:00Z')
    expect(list).toHaveLength(RECENT_MAX)
    expect(list[0]).toEqual({ id: U(5), at: '2026-10-01T01:00:00Z' })
    expect(list.filter((x) => x.id === U(5))).toHaveLength(1)
  })
})
